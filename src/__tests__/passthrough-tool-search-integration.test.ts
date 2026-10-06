/**
 * Tool deferral through the full HTTP layer, mocked SDK.
 *
 * What the proxy asks the SDK for when a session's tools are deferred, what
 * its PreToolUse hook answers, and what it does with the turns that follow.
 * scripts/e2e-deferred-tool-turn.mjs holds the same against the real CLI.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"
import {
  blockStop,
  inputJsonDelta,
  messageDelta,
  messageStart,
  messageStop,
  parseSSE,
  resolveMockSdkSessionId,
  textBlockStart,
  textDelta,
  toolUseBlockStart,
} from "./helpers"

interface HookInput { tool_name: string; tool_use_id: string; tool_input: unknown }
type Step = Record<string, unknown>

/** SDK messages in order; a `{ hook }` step calls the proxy's PreToolUse hook. */
let script: Step[] = []
let terminalError: Error | undefined
let queries: Array<{ options: Record<string, any> }> = []
let prompts: unknown[][] = []
let hookOutputs: Array<{ name: string; out: Record<string, unknown> }> = []
let baseSessionId = "tool-search-session"

installSdkMock(() => ({
  query: (params: { prompt: unknown; options: Record<string, any> }) => {
    queries.push(params)
    const preHook = params.options?.hooks?.PreToolUse?.[0]?.hooks?.[0]
    const sessionId = resolveMockSdkSessionId(params.options, baseSessionId)
    const steps = script
    const error = terminalError
    return (async function* () {
      const prompt: unknown[] = []
      if (typeof params.prompt === "string") prompt.push(params.prompt)
      else for await (const message of params.prompt as AsyncIterable<unknown>) prompt.push(message)
      prompts.push(prompt)
      for (const step of steps) {
        if ("hook" in step) {
          const input = step.hook as HookInput
          hookOutputs.push({
            name: input.tool_name,
            out: await preHook(input, input.tool_use_id, { signal: new AbortController().signal }),
          })
          continue
        }
        yield { ...step, session_id: sessionId }
      }
      if (error) throw error
    })()
  },
  createSdkMcpServer: () => ({
    type: "sdk",
    name: "test",
    instance: { tool: () => {}, registerTool: () => ({}) },
  }),
  tool: () => ({}),
}), "passthrough-tool-search-integration.test.ts")

installLoggerMock(() => ({
  claudeLog: () => {},
  withClaudeLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}))

installMcpToolsMock(() => ({
  createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: { tool: () => {}, registerTool: () => ({}) } }),
}))

const { createProxyServer } = await import("../proxy/server")
const { clearSessionCache } = await import("../proxy/session/cache")
const { evictSharedSession, lookupSharedSession, setSessionStoreDir } = await import("../proxy/sessionStore")
const { TOOL_SEARCH_TURN_BUDGET, cliIgnoresStop, resetToolSearchState } = await import("../proxy/passthroughToolSearch")

const RUN = crypto.randomUUID()
const SESSION_DIR = mkdtempSync(join(tmpdir(), "meridian-tool-search-"))
const usedSessionKeys = new Set<string>()

const READ = {
  name: "read",
  description: "Read a file",
  input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] },
}
const LINT = {
  name: "custom_lint",
  description: "Run the project linter",
  input_schema: { type: "object", properties: { file: { type: "string" } }, required: ["file"] },
  defer_loading: true,
}
const DEFERRED = [READ, LINT]

function assistant(apiId: string, content: Array<Record<string, unknown>>) {
  return {
    type: "assistant",
    uuid: crypto.randomUUID(),
    parent_tool_use_id: null,
    message: {
      id: apiId, type: "message", role: "assistant", content, model: "claude-sonnet-4-5",
      stop_reason: content.some(block => block.type === "tool_use") ? "tool_use" : "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  }
}
function toolResult(toolUseId: string, content: unknown, isError = false) {
  return {
    type: "user",
    uuid: crypto.randomUUID(),
    parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }] },
  }
}
const deny = (toolUseId: string) => toolResult(toolUseId, "forwarded to the client", true)
const result = (subtype = "success") => ({ type: "result", subtype, is_error: subtype !== "success" })
const hook = (name: string, id: string, input: unknown = {}) => ({ hook: { tool_name: name, tool_use_id: id, tool_input: input } })
const reference = (name: string) => [{ type: "tool_reference", tool_name: name }]

/** One streamed tool_use block. */
function toolBlock(index: number, name: string, id: string, input: unknown = {}) {
  return [toolUseBlockStart(index, name, id), inputJsonDelta(index, JSON.stringify(input)), blockStop(index)]
}

/** A turn that calls `read` and stops, as a CLI that honours the stop runs it. */
function readTurn(id = "call-read") {
  const message = assistant("msg_read", [{ type: "tool_use", id, name: "mcp__oc__read", input: { file_path: "x" } }])
  return {
    message,
    steps: [
      messageStart("msg_read"),
      ...toolBlock(0, "mcp__oc__read", id, { file_path: "x" }),
      messageDelta("tool_use"),
      message,
      hook("mcp__oc__read", id, { file_path: "x" }),
      deny(id),
      result(),
    ] as Step[],
  }
}

type App = { fetch: (request: Request) => Response | Promise<Response> }

async function post(body: Record<string, unknown>, session: string, headers: Record<string, string> = {}, target: App = app) {
  const key = `${session}-${RUN}`
  usedSessionKeys.add(key)
  return target.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "dummy",
      "x-opencode-session": key,
      "user-agent": "opencode/1.0.0",
      ...headers,
    },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 400, stream: false, ...body }),
  }))
}

const ask = (content: string) => [{ role: "user", content }]
const systemText = (index = 0): string => {
  const prompt = queries[index]!.options.systemPrompt
  return typeof prompt === "string" ? prompt : prompt?.append ?? ""
}
/** What the SDK was handed as the turn, as text: where a Claude Code client's deferred tools are named. */
const promptText = (index = 0): string => prompts[index]!.map(part => {
  if (typeof part === "string") return part
  const content = (part as { message?: { content?: unknown } }).message?.content
  if (typeof content === "string") return content
  return Array.isArray(content) ? content.map(block => (block as { text?: string }).text ?? "").join("\n") : ""
}).join("\n")
const streamedTools = (events: ReturnType<typeof parseSSE>): string[] => events.flatMap(({ event, data }) => {
  const block = (data as { content_block?: { type?: string; name?: string } }).content_block
  return event === "content_block_start" && block?.type === "tool_use" ? [String(block.name)] : []
})
const stopReasons = (events: ReturnType<typeof parseSSE>): string[] => events.flatMap(({ event, data }) => {
  const reason = (data as { delta?: { stop_reason?: unknown } }).delta?.stop_reason
  return event === "message_delta" && typeof reason === "string" ? [reason] : []
})

async function storedCheckpoint(session: string) {
  const key = `${session}-${RUN}`
  for (let i = 0; i < 500; i++) {
    const stored = lookupSharedSession(key)
    if (stored?.passthroughToolCallAssistantUuid) return stored
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return lookupSharedSession(key)
}

let app: App
const ENV_KEYS = [
  "MERIDIAN_PASSTHROUGH", "MERIDIAN_PASSTHROUGH_TOOL_SEARCH", "MERIDIAN_PASSTHROUGH_MAX_TURNS",
  "MERIDIAN_PASSTHROUGH_EARLY_STOP", "MERIDIAN_DEFER_TOOL_THRESHOLD",
  "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
] as const
const savedEnv = new Map<string, string | undefined>()

beforeAll(() => {
  setSessionStoreDir(SESSION_DIR)
  app = createProxyServer({ port: 0, host: "127.0.0.1" }).app
})

afterAll(() => {
  setSessionStoreDir(null)
  rmSync(SESSION_DIR, { recursive: true, force: true })
})

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key])
    delete process.env[key]
  }
  process.env.MERIDIAN_PASSTHROUGH = "1"
  script = []
  terminalError = undefined
  queries = []
  prompts = []
  hookOutputs = []
  baseSessionId = `tool-search-${crypto.randomUUID()}`
  resetToolSearchState()
})

afterEach(() => {
  for (const key of usedSessionKeys) evictSharedSession(key)
  usedSessionKeys.clear()
  clearSessionCache()
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  // The capability is process-wide: leave none behind for other files.
  resetToolSearchState()
})

describe("what a deferred-tools session asks the SDK for", () => {
  beforeEach(() => { script = [assistant("msg_text", [{ type: "text", text: "Hello" }])] })

  it("offers ToolSearch, a budget to use it in, and the names it can load", async () => {
    await post({ tools: DEFERRED, messages: ask("lint it") }, "ask-on")

    const { options } = queries[0]!
    expect(options.tools).toEqual(["ToolSearch"])
    expect(options.maxTurns).toBe(TOOL_SEARCH_TURN_BUDGET)
    expect(options.env.ENABLE_TOOL_SEARCH).toBe("true")
    expect(systemText()).toContain("<available-deferred-tools>")
    expect(systemText()).toContain("\nmcp__oc__custom_lint\n")
    expect(systemText()).not.toContain("\nmcp__oc__read\n")
  })

  it("asks for nothing new when no tool is deferred", async () => {
    await post({ tools: [READ], messages: ask("read it") }, "ask-plain")

    const { options } = queries[0]!
    expect(options.tools).toEqual([])
    expect(options.maxTurns).toBe(1)
    expect(options.env.ENABLE_TOOL_SEARCH).toBe("false")
    expect(systemText()).not.toContain("available-deferred-tools")
  })

  const loadedAsBefore = () => {
    const { options } = queries[0]!
    expect(options.tools).toEqual([])
    expect(options.env.ENABLE_TOOL_SEARCH).toBe("false")
    expect(systemText()).not.toContain("available-deferred-tools")
    return options
  }

  it("leaves every tool loaded under the kill switch", async () => {
    process.env.MERIDIAN_PASSTHROUGH_TOOL_SEARCH = "0"
    await post({ tools: DEFERRED, messages: ask("lint it") }, "ask-off")
    expect(loadedAsBefore().maxTurns).toBe(1)
  })

  // Haiku is not here: other files in the same run replace the model mapping,
  // so what a haiku request resolves to is not this file's to say. The rule is
  // in passthrough-tool-search.test.ts and the real-CLI gate drives it.

  it("leaves every tool loaded for a client with a ToolSearch of its own", async () => {
    const clientSearch = { name: "ToolSearch", description: "Client-side tool search", input_schema: { type: "object", properties: { query: { type: "string" } } } }
    await post({ tools: [...DEFERRED, clientSearch], messages: ask("lint it") }, "ask-client-search")
    expect(loadedAsBefore().maxTurns).toBe(1)
  })

  it("leaves every tool loaded when the turn budget is pinned to one", async () => {
    process.env.MERIDIAN_PASSTHROUGH_MAX_TURNS = "1"
    await post({ tools: DEFERRED, messages: ask("lint it") }, "ask-pin-one")
    expect(loadedAsBefore().maxTurns).toBe(1)
  })

  it("leaves every tool loaded when early stop is off", async () => {
    process.env.MERIDIAN_PASSTHROUGH_EARLY_STOP = "0"
    await post({ tools: DEFERRED, messages: ask("lint it") }, "ask-no-early-stop")
    expect(loadedAsBefore().maxTurns).toBe(4)
  })

  it("defers under a pinned budget that has room for a ToolSearch round", async () => {
    process.env.MERIDIAN_PASSTHROUGH_MAX_TURNS = "3"
    await post({ tools: DEFERRED, messages: ask("lint it") }, "ask-pin-three")
    expect(queries[0]!.options.tools).toEqual(["ToolSearch"])
    expect(queries[0]!.options.maxTurns).toBe(3)
  })

  it("leaves every tool loaded when the CLI is told to send no experimental betas", async () => {
    // The CLI then offers no tool search, whatever ENABLE_TOOL_SEARCH says.
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = "1"
    await post({ tools: DEFERRED, messages: ask("lint it") }, "ask-no-betas")
    expect(loadedAsBefore().maxTurns).toBe(1)
  })

  describe("on a profile whose upstream is not Anthropic's own", () => {
    // ENABLE_TOOL_SEARCH=true overrides the CLI's own guard for such a base
    // URL, and a gateway that does not forward tool_reference blocks answers
    // the request with a 400.
    const gateway = (): App => createProxyServer({
      port: 0, host: "127.0.0.1", silent: true,
      profiles: [{ id: "gateway", type: "api", apiKey: "test-key", baseUrl: "http://127.0.0.1:9" }],
      defaultProfile: "gateway",
    }).app

    it("leaves every tool loaded", async () => {
      await post({ tools: DEFERRED, messages: ask("lint it") }, "ask-gateway", {}, gateway())
      expect(queries[0]!.options.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9")
      expect(loadedAsBefore().maxTurns).toBe(1)
    })

    it("defers once the operator vouches for the gateway", async () => {
      process.env.MERIDIAN_PASSTHROUGH_TOOL_SEARCH = "force"
      await post({ tools: DEFERRED, messages: ask("lint it") }, "ask-gateway-forced", {}, gateway())
      expect(queries[0]!.options.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9")
      expect(queries[0]!.options.tools).toEqual(["ToolSearch"])
      expect(queries[0]!.options.env.ENABLE_TOOL_SEARCH).toBe("true")
      expect(systemText()).toContain("\nmcp__oc__custom_lint\n")
    })
  })
})

describe("which of a Claude Code client's tools are deferred", () => {
  beforeEach(() => { script = [assistant("msg_text", [{ type: "text", text: "Hello" }])] })

  const tool = (name: string) => ({ name, description: `${name} tool`, input_schema: { type: "object", properties: { input: { type: "string" } } } })
  // What the client keeps loaded on a direct connection, and what it defers.
  const KEPT = ["Agent", "Bash", "Edit", "Read", "Skill", "Workflow"].map(tool)
  const DEFERRED_ON_DIRECT = ["CronCreate", "NotebookEdit", "SendMessage", "TaskStop", "WebFetch", "WebSearch"].map(tool)
  const serverTools = (count: number) => Array.from({ length: count }, (_, i) => tool(`mcp__srv__tool_${String(i).padStart(2, "0")}`))

  /** A Claude Code request: told apart by its user agent, keyed by its own session id. */
  const postClaudeCode = (tools: unknown[]) => app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "dummy", "user-agent": "claude-cli/2.1.290 (external, cli)" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 400, stream: false, tools,
      metadata: { user_id: JSON.stringify({ session_id: crypto.randomUUID() }) },
      messages: ask("fetch the page"),
    }),
  }))

  it("defers its own tools that it defers itself, beside its MCP servers' tools", async () => {
    const response = await postClaudeCode([...KEPT, ...DEFERRED_ON_DIRECT, ...serverTools(12)])
    expect(response.status).toBe(200)

    const { options } = queries[0]!
    expect(options.tools).toEqual(["ToolSearch"])
    // Named in the turn, as the client names them (deferredToolsInTurns).
    for (const { name } of [...DEFERRED_ON_DIRECT, ...serverTools(12)]) expect(promptText()).toContain(`\nmcp__oc__${name}\n`)
    for (const { name } of KEPT) expect(promptText()).not.toContain(`\nmcp__oc__${name}\n`)
    expect(systemText()).not.toContain("mcp__oc__")
  })

  // The client defers them at any count when its tool search is on: a
  // session without MCP servers, or a subagent with a few of these, sent them
  // loaded through the proxy where it would not have on its own.
  it("defers them at any count, as the client does", async () => {
    const response = await postClaudeCode([...KEPT, ...DEFERRED_ON_DIRECT])
    expect(response.status).toBe(200)
    expect(queries[0]!.options.tools).toEqual(["ToolSearch"])
    for (const { name } of DEFERRED_ON_DIRECT) expect(promptText()).toContain(`\nmcp__oc__${name}\n`)
    for (const { name } of KEPT) expect(promptText()).not.toContain(`\nmcp__oc__${name}\n`)

    await postClaudeCode([...KEPT, tool("WebFetch")])
    expect(queries[1]!.options.tools).toEqual(["ToolSearch"])
  })

  it("defers nothing when it has nothing it would defer", async () => {
    await postClaudeCode(KEPT)
    expect(queries[0]!.options.tools).toEqual([])
    expect(queries[0]!.options.maxTurns).toBe(1)
  })

  it("keeps to a threshold the operator has set, counting them with the MCP servers' tools", async () => {
    process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = "15"
    await postClaudeCode([...KEPT, ...DEFERRED_ON_DIRECT, ...serverTools(9)])
    expect(queries[0]!.options.tools).toEqual([])
    expect(systemText()).not.toContain("available-deferred-tools")

    await postClaudeCode([...KEPT, ...DEFERRED_ON_DIRECT, ...serverTools(10)])
    expect(queries[1]!.options.tools).toEqual(["ToolSearch"])
  })

  it("defers nothing when the operator has switched auto-defer off", async () => {
    process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = "0"
    await postClaudeCode([...KEPT, ...DEFERRED_ON_DIRECT, ...serverTools(40)])
    expect(queries[0]!.options.tools).toEqual([])
  })
})

describe("a Claude Code conversation whose MCP servers connect as it goes", () => {
  // The client names deferred tools in its turns when its own tool search is
  // on, so a server connecting late adds a line at the end of the prompt. A
  // list in the system prompt would change it and rewrite the prompt cache of
  // everything after it, on every such connection.
  const tool = (name: string) => ({ name, description: `${name} tool`, input_schema: { type: "object", properties: { input: { type: "string" } } } })
  const OWN = ["Bash", "Read"].map(tool)
  const server = (...indexes: number[]) => indexes.map(i => tool(`mcp__srv__tool_${String(i).padStart(2, "0")}`))
  const registered = (i: number) => `mcp__oc__mcp__srv__tool_${String(i).padStart(2, "0")}`
  const NOW_AVAILABLE = "The following deferred tools are now available via ToolSearch."
  const postTurn = (tools: unknown[], session: string, messages: unknown[], target: App = app) => {
    usedSessionKeys.add(session)
    return target.fetch(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "dummy", "user-agent": "claude-cli/2.1.290 (external, cli)" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5", max_tokens: 400, stream: false, tools, messages,
        metadata: { user_id: JSON.stringify({ session_id: session }) },
      }),
    }))
  }
  const turns = (...texts: string[]) => texts.flatMap((text, i) => i === 0
    ? [{ role: "user", content: text }]
    : [{ role: "assistant", content: [{ type: "text", text: "Hello" }] }, { role: "user", content: text }])

  beforeEach(() => { script = [assistant("msg_text", [{ type: "text", text: "Hello" }])] })

  it("names every deferred tool in the first turn and none in the system prompt", async () => {
    const response = await postTurn([...OWN, ...server(0, 1)], `cc-turns-first-${RUN}`, turns("hello"))
    expect(response.status).toBe(200)

    expect(queries[0]!.options.tools).toEqual(["ToolSearch"])
    expect(systemText(0)).not.toContain(registered(0))
    expect(promptText(0)).toContain(`${NOW_AVAILABLE}`)
    expect(promptText(0)).toContain(`\n${registered(0)}\n${registered(1)}\n</system-reminder>`)
    expect(promptText(0).indexOf("hello")).toBeLessThan(promptText(0).indexOf(NOW_AVAILABLE))
  })

  it("keeps the system prompt as it was when a server connects, and names only its tools in that turn", async () => {
    const session = `cc-turns-grow-${RUN}`
    await postTurn([...OWN, ...server(0, 1)], session, turns("hello"))
    const second = await postTurn([...OWN, ...server(0, 1, 2)], session, turns("hello", "next"))
    expect(second.status).toBe(200)

    expect(queries[1]!.options.resume).toBe(queries[0]!.options.sessionId)
    expect(systemText(1)).toBe(systemText(0))
    expect(promptText(1)).toContain(`${NOW_AVAILABLE}`)
    expect(promptText(1)).toContain(`\n${registered(2)}\n</system-reminder>`)
    expect(promptText(1)).not.toContain(registered(0))
  })

  it("says nothing more while the tools stay as they are", async () => {
    const session = `cc-turns-steady-${RUN}`
    await postTurn([...OWN, ...server(0, 1)], session, turns("hello"))
    await postTurn([...OWN, ...server(0, 1)], session, turns("hello", "next"))

    expect(queries[1]!.options.resume).toBe(queries[0]!.options.sessionId)
    expect(promptText(1)).not.toContain("<system-reminder>")
  })

  it("names the tools that went away", async () => {
    const session = `cc-turns-shrink-${RUN}`
    await postTurn([...OWN, ...server(0, 1)], session, turns("hello"))
    await postTurn([...OWN, ...server(0)], session, turns("hello", "next"))

    expect(systemText(1)).toBe(systemText(0))
    expect(promptText(1)).toContain(`no longer available in this session`)
    expect(promptText(1)).toContain(`\n${registered(1)}\n`)
    expect(promptText(1)).not.toContain(NOW_AVAILABLE)
  })

  it("names every tool again to a session this process did not tell, such as one resumed after a restart", async () => {
    const session = `cc-turns-restart-${RUN}`
    await postTurn([...OWN, ...server(0, 1)], session, turns("hello"))
    const restarted = createProxyServer({ port: 0, host: "127.0.0.1" }).app
    await postTurn([...OWN, ...server(0, 1)], session, turns("hello", "next"), restarted)

    expect(queries[1]!.options.resume).toBe(queries[0]!.options.sessionId)
    expect(promptText(1)).toContain(`\n${registered(0)}\n${registered(1)}\n</system-reminder>`)
  })
})

describe("a session pinned to deferral whose tools are all loaded now", () => {
  // The pin (#861) holds the session's first decision. A client that then
  // drops every deferrable tool leaves it marked with nothing to defer.
  it("asks for no ToolSearch and keeps the one-turn cap", async () => {
    const many = Array.from({ length: 16 }, (_, index) => ({
      name: `custom_tool_${index}`,
      description: `Custom tool ${index}`,
      input_schema: { type: "object", properties: {} },
    }))
    script = [assistant("msg_hello", [{ type: "text", text: "Hello" }])]
    await post({ tools: [READ, ...many], messages: ask("hello") }, "pinned-then-loaded")
    expect(queries[0]!.options.tools).toEqual(["ToolSearch"])

    script = readTurn("call-pinned").steps
    const second = await post({ tools: [READ], messages: [
      ...ask("hello"),
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      { role: "user", content: "read x" },
    ] }, "pinned-then-loaded")
    expect(second.status).toBe(200)

    expect(queries[1]!.options.tools).toEqual([])
    expect(queries[1]!.options.maxTurns).toBe(1)
    expect(queries[1]!.options.env.ENABLE_TOOL_SEARCH).toBe("false")
    expect(systemText(1)).not.toContain("available-deferred-tools")
    expect(hookOutputs.at(-1)!.out).not.toHaveProperty("continue")
  })
})

describe("a session whose first request deferred only what the client marked", () => {
  // The pin (#861) holds the session's auto-defer decision. It used to hold
  // "something is deferred", so one tool the client marked itself pinned
  // auto-defer on, and the next change of tool set deferred every tool outside
  // the core, however few there were.
  it("does not start deferring the rest when its tool set changes", async () => {
    script = [assistant("msg_hello", [{ type: "text", text: "Hello" }])]
    await post({ tools: DEFERRED, messages: ask("hello") }, "marked-then-grown")
    expect(systemText(0)).toContain("\nmcp__oc__custom_lint\n")

    const format = { name: "custom_format", description: "Format a file", input_schema: { type: "object", properties: {} } }
    const second = await post({ tools: [...DEFERRED, format], messages: [
      ...ask("hello"),
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      { role: "user", content: "format x" },
    ] }, "marked-then-grown")
    expect(second.status).toBe(200)

    expect(queries[1]!.options.tools).toEqual(["ToolSearch"])
    expect(systemText(1)).toContain("\nmcp__oc__custom_lint\n")
    expect(systemText(1)).not.toContain("mcp__oc__custom_format")
  })
})

describe("the tool turn of a deferred-tools session", () => {
  it("stream: asks the CLI to end the query beside the deny, and resumes at the call", async () => {
    const turn = readTurn()
    script = turn.steps

    const first = await post({ stream: true, tools: DEFERRED, messages: ask("read x") }, "turn-stream")
    const events = parseSSE(await first.text())

    expect(hookOutputs).toHaveLength(1)
    expect(hookOutputs[0]!.out.decision).toBe("block")
    expect(hookOutputs[0]!.out.continue).toBe(false)
    expect(events.filter(e => e.event === "error")).toHaveLength(0)
    expect(streamedTools(events)).toEqual(["read"])
    expect(stopReasons(events)).toEqual(["tool_use"])
    const stored = await storedCheckpoint("turn-stream")
    expect(stored?.passthroughToolCallAssistantUuid).toBe(turn.message.uuid)
    expect(stored?.passthroughToolCallIds).toEqual(["call-read"])

    script = [assistant("msg_done", [{ type: "text", text: "done" }])]
    await post({ tools: DEFERRED, messages: [
      ...ask("read x"),
      { role: "assistant", content: [{ type: "tool_use", id: "call-read", name: "read", input: { file_path: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-read", content: "X" }] },
    ] }, "turn-stream")
    expect(queries[1]!.options.resumeSessionAt).toBe(turn.message.uuid)
    expect(queries[1]!.options.tools).toEqual(["ToolSearch"])
    expect(queries[1]!.options.maxTurns).toBe(TOOL_SEARCH_TURN_BUDGET)
  })

  it("non-stream: asks the CLI to end the query beside the deny", async () => {
    script = readTurn().steps

    const response = await post({ tools: DEFERRED, messages: ask("read x") }, "turn-json")
    const body = await response.json() as { stop_reason: string; content: Array<{ type: string; name?: string }> }

    expect(hookOutputs[0]!.out.continue).toBe(false)
    expect(body.stop_reason).toBe("tool_use")
    expect(body.content.filter(block => block.type === "tool_use").map(block => block.name)).toEqual(["read"])
  })

  it("leaves the deny as it was for a session without deferred tools", async () => {
    script = readTurn().steps

    await post({ tools: [READ], messages: ask("read x") }, "turn-plain")

    expect(hookOutputs[0]!.out.decision).toBe("block")
    expect("continue" in hookOutputs[0]!.out).toBe(false)
  })

  it("stream: runs a ToolSearch round inside the query and shows the client only the call it led to", async () => {
    const search = assistant("msg_search", [{ type: "tool_use", id: "search-1", name: "ToolSearch", input: { query: "select:mcp__oc__custom_lint" } }])
    const call = assistant("msg_call", [{ type: "tool_use", id: "call-lint", name: "mcp__oc__custom_lint", input: { file: "x" } }])
    script = [
      messageStart("msg_search"),
      textBlockStart(0), textDelta(0, "Loading the linter."), blockStop(0),
      ...toolBlock(1, "ToolSearch", "search-1", { query: "select:mcp__oc__custom_lint" }),
      messageDelta("tool_use"),
      search,
      hook("ToolSearch", "search-1"),
      toolResult("search-1", reference("mcp__oc__custom_lint")),
      messageStart("msg_call"),
      ...toolBlock(0, "mcp__oc__custom_lint", "call-lint", { file: "x" }),
      messageDelta("tool_use"),
      call,
      hook("mcp__oc__custom_lint", "call-lint", { file: "x" }),
      deny("call-lint"),
      result(),
    ]

    const response = await post({ stream: true, tools: DEFERRED, messages: ask("lint x") }, "turn-search")
    const events = parseSSE(await response.text())

    expect(hookOutputs.map(entry => entry.name)).toEqual(["ToolSearch", "mcp__oc__custom_lint"])
    expect(hookOutputs[0]!.out).toEqual({})
    expect(hookOutputs[1]!.out.continue).toBe(false)
    expect(events.filter(e => e.event === "error")).toHaveLength(0)
    expect(streamedTools(events)).toEqual(["custom_lint"])
    expect(stopReasons(events)).toEqual(["tool_use"])
    // The second Messages call came before any stop was asked for: not a CLI
    // running on past one.
    expect(cliIgnoresStop(queries[0]!.options.pathToClaudeCodeExecutable)).toBe(false)
    expect((await storedCheckpoint("turn-search"))?.passthroughToolCallAssistantUuid).toBe(call.uuid)
  })
})

describe("a CLI that calls the model again after the stop", () => {
  it("is found out by the turn it starts, and its sessions go back to every tool loaded", async () => {
    const turn = readTurn("call-old-cli")
    script = [
      ...turn.steps.slice(0, -1),
      // What the stop was meant to prevent: the model digesting the deny.
      messageStart("msg_digest"),
      textBlockStart(0), textDelta(0, "The call was forwarded."), blockStop(0),
      messageDelta("end_turn"),
      assistant("msg_digest", [{ type: "text", text: "The call was forwarded." }]),
      result(),
    ]

    const first = await post({ stream: true, tools: DEFERRED, messages: ask("read x") }, "old-cli-first")
    const events = parseSSE(await first.text())

    // The turn itself is still delivered: the digest is discarded as before.
    expect(streamedTools(events)).toEqual(["read"])
    expect(stopReasons(events)).toEqual(["tool_use"])
    expect(JSON.stringify(events)).not.toContain("The call was forwarded.")
    expect(queries[0]!.options.tools).toEqual(["ToolSearch"])
    expect(cliIgnoresStop(queries[0]!.options.pathToClaudeCodeExecutable)).toBe(true)

    script = [assistant("msg_text", [{ type: "text", text: "Hello" }])]
    await post({ tools: DEFERRED, messages: ask("lint it") }, "old-cli-second")

    expect(queries[1]!.options.tools).toEqual([])
    expect(queries[1]!.options.maxTurns).toBe(1)
    expect(queries[1]!.options.env.ENABLE_TOOL_SEARCH).toBe("false")
    expect(systemText(1)).not.toContain("available-deferred-tools")
  })
})

describe("a hook answered before the iterator has reached its turn", () => {
  // The SDK runs a hook as it reads the CLI's request for one, and the
  // messages the CLI wrote ahead of that can still be waiting for the
  // consumer. Here the turn's own message_start is one of them.
  it("stream: is not taken for a CLI ignoring the stop, and the next session still defers", async () => {
    const turn = readTurn("call-early-hook")
    const hookStep = turn.steps.find(step => "hook" in step)!
    script = [hookStep, ...turn.steps.filter(step => step !== hookStep)]

    const first = await post({ stream: true, tools: DEFERRED, messages: ask("read x") }, "early-hook-first")
    const events = parseSSE(await first.text())

    expect(streamedTools(events)).toEqual(["read"])
    expect(stopReasons(events)).toEqual(["tool_use"])
    expect(hookOutputs[0]!.out.continue).toBe(false)
    expect(cliIgnoresStop(queries[0]!.options.pathToClaudeCodeExecutable)).toBe(false)

    script = [assistant("msg_text", [{ type: "text", text: "Hello" }])]
    await post({ tools: DEFERRED, messages: ask("lint it") }, "early-hook-second")

    expect(queries[1]!.options.tools).toEqual(["ToolSearch"])
    expect(queries[1]!.options.maxTurns).toBe(TOOL_SEARCH_TURN_BUDGET)
  })
})

describe("a call the CLI rejects before any hook", () => {
  // The model named a client tool without the namespace the SDK registered it
  // under. No hook runs, so nothing asked the CLI to stop and it calls the
  // model again; that call is the SDK's doing, not a stop being ignored.
  it("is still handed to the client, and the turn after it is not taken for an ignored stop", async () => {
    script = [
      messageStart("msg_bare"),
      ...toolBlock(0, "custom_lint", "call-bare", { file: "x" }),
      messageDelta("tool_use"),
      assistant("msg_bare", [{ type: "tool_use", id: "call-bare", name: "custom_lint", input: { file: "x" } }]),
      toolResult("call-bare", "<tool_use_error>Error: No such tool available: custom_lint</tool_use_error>", true),
      messageStart("msg_after"),
      textBlockStart(0), textDelta(0, "That tool is not available."), blockStop(0),
      messageDelta("end_turn"),
      assistant("msg_after", [{ type: "text", text: "That tool is not available." }]),
      result(),
    ]

    const response = await post({ stream: true, tools: DEFERRED, messages: ask("lint x") }, "bare-name")
    const events = parseSSE(await response.text())

    expect(hookOutputs).toHaveLength(0)
    expect(events.filter(e => e.event === "error")).toHaveLength(0)
    expect(streamedTools(events)).toEqual(["custom_lint"])
    expect(stopReasons(events)).toEqual(["tool_use"])
    expect(JSON.stringify(events)).not.toContain("That tool is not available.")
    expect(cliIgnoresStop(queries[0]!.options.pathToClaudeCodeExecutable)).toBe(false)
  })
})

describe("a rejected call the model then retries under the registered name", () => {
  // What a model does with "No such tool available": the same call again,
  // spelled the way the SDK registered it. The client already holds the first
  // one, so the retry must not reach it as a second call. The order is the
  // real CLI's: it rejects the call as soon as its block ends, ahead of the
  // message's own message_delta.
  const rejectedThenRetried = () => {
    const bare = assistant("msg_bare", [{ type: "tool_use", id: "call-bare", name: "custom_lint", input: { file: "x" } }])
    const retry = assistant("msg_retry", [{ type: "tool_use", id: "call-retry", name: "mcp__oc__custom_lint", input: { file: "x" } }])
    return {
      bare,
      steps: [
        messageStart("msg_bare"),
        ...toolBlock(0, "custom_lint", "call-bare", { file: "x" }),
        bare,
        toolResult("call-bare", "<tool_use_error>Error: No such tool available: custom_lint</tool_use_error>", true),
        messageDelta("tool_use"),
        messageStop(),
        messageStart("msg_retry"),
        ...toolBlock(0, "mcp__oc__custom_lint", "call-retry", { file: "x" }),
        retry,
        messageDelta("tool_use"),
        messageStop(),
        hook("mcp__oc__custom_lint", "call-retry", { file: "x" }),
        deny("call-retry"),
        result(),
      ] as Step[],
    }
  }

  it("non-stream: hands the client one call, not two, and resumes at it", async () => {
    const turn = rejectedThenRetried()
    script = turn.steps

    const response = await post({ tools: DEFERRED, messages: ask("lint x") }, "retry-json")
    const body = await response.json() as { stop_reason: string; content: Array<{ type: string; id?: string }> }

    expect(body.stop_reason).toBe("tool_use")
    expect(body.content.filter(block => block.type === "tool_use").map(block => block.id)).toEqual(["call-bare"])
    expect(String(hookOutputs[0]!.out.reason)).toContain("already been handled")
    expect(hookOutputs[0]!.out.continue).toBe(false)
    expect((await storedCheckpoint("retry-json"))?.passthroughToolCallAssistantUuid).toBe(turn.bare.uuid)
  })

  it("stream: hands the client one call, not two, and resumes at it", async () => {
    const turn = rejectedThenRetried()
    script = turn.steps

    const response = await post({ stream: true, tools: DEFERRED, messages: ask("lint x") }, "retry-stream")
    const events = parseSSE(await response.text())

    expect(events.filter(e => e.event === "error")).toHaveLength(0)
    expect(streamedTools(events)).toEqual(["custom_lint"])
    expect(stopReasons(events)).toEqual(["tool_use"])
    expect(String(hookOutputs[0]!.out.reason)).toContain("already been handled")
    expect((await storedCheckpoint("retry-stream"))?.passthroughToolCallAssistantUuid).toBe(turn.bare.uuid)
  })
})

describe("a ToolSearch called beside a client tool", () => {
  it("has its result put back when the client's results resume the turn", async () => {
    const searchPart = assistant("msg_mixed", [{ type: "tool_use", id: "search-1", name: "ToolSearch", input: { query: "select:mcp__oc__custom_lint" } }])
    const readPart = assistant("msg_mixed", [{ type: "tool_use", id: "call-read", name: "mcp__oc__read", input: { file_path: "x" } }])
    script = [
      messageStart("msg_mixed"),
      ...toolBlock(0, "ToolSearch", "search-1", { query: "select:mcp__oc__custom_lint" }),
      ...toolBlock(1, "mcp__oc__read", "call-read", { file_path: "x" }),
      messageDelta("tool_use"),
      searchPart,
      readPart,
      hook("ToolSearch", "search-1"),
      hook("mcp__oc__read", "call-read", { file_path: "x" }),
      toolResult("search-1", reference("mcp__oc__custom_lint")),
      deny("call-read"),
      result(),
    ]

    const first = await post({ stream: true, tools: DEFERRED, messages: ask("read x, then lint it") }, "mixed")
    expect(streamedTools(parseSSE(await first.text()))).toEqual(["read"])
    expect((await storedCheckpoint("mixed"))?.passthroughToolCallAssistantUuid).toBe(readPart.uuid)

    script = [assistant("msg_done", [{ type: "text", text: "done" }])]
    await post({ tools: DEFERRED, messages: [
      ...ask("read x, then lint it"),
      { role: "assistant", content: [{ type: "tool_use", id: "call-read", name: "read", input: { file_path: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-read", content: "X" }] },
    ] }, "mixed")

    expect(queries[1]!.options.resumeSessionAt).toBe(readPart.uuid)
    const continuation = prompts[1] as Array<{ message: { content: Array<Record<string, unknown>> } }>
    expect(continuation).toHaveLength(1)
    expect(continuation[0]!.message.content).toEqual([
      { type: "tool_result", tool_use_id: "search-1", content: reference("mcp__oc__custom_lint") },
      { type: "tool_result", tool_use_id: "call-read", content: "X" },
    ])
  })
})

describe("a ToolSearch called after a client tool in the same message", () => {
  // The session resumes at the forwarded call's fragment, which cuts the
  // ToolSearch call off. Its result sent back alone would answer no tool_use.
  it("is left behind when the client's results resume the turn", async () => {
    const readPart = assistant("msg_after", [{ type: "tool_use", id: "call-read", name: "mcp__oc__read", input: { file_path: "x" } }])
    const searchPart = assistant("msg_after", [{ type: "tool_use", id: "search-1", name: "ToolSearch", input: { query: "select:mcp__oc__custom_lint" } }])
    script = [
      messageStart("msg_after"),
      ...toolBlock(0, "mcp__oc__read", "call-read", { file_path: "x" }),
      ...toolBlock(1, "ToolSearch", "search-1", { query: "select:mcp__oc__custom_lint" }),
      messageDelta("tool_use"),
      readPart,
      searchPart,
      hook("mcp__oc__read", "call-read", { file_path: "x" }),
      hook("ToolSearch", "search-1"),
      deny("call-read"),
      toolResult("search-1", reference("mcp__oc__custom_lint")),
      result(),
    ]

    const first = await post({ stream: true, tools: DEFERRED, messages: ask("read x, then lint it") }, "mixed-after")
    expect(streamedTools(parseSSE(await first.text()))).toEqual(["read"])
    expect((await storedCheckpoint("mixed-after"))?.passthroughToolCallAssistantUuid).toBe(readPart.uuid)

    script = [assistant("msg_done", [{ type: "text", text: "done" }])]
    await post({ tools: DEFERRED, messages: [
      ...ask("read x, then lint it"),
      { role: "assistant", content: [{ type: "tool_use", id: "call-read", name: "read", input: { file_path: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-read", content: "X" }] },
    ] }, "mixed-after")

    expect(queries[1]!.options.resumeSessionAt).toBe(readPart.uuid)
    const continuation = prompts[1] as Array<{ message: { content: Array<Record<string, unknown>> } }>
    expect(continuation).toHaveLength(1)
    expect(continuation[0]!.message.content).toEqual([
      { type: "tool_result", tool_use_id: "call-read", content: "X" },
    ])
  })
})

describe("a turn that searches until the budget runs out", () => {
  const searching = (rounds: number): Step[] => Array.from({ length: rounds }, (_, round) => {
    const id = `search-${round}`
    const apiId = `msg_search_${round}`
    return [
      messageStart(apiId),
      ...toolBlock(0, "ToolSearch", id, { query: "lint" }),
      messageDelta("tool_use"),
      assistant(apiId, [{ type: "tool_use", id, name: "ToolSearch", input: { query: "lint" } }]),
      hook("ToolSearch", id),
      toolResult(id, reference("mcp__oc__custom_lint")),
    ]
  }).flat()
  const overrun = () => new Error(`Claude Code returned an error result: Reached maximum number of turns (${TOOL_SEARCH_TURN_BUDGET})`)

  it("stream: ends as truncated, which a client can continue from, rather than as an error", async () => {
    script = [...searching(TOOL_SEARCH_TURN_BUDGET), result("error_max_turns")]
    terminalError = overrun()

    const response = await post({ stream: true, tools: DEFERRED, messages: ask("lint x") }, "overrun-stream")
    const events = parseSSE(await response.text())

    expect(events.filter(e => e.event === "error")).toHaveLength(0)
    expect(streamedTools(events)).toEqual([])
    expect(stopReasons(events)).toEqual(["max_tokens"])
  })

  it("non-stream: ends as truncated rather than as an error", async () => {
    script = [...searching(TOOL_SEARCH_TURN_BUDGET), result("error_max_turns")]
    terminalError = overrun()

    const response = await post({ tools: DEFERRED, messages: ask("lint x") }, "overrun-json")

    expect(response.status).toBe(200)
    const body = await response.json() as { stop_reason: string; content: unknown[] }
    expect(body.stop_reason).toBe("max_tokens")
    expect(body.content.filter(block => (block as { type?: string }).type === "tool_use")).toEqual([])
  })

  // The proxy's stand-in for an empty answer ("I can help with that...") is a
  // sentence the model never wrote. Under `max_tokens` the client keeps it as
  // the start of a reply it then asks the model to finish.
  it("non-stream: puts no words in the model's mouth for a turn that only searched", async () => {
    script = [...searching(TOOL_SEARCH_TURN_BUDGET), result("error_max_turns")]
    terminalError = overrun()

    const response = await post({ tools: DEFERRED, messages: ask("lint x") }, "overrun-json-empty")
    const body = await response.json() as { stop_reason: string; content: unknown[] }

    expect(body.stop_reason).toBe("max_tokens")
    expect(body.content).toEqual([])
  })

  // A guard, not a regression test: this held before deferral and never
  // failed. It is here because the comments and E2E.md E76 now rely on it.
  it("non-stream: keeps the session that searched, so the client carries on with what it loaded", async () => {
    script = [...searching(TOOL_SEARCH_TURN_BUDGET), result("error_max_turns")]
    terminalError = overrun()
    await post({ tools: DEFERRED, messages: ask("lint x") }, "overrun-json-kept")

    terminalError = undefined
    script = [assistant("msg_done", [{ type: "text", text: "done" }])]
    await post({ tools: DEFERRED, messages: [
      ...ask("lint x"),
      { role: "assistant", content: [{ type: "text", text: "(no content)" }] },
      { role: "user", content: "carry on" },
    ] }, "overrun-json-kept")

    expect(queries[1]!.options.resume).toBe(queries[0]!.options.sessionId)
  })

  // A call the CLI rejected on the last turn of the budget is in the answer
  // with nothing captured for it. `max_tokens` would leave the client holding
  // a call it is told neither to run nor to discard, so non-stream this shape
  // stays the error it is under the one-turn cap, whatever the turn searched
  // before it. (Streamed, the uncaptured-call recovery of #1192 hands it on.)
  it("non-stream: does not report a turn that ended on a call the CLI rejected as truncated", async () => {
    script = [
      ...searching(TOOL_SEARCH_TURN_BUDGET - 1),
      messageStart("msg_bare"),
      ...toolBlock(0, "custom_lint", "call-bare", { file: "x" }),
      assistant("msg_bare", [{ type: "tool_use", id: "call-bare", name: "custom_lint", input: { file: "x" } }]),
      toolResult("call-bare", "<tool_use_error>Error: No such tool available: custom_lint</tool_use_error>", true),
      messageDelta("tool_use"),
      messageStop(),
      result("error_max_turns"),
    ]
    terminalError = overrun()

    const response = await post({ tools: DEFERRED, messages: ask("lint x") }, "overrun-json-rejected")
    const body = await response.json() as { type?: string; stop_reason?: string; content?: unknown[] }

    expect(body.stop_reason).not.toBe("max_tokens")
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(body.type).toBe("error")
  })
})

describe("a Claude Code client", () => {
  const own = (count: number) => Array.from({ length: count }, (_, i) => ({
    name: `Own${i}`, description: "A tool of the client's own", input_schema: { type: "object", properties: {} },
  }))
  const mcp = (count: number) => Array.from({ length: count }, (_, i) => ({
    name: `mcp__srv__tool_${String(i).padStart(2, "0")}`, description: "A tool of one of its MCP servers", input_schema: { type: "object", properties: {} },
  }))
  const postClaudeCode = (tools: unknown[], session: string) => {
    usedSessionKeys.add(session)
    return app.fetch(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "dummy", "user-agent": "claude-cli/2.1.289" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5", max_tokens: 400, stream: false, tools, messages: ask("hello"),
        metadata: { user_id: JSON.stringify({ session_id: session }) },
      }),
    }))
  }
  beforeEach(() => { script = [assistant("msg_text", [{ type: "text", text: "Hello" }])] })

  it("keeps its own tools loaded and defers the tools of its MCP servers", async () => {
    await postClaudeCode([...own(20), ...mcp(16)], `cc-big-${RUN}`)

    expect(queries[0]!.options.tools).toEqual(["ToolSearch"])
    const note = promptText().slice(promptText().indexOf("<system-reminder>"))
    expect(note.match(/^mcp__oc__mcp__srv__tool_\d\d$/gm)).toHaveLength(16)
    expect(note).not.toContain("Own")
  })

  // However few: the client's own tool search defers an MCP tool at any count.
  it("defers its MCP servers' tools however few, and keeps however many of its own loaded", async () => {
    await postClaudeCode([...own(40), ...mcp(3)], `cc-few-${RUN}`)

    expect(queries[0]!.options.tools).toEqual(["ToolSearch"])
    const note = promptText().slice(promptText().indexOf("<system-reminder>"))
    expect(note.match(/^mcp__oc__mcp__srv__tool_\d\d$/gm)).toHaveLength(3)
    expect(note).not.toContain("Own")
  })

  it("defers nothing when it has no MCP server and none of the tools it defers itself", async () => {
    await postClaudeCode(own(40), `cc-none-${RUN}`)

    expect(queries[0]!.options.tools).toEqual([])
    expect(queries[0]!.options.maxTurns).toBe(1)
    expect(systemText()).not.toContain("available-deferred-tools")
  })
})
