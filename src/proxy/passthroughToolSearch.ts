/**
 * Tool deferral in passthrough mode.
 *
 * NOTE: agent-specific (passthrough mode).
 *
 * A deferred tool is one the model is told the name of and nothing else. Its
 * definition is not in the prompt until the model asks for it with the SDK's
 * ToolSearch tool; the CLI answers that call itself with a `tool_reference`,
 * and the API expands the definition from there on. On a client with a large
 * tool set that is most of the prompt: a live Claude Code session with 199
 * tools carried about 134K tokens of definitions on every Messages call, and
 * in a sibling session's 215 tools the 180 from MCP servers were 73% of the
 * definitions by size.
 *
 * Passthrough registers the client's tools and marks which may be deferred,
 * but it also strips the SDK's built-in tools (`tools: []`), and ToolSearch is
 * one of them. Without it the CLI defers nothing and sends every tool loaded.
 * So deferral needs ToolSearch back in the request, and three things with it:
 *
 *   - The names. The CLI announces deferred tools in an attachment, and
 *     passthrough switches attachments off (CLAUDE_CODE_DISABLE_ATTACHMENTS),
 *     so `deferredToolsNote` says it in the system prompt instead.
 *
 *   - Somewhere to stop. A ToolSearch call and the tool call it leads to are
 *     two Messages calls in one query, so the one-turn cap that ends an
 *     ordinary tool turn (computePassthroughMaxTurns) cannot apply. The
 *     PreToolUse deny carries `continue: false` instead (`endTurnAtDeny`): the
 *     CLI runs the rest of that message's tool calls and ends the query
 *     without calling the model again. Parallel calls each still reach the
 *     hook, and the result commits the transcript as any other does.
 *
 *   - A CLI that honours it. 2.1.284 and 2.1.289 do; 2.1.141, which Agent SDK
 *     0.2.141 bundles, ignores the key and calls the model again. Nothing
 *     says which a given binary is, so the proxy watches (`StopWatch`): a
 *     model turn that starts after a stopped call's message marks that
 *     executable (`noteCliIgnoredStop`) and its sessions go back to every
 *     tool loaded under the one-turn cap, which is cheaper than deferral paid
 *     for with a discarded turn per tool call. A session that already used
 *     ToolSearch survives the switch: the CLI replaces its references with a
 *     line of text.
 *
 * And an upstream that takes the request. The CLI keeps its own tool search
 * off for a base URL that is not Anthropic's, and ENABLE_TOOL_SEARCH=true,
 * which deferral sets, overrides that. `toolSearchUpstream` holds the guard
 * here instead, until the operator vouches for the upstream.
 *
 * One more case needs carrying. A message that calls ToolSearch beside a
 * client tool is handed to the client like any other, and the next request
 * resumes at that message with the client's results only. The ToolSearch
 * result sat after the resume point and is gone, so the CLI fills the gap
 * with "[Tool result missing due to internal error]" and the tool stays
 * unloaded. `InternalToolResults` keeps the real result so the continuation
 * can put it back, for a ToolSearch called ahead of the forwarded call. One
 * called after it is cut off with its result, and the model searches again.
 *
 * Checked against CLI 2.1.141, 2.1.284 and 2.1.289 with
 * scripts/probe-passthrough-tool-search.mjs and
 * scripts/e2e-deferred-tool-turn.mjs; E2E.md E76 records the runs.
 *
 * Leaf module: no imports from server.ts or session/. The two pieces of state
 * it holds are process-wide by nature (what a binary does, what a checkpoint
 * left behind) and neither is persisted.
 */

/** The SDK built-in that loads a deferred tool's definition. */
export const TOOL_SEARCH_TOOL_NAME = "ToolSearch"

/**
 * Messages calls one tool turn may make when deferred tools are on offer:
 * ToolSearch rounds, then the tool call that ends the query. The deny stops
 * the query, not this number, so it is only a bound on a model that keeps
 * searching. A turn that runs into it reaches the client as `max_tokens`.
 */
export const TOOL_SEARCH_TURN_BUDGET = 6

export type ToolSearchInactiveReason =
  /** Nothing is deferred: too few deferrable tools, auto-defer is off, or a
   *  session pinned to deferral has none of them left. */
  | "no_deferred_tools"
  /** MERIDIAN_PASSTHROUGH_TOOL_SEARCH=0. */
  | "disabled"
  /** Advisor, structured output or the early-stop kill switch: the SDK has to
   *  run past the tool boundary, which is where deferral stops it. */
  | "multi_turn_session"
  /** MERIDIAN_PASSTHROUGH_MAX_TURNS=1: a ToolSearch round would end the turn. */
  | "single_turn_pinned"
  /** The CLI offers this model no tool search. */
  | "model"
  /** The client declares a ToolSearch of its own and defers on its side. */
  | "client_tool_search"
  /** CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS reaches the CLI, which then offers
   *  no tool search whatever else it is told. */
  | "experimental_betas_off"
  /** The profile's base URL is not Anthropic's own and nobody vouched for it
   *  (MERIDIAN_PASSTHROUGH_TOOL_SEARCH=force). */
  | "custom_upstream"
  /** This CLI was seen calling the model again after a hook asked it to stop. */
  | "cli_ignores_stop"

export interface ToolSearchDecision {
  active: boolean
  reason?: ToolSearchInactiveReason
}

export interface ToolSearchInput {
  /** At least one of the request's tools is marked for deferral. */
  hasDeferredTools: boolean
  /** The operator's kill switch. */
  disabled: boolean
  /** The SDK child talks to a base URL that is not Anthropic's own. */
  customUpstream: boolean
  /** MERIDIAN_PASSTHROUGH_TOOL_SEARCH=force: that upstream forwards
   *  `tool_reference` blocks, on the operator's word. */
  upstreamVouchedFor: boolean
  /** The SDK child is told to send no experimental betas. */
  experimentalBetasOff: boolean
  /** The turn is one the proxy ends at the tool boundary. */
  stopsAtToolBoundary: boolean
  /** MERIDIAN_PASSTHROUGH_MAX_TURNS, when the operator set one. */
  pinnedTurnBudget?: number
  /** The model the SDK is asked for. */
  model: string
  /** The client's tool names, as it declared them. */
  clientToolNames: readonly string[]
  /** The CLI binary the SDK drives. */
  claudeExecutable: string
}

const stopIgnoredBy = new Set<string>()

/** Has this executable been seen calling the model after a hook's stop? */
export function cliIgnoresStop(claudeExecutable: string): boolean {
  return stopIgnoredBy.has(claudeExecutable)
}

/** Record it. True the first time, so the caller logs it once. */
export function noteCliIgnoredStop(claudeExecutable: string): boolean {
  if (stopIgnoredBy.has(claudeExecutable)) return false
  stopIgnoredBy.add(claudeExecutable)
  return true
}

/**
 * What one request has seen of its queries, kept to tell a CLI that ignored
 * the stop from one that did not.
 *
 * The evidence is the order of the iterator alone: a model turn that starts
 * after a message one of whose calls a hook answered with the stop. When the
 * hook answered is not evidence. The SDK runs a hook as it reads the CLI's
 * request for it, while messages the CLI wrote before that can still be
 * waiting for the iterator's consumer, the `message_start` of the very turn
 * the call belongs to among them. Taking that one for a new turn switched
 * deferral off for the whole process on a CLI that had stopped as asked.
 */
export interface StopWatch {
  /** tool_use ids a hook answered with the stop. */
  asked: Set<string>
  /** tool_use ids the current query's messages have carried so far. */
  carried: Set<string>
  /** API message ids the current query has started. */
  started: Set<string>
}

export function createStopWatch(): StopWatch {
  return { asked: new Set(), carried: new Set(), started: new Set() }
}

/** The hook is about to answer this call with `endTurnAtDeny`. */
export function noteStopAsked(watch: StopWatch, toolUseId: string | undefined): void {
  if (toolUseId) watch.asked.add(toolUseId)
}

/**
 * Feed every message of the request's SDK iterators through this, in order.
 * True for the message that starts a model turn after a stopped call's own:
 * once per such turn, so the caller can act on the first.
 */
export function stopWasIgnored(watch: StopWatch, message: unknown): boolean {
  const m = message as {
    type?: unknown
    subtype?: unknown
    event?: { type?: unknown; message?: { id?: unknown }; content_block?: { type?: unknown; id?: unknown } }
    message?: { id?: unknown; content?: unknown }
  } | null | undefined
  // A query opens with its init message and closes with its result: a retry
  // or a later query of the same request follows none of what came before.
  if ((m?.type === "system" && m.subtype === "init") || m?.type === "result") {
    watch.carried.clear()
    watch.started.clear()
    return false
  }
  if (m?.type === "stream_event") {
    const event = m.event
    if (event?.type === "message_start") {
      const apiId = event.message?.id
      // Without an id there is nothing to tell two starts apart by: each is a turn.
      return turnStarts(watch, typeof apiId === "string" && apiId ? apiId : undefined)
    }
    const block = event?.type === "content_block_start" ? event.content_block : undefined
    if (block?.type === "tool_use" && typeof block.id === "string") watch.carried.add(block.id)
    return false
  }
  if (m?.type !== "assistant") return false
  const apiId = m.message?.id
  const ignored = typeof apiId === "string" && apiId ? turnStarts(watch, apiId) : false
  const content = m.message?.content
  if (Array.isArray(content)) {
    for (const raw of content) {
      const block = raw as { type?: unknown; id?: unknown } | null | undefined
      if (block?.type === "tool_use" && typeof block.id === "string") watch.carried.add(block.id)
    }
  }
  return ignored
}

function turnStarts(watch: StopWatch, apiId: string | undefined): boolean {
  if (apiId !== undefined) {
    if (watch.started.has(apiId)) return false
    watch.started.add(apiId)
  }
  for (const toolUseId of watch.carried) {
    if (!watch.asked.has(toolUseId)) continue
    // What this turn follows has been accounted for.
    watch.carried.clear()
    return true
  }
  return false
}

/**
 * The models the CLI gives no tool search: a model whose lower-cased name
 * holds one of these.
 *
 * NOTE: the CLI reads its list from a feature flag
 * (`tengu_tool_search_unsupported_models`) and falls back to the two Claude 3
 * Haikus; 2.1.284 and 2.1.290 alike. As the flag stood for a subscription on
 * 2026-10-05 it named the Claude 3 models below and nothing later. The proxy
 * cannot read what the child will be told, so this is the flag as it stood.
 * Haiku 4.5, which is what the CLI's `haiku` is, has tool search: the 2.1.290
 * client connected directly deferred its own tools on it.
 */
const MODELS_WITHOUT_TOOL_SEARCH = [
  "claude-3-5-haiku", "claude-3-haiku", "claude-3-opus", "claude-3-sonnet", "claude-3-5-sonnet", "claude-3-7-sonnet",
]

function modelHasToolSearch(model: string): boolean {
  const name = model.toLowerCase()
  return !MODELS_WITHOUT_TOOL_SEARCH.some(entry => name.includes(entry))
}

/**
 * What the SDK child's environment says about where its requests go.
 *
 * Both tests are the CLI's own (2.1.284). Left alone, it keeps tool search off
 * when ANTHROPIC_BASE_URL names any host but api.anthropic.com, because a
 * gateway that does not forward `tool_reference` blocks answers such a request
 * with a 400. ENABLE_TOOL_SEARCH=true, which deferral sets, overrides that
 * guard, so the proxy has to hold it instead. CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
 * is the other way round: the CLI then offers no tool search whatever
 * ENABLE_TOOL_SEARCH says, and a ToolSearch announced to the model would not
 * exist.
 */
export function toolSearchUpstream(
  childEnv: Readonly<Record<string, string | undefined>>,
): { customUpstream: boolean; experimentalBetasOff: boolean } {
  return {
    customUpstream: !isFirstPartyBaseUrl(childEnv.ANTHROPIC_BASE_URL),
    experimentalBetasOff: isTruthyFlag(childEnv.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS),
  }
}

function isFirstPartyBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return true
  try {
    return new URL(baseUrl).host === "api.anthropic.com"
  } catch {
    // Not a URL the CLI could tell from a gateway's either.
    return false
  }
}

function isTruthyFlag(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase().trim())
}

/**
 * Whether this request defers tools for real: ToolSearch in the request, the
 * names in the system prompt, the stop beside every deny.
 *
 * Every "no" leaves the session as it was before deferral worked: all tools
 * loaded and the turn budget computePassthroughMaxTurns gives it.
 */
export function resolveToolSearch(input: ToolSearchInput): ToolSearchDecision {
  if (!input.hasDeferredTools) return { active: false, reason: "no_deferred_tools" }
  if (input.disabled) return { active: false, reason: "disabled" }
  if (!input.stopsAtToolBoundary) return { active: false, reason: "multi_turn_session" }
  if (input.pinnedTurnBudget === 1) return { active: false, reason: "single_turn_pinned" }
  if (!modelHasToolSearch(input.model)) return { active: false, reason: "model" }
  // Two tools of that name would reach the model, and only the SDK's can load
  // anything: the client's answers with references to names the SDK never
  // registered, which the CLI drops.
  if (input.clientToolNames.includes(TOOL_SEARCH_TOOL_NAME)) return { active: false, reason: "client_tool_search" }
  if (input.experimentalBetasOff) return { active: false, reason: "experimental_betas_off" }
  if (input.customUpstream && !input.upstreamVouchedFor) return { active: false, reason: "custom_upstream" }
  if (cliIgnoresStop(input.claudeExecutable)) return { active: false, reason: "cli_ignores_stop" }
  return { active: true }
}

/**
 * Add the stop to a PreToolUse deny.
 *
 * `continue: false` ends the query once the message's tool calls have all been
 * answered. `stopReason` is shown to nobody: the next request resumes at the
 * assistant message, ahead of anything this turn wrote after it.
 */
export function endTurnAtDeny<T extends { decision: "block"; reason: string }>(
  deny: T,
): T & { continue: false; stopReason: string } {
  return { ...deny, continue: false, stopReason: "Tool call forwarded to the client" }
}

/**
 * The system-prompt block that names the deferred tools.
 *
 * The wording follows the CLI's own announcement, which is what the model has
 * been shown whenever it met deferred tools before. Names are sorted so the
 * same tool set always renders the same text: the block sits in the system
 * prompt, and a reordering there would rewrite the cache behind it.
 */
export function deferredToolsNote(names: readonly string[]): string {
  if (names.length === 0) return ""
  const sorted = [...names].sort((a, b) => a.localeCompare(b))
  return (
    `\n<available-deferred-tools>\n` +
    `The following deferred tools are available via ${TOOL_SEARCH_TOOL_NAME}. Their schemas are not loaded. ` +
    `Use ${TOOL_SEARCH_TOOL_NAME} with query "select:<name>[,<name>...]" to load a tool's schema before calling it:\n` +
    `${sorted.join("\n")}\n` +
    `</available-deferred-tools>`
  )
}

/** A `tool_result` block as the continuation carries it. */
export interface InternalToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: unknown
  is_error?: boolean
}

/**
 * ToolSearch calls and their results, as one query's iterator shows them.
 *
 * The CLI surfaces an API message as one assistant message per content block,
 * each with its own uuid and all with the message's API id. That id is what
 * says a ToolSearch call and a forwarded client call came from the same
 * message, so a message without one carries nothing.
 */
export interface InternalToolResults {
  /** Where each assistant fragment sits, by its uuid. */
  fragments: Map<string, InternalToolFragment>
  /** The fragment each ToolSearch call arrived in, by tool_use id. */
  calls: Map<string, InternalToolFragment>
  /** Every tool result of the query, by the tool_use id it answers. */
  results: Map<string, InternalToolResultBlock>
  /** Assistant fragments seen so far. */
  count: number
}

interface InternalToolFragment {
  /** The API message the fragment is part of. */
  apiId: string
  /** Its place among the query's assistant fragments. */
  order: number
}

export function createInternalToolResults(): InternalToolResults {
  return { fragments: new Map(), calls: new Map(), results: new Map(), count: 0 }
}

/** Feed every assistant and user message of the query through this. */
export function noteInternalToolMessage(seen: InternalToolResults, message: unknown): void {
  const m = message as {
    type?: unknown
    uuid?: unknown
    message?: { id?: unknown; content?: unknown }
  } | null | undefined
  const content = m?.message?.content
  if (!Array.isArray(content)) return
  if (m?.type === "assistant") {
    const apiId = m.message?.id
    if (typeof apiId !== "string" || !apiId) return
    const fragment = { apiId, order: seen.count++ }
    if (typeof m.uuid === "string" && m.uuid) seen.fragments.set(m.uuid, fragment)
    for (const raw of content) {
      const block = raw as { type?: unknown; id?: unknown; name?: unknown } | null | undefined
      if (block?.type === "tool_use" && block.name === TOOL_SEARCH_TOOL_NAME && typeof block.id === "string") {
        seen.calls.set(block.id, fragment)
      }
    }
    return
  }
  if (m?.type !== "user") return
  // Every result is kept, not only those of calls seen so far: the CLI can
  // answer a call while later blocks of its message are still streaming, so a
  // result can reach the iterator ahead of the fragment that carries its
  // call. Only a ToolSearch call's is ever read back.
  for (const raw of content) {
    const block = raw as { type?: unknown; tool_use_id?: unknown; content?: unknown; is_error?: unknown } | null | undefined
    if (block?.type !== "tool_result" || typeof block.tool_use_id !== "string") continue
    seen.results.set(block.tool_use_id, {
      type: "tool_result",
      tool_use_id: block.tool_use_id,
      content: block.content,
      ...(block.is_error === true ? { is_error: true } : {}),
    })
  }
}

/**
 * The ToolSearch results a session resumed at this assistant fragment is
 * missing: those of calls in the same API message, up to the fragment.
 *
 * Results of earlier messages are not among them: they sit ahead of the
 * resume point and are still in the transcript. Nor is a ToolSearch the
 * model called after the fragment. The resume point cuts that call off with
 * its result, and a result sent back alone would answer no tool_use: the API
 * refuses such a request, and CLI 2.1.284 drops the block before sending.
 */
export function internalToolResultsAt(
  seen: InternalToolResults,
  assistantUuid: string | undefined,
): InternalToolResultBlock[] {
  const at = assistantUuid ? seen.fragments.get(assistantUuid) : undefined
  if (!at) return []
  const blocks: InternalToolResultBlock[] = []
  for (const [toolUseId, call] of seen.calls) {
    const result = call.apiId === at.apiId && call.order <= at.order ? seen.results.get(toolUseId) : undefined
    if (result) blocks.push(result)
  }
  return blocks
}

/**
 * Enough for every tool round in flight on a busy proxy; a checkpoint is read
 * back by the very next request of its conversation.
 */
const CARRIED_CHECKPOINTS = 512
const carried = new Map<string, InternalToolResultBlock[]>()

/**
 * Keep a checkpoint's ToolSearch results for the request that resumes at it.
 *
 * In memory only. A proxy restarted between a tool call and its results loses
 * them, and the model sees the CLI's "missing" placeholder and searches again.
 */
export function rememberInternalToolResults(assistantUuid: string, blocks: readonly InternalToolResultBlock[]): void {
  if (blocks.length === 0) return
  carried.delete(assistantUuid)
  carried.set(assistantUuid, [...blocks])
  while (carried.size > CARRIED_CHECKPOINTS) {
    const oldest = carried.keys().next().value
    if (oldest === undefined) break
    carried.delete(oldest)
  }
}

/** Not consumed: a retried continuation resumes at the same checkpoint. */
export function recallInternalToolResults(assistantUuid: string | undefined): InternalToolResultBlock[] {
  return assistantUuid ? carried.get(assistantUuid) ?? [] : []
}

/** Tests only. */
export function resetToolSearchState(): void {
  stopIgnoredBy.clear()
  carried.clear()
}
