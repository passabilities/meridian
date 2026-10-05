import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  assistantMessage,
  messageStart,
  textBlockStart,
  textDelta,
  blockStop,
  messageDelta,
  messageStop,
  resolveMockSdkSessionId,
} from "./helpers"

interface AttemptControl {
  release: () => void
  started: Promise<void>
}

let activeQueries = 0
let maxActiveQueries = 0
let queryCalls = 0
let controls: AttemptControl[] = []
let capturedParams: Array<{ prompt?: unknown; options?: { resume?: string; resumeSessionAt?: string; sessionId?: string; env?: Record<string, string> } }> = []
let rateLimitWorkQueries = false
/** Answer as the API does when a CLI adds its cache breakpoints beside the prompt's own. */
let refuseOwnedBreakpoints = false

function deferredAttempt(): AttemptControl & { wait: Promise<void>; markStarted: () => void } {
  let release = () => {}
  let markStarted = () => {}
  const wait = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  return { release, started, wait, markStarted }
}

installSdkMock(() => ({
  query: (params: { options?: { resume?: string; sessionId?: string; env?: Record<string, string> } }) => {
    capturedParams.push(params)
    queryCalls++
    const control = deferredAttempt()
    controls.push(control)
    const sessionId = resolveMockSdkSessionId(params.options, `sdk-concurrency-${queryCalls}`)
    const generator = (async function* () {
      activeQueries++
      maxActiveQueries = Math.max(maxActiveQueries, activeQueries)
      control.markStarted()
      try {
        if (rateLimitWorkQueries && params.options?.env?.CLAUDE_CONFIG_DIR?.includes("hot-work")) {
          throw new Error("429 rate limit reached for this account")
        }
        if (refuseOwnedBreakpoints && params.options?.env?.DISABLE_PROMPT_CACHING === "1") {
          throw new Error('Claude Code returned an error result: API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"A maximum of 4 blocks with cache_control may be provided. Found 5."}}')
        }
        yield { ...messageStart(), session_id: sessionId }
        await control.wait
        yield { ...textBlockStart(0), session_id: sessionId }
        yield { ...textDelta(0, "ok"), session_id: sessionId }
        yield { ...blockStop(0), session_id: sessionId }
        yield { ...messageDelta("end_turn"), session_id: sessionId }
        yield { ...messageStop(), session_id: sessionId }
        yield { ...assistantMessage([{ type: "text", text: "ok" }]), session_id: sessionId }
      } finally {
        activeQueries--
      }
    })()
    return Object.assign(generator, { close: () => {} })
  },
  createSdkMcpServer: () => ({ type: "sdk", name: "test", instance: {} }),
  tool: () => ({}),
}), "proxy-concurrency-coordination.test.ts")

installLoggerMock(() => ({
  claudeLog: () => {},
  withClaudeLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}))

installMcpToolsMock(() => ({
  createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }),
}))

const { createProxyServer, clearSessionCache } = await import("../proxy/server")
const { resetProcessSdkSemaphoreForTests } = await import("../proxy/concurrency")
const { telemetryStore, diagnosticLog } = await import("../telemetry")
const { setSessionStoreDir, storeSharedSession, readSessionStoreSnapshot } = await import("../proxy/sessionStore")
const { processSessionTurns } = await import("../proxy/session/turnCoordinator")
const { computeLineageHash, computeMessageHashes, verifyLineage } = await import("../proxy/session/lineage")
const { deriveToolLoopSessionId, openAiAdapter } = await import("../proxy/adapters/openai")
const { claudeCodeSessionKey } = await import("../proxy/adapters/claudecode")
const { translateOpenAiToAnthropic } = await import("../proxy/openai")

function request(
  messages: Array<{ role: string; content: unknown }>,
  sessionId: string,
  stream = false,
  extraHeaders: Record<string, string> = {},
  signal?: AbortSignal,
): Request {
  return new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-opencode-session": sessionId,
      ...extraHeaders,
    },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 128, stream, messages }),
    signal,
  })
}

/**
 * Oh My Pi has no per-flow header: every caller in one conversation, main turn
 * and side calls alike, stamps the same id in `metadata.user_id`.
 */
function piRequest(
  messages: Array<{ role: string; content: unknown }>,
  sessionId: string,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-meridian-agent": "pi",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 128,
      stream: false,
      messages,
      metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    }),
  })
}

/**
 * Headless Claude Code sends `metadata.user_id = {"session_id": "..."}` with
 * a `claude-cli/...` User-Agent and no per-flow header.
 */
function claudeCodeRequest(
  messages: Array<{ role: string; content: unknown }>,
  sessionId: string,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": "claude-cli/2.1.277",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 128,
      stream: false,
      messages,
      metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    }),
  })
}

/**
 * Claude Code's auto-mode permission classifier: the conversation's own
 * session id, no tools, not streamed, and stop sequences closing its verdict.
 */
function claudeCodeClassifierRequest(sessionId: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": "claude-cli/2.1.286",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      stream: false,
      stop_sequences: ["</block>"],
      messages: [
        { role: "user", content: "<transcript>User: run the tests</transcript>" },
        { role: "user", content: "Should this action be blocked?" },
      ],
      metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    }),
  })
}

const CLASSIFIER_INSTRUCTION = "Stage 1 does NOT apply user intent.\nRespond with <severity>N</severity> ONLY. No other text."

/**
 * A permission check on a conversation long enough to be worth caching, as
 * CLI 2.1.289 sends it: the user's instructions as a message of their own,
 * then the transcript as a block per entry with the CLI's own cache
 * breakpoints, the action under review, and the instruction closing it. Every
 * check re-sends the transcript with what happened since appended.
 */
function claudeCodeTranscriptCheck(sessionId: string, entries: number, instruction = CLASSIFIER_INSTRUCTION): Request {
  const mark = { cache_control: { type: "ephemeral", ttl: "1h" } }
  const entry = (index: number) => ({
    type: "text",
    text: `{"Bash":{"command":"bun test src/__tests__/step-${index}.test.ts","description":"Run the tests for step ${index}"}}\n{"outcome":"ok"}\n`,
  })
  return new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "claude-cli/2.1.289" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 64,
      stream: false,
      stop_sequences: ["</severity>"],
      messages: [
        { role: "user", content: [{
          type: "text",
          text: `The following is the user's CLAUDE.md configuration.\n\n<user_claude_md>\n${"Never commit secret material.\n".repeat(700)}</user_claude_md>`,
          ...mark,
        }] },
        { role: "user", content: [
          { type: "text", text: "<transcript>\n" },
          ...Array.from({ length: entries - 1 }, (_, index) => entry(index)),
          { ...entry(entries - 1), ...mark },
          { type: "text", text: `{"Bash":{"command":"git push origin step-${entries}"}}\n`, ...mark },
          { type: "text", text: "</transcript>\n" },
          { type: "text", text: instruction },
        ] },
      ],
      metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    }),
  })
}

/**
 * A Claude Code Agent-tool subagent turn: the parent conversation's own
 * metadata session id plus the subagent's `x-claude-code-agent-id`.
 */
function claudeCodeSubagentRequest(
  messages: Array<{ role: string; content: unknown }>,
  sessionId: string,
  agentId: string,
): Request {
  return claudeCodeRequest(messages, sessionId, { "x-claude-code-agent-id": agentId })
}

function claudeCodeSubagentKey(sessionId: string, agentId: string): string {
  const key = claudeCodeSessionKey(agentId, { metadata: { user_id: JSON.stringify({ session_id: sessionId }) } })
  if (key === undefined) throw new Error("test subagent key did not derive")
  return key
}

/**
 * One round of a subagent's tool loop, as CLI 2.1.289 sends it: the turn ends
 * in a tool result, and the CLI's reminders ride as mid-conversation `system`
 * messages, one of them trailing the turn.
 */
const SUBAGENT_TOOL_ROUND = [
  { role: "user", content: "Review the diff" },
  { role: "system", content: "# Environment\nYou have been invoked in the following environment:" },
  { role: "assistant", content: [{ type: "tool_use", id: "toolu_read_a", name: "Read", input: { file_path: "a.ts" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_read_a", content: "export const a = 1" }] },
  { role: "system", content: "Available agent types for the Agent tool:\n- claude: Catch-all" },
]

/** The round after it: the same history, one more tool call and its result. */
const SUBAGENT_NEXT_ROUND = [
  ...SUBAGENT_TOOL_ROUND,
  { role: "assistant", content: [{ type: "tool_use", id: "toolu_read_b", name: "Read", input: { file_path: "b.ts" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_read_b", content: "export const b = 2" }] },
]

/**
 * Claude Code's background-agent progress summary (`agent_summary`): on a 30s
 * timer the CLI forks a running subagent's transcript under that subagent's
 * own session id and agent id, merging its prompt into the turn's tool-result
 * message. The fork keeps the subagent's tools and streams.
 */
function claudeCodeAgentSummaryRequest(
  history: Array<{ role: string; content: unknown }>,
  sessionId: string,
  agentId: string,
): Request {
  const turn = history.findLastIndex(message => message.role === "user")
  const trailing = history[turn]
  if (!trailing || !Array.isArray(trailing.content)) throw new Error("test history must end in a tool-result turn")
  const prompt = [
    "Describe your most recent action in 3-5 words using present tense (-ing). Name the file or function, not the branch. Do not use tools.",
    "",
    "Good: \"Reading runAgent.ts\"",
    "Bad (past tense): \"Analyzed the branch diff\"",
  ].join("\n")
  return new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "user-agent": "claude-cli/2.1.289",
      "x-claude-code-agent-id": agentId,
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 128,
      stream: true,
      tools: [{
        name: "Read",
        description: "Read a file",
        input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
      }],
      messages: [
        ...history.slice(0, turn),
        { ...trailing, content: [...trailing.content, { type: "text", text: prompt }] },
        ...history.slice(turn + 1),
      ],
      metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
    }),
  })
}

/**
 * A generic OpenAI client running its own tool loop sends no session header.
 * The derived key (deriveToolLoopSessionId) is what the inner hop resolves, so
 * two rounds of one loop that collide share it.
 */
function chatRequest(messages: unknown[]): Request {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "dummy" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 128, stream: false, messages }),
  })
}

function observeTurnArrival(sessionId: string) {
  let markArrived = () => {}
  const arrived = new Promise<void>(resolve => { markArrived = resolve })
  const acquire = processSessionTurns.acquire.bind(processSessionTurns)
  const observer = spyOn(processSessionTurns, "acquire").mockImplementation((key, signal) => {
    const pending = acquire(key, signal)
    if (key === `session:${sessionId}`) markArrived()
    return pending
  })
  return { arrived, restore: () => observer.mockRestore() }
}

/** The text prompt one SDK attempt was handed. */
function sdkPrompt(index: number): string {
  const prompt = capturedParams[index]?.prompt
  if (typeof prompt !== "string") throw new Error(`SDK attempt #${index} was not handed a text prompt`)
  return prompt
}

interface PromptBlock {
  type: string
  text: string
  cache_control?: unknown
}

/** The text blocks of the single user message one SDK attempt was handed. */
async function sdkPromptBlocks(index: number): Promise<PromptBlock[]> {
  const prompt = capturedParams[index]?.prompt
  if (!prompt || typeof prompt === "string") throw new Error(`SDK attempt #${index} was not handed a structured prompt`)
  const messages: Array<{ message: { content: PromptBlock[] } }> = []
  for await (const message of prompt as AsyncIterable<{ message: { content: PromptBlock[] } }>) messages.push(message)
  if (messages.length !== 1) throw new Error(`SDK attempt #${index} was handed ${messages.length} user messages`)
  return messages[0]!.message.content
}

/** The text through the end of every block, and through each cache breakpoint. */
function promptPrefixes(blocks: PromptBlock[]): { boundaries: string[]; breakpoints: string[] } {
  let text = ""
  const boundaries = blocks.map(block => (text += block.text))
  return { boundaries, breakpoints: boundaries.filter((_, index) => blocks[index]!.cache_control !== undefined) }
}

async function waitForControl(index: number, timeoutMs = 3000): Promise<AttemptControl> {
  const deadline = Date.now() + timeoutMs
  while (!controls[index]) {
    // A refused request never reaches the SDK, so without this the assertion
    // "it was admitted" would surface as an opaque test-runner timeout.
    if (Date.now() > deadline) throw new Error(`SDK attempt #${index} never started`)
    await Bun.sleep(1)
  }
  const control = controls[index]!
  await control.started
  return control
}

describe("SDK and Session concurrency coordination", () => {
  let testSessionDir: string
  const originalMax = process.env.MERIDIAN_MAX_CONCURRENT
  const originalHold = process.env.MERIDIAN_SESSION_TURN_MAX_HOLD_MS
  const originalRouting = process.env.MERIDIAN_ROUTING
  const originalPromptCache = process.env.MERIDIAN_AUXILIARY_PROMPT_CACHE
  const originalAuxiliaryIdle = process.env.MERIDIAN_UPSTREAM_AUXILIARY_IDLE_MS

  beforeEach(() => {
    testSessionDir = mkdtempSync(join(tmpdir(), "meridian-concurrency-"))
    setSessionStoreDir(testSessionDir)
    process.env.MERIDIAN_MAX_CONCURRENT = "1"
    activeQueries = 0
    maxActiveQueries = 0
    queryCalls = 0
    controls = []
    capturedParams = []
    rateLimitWorkQueries = false
    refuseOwnedBreakpoints = false
    clearSessionCache()
    resetProcessSdkSemaphoreForTests()
    telemetryStore.clear()
    diagnosticLog.clear()
  })

  afterEach(() => {
    resetProcessSdkSemaphoreForTests()
    setSessionStoreDir(null)
    rmSync(testSessionDir, { recursive: true, force: true })
    if (originalMax === undefined) delete process.env.MERIDIAN_MAX_CONCURRENT
    else process.env.MERIDIAN_MAX_CONCURRENT = originalMax
    if (originalHold === undefined) delete process.env.MERIDIAN_SESSION_TURN_MAX_HOLD_MS
    else process.env.MERIDIAN_SESSION_TURN_MAX_HOLD_MS = originalHold
    if (originalRouting === undefined) delete process.env.MERIDIAN_ROUTING
    else process.env.MERIDIAN_ROUTING = originalRouting
    if (originalPromptCache === undefined) delete process.env.MERIDIAN_AUXILIARY_PROMPT_CACHE
    else process.env.MERIDIAN_AUXILIARY_PROMPT_CACHE = originalPromptCache
    if (originalAuxiliaryIdle === undefined) delete process.env.MERIDIAN_UPSTREAM_AUXILIARY_IDLE_MS
    else process.env.MERIDIAN_UPSTREAM_AUXILIARY_IDLE_MS = originalAuxiliaryIdle
  })

  it("holds the SDK permit for the complete streaming lifecycle", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const first = await app.fetch(request([{ role: "user", content: "one" }], "stream-one", true))
    const firstControl = await waitForControl(0)
    const second = await app.fetch(request([{ role: "user", content: "two" }], "stream-two", true))

    await Bun.sleep(10)
    expect(queryCalls).toBe(1)
    expect(activeQueries).toBe(1)

    firstControl.release()
    await first.text()
    const secondControl = await waitForControl(1)
    expect(maxActiveQueries).toBe(1)
    secondControl.release()
    await second.text()
    expect(activeQueries).toBe(0)
  })

  it("shares the SDK permit across ProxyServer instances", async () => {
    const firstApp = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const secondApp = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app

    const first = await firstApp.fetch(request([{ role: "user", content: "one" }], "process-one", true))
    const firstControl = await waitForControl(0)
    const second = await secondApp.fetch(request([{ role: "user", content: "two" }], "process-two", true))

    await Bun.sleep(10)
    expect(queryCalls).toBe(1)
    expect(activeQueries).toBe(1)

    firstControl.release()
    await first.text()
    const secondControl = await waitForControl(1)
    expect(maxActiveQueries).toBe(1)
    secondControl.release()
    await second.text()
  })

  it("uses the latest resume state for a continuation that waited", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const opening = [{ role: "user", content: "hello" }]
    const continuation = [
      ...opening,
      { role: "assistant", content: "ok" },
      { role: "user", content: "continue" },
    ]
    const firstP = app.fetch(request(opening, "shared"))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(request(continuation, "shared"))

    await Bun.sleep(10)
    expect(queryCalls).toBe(1)
    firstControl.release()
    expect((await firstP).status).toBe(200)

    const secondControl = await waitForControl(1)
    expect(capturedParams[0]?.options?.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(capturedParams[1]?.options?.resume).toBe(capturedParams[0]?.options?.sessionId)
    secondControl.release()
    expect((await secondP).status).toBe(200)
  })

  it("returns an Anthropic-compatible invalid request for a stale repeated branch", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const messages = [{ role: "user", content: "same request" }]
    const firstP = app.fetch(request(messages, "conflict"))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(request(messages, "conflict"))

    firstControl.release()
    expect((await firstP).status).toBe(200)
    const second = await secondP
    expect(second.status).toBe(400)
    expect(second.headers.get("x-meridian-conflict")).toBeNull()
    expect(await second.json()).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "This session advanced while the request was waiting. Retry with the latest conversation history or use a distinct session ID.",
      },
    })
    expect(queryCalls).toBe(1)

    // A refusal that never reaches telemetry is a refusal operators can't
    // count, so the rate of concurrency conflicts stays invisible.
    const conflicts = telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.status).toBe(400)
    expect(conflicts[0]!.upstreamDurationMs).toBe(0)
  })

  it("answers, instead of refusing, the loser of a race an adapter declares (#870)", async () => {
    // Reproduces the omp report: a side question asked mid-turn and the main
    // tool loop reach the proxy under one session id, holding branches that
    // share a prefix and differ at the last message. Serializing them is
    // right; refusing the loser is not, because the 400 is a hard error that
    // pushes the client onto a fallback model for a turn it could have run.
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const shared = [
      { role: "user", content: "start the task" },
      { role: "assistant", content: "ok" },
    ]
    const sideQuestion = [...shared, { role: "user", content: "by the way, which branch is this?" }]
    const mainLoop = [...shared, { role: "user", content: "tool result for step 12" }]

    const sideP = app.fetch(piRequest(sideQuestion, "omp-session"))
    const sideControl = await waitForControl(0)
    const mainP = app.fetch(piRequest(mainLoop, "omp-session"))

    sideControl.release()
    expect((await sideP).status).toBe(200)
    const mainControl = await waitForControl(1)
    mainControl.release()
    expect((await mainP).status).toBe(200)
    // One session id still means one turn at a time: the second SDK query only
    // started once the first had finished.
    expect(maxActiveQueries).toBe(1)
    expect(queryCalls).toBe(2)

    // The loser carries a branch the winner never had, so it runs fresh rather
    // than resuming the winner's session and merging two histories.
    expect(capturedParams[1]?.options?.resume).toBeUndefined()
    expect(telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")).toHaveLength(0)

    // The mapping follows the turn that ran last, so the next main-loop request
    // resumes instead of paying a second fresh replay.
    const loserSessionId = capturedParams[1]?.options?.sessionId
    expect(loserSessionId).toMatch(/^[0-9a-f-]{36}$/)
    const stored = Object.values(readSessionStoreSnapshot()).map(s => s.claudeSessionId)
    expect(stored).toContain(loserSessionId!)
  })

  it("answers, instead of refusing, a plugin-less OpenCode client's concurrent turn (#1024)", async () => {
    // OpenCode fires a Haiku `agent=title` stream and the primary turn about a
    // second apart on ONE session id. With Meridian's plugin the title says so
    // in a header and is detached; a client running some other plugin sends no
    // such header, so both look like the same conversation and the loser used
    // to take a hard 400 on the FIRST turn of every new session.
    //
    // It is exactly pi's situation — one session id for the main turn and its
    // side calls, no per-flow signal available — so it gets pi's treatment.
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const ua = { "user-agent": "opencode/1.18.30 ai-sdk/provider-utils/4.0.46 runtime/bun/1.3.14" }
    const messages = [{ role: "user", content: "same request" }]
    const firstP = app.fetch(request(messages, "pluginless", false, ua))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(request(messages, "pluginless", false, ua))

    firstControl.release()
    expect((await firstP).status).toBe(200)
    const secondControl = await waitForControl(1)
    secondControl.release()
    expect((await secondP).status).toBe(200)

    // Degraded, not waved through: still one turn at a time, and the loser runs
    // fresh rather than resuming the winner and merging two conversations.
    expect(maxActiveQueries).toBe(1)
    expect(queryCalls).toBe(2)
    expect(capturedParams[1]?.options?.resume).toBeUndefined()
    expect(telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")).toHaveLength(0)
  })

  it("still refuses the loser when the OpenCode plugin's signal is present", async () => {
    // The control for #1024: relaxing the rule must reach ONLY clients that
    // cannot send the signal. A plugin-equipped client that genuinely races
    // itself keeps the loud failure, because for it a collision is a defect
    // rather than an unavoidable protocol shape.
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const headers = {
      "user-agent": "opencode/1.18.30 ai-sdk/provider-utils/4.0.46 runtime/bun/1.3.14",
      "x-opencode-agent-mode": "primary",
    }
    const messages = [{ role: "user", content: "same request" }]
    const firstP = app.fetch(request(messages, "plugged", false, headers))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(request(messages, "plugged", false, headers))

    firstControl.release()
    expect((await firstP).status).toBe(200)
    const second = await secondP
    expect(second.status).toBe(400)
    expect((await second.json() as { error: { message: string } }).error.message)
      .toContain("advanced while the request was waiting")
    expect(queryCalls).toBe(1)
    expect(telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")).toHaveLength(1)
  })

  it("refuses a client that spoofs the synthesized-session marker", async () => {
    // The marker relaxes this guard and is read off the ordinary client-facing
    // request path, so it cannot be self-asserted. Only Meridian's own internal
    // hop carries the proof — the per-instance x-meridian-internal-hop token —
    // so a client sending the marker without that token earns nothing and keeps
    // the loud conflict the previous test pins.
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const headers = {
      "user-agent": "opencode/1.18.30 ai-sdk/provider-utils/4.0.46 runtime/bun/1.3.14",
      "x-opencode-agent-mode": "primary",
      "x-meridian-synthesized-session": "1",
    }
    const messages = [{ role: "user", content: "same request" }]
    const firstP = app.fetch(request(messages, "spoofed", false, headers))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(request(messages, "spoofed", false, headers))

    firstControl.release()
    expect((await firstP).status).toBe(200)
    const second = await secondP
    expect(second.status).toBe(400)
    expect(queryCalls).toBe(1)
    expect(telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")).toHaveLength(1)
  })

  it("answers, instead of refusing, a headless Claude Code client's concurrent turn (#1043)", async () => {
    // Claude Code in headless mode (`claude -p "..."`) fires a session-start
    // side request and the primary prompt concurrently under the same session
    // ID in metadata.user_id. The primary request waits for turn lease, then
    // gets rejected with HTTP 400 because sessionTurnLease.advancedWhileWaiting
    // is true and !declaresConcurrentFlow. With
    // runsConcurrentTurnsPerSessionKey: true, the loser is reclassified as a
    // fresh replay instead of failing with HTTP 400.
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = "claude-code-race"
    const sideRequest = [{ role: "user", content: "session warmup" }]
    const primaryRequest = [
      { role: "user", content: "Reply with exactly the word OK" },
    ]

    const firstP = app.fetch(claudeCodeRequest(sideRequest, sessionId))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(claudeCodeRequest(primaryRequest, sessionId))

    firstControl.release()
    expect((await firstP).status).toBe(200)
    const secondControl = await waitForControl(1)
    secondControl.release()
    expect((await secondP).status).toBe(200)

    expect(maxActiveQueries).toBe(1)
    expect(queryCalls).toBe(2)
    expect(capturedParams[1]?.options?.resume).toBeUndefined()
    expect(telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")).toHaveLength(0)
  })

  it("keeps a Claude Code conversation resumable across an auto-mode classifier request", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-aux-${crypto.randomUUID()}`
    const opening = [{ role: "user", content: "Run the tests" }]

    const firstP = app.fetch(claudeCodeRequest(opening, sessionId))
    ;(await waitForControl(0)).release()
    expect((await firstP).status).toBe(200)
    const published = readSessionStoreSnapshot()[sessionId]
    expect(published?.messageCount).toBe(1)

    const auxP = app.fetch(claudeCodeClassifierRequest(sessionId))
    ;(await waitForControl(1)).release()
    expect((await auxP).status).toBe(200)
    // Answered on its own body, and the conversation's mapping is untouched.
    expect(capturedParams[1]?.options?.resume).toBeUndefined()
    expect(readSessionStoreSnapshot()[sessionId]).toEqual(published)

    const nextP = app.fetch(claudeCodeRequest([
      ...opening,
      { role: "assistant", content: "ok" },
      { role: "user", content: "continue" },
    ], sessionId))
    ;(await waitForControl(2)).release()
    expect((await nextP).status).toBe(200)
    expect(capturedParams[2]?.options?.resume).toBe(capturedParams[0]?.options?.sessionId)
  })

  it("never queues a classifier request behind the conversation's running turn", async () => {
    // Two SDK permits, so only the session lease could make the side call wait.
    process.env.MERIDIAN_MAX_CONCURRENT = "2"
    resetProcessSdkSemaphoreForTests()
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-aux-lease-${crypto.randomUUID()}`
    const opening = [{ role: "user", content: "Run the tests" }]

    const mainP = app.fetch(claudeCodeRequest(opening, sessionId))
    const mainControl = await waitForControl(0)
    // The main turn is inside the SDK and holds the session lease.
    const auxP = app.fetch(claudeCodeClassifierRequest(sessionId))
    const auxControl = await waitForControl(1)
    auxControl.release()
    expect((await auxP).status).toBe(200)
    expect(telemetryStore.getRecent().find(m => m.sessionQueueWaitMs !== undefined && m.sessionQueueWaitMs > 50))
      .toBeUndefined()

    // The main turn still commits normally after the side call finished first.
    mainControl.release()
    expect((await mainP).status).toBe(200)
    expect(readSessionStoreSnapshot()[sessionId]?.messageCount).toBe(1)
    expect(telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")).toHaveLength(0)
  })

  it("treats a declared non-auxiliary request class as a normal turn", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-main-class-${crypto.randomUUID()}`
    const reqP = app.fetch(claudeCodeClassifierRequest(sessionId, { "x-claude-code-request-class": "main" }))
    ;(await waitForControl(0)).release()
    expect((await reqP).status).toBe(200)
    expect(readSessionStoreSnapshot()[sessionId]?.messageCount).toBe(2)
  })

  it("never queues a Claude Code subagent turn behind its parent's running turn", async () => {
    // Two SDK permits, so only the session lease could make the subagent wait.
    process.env.MERIDIAN_MAX_CONCURRENT = "2"
    resetProcessSdkSemaphoreForTests()
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-subagent-lease-${crypto.randomUUID()}`

    const parentP = app.fetch(claudeCodeRequest([{ role: "user", content: "Spawn a reviewer" }], sessionId))
    const parentControl = await waitForControl(0)
    // The parent turn is inside the SDK and holds its session lease. Queued
    // behind it, the subagent would never reach the SDK and this would time out.
    const subP = app.fetch(claudeCodeSubagentRequest(
      [{ role: "user", content: "Review the diff" }], sessionId, "a4a81dc1bbf7ee837",
    ))
    const subControl = await waitForControl(1)
    subControl.release()
    expect((await subP).status).toBe(200)
    parentControl.release()
    expect((await parentP).status).toBe(200)

    expect(telemetryStore.getRecent().find(m => m.sessionQueueWaitMs !== undefined && m.sessionQueueWaitMs > 50))
      .toBeUndefined()
    expect(telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")).toHaveLength(0)
  })

  it("resumes a Claude Code parent and its subagent each on their own session", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-subagent-${crypto.randomUUID()}`
    const agentId = "a9b1a8c1cf8639b90"
    const subagentKey = claudeCodeSubagentKey(sessionId, agentId)
    const parentOpening = [{ role: "user", content: "Spawn a reviewer" }]
    const subagentOpening = [{ role: "user", content: "Review the diff" }]

    const parentFirst = app.fetch(claudeCodeRequest(parentOpening, sessionId))
    ;(await waitForControl(0)).release()
    expect((await parentFirst).status).toBe(200)

    const subagentFirst = app.fetch(claudeCodeSubagentRequest(subagentOpening, sessionId, agentId))
    ;(await waitForControl(1)).release()
    expect((await subagentFirst).status).toBe(200)
    // A subagent's first turn starts a session of its own and leaves the
    // parent's mapping exactly as the parent left it.
    expect(capturedParams[1]?.options?.resume).toBeUndefined()
    expect(readSessionStoreSnapshot()[sessionId]?.messageCount).toBe(1)
    expect(readSessionStoreSnapshot()[subagentKey]?.messageCount).toBe(1)

    const subagentNext = app.fetch(claudeCodeSubagentRequest([
      ...subagentOpening,
      { role: "assistant", content: "ok" },
      { role: "user", content: "the diff looks fine" },
    ], sessionId, agentId))
    ;(await waitForControl(2)).release()
    expect((await subagentNext).status).toBe(200)
    expect(capturedParams[2]?.options?.resume).toBe(capturedParams[1]?.options?.sessionId)

    const parentNext = app.fetch(claudeCodeRequest([
      ...parentOpening,
      { role: "assistant", content: "ok" },
      { role: "user", content: "continue" },
    ], sessionId))
    ;(await waitForControl(3)).release()
    expect((await parentNext).status).toBe(200)
    expect(capturedParams[3]?.options?.resume).toBe(capturedParams[0]?.options?.sessionId)
  })

  it("runs two parallel subagents of one conversation without serializing them", async () => {
    process.env.MERIDIAN_MAX_CONCURRENT = "2"
    resetProcessSdkSemaphoreForTests()
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-parallel-${crypto.randomUUID()}`

    const firstP = app.fetch(claudeCodeSubagentRequest(
      [{ role: "user", content: "Review alpha" }], sessionId, "a9b1a8c1cf8639b90",
    ))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(claudeCodeSubagentRequest(
      [{ role: "user", content: "Review beta" }], sessionId, "a974a04cc37ab3ce8",
    ))
    const secondControl = await waitForControl(1)
    expect(maxActiveQueries).toBe(2)
    secondControl.release()
    firstControl.release()
    expect((await firstP).status).toBe(200)
    expect((await secondP).status).toBe(200)
  })

  it("isolates a subagent's classifier call as auxiliary", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-subagent-aux-${crypto.randomUUID()}`
    const agentId = "a4a81dc1bbf7ee837"
    const subagentKey = claudeCodeSubagentKey(sessionId, agentId)

    const subagentFirst = app.fetch(claudeCodeSubagentRequest(
      [{ role: "user", content: "Review the diff" }], sessionId, agentId,
    ))
    ;(await waitForControl(0)).release()
    expect((await subagentFirst).status).toBe(200)
    const published = readSessionStoreSnapshot()[subagentKey]
    expect(published?.messageCount).toBe(1)

    const auxP = app.fetch(claudeCodeClassifierRequest(sessionId, { "x-claude-code-agent-id": agentId }))
    ;(await waitForControl(1)).release()
    expect((await auxP).status).toBe(200)
    expect(capturedParams[1]?.options?.resume).toBeUndefined()
    expect(readSessionStoreSnapshot()[subagentKey]).toEqual(published)
  })

  it("keeps a Claude Code subagent resumable across its background progress summary", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-agent-summary-${crypto.randomUUID()}`
    const agentId = "a4a81dc1bbf7ee837"
    const subagentKey = claudeCodeSubagentKey(sessionId, agentId)

    const turnP = app.fetch(claudeCodeSubagentRequest(SUBAGENT_TOOL_ROUND, sessionId, agentId))
    ;(await waitForControl(0)).release()
    expect((await turnP).status).toBe(200)
    const published = readSessionStoreSnapshot()[subagentKey]
    expect(published?.messageCount).toBe(5)

    // The fork repeats the subagent's history with one more block on its final
    // user message. Committed as a turn, that variant replaces the mapping, and
    // the subagent's next real turn reads as modified history against it.
    const summary = await app.fetch(claudeCodeAgentSummaryRequest(SUBAGENT_TOOL_ROUND, sessionId, agentId))
    ;(await waitForControl(1)).release()
    expect(summary.status).toBe(200)
    await summary.text()
    expect(readSessionStoreSnapshot()[subagentKey]).toEqual(published)

    const nextP = app.fetch(claudeCodeSubagentRequest(SUBAGENT_NEXT_ROUND, sessionId, agentId))
    ;(await waitForControl(2)).release()
    expect((await nextP).status).toBe(200)
    expect(capturedParams[2]?.options?.resume).toBe(capturedParams[0]?.options?.sessionId)
  })

  it("keeps a Claude Code subagent resumable when its progress summary runs ahead of the next turn", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-agent-summary-ahead-${crypto.randomUUID()}`
    const agentId = "a4a81dc1bbf7ee837"
    const subagentKey = claudeCodeSubagentKey(sessionId, agentId)

    const turnP = app.fetch(claudeCodeSubagentRequest(SUBAGENT_TOOL_ROUND, sessionId, agentId))
    ;(await waitForControl(0)).release()
    expect((await turnP).status).toBe(200)
    const published = readSessionStoreSnapshot()[subagentKey]
    expect(published?.messageCount).toBe(5)

    // The next tool result is in, but the turn that reports it is held up
    // (observed live behind a stalled permission check), so the CLI's timer
    // forks the transcript first. This fork extends the stored history exactly
    // as that turn will, so nothing about its lineage marks it as a side call.
    const summary = await app.fetch(claudeCodeAgentSummaryRequest(SUBAGENT_NEXT_ROUND, sessionId, agentId))
    ;(await waitForControl(1)).release()
    expect(summary.status).toBe(200)
    await summary.text()
    expect(readSessionStoreSnapshot()[subagentKey]).toEqual(published)

    const nextP = app.fetch(claudeCodeSubagentRequest(SUBAGENT_NEXT_ROUND, sessionId, agentId))
    ;(await waitForControl(2)).release()
    expect((await nextP).status).toBe(200)
    expect(capturedParams[2]?.options?.resume).toBe(capturedParams[0]?.options?.sessionId)
  })

  it("never queues a progress summary behind the subagent's running turn", async () => {
    // Two SDK permits, so only the session lease could make the fork wait.
    process.env.MERIDIAN_MAX_CONCURRENT = "2"
    resetProcessSdkSemaphoreForTests()
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-agent-summary-lease-${crypto.randomUUID()}`
    const agentId = "a974a04cc37ab3ce8"
    const subagentKey = claudeCodeSubagentKey(sessionId, agentId)

    const turnP = app.fetch(claudeCodeSubagentRequest(SUBAGENT_TOOL_ROUND, sessionId, agentId))
    const turnControl = await waitForControl(0)
    // The CLI's timer fires while the subagent's turn is inside the SDK and
    // holds the session lease. Queued behind it, the fork would never reach
    // the SDK and this would time out.
    const summaryP = app.fetch(claudeCodeAgentSummaryRequest(SUBAGENT_TOOL_ROUND, sessionId, agentId))
    ;(await waitForControl(1)).release()
    const summary = await summaryP
    expect(summary.status).toBe(200)
    await summary.text()
    expect(telemetryStore.getRecent().find(m => m.sessionQueueWaitMs !== undefined && m.sessionQueueWaitMs > 50))
      .toBeUndefined()

    // The turn still publishes its own session after the fork finished first.
    turnControl.release()
    expect((await turnP).status).toBe(200)
    expect(readSessionStoreSnapshot()[subagentKey]?.claudeSessionId).toBe(capturedParams[0]?.options?.sessionId)
    expect(telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")).toHaveLength(0)
  })

  it("answers a progress summary from the latest step instead of replaying the whole history", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-agent-summary-replay-${crypto.randomUUID()}`
    const agentId = "a4a81dc1bbf7ee837"

    // A turn of the subagent's own with no session to resume replays all of it.
    const turnP = app.fetch(claudeCodeSubagentRequest(SUBAGENT_NEXT_ROUND, sessionId, agentId))
    ;(await waitForControl(0)).release()
    expect((await turnP).status).toBe(200)
    expect(sdkPrompt(0)).toContain("Review the diff")
    expect(sdkPrompt(0)).toContain("export const a = 1")
    expect(sdkPrompt(0)).toContain("export const b = 2")

    // The fork carries that same history and answers from a session of its
    // own, so all of it was sent, and written to the prompt cache, for a label
    // that describes the latest step (measured live: ~316K tokens per label).
    const summary = await app.fetch(claudeCodeAgentSummaryRequest(SUBAGENT_NEXT_ROUND, sessionId, agentId))
    ;(await waitForControl(1)).release()
    expect(summary.status).toBe(200)
    await summary.text()
    expect(capturedParams[1]?.options?.resume).toBeUndefined()
    expect(sdkPrompt(1)).toContain("b.ts")
    expect(sdkPrompt(1)).toContain("export const b = 2")
    expect(sdkPrompt(1)).toContain("Describe your most recent action in 3-5 words")
    expect(sdkPrompt(1)).not.toContain("Review the diff")
    expect(sdkPrompt(1)).not.toContain("export const a = 1")
    expect(sdkPrompt(1)).toContain("5 earlier messages")
    // Marker, latest assistant turn, prompt turn — and the log says so.
    expect(diagnosticLog.getRecent({ category: "session" }).map(entry => entry.message))
      .toContainEqual(expect.stringContaining("auxiliary replay reduced: 7 messages -> 3"))
  })

  it("replays a request whole when the client says it is a turn, whatever it ends with", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-agent-summary-declared-${crypto.randomUUID()}`
    const fork = claudeCodeAgentSummaryRequest(SUBAGENT_NEXT_ROUND, sessionId, "a4a81dc1bbf7ee837")
    // An explicit request class outranks the prompt's shape. Only a side call
    // is answered from part of what it sent; a turn's history is the turn.
    fork.headers.set("x-claude-code-request-class", "subagent")

    const turn = await app.fetch(fork)
    ;(await waitForControl(0)).release()
    expect(turn.status).toBe(200)
    await turn.text()
    expect(sdkPrompt(0)).toContain("Review the diff")
    expect(sdkPrompt(0)).toContain("export const a = 1")
    expect(sdkPrompt(0)).toContain("Describe your most recent action in 3-5 words")
  })

  it("sends a permission check's transcript as blocks with its own cache breakpoints", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-check-layout-${crypto.randomUUID()}`

    const checkP = app.fetch(claudeCodeTranscriptCheck(sessionId, 400))
    ;(await waitForControl(0)).release()
    expect((await checkP).status).toBe(200)
    const blocks = await sdkPromptBlocks(0)

    // The same request with the layout switched off is the prompt as it was
    // always sent: one string. The blocks are that text and nothing else.
    process.env.MERIDIAN_AUXILIARY_PROMPT_CACHE = "0"
    const flatP = app.fetch(claudeCodeTranscriptCheck(sessionId, 400))
    ;(await waitForControl(1)).release()
    expect((await flatP).status).toBe(200)
    expect(blocks.map(block => block.text).join("")).toBe(sdkPrompt(1))
    expect(blocks.length).toBeGreaterThan(3)
    expect(blocks.every(block => block.type === "text" && block.text.trim() !== "")).toBe(true)

    // Two breakpoints, both Meridian's: where the user's instructions end, and
    // the last cut before the part that changes. The client's own are gone.
    // On a subscription profile they live an hour, as the SDK child's would.
    const marked = blocks.filter(block => block.cache_control !== undefined)
    expect(marked.map(block => block.cache_control))
      .toEqual([{ type: "ephemeral", ttl: "1h" }, { type: "ephemeral", ttl: "1h" }])
    const { breakpoints } = promptPrefixes(blocks)
    expect(breakpoints[0]).toEndWith("</user_claude_md>\n</conversation_history>\n\nThe above is a replay of your prior conversation with this user — the original session could not be resumed. It is context only: do not continue or imitate its transcript format, do not write \"[Assistant: ...]\" markers, and never invent tool output — use your actual tools when action is needed. Respond only as the assistant to the user's message below.\n\n")
    expect(breakpoints[1]!.includes("step-200.test.ts")).toBe(true)
    expect(breakpoints[1]!.includes("step-399.test.ts")).toBe(false)
    expect(blocks.at(-1)!.cache_control).toBeUndefined()
    expect(blocks.at(-1)!.text).toEndWith(CLASSIFIER_INSTRUCTION)

    // Its breakpoints are only valid alone, so the CLI's are switched off —
    // for this prompt, and not for the plain one.
    expect(capturedParams[0]?.options?.env?.DISABLE_PROMPT_CACHING).toBe("1")
    expect(capturedParams[1]?.options?.env?.DISABLE_PROMPT_CACHING).toBeUndefined()
    const laidOut = diagnosticLog.getRecent({ category: "session" }).map(entry => entry.message)
      .filter(message => message.includes("auxiliary prompt laid out for caching"))
    expect(laidOut).toHaveLength(1)
    expect(laidOut[0]).toContain(`${blocks.length} blocks, 2 breakpoints`)
  })

  it("caches a permission check for five minutes on an API-key profile, as its SDK child would", async () => {
    const app = createProxyServer({
      port: 0, host: "127.0.0.1", silent: true,
      profiles: [{ id: "keyed", type: "api", apiKey: "test-key", baseUrl: "http://127.0.0.1:9" }],
      defaultProfile: "keyed",
    }).app
    const sessionId = `claude-code-check-api-profile-${crypto.randomUUID()}`

    const checkP = app.fetch(claudeCodeTranscriptCheck(sessionId, 400))
    ;(await waitForControl(0)).release()
    expect((await checkP).status).toBe(200)
    const marked = (await sdkPromptBlocks(0)).filter(block => block.cache_control !== undefined)
    expect(marked.map(block => block.cache_control)).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }])
    expect(capturedParams[0]?.options?.env?.DISABLE_PROMPT_CACHING).toBe("1")
  })

  it("lets a later permission check read back what the one before it wrote", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-check-growth-${crypto.randomUUID()}`
    const prompts: PromptBlock[][] = []
    // Stage 1, then stage 2 of the same check, then the next check.
    const checks: Array<[number, string]> = [
      [400, CLASSIFIER_INSTRUCTION],
      [400, "Use <thinking> first, then respond with <severity>N</severity>."],
      [431, CLASSIFIER_INSTRUCTION],
    ]
    for (const [index, [entries, instruction]] of checks.entries()) {
      const checkP = app.fetch(claudeCodeTranscriptCheck(sessionId, entries, instruction))
      ;(await waitForControl(index)).release()
      expect((await checkP).status).toBe(200)
      prompts.push(await sdkPromptBlocks(index))
    }
    // The cache reads an entry only where a later request has a block boundary
    // exactly where an earlier one put a breakpoint.
    for (const [index, earlier] of prompts.slice(0, -1).entries()) {
      const later = promptPrefixes(prompts[index + 1]!)
      for (const prefix of promptPrefixes(earlier).breakpoints) expect(later.boundaries).toContain(prefix)
    }
    const grown = prompts.map(blocks => blocks.map(block => block.text).join(""))
    const reused = promptPrefixes(prompts[1]!).breakpoints.at(-1)!
    expect(reused.length).toBeGreaterThan(grown[2]!.length * 0.6)
    expect(grown[2]!.startsWith(reused)).toBe(true)
  })

  it("leaves a side call too short to cache, and one that does not grow, as they were", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-check-short-${crypto.randomUUID()}`

    const shortP = app.fetch(claudeCodeClassifierRequest(sessionId))
    ;(await waitForControl(0)).release()
    expect((await shortP).status).toBe(200)
    expect(sdkPrompt(0)).toContain("Should this action be blocked?")
    expect(capturedParams[0]?.options?.env?.DISABLE_PROMPT_CACHING).toBeUndefined()

    // A progress summary is answered from its latest step, a different one
    // every time, so however long that step is there is nothing to read back.
    const calls = Array.from({ length: 16 }, (_, index) => `toolu_read_${index}`)
    const longRound = [
      ...SUBAGENT_TOOL_ROUND,
      { role: "assistant", content: calls.map(id => ({ type: "tool_use", id, name: "Read", input: { file_path: `${id}.ts` } })) },
      { role: "user", content: calls.map(id => ({ type: "tool_result", tool_use_id: id, content: `export const ${id} = 1\n`.repeat(80) })) },
    ]
    const summary = await app.fetch(claudeCodeAgentSummaryRequest(longRound, sessionId, "a4a81dc1bbf7ee837"))
    ;(await waitForControl(1)).release()
    expect(summary.status).toBe(200)
    await summary.text()
    expect(sdkPrompt(1).length).toBeGreaterThan(30_000)
    expect(sdkPrompt(1)).toContain("Describe your most recent action in 3-5 words")
    expect(capturedParams[1]?.options?.env?.DISABLE_PROMPT_CACHING).toBeUndefined()
    expect(diagnosticLog.getRecent({ category: "session" }).map(entry => entry.message)
      .filter(message => message.includes("auxiliary prompt laid out for caching"))).toHaveLength(0)
  })

  it("resends a permission check as plain text when the API refuses its breakpoints, and stops laying them out", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-check-refused-${crypto.randomUUID()}`
    refuseOwnedBreakpoints = true

    const checkP = app.fetch(claudeCodeTranscriptCheck(sessionId, 400))
    await waitForControl(0)
    ;(await waitForControl(1)).release()
    const check = await checkP
    expect(check.status).toBe(200)
    expect((await check.json() as { content: Array<{ text?: string }> }).content[0]?.text).toBe("ok")
    expect(capturedParams[0]?.options?.env?.DISABLE_PROMPT_CACHING).toBe("1")
    expect(capturedParams[1]?.options?.env?.DISABLE_PROMPT_CACHING).toBeUndefined()
    expect(sdkPrompt(1)).toEndWith(CLASSIFIER_INSTRUCTION)
    expect(sdkPrompt(1)).toContain("step-399.test.ts")

    // A CLI that adds breakpoints of its own does so every time: the next
    // check goes out plain at once instead of paying for a refusal first.
    const nextP = app.fetch(claudeCodeTranscriptCheck(sessionId, 420))
    ;(await waitForControl(2)).release()
    expect((await nextP).status).toBe(200)
    expect(queryCalls).toBe(3)
    expect(sdkPrompt(2)).toContain("step-419.test.ts")
    expect(capturedParams[2]?.options?.env?.DISABLE_PROMPT_CACHING).toBeUndefined()
    expect(diagnosticLog.getRecent({ category: "session" }).map(entry => entry.message)
      .filter(message => message.includes("cache breakpoints refused"))).toHaveLength(1)
  })

  it("keeps the shared key when the agent id is malformed", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-bad-agent-${crypto.randomUUID()}`

    const reqP = app.fetch(claudeCodeSubagentRequest([{ role: "user", content: "hello" }], sessionId, "not a valid id"))
    ;(await waitForControl(0)).release()
    expect((await reqP).status).toBe(200)
    expect(readSessionStoreSnapshot()[sessionId]?.messageCount).toBe(1)
    expect(Object.keys(readSessionStoreSnapshot()).some(key => key.startsWith(`${sessionId}:agent:`))).toBe(false)
  })

  it("replays a declared-flow loser instead of rewinding the turn it lost to (#870)", async () => {
    // A side call carries a prefix of the main history, so once the main turn
    // commits the loser reads as an undo against it. Honouring that would roll
    // the winner's SDK session back to serve a turn that merely arrived late,
    // so a declared flow is admitted on its own body, never on that lineage.
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `omp-undo-${crypto.randomUUID()}`
    const committed = [
      { role: "user", content: "start the task" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "tool result for step 12" },
    ]
    const lease = await processSessionTurns.acquire(`session:${sessionId}`)
    const incoming = [...committed.slice(0, 2), { role: "user", content: "side question from the earlier turn" }]
    const arrival = observeTurnArrival(sessionId)
    const sideP = app.fetch(piRequest(incoming, sessionId))
    try { await arrival.arrived } finally { arrival.restore() }

    // The request has taken its coherent snapshot and joined the real queue.
    storeSharedSession(
      sessionId,
      "winner-sdk",
      committed.length,
      computeLineageHash(committed),
      computeMessageHashes(committed),
      ["winner-uuid-1", "winner-uuid-2", "winner-uuid-3"],
    )
    // Ensure this fixture actually reaches the undo path under current proofs.
    const winner = readSessionStoreSnapshot()[sessionId]
    if (!winner?.lineageHash) throw new Error("Expected a verifiable winner mapping")
    expect(verifyLineage({ ...winner, lineageHash: winner.lineageHash, lastAccess: 0 }, incoming).type).toBe("undo")
    lease.markCommitted(sessionId)
    lease.release()

    const sideControl = await waitForControl(0)
    sideControl.release()
    expect((await sideP).status).toBe(200)
    // Neither resumed nor rolled back: the committed session is left alone.
    expect(capturedParams[0]?.options?.resume).toBeUndefined()
    expect(capturedParams[0]?.options?.resumeSessionAt).toBeUndefined()
  })

  it("keeps a per-request fork signal's undo when it loses the same race (#870)", async () => {
    // The protocol-level declaration exists because pi cannot mark its own side
    // calls, so an undo shape there is an accident of arrival order. A fork
    // source is the opposite: that caller named the boundary itself, so its
    // rollback is deliberate and must still be honoured after losing a race.
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `omp-fork-${crypto.randomUUID()}`
    const committed = [
      { role: "user", content: "start the task" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "tool result for step 12" },
    ]
    const lease = await processSessionTurns.acquire(`session:${sessionId}`)
    const incoming = [...committed.slice(0, 2), { role: "user", content: "extract memory at this fork boundary" }]
    const arrival = observeTurnArrival(sessionId)
    const forkP = app.fetch(piRequest(incoming, sessionId, {
      "x-meridian-source": "fork-memory-extract",
    }))
    try { await arrival.arrived } finally { arrival.restore() }

    // Same admission boundary as the unmarked side call; no timing sleep.
    storeSharedSession(
      sessionId,
      "winner-sdk",
      committed.length,
      computeLineageHash(committed),
      computeMessageHashes(committed),
      ["winner-uuid-1", "winner-uuid-2", "winner-uuid-3"],
    )
    // Ensure this fixture actually reaches the undo path under current proofs.
    const winner = readSessionStoreSnapshot()[sessionId]
    if (!winner?.lineageHash) throw new Error("Expected a verifiable winner mapping")
    expect(verifyLineage({ ...winner, lineageHash: winner.lineageHash, lastAccess: 0 }, incoming).type).toBe("undo")
    lease.markCommitted(sessionId)
    lease.release()

    const forkControl = await waitForControl(0)
    forkControl.release()
    expect((await forkP).status).toBe(200)
    expect(capturedParams[0]?.options?.resume).toBe("winner-sdk")
    expect(capturedParams[0]?.options?.resumeSessionAt).toBe("winner-uuid-2")
  })

  it("replays a synthesized-key loser instead of rewinding the session it lost to", async () => {
    // A generic OpenAI client owns its tool loop and sends no session header,
    // so Meridian derives one from the loop's first tool-call id. A later round
    // and an earlier one can still collide on it: the earlier body is a prefix
    // of what the committed round stored, so it reads as an undo. That shape is
    // an accident of arrival order — the client named no boundary — so
    // honouring it would rewind the session the later round just committed. The
    // synthesized-key proof (x-meridian-internal-hop; see the spoof test above)
    // earns the same soft reclassification a protocol that runs concurrent
    // turns per key already gets.
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const call = { id: "call_race_1", type: "function", function: { name: "bash", arguments: "{}" } }
    const winner = [
      { role: "user", content: "start the task" },
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: "call_race_1", content: "winner result" },
    ]
    const loser = [
      ...winner.slice(0, 2),
      { role: "tool", tool_call_id: "call_race_1", content: "earlier attempt, arrived late" },
    ]
    const derivedKey = deriveToolLoopSessionId({ messages: winner })
    expect(derivedKey).toBeDefined()
    // Same key, so the two rounds share one session and one turn lease; only the
    // final message differs, which is the undo shape.
    expect(deriveToolLoopSessionId({ messages: loser })).toBe(derivedKey!)

    // The lineage the inner hop will compare against: the OpenAI bodies
    // translated to Anthropic and canonicalized by the adapter the internal hop
    // selects. The loser shares the first two messages and rewrites the last.
    const committed = openAiAdapter.canonicalizeMessagesForLineage!(
      translateOpenAiToAnthropic({ messages: winner } as never, { preserveConversationHistory: true })!.messages,
    )
    const incoming = openAiAdapter.canonicalizeMessagesForLineage!(
      translateOpenAiToAnthropic({ messages: loser } as never, { preserveConversationHistory: true })!.messages,
    )

    const lease = await processSessionTurns.acquire(`session:${derivedKey}`)
    const arrival = observeTurnArrival(derivedKey!)
    const loserP = app.fetch(chatRequest(loser))
    try { await arrival.arrived } finally { arrival.restore() }

    // The round this request lost to has committed; its body reads as an undo.
    storeSharedSession(
      derivedKey!,
      "winner-sdk",
      committed.length,
      computeLineageHash(committed),
      computeMessageHashes(committed),
      ["winner-uuid-1", "winner-uuid-2", "winner-uuid-3"],
    )
    const winnerStored = readSessionStoreSnapshot()[derivedKey!]
    if (!winnerStored?.lineageHash) throw new Error("Expected a verifiable winner mapping")
    expect(verifyLineage({ ...winnerStored, lineageHash: winnerStored.lineageHash, lastAccess: 0 }, incoming).type).toBe("undo")
    lease.markCommitted(derivedKey!)
    lease.release()

    const loserControl = await waitForControl(0)
    loserControl.release()
    expect((await loserP).status).toBe(200)
    // Neither resumed nor rolled back: the committed session is left alone, and
    // the loser replays its own body instead of being refused or rewinding.
    expect(capturedParams[0]?.options?.resume).toBeUndefined()
    expect(capturedParams[0]?.options?.resumeSessionAt).toBeUndefined()
    expect(telemetryStore.getRecent().filter(m => m.error === "session_turn_conflict")).toHaveLength(0)
  })

  it("does not refuse a turn because a DIFFERENT profile advanced the same session id", async () => {
    // One client session id backs an independent conversation per profile, each
    // with its own cache scope. A commit under "work" says nothing about the
    // lineage a queued "personal" request carries, so it must not refuse it.
    const app = createProxyServer({
      port: 0,
      host: "127.0.0.1",
      silent: true,
      profiles: [
        { id: "work", claudeConfigDir: "/tmp/meridian-test-turn-work" },
        { id: "personal", claudeConfigDir: "/tmp/meridian-test-turn-personal" },
      ],
      defaultProfile: "work",
    }).app
    const messages = [{ role: "user", content: "same request" }]
    const firstP = app.fetch(request(messages, "cross-profile", false, { "x-meridian-profile": "work" }))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(request(messages, "cross-profile", false, { "x-meridian-profile": "personal" }))

    // Still serialized — they share one client session id.
    await Bun.sleep(10)
    expect(queryCalls).toBe(1)

    firstControl.release()
    expect((await firstP).status).toBe(200)

    const secondControl = await waitForControl(1)
    secondControl.release()
    expect((await secondP).status).toBe(200)
    expect(queryCalls).toBe(2)
  })

  it("rejects a stale turn when a hot priority profile appears after the arrival snapshot", async () => {
    process.env.MERIDIAN_ROUTING = "priority"
    const profiles = [
      { id: "work", claudeConfigDir: "/tmp/meridian-test-hot-work" },
    ]
    const app = createProxyServer({
      port: 0,
      host: "127.0.0.1",
      silent: true,
      profiles,
      defaultProfile: "work",
    }).app
    const sessionId = `hot-profile-${crypto.randomUUID()}`
    const lease = await processSessionTurns.acquire(`session:${sessionId}`)
    const pending = app.fetch(request([{ role: "user", content: "stale body" }], sessionId))

    // Let handleWithQueue take its coherent arrival snapshot, then make a new
    // profile and its durable mapping visible before the queued turn is granted.
    await Bun.sleep(20)
    profiles.push({ id: "hot", claudeConfigDir: "/tmp/meridian-test-hot-new" })
    storeSharedSession(`hot:${sessionId}`, "hot-existing-sdk", 2, "hot-lineage", ["old-a", "old-b"])
    rateLimitWorkQueries = true
    lease.release()

    const response = await pending
    expect(response.status).toBe(400)
    expect((await response.json() as { error?: { message?: string } }).error?.message)
      .toContain("advanced while the request was waiting")
    expect(capturedParams.length).toBeGreaterThan(0)
    expect(capturedParams.every((params) =>
      params.options?.env?.CLAUDE_CONFIG_DIR?.includes("hot-work") === true
    )).toBe(true)
  }, 10_000)

  it("lets a declared concurrent flow replay instead of refusing it", async () => {
    // fork-/subagent- sources knowingly run parallel turns under one session
    // key; a reclassification is their normal cost. Refusing them would break
    // flows that worked before turn coordination existed.
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const messages = [{ role: "user", content: "same request" }]
    const firstP = app.fetch(request(messages, "declared-flow"))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(
      request(messages, "declared-flow", false, { "x-meridian-source": "subagent-scout" }),
    )

    firstControl.release()
    expect((await firstP).status).toBe(200)

    const secondControl = await waitForControl(1)
    secondControl.release()
    expect((await secondP).status).toBe(200)
    expect(queryCalls).toBe(2)
  })

  it("lets an OpenCode subagent mode replay instead of refusing it", async () => {
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const messages = [{ role: "user", content: "same request" }]
    const firstP = app.fetch(request(messages, "declared-mode"))
    const firstControl = await waitForControl(0)
    const secondP = app.fetch(
      request(messages, "declared-mode", false, { "x-opencode-agent-mode": "subagent" }),
    )

    firstControl.release()
    expect((await firstP).status).toBe(200)

    const secondControl = await waitForControl(1)
    secondControl.release()
    expect((await secondP).status).toBe(200)
    expect(queryCalls).toBe(2)
  })

  it("gives up on a side call the model never answers long before it would on a turn", async () => {
    process.env.MERIDIAN_UPSTREAM_AUXILIARY_IDLE_MS = "150"
    process.env.MERIDIAN_MAX_CONCURRENT = "3"
    resetProcessSdkSemaphoreForTests()
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-aux-idle-${crypto.randomUUID()}`

    // A turn that has gone quiet, and beside it a permission check the model
    // never answers. The conversation cannot move until the check returns.
    const turnP = app.fetch(claudeCodeRequest([{ role: "user", content: "Run the tests" }], sessionId))
    const turnControl = await waitForControl(0)
    const startedAt = Date.now()
    const stalled = await app.fetch(claudeCodeClassifierRequest(sessionId))
    const waited = Date.now() - startedAt
    expect(stalled.status).toBe(504)
    const refusal = await stalled.json() as { error: { type: string; message: string } }
    expect(refusal.error.type).toBe("upstream_timeout")
    expect(refusal.error.message).toContain("Upstream stalled: no data for")
    expect(waited).toBeGreaterThanOrEqual(140)
    expect(waited).toBeLessThan(5_000)

    // The client asks again, as it does after a 504, and is answered.
    const retryP = app.fetch(claudeCodeClassifierRequest(sessionId))
    ;(await waitForControl(2)).release()
    expect((await retryP).status).toBe(200)

    // The turn has now been silent for longer than the side call was allowed,
    // and is still running under the limit meant for turns.
    await Bun.sleep(Math.max(0, 200 - (Date.now() - startedAt)))
    turnControl.release()
    expect((await turnP).status).toBe(200)
    controls[1]?.release()
  }, 15_000)

  it("stops a side call that stalls every time, and names the limit that applies to it", async () => {
    process.env.MERIDIAN_UPSTREAM_AUXILIARY_IDLE_MS = "120"
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-aux-idle-ceiling-${crypto.randomUUID()}`

    const statuses: number[] = []
    let last: { error?: { type?: string; message?: string } } = {}
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await app.fetch(claudeCodeClassifierRequest(sessionId))
      statuses.push(response.status)
      last = await response.json() as typeof last
    }
    expect(statuses).toEqual([504, 504, 400])
    expect(last.error?.message).toContain("the 3rd consecutive stall on this session (limit 120ms)")
    expect(last.error?.message).toContain("raise MERIDIAN_UPSTREAM_AUXILIARY_IDLE_MS,")

    // The same check again is turned away before another query is spent on it.
    const again = await app.fetch(claudeCodeClassifierRequest(sessionId))
    expect(again.status).toBe(400)
    expect(queryCalls).toBe(3)
    for (const control of controls) control.release()
  }, 15_000)

  it("gives a streamed side call the same short limit", async () => {
    process.env.MERIDIAN_UPSTREAM_AUXILIARY_IDLE_MS = "150"
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app
    const sessionId = `claude-code-aux-idle-stream-${crypto.randomUUID()}`

    const startedAt = Date.now()
    const summary = await app.fetch(claudeCodeAgentSummaryRequest(SUBAGENT_NEXT_ROUND, sessionId, "a4a81dc1bbf7ee837"))
    const events = await summary.text()
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(events).toContain("event: error")
    expect(events).toContain("upstream_timeout")
    expect(events).toContain("Upstream stalled: no data for")
    controls[0]?.release()
  }, 15_000)

  it("aborts a wedged turn without releasing its fencing lease early", async () => {
    process.env.MERIDIAN_MAX_CONCURRENT = "2"
    process.env.MERIDIAN_SESSION_TURN_MAX_HOLD_MS = "2000"
    resetProcessSdkSemaphoreForTests()
    const app = createProxyServer({ port: 0, host: "127.0.0.1", silent: true }).app

    // This mock intentionally ignores AbortSignal while blocked. The watchdog
    // may request cancellation, but must retain the lease until the SDK attempt
    // actually settles or an older request could overwrite its successor.
    const wedged = await app.fetch(request([{ role: "user", content: "one" }], "wedged", true))
    const wedgedControl = await waitForControl(0)
    const waiterAbort = new AbortController()
    const secondP = app.fetch(request(
      [{ role: "user", content: "two" }],
      "wedged",
      true,
      {},
      waiterAbort.signal,
    ))
    await new Promise((resolve) => setTimeout(resolve, 2100))
    expect(queryCalls).toBe(1)

    // A waiter can still cancel cleanly; it never enters the SDK while the old
    // attempt is unfenced. Settle the mock before cancelling the response body
    // so the test does not intentionally leave background work behind.
    waiterAbort.abort()
    expect((await secondP).status).toBe(499)
    wedgedControl.release()
    await wedged.body?.cancel()
  }, 10_000)
})
