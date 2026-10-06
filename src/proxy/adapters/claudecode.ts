/**
 * Claude Code agent adapter.
 *
 * Claude Code (claude-cli) is unusual among meridian clients in two ways:
 *   1. It typically runs on a different machine than the proxy (pointing at
 *      ANTHROPIC_BASE_URL over the network), so its CWD doesn't exist on the
 *      proxy host.
 *   2. Its system prompt embeds working-directory info using the
 *      `Primary working directory: <path>` format inside a `# Environment`
 *      block — different from OpenCode's `<env>Working directory: <path></env>`.
 *
 * Consequently this adapter:
 *   - Returns `undefined` from extractWorkingDirectory so the SDK subprocess
 *     chdirs into `process.cwd()` (a valid server path) rather than the
 *     client's local filesystem layout.
 *   - Parses the client's local CWD via extractClientWorkingDirectory for
 *     fingerprinting and a system-prompt hint (see server.ts + query.ts).
 */

import type { Context } from "hono"
import type { AgentAdapter } from "../adapter"
import { type FileChange, extractFileChangesFromBash } from "../fileChanges"
import { normalizeContent } from "../messages"
import { BLOCKED_BUILTIN_TOOLS, CLAUDE_CODE_ONLY_TOOLS, MCP_SERVER_NAME, ALLOWED_MCP_TOOLS } from "../tools"
import { resolvePassthrough } from "../../env"

/**
 * Extract Claude Code's client-local working directory from the request's
 * system prompt. Claude Code injects a block like:
 *
 *   # Environment
 *   You have been invoked in the following environment:
 *    - Primary working directory: /Users/alice/projects/myapp
 *    - ...
 *
 * Returns the path if found, or undefined to fall back to the SDK CWD.
 */
function extractClaudeCodeClientCwd(body: any): string | undefined {
  let systemText = ""
  if (typeof body.system === "string") {
    systemText = body.system
  } else if (Array.isArray(body.system)) {
    systemText = body.system
      .filter((b: any) => b.type === "text" && b.text)
      .map((b: any) => b.text)
      .join("\n")
  }
  if (!systemText) return undefined

  const match = systemText.match(/Primary working directory:\s*([^\n<]+)/i)
  return match?.[1]?.trim() || undefined
}

/**
 * Session identity declared in `metadata.user_id`.
 *
 * `sessionId` is the whole of the session key — nothing is appended, prefixed,
 * or normalized — because it is what every cached mapping is already stored
 * under. `parentSessionId` is additive: a client that does not stamp it gets
 * exactly the identity it got before the field existed.
 */
export interface ClaudeCodeSessionIdentity {
  readonly sessionId: string
  /**
   * The IMMEDIATE parent's session id, when the client declares subagent
   * lineage. Deeper trees are expressed by each level naming its own parent, so
   * consumers walk the chain rather than expecting a root here.
   */
  readonly parentSessionId?: string
}

/**
 * Parse the identity envelope Claude Code (and Prime Agent's extension) embeds
 * in `metadata.user_id`.
 *
 * Strict by design: `user_id` must be, or parse to, an object carrying a
 * non-empty string `session_id`. Anything else yields undefined and the caller
 * falls back to fingerprint resume, so unrelated Anthropic-API clients that put
 * their own value in `user_id` are never mistaken for a keyed session.
 */
export function extractClaudeCodeSessionIdentity(body: unknown): ClaudeCodeSessionIdentity | undefined {
  if (!body || typeof body !== "object") return undefined

  const metadata = (body as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object") return undefined

  const rawUserId = (metadata as { user_id?: unknown }).user_id
  let userMetadata: unknown = rawUserId

  if (typeof rawUserId === "string") {
    try {
      userMetadata = JSON.parse(rawUserId)
    } catch {
      return undefined
    }
  }

  if (!userMetadata || typeof userMetadata !== "object") return undefined
  const sessionId = (userMetadata as { session_id?: unknown }).session_id
  if (typeof sessionId !== "string" || sessionId.length === 0) return undefined

  const parentSessionId = (userMetadata as { parent_session_id?: unknown }).parent_session_id
  // A node that names itself as its own parent is not a tree edge, and treating
  // it as one would make a request its own cancellation target.
  const parent = typeof parentSessionId === "string"
    && parentSessionId.length > 0
    && parentSessionId !== sessionId
    ? parentSessionId
    : undefined

  return parent ? { sessionId, parentSessionId: parent } : { sessionId }
}

/** Extract the stable conversation ID embedded by Claude Code in metadata.user_id. */
export function extractClaudeCodeSessionId(body: unknown): string | undefined {
  return extractClaudeCodeSessionIdentity(body)?.sessionId
}

/** Extract the immediate parent session key, when the client declares lineage. */
export function extractClaudeCodeParentSessionId(body: unknown): string | undefined {
  return extractClaudeCodeSessionIdentity(body)?.parentSessionId
}

/** The agent context Claude Code runs a request under; absent on the main conversation. */
export const CLAUDE_CODE_AGENT_ID_HEADER = "x-claude-code-agent-id"

/** Agent ids are short opaque tokens. Anything else is ignored, never keyed. */
const CLAUDE_CODE_AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The session key for one Claude Code request.
 *
 * NOTE: agent-specific (claude-code). An Agent-tool subagent sends its parent
 * conversation's `metadata.user_id` session id while running a multi-turn
 * conversation of its own, and background subagents overlap the parent's
 * turns. Under one key each history read as `unrelated-history` to the other,
 * so neither resumed, and both queued on one turn lease. The CLI stamps
 * `x-claude-code-agent-id` on every subagent request — stable across that
 * subagent's turns, distinct between subagents, and sent without gateway hint
 * headers (verified against 2.1.287) — so a subagent is keyed
 * `<sid>:agent:<agentId>`. The main conversation, and any request whose agent
 * id is missing or malformed, keeps the bare session id. An agent id never
 * creates a key on its own: without a metadata session id there is none.
 *
 * A backgrounded main session (and a fork-of-main subagent) also gets a fresh
 * agent id but carries the whole transcript, so its first request under the
 * new key is one full-history replay; later turns resume on that key.
 */
export function claudeCodeSessionKey(agentId: string | undefined, body: unknown): string | undefined {
  const sessionId = extractClaudeCodeSessionId(body)
  if (sessionId === undefined) return undefined
  if (agentId === undefined || !CLAUDE_CODE_AGENT_ID.test(agentId)) return sessionId
  return `${sessionId}:agent:${agentId}`
}

/** Claude Code's own request classification (`main`, `auxiliary`, `compaction`, …). */
export const CLAUDE_CODE_REQUEST_CLASS_HEADER = "x-claude-code-request-class"

/** The auto-mode classifier's XML verdicts end at these tags. */
const CLASSIFIER_STOP_SEQUENCES = new Set(["</block>", "</severity>"])

/** The auto-mode classifier: no tools, not streamed, a stop sequence closing its verdict tag. */
function hasClassifierShape(request: { tools?: unknown; stream?: unknown; stop_sequences?: unknown }): boolean {
  if (Array.isArray(request.tools) && request.tools.length > 0) return false
  if (request.stream === true) return false
  if (!Array.isArray(request.stop_sequences)) return false
  return request.stop_sequences.some(stop => typeof stop === "string" && CLASSIFIER_STOP_SEQUENCES.has(stop))
}

/** How the CLI's background-agent progress prompt (`agent_summary`) opens. */
const AGENT_SUMMARY_PROMPT = "Describe your most recent action in 3-5 words using present tense (-ing)."

function isAgentSummaryPromptBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") return false
  const { type, text } = block as { type?: unknown; text?: unknown }
  return type === "text" && typeof text === "string" && text.startsWith(AGENT_SUMMARY_PROMPT)
}

/**
 * Where the progress-summary fork carries the CLI's summary prompt: its final
 * user message. Mid-conversation `system` messages may trail that message, as
 * they do any turn; nothing else may. -1 when the request is not that fork.
 */
function agentSummaryPromptIndex(messages: unknown[]): number {
  const index = messages.findLastIndex(message => (message as { role?: unknown } | null)?.role !== "system")
  const last = messages[index]
  if (!last || typeof last !== "object") return -1
  const { role, content } = last as { role?: unknown; content?: unknown }
  if (role !== "user") return -1
  if (typeof content === "string") return content.startsWith(AGENT_SUMMARY_PROMPT) ? index : -1
  if (!Array.isArray(content)) return -1
  return content.some(isAgentSummaryPromptBlock) ? index : -1
}

function endsWithAgentSummaryPrompt(request: { messages?: unknown }): boolean {
  return Array.isArray(request.messages) && agentSummaryPromptIndex(request.messages) >= 0
}

/**
 * Is this a Claude Code side call under the conversation's session id?
 *
 * NOTE: agent-specific (claude-code). The auto-mode permission classifier
 * sends the conversation's own `metadata.user_id` session id with a two-message
 * transcript of its own. Read as a turn, it classifies `unrelated-history` and
 * overwrites the conversation's mapping, so the next real turn cannot resume.
 *
 * The background-agent progress summary (`agent_summary`) does the same under
 * a subagent's key. On a 30s timer the CLI forks the running subagent's
 * transcript whenever it has changed, with that subagent's agent id, tools and
 * streaming, and merges its prompt into the turn's tool-result message. Read
 * as a turn, that one extra block passes for a late parallel tool result,
 * replays the whole history because it settles no pending tool call, and
 * replaces the subagent's mapping — so the subagent's next real turn diverges
 * `modified-history` and replays it again (measured live: 24 forks, 24
 * replayed turns at 7% cache hits, against 93% on the turns no fork preceded).
 * A replayed turn also arrives without the model's earlier reasoning: three in
 * a row spent 18K-36K output tokens re-planning before a tool call, against
 * 2.7K on the resumed turn between them.
 *
 * The CLI names its request class in `x-claude-code-request-class`, but sends
 * it only with `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`, to a first-party base URL,
 * or under a remote flag — through Meridian it is normally absent. When present
 * it decides outright. Otherwise the side call's shape does. The classifier's:
 * a session key, no tools, not streamed, and a stop sequence closing its
 * verdict tag. The summary fork's: a session key and the summary prompt
 * opening a text block of its final user message. The streamed session-start
 * request, compaction and main turns all fall outside both. If a future CLI
 * changes those stop sequences or that prompt, detection falls back to today's
 * behavior rather than isolating a real turn.
 */
export function isClaudeCodeAuxiliaryRequest(requestClass: string | undefined, body: unknown): boolean {
  if (requestClass !== undefined) return requestClass === "auxiliary"
  if (!body || typeof body !== "object") return false
  if (!hasClassifierShape(body) && !endsWithAgentSummaryPrompt(body)) return false
  return extractClaudeCodeSessionId(body) !== undefined
}

/**
 * Does this side call repeat the prompt of the one before it and add to its end?
 *
 * NOTE: agent-specific (claude-code). The auto-mode classifier re-sends the
 * conversation's transcript on every permission check, with what happened
 * since appended and the same instruction closing it (measured live across 33
 * consecutive checks: each prompt was the previous one minus its 203-character
 * ending, plus 0.3K-15K new characters). The CLI sends that transcript as a
 * block per entry with its own cache breakpoints, so that a check reads the
 * last one's prefix. Replayed through Meridian as one block it read nothing:
 * 38 checks in 22 minutes wrote 3.66M cache tokens, 83% of all cache written.
 *
 * The progress summary does not grow — it is answered from a different step
 * each time (see `agentSummaryReplayMessages`) — and a side call known only by
 * the client's request class is not known to either.
 */
export function claudeCodeAuxiliaryPromptGrows(body: unknown): boolean {
  return Boolean(body) && typeof body === "object" && hasClassifierShape(body as Parameters<typeof hasClassifierShape>[0])
}

/**
 * How long the prompt cache entries a request writes should live.
 *
 * NOTE: agent-specific (claude-code). On a subscription the CLI writes a main
 * conversation's cache for an hour and an Agent-tool subagent's for five
 * minutes: a subagent works in one burst, and an hour's entry costs 2x input
 * a token against 1.25x. Through Meridian every conversation is a query of
 * its own SDK child, which the CLI takes for a main conversation, so a
 * subagent's cache was written for an hour too (a Fable request through a
 * subscription profile, 2026-10-05: `ephemeral_1h_input_tokens` 4208,
 * `ephemeral_5m_input_tokens` 0). On three days of one user's Fable subagents,
 * 1,630 calls, 1.0% of the gaps between a subagent's calls ran past five
 * minutes, and writing for an hour cost 17% more prompt than writing for five.
 *
 * So a request under an agent id gets the five minutes the CLI would have
 * given it: a subagent's turns, and the progress summary forked from them.
 * The permission check is left to the child, since the CLI keeps that cache
 * for an hour itself, and so is the main conversation, where an hour is the
 * cheaper of the two (the same three days: 11% less than five minutes).
 */
export function claudeCodePromptCacheLifetime(agentId: string | undefined, body: unknown): "5m" | undefined {
  if (agentId === undefined || !CLAUDE_CODE_AGENT_ID.test(agentId)) return undefined
  if (body && typeof body === "object" && hasClassifierShape(body as Parameters<typeof hasClassifierShape>[0])) return undefined
  return "5m"
}

/** The most a progress label is shown of any one tool input, tool output or note. */
const AGENT_SUMMARY_FIELD_MAX = 2_000

function clipSummaryText(text: string): string {
  if (text.length <= AGENT_SUMMARY_FIELD_MAX || text.startsWith(AGENT_SUMMARY_PROMPT)) return text
  return `${text.slice(0, AGENT_SUMMARY_FIELD_MAX)}\n[… ${text.length - AGENT_SUMMARY_FIELD_MAX} more characters omitted]`
}

/** A tool input is plain JSON: clip every string in it, however it is nested. */
function clipSummaryInput(value: unknown): unknown {
  if (typeof value === "string") return clipSummaryText(value)
  if (Array.isArray(value)) return value.map(clipSummaryInput)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clipSummaryInput(entry)]))
}

/** Text is clipped; images and every other block pass through whole. */
function clipSummaryContent(content: unknown): unknown {
  if (typeof content === "string") return clipSummaryText(content)
  if (!Array.isArray(content)) return content
  return content.map((block: unknown) => {
    if (!block || typeof block !== "object") return block
    const { type, text, input, content: nested } = block as { type?: unknown; text?: unknown; input?: unknown; content?: unknown }
    if (type === "text" && typeof text === "string") return { ...block, text: clipSummaryText(text) }
    if (type === "tool_use") return { ...block, input: clipSummaryInput(input) }
    if (type === "tool_result") return { ...block, content: clipSummaryContent(nested) }
    return block
  })
}

/**
 * What a progress-summary fork is answered from: the subagent's latest
 * assistant turn and the message carrying the prompt, with each tool input
 * and output clipped.
 *
 * NOTE: agent-specific (claude-code). The CLI sends the fork with the
 * subagent's whole transcript so that it reads the subagent's prompt cache.
 * Through Meridian it is a side call answered from a session of its own, which
 * shares no cache with the conversation: the transcript was replayed as one
 * block and written to the cache for every label (measured live: 311K-321K
 * cache-write tokens for a 14-17 token answer, of which the latest step was
 * 1-4%). The label names "your most recent action", which that step holds, and
 * the prompt itself quotes the previous label.
 *
 * Undefined when the request is not that fork, or has nothing before its
 * latest step to leave out; the request is then replayed as sent.
 */
export function agentSummaryReplayMessages(body: unknown): Array<{ role: string; content: unknown }> | undefined {
  if (!body || typeof body !== "object") return undefined
  const { messages } = body as { messages?: unknown }
  if (!Array.isArray(messages)) return undefined
  const prompt = agentSummaryPromptIndex(messages)
  if (prompt < 0) return undefined
  const latest = messages.findLastIndex((message: unknown, index: number) =>
    index < prompt && (message as { role?: unknown } | null)?.role === "assistant")
  if (latest <= 0) return undefined
  const step = messages.slice(latest, prompt + 1).flatMap((message: unknown) => {
    if (!message || typeof message !== "object") return []
    const { role, content } = message as { role?: unknown; content?: unknown }
    return typeof role === "string" ? [{ ...message, role, content: clipSummaryContent(content) }] : []
  })
  return [
    {
      role: "user",
      content: `[Meridian: this progress summary is answered from the latest step only; ${latest} earlier message${latest === 1 ? "" : "s"} left out.]`,
    },
    ...step,
  ]
}

/**
 * Is this request from the Claude Code CLI, whatever adapter is handling it?
 *
 * Claude Code sends `x-claude-code-session-id` on every request — verified
 * against 2.1.266 that it is the CLI session UUID, pinned exactly by
 * `--session-id`. No other client sends it, so it identifies the client even
 * when a gateway has rewritten the User-Agent and the LiteLLM heuristic has
 * already claimed the request.
 *
 * This answers "who owns the tool loop", not "which adapter should run". The
 * header is deliberately NOT used for adapter selection: routing gateway
 * traffic to the claude-code adapter would swap tool handling, MCP naming and
 * prompt shape for every existing LiteLLM user and move their cache prefix.
 *
 * It is also NOT a session key. The CLI reuses one session id across the
 * auxiliary requests it makes alongside a conversation, so keying on it puts
 * two unrelated histories under one key — measured live as
 * `unrelated-history` and an HTTP 400 concurrent conflict, i.e. a hard failure
 * where there had only been a silent inefficiency. See
 * `scripts/e2e-passthrough-claude-code-session.mjs`, which guards that.
 */
export function isClaudeCodeClient(c: Context): boolean {
  return Boolean(c.req.header("x-claude-code-session-id"))
}

/**
 * NOTE: agent-specific (claude-code). With its `mid-conversation-system`
 * feature on, claude-cli ends a tool-result request with a `system` turn, and
 * for some models it appends a reminder that lives for that one request. On
 * `claude-fable-5-1` (claude-cli 2.1.289) every tool round ends
 *
 *   system: [ "<total_tokens>N tokens left</total_tokens>" (cache_control),
 *             "First privately list what you need next; ..." ]
 *
 * and the next request carries the same turn as the plain string
 * `<total_tokens>N tokens left</total_tokens>`: the reminder is gone, and a
 * new one sits behind the new tail. Hashing it made every tool round after
 * the first look like edited history, so each one replayed the whole
 * conversation into a fresh SDK session. Measured on a live proxy on
 * 2026-10-05: 32 such turns wrote 5.4M tokens to the cache, 168K each, where
 * the turns that did resume wrote 10K (E2E.md E77).
 *
 * The client says which part it keeps: the cache breakpoint sits on the last
 * block it will send again, and anything it adds for one request has to come
 * after that or it would rewrite the cached prefix. So what follows the last
 * breakpoint of a system turn is not ancestry. The known wording is matched as
 * well, for a request that carries no breakpoint there.
 */
const BATCHING_REMINDER_TEXT =
  "First privately list what you need next; then request every item that doesn't depend on another's result in this one response."

function isCacheBreakpoint(block: unknown): boolean {
  return block !== null && typeof block === "object" && (block as { cache_control?: unknown }).cache_control != null
}

function isBatchingReminder(block: unknown): boolean {
  return block !== null && typeof block === "object"
    && (block as { type?: unknown }).type === "text" && (block as { text?: unknown }).text === BATCHING_REMINDER_TEXT
}

export function canonicalizeClaudeCodeMessagesForLineage(
  messages: Array<{ role: string; content: unknown }>,
): Array<{ role: string; content: unknown }> {
  // Preserve message positions exactly; only a system turn's tail is dropped.
  return messages.map((message) => {
    if (message.role !== "system" || !Array.isArray(message.content)) return message
    const breakpoint = message.content.findLastIndex(isCacheBreakpoint)
    let content = breakpoint >= 0 ? message.content.slice(0, breakpoint + 1) : message.content
    if (content.length > 1 && isBatchingReminder(content.at(-1))) content = content.slice(0, -1)
    return content.length === message.content.length ? message : { ...message, content }
  })
}

export const claudeCodeAdapter: AgentAdapter = {
  name: "claude-code",

  /**
   * NOTE: agent-specific (claude-code) — Headless Claude Code (`claude -p "..."`)
   * sends a session-start side request (`tools=0`, single user message) and the
   * primary turn (`tools=24`, message count 2) concurrently under the same
   * session id (`metadata.user_id: {"session_id": "..."}`) (#1043). The client
   * has no per-flow signal or plugin header. Whichever request commits first
   * advances the mapping, so the other arrives holding a branch that no longer
   * matches. Setting `runsConcurrentTurnsPerSessionKey: true` allows the loser
   * of that race to be reclassified as a fresh replay rather than refused with
   * HTTP 400 `session_turn_conflict`.
   */
  runsConcurrentTurnsPerSessionKey: true,

  /** NOTE: Claude Code-specific. Its environment belongs to the remote client. */
  clientEnvironmentMayDifferFromProxy: true,

  /**
   * Claude Code embeds its conversation ID in metadata.user_id rather than a
   * session-affinity header; an Agent-tool subagent adds its agent id (see
   * `claudeCodeSessionKey`). Fall back to fingerprint resume when absent.
   */
  getSessionId(c: Context, body?: unknown): string | undefined {
    return claudeCodeSessionKey(c.req.header(CLAUDE_CODE_AGENT_ID_HEADER), body)
  },

  /**
   * Subagent lineage from the same envelope that supplied the session key, so
   * a declared parent always names a key derived the same way this one was.
   */
  getParentSessionId(_c: Context, body?: unknown): string | undefined {
    return extractClaudeCodeParentSessionId(body)
  },

  /**
   * The conversation's own `metadata.user_id` session id: the key its main
   * requests use, and the root its Agent-tool subagents (keyed apart by agent
   * id) share for account routing.
   */
  getRootSessionId(_c: Context, body?: unknown): string | undefined {
    return extractClaudeCodeSessionId(body)
  },

  /** See `isClaudeCodeAuxiliaryRequest`. */
  isAuxiliaryRequest(c: Context, body?: unknown): boolean {
    return isClaudeCodeAuxiliaryRequest(c.req.header(CLAUDE_CODE_REQUEST_CLASS_HEADER), body)
  },

  /** See `agentSummaryReplayMessages`. */
  getAuxiliaryReplayMessages(_c: Context, body?: unknown): Array<{ role: string; content: unknown }> | undefined {
    return agentSummaryReplayMessages(body)
  },

  /** See `claudeCodeAuxiliaryPromptGrows`. */
  auxiliaryPromptGrows(_c: Context, body?: unknown): boolean {
    return claudeCodeAuxiliaryPromptGrows(body)
  },

  /** See `claudeCodePromptCacheLifetime`. */
  promptCacheLifetime(c: Context, body?: unknown): "5m" | undefined {
    return claudeCodePromptCacheLifetime(c.req.header(CLAUDE_CODE_AGENT_ID_HEADER), body)
  },

  /**
   * Claude Code is remote relative to the proxy. Do not use its local path
   * as the SDK subprocess cwd — return undefined so the resolver falls back
   * to MERIDIAN_WORKDIR / process.cwd() (a valid path on the proxy host).
   */
  extractWorkingDirectory(_body: any): string | undefined {
    return undefined
  },

  /**
   * Used for fingerprint bucketing and the system-prompt CWD hint.
   */
  extractClientWorkingDirectory(body: any): string | undefined {
    return extractClaudeCodeClientCwd(body)
  },

  normalizeContent(content: any): string {
    return normalizeContent(content)
  },

  canonicalizeMessagesForLineage(messages) {
    return canonicalizeClaudeCodeMessagesForLineage(messages)
  },

  getBlockedBuiltinTools(): readonly string[] {
    return BLOCKED_BUILTIN_TOOLS
  },

  getAgentIncompatibleTools(): readonly string[] {
    return CLAUDE_CODE_ONLY_TOOLS
  },

  getMcpServerName(): string {
    return MCP_SERVER_NAME
  },

  getAllowedMcpTools(): readonly string[] {
    return ALLOWED_MCP_TOOLS
  },

  getCoreToolNames(): readonly string[] {
    // Claude Code ships a Read/Write/Bash/etc. toolkit much like OpenCode.
    return ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
  },

  usesPassthrough(): boolean {
    // Claude Code owns its own tool execution client-side; default to
    // passthrough so tool_use blocks flow back to the CLI.
    return resolvePassthrough(true)
  },

  supportsThinking(): boolean {
    return true
  },

  /**
   * Claude Code surfaces its own file edits in its UI; suppress meridian's
   * synthetic "Files changed:" block to avoid duplication.
   */
  shouldTrackFileChanges(): boolean {
    return false
  },

  /**
   * Map Claude Code tool_use blocks to file changes. Claude Code uses
   * PascalCase tool names (Read, Write, Edit, Bash) with file_path input.
   */
  extractFileChangesFromToolUse(toolName: string, toolInput: unknown): FileChange[] {
    const input = toolInput as Record<string, unknown> | null | undefined
    const filePath = input?.file_path ?? input?.filePath ?? input?.path

    const lowerName = toolName.toLowerCase()
    if (lowerName === "write" && filePath) {
      return [{ operation: "wrote", path: String(filePath) }]
    }
    if ((lowerName === "edit" || lowerName === "multiedit") && filePath) {
      return [{ operation: "edited", path: String(filePath) }]
    }
    if (lowerName === "bash" && input?.command) {
      return extractFileChangesFromBash(String(input.command))
    }
    return []
  },
}
