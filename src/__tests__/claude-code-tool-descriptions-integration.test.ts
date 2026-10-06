/**
 * Whether a Claude Code request's SDK query lifts the child's cap on tool
 * descriptions, through the HTTP layer with a mocked SDK.
 *
 * A passthrough client's tools are registered with the SDK child as MCP tools,
 * and the CLI cuts an MCP tool's description at 2,048 characters. Claude Code's
 * own tools are not MCP tools on a direct connection and run past that: the
 * real client against a scripted API, 2026-10-05, had six of its 21 cut
 * (Workflow 3,480 characters, SendMessage 4,259, ScheduleWakeup 3,396,
 * CronCreate, DesignSync, EnterWorktree), each ending "… [truncated]". The
 * CLI's own switch, CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH, is set in the
 * child's environment for that client.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"
import { assistantMessage, blockStop, messageDelta, messageStart, messageStop, resolveMockSdkSessionId, textBlockStart, textDelta } from "./helpers"

let capturedEnvs: Array<Record<string, string | undefined>> = []
/** The next query that resumes a session finds a message of it gone. */
let resumeFindsMessageGone = false

installSdkMock(() => ({
  query: (params: any) => {
    capturedEnvs.push(params.options?.env ?? {})
    const sessionId = resolveMockSdkSessionId(params.options, "test-session")
    return (async function* () {
      if (resumeFindsMessageGone && params.options?.resume) {
        resumeFindsMessageGone = false
        throw new Error("No message found with message.uuid of: 0b6f1c1e-5a44-4f0c-9d5e-7f0d1b2c3a4e")
      }
      if (params.options?.includePartialMessages === true) {
        for (const event of [messageStart("msg-1"), textBlockStart(0), textDelta(0, "ok"), blockStop(0), messageDelta("end_turn"), messageStop()]) {
          yield { ...event, session_id: sessionId }
        }
      }
      yield { ...assistantMessage([{ type: "text", text: "ok" }]), session_id: sessionId }
    })()
  },
  createSdkMcpServer: () => ({ type: "sdk", name: "test", instance: {} }),
  tool: () => ({}),
}), "claude-code-tool-descriptions-integration.test.ts")

installLoggerMock(() => ({
  claudeLog: () => {},
  withClaudeLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}))

installMcpToolsMock(() => ({
  createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }),
}))

const { createProxyServer, clearSessionCache } = await import("../proxy/server")

type TestApp = { fetch: (r: Request) => Response | Promise<Response> }

const SESSION = "8e2b6d1a-3c47-4f59-a6d0-5b9c7e1f2a38"
const TOOLS = [{
  name: "Workflow",
  description: `Execute a workflow script. ${"The rules of its use run on. ".repeat(120)}`,
  input_schema: { type: "object", properties: { script: { type: "string" } }, required: ["script"] },
}]

async function post(app: TestApp, headers: Record<string, string>, body: Record<string, unknown> = {}) {
  const res = await app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model: "claude-fable-5-1",
      max_tokens: 64,
      stream: false,
      metadata: { user_id: JSON.stringify({ session_id: SESSION }) },
      tools: TOOLS,
      messages: [{ role: "user", content: "run the workflow" }],
      ...body,
    }),
  }))
  expect(res.status).toBe(200)
  // A stream is only over, and its queries all made, once it has been read.
  await res.text()
}

const CLAUDE_CODE = { "user-agent": "claude-cli/2.1.290 (external, cli)" }
const caps = () => capturedEnvs.map(env => env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH)

const saved = {
  cap: process.env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH,
  passthrough: process.env.MERIDIAN_PASSTHROUGH,
  legacyPassthrough: process.env.CLAUDE_PROXY_PASSTHROUGH,
}
function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(() => {
  capturedEnvs = []
  resumeFindsMessageGone = false
  clearSessionCache()
  delete process.env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH
  delete process.env.MERIDIAN_PASSTHROUGH
  delete process.env.CLAUDE_PROXY_PASSTHROUGH
})

afterEach(() => {
  restore("CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH", saved.cap)
  restore("MERIDIAN_PASSTHROUGH", saved.passthrough)
  restore("CLAUDE_PROXY_PASSTHROUGH", saved.legacyPassthrough)
})

describe("the tool description cap of a Claude Code request's SDK child", () => {
  it("is lifted, so the client's own tools reach the model whole", async () => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, CLAUDE_CODE)
    expect(caps()).toHaveLength(1)
    expect(Number(caps()[0])).toBeGreaterThan(TOOLS[0]!.description.length)
  })

  it("is lifted for a subagent's request too", async () => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, { ...CLAUDE_CODE, "x-claude-code-agent-id": "a65ce96ceed9428a7" })
    expect(Number(caps()[0])).toBeGreaterThan(TOOLS[0]!.description.length)
  })

  it.each([
    ["a request that is not streamed", false],
    ["a streamed request", true],
  ])("is still lifted when %s is replayed into a fresh session", async (_label, stream) => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, CLAUDE_CODE, { stream })

    capturedEnvs = []
    resumeFindsMessageGone = true
    await post(app, CLAUDE_CODE, {
      stream,
      messages: [
        { role: "user", content: "run the workflow" },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: "and again" },
      ],
    })
    // The resume that failed, and the replay.
    expect(caps()).toHaveLength(2)
    expect(caps().every(cap => Number(cap) > TOOLS[0]!.description.length)).toBe(true)
  })

  it("is left as the child has it for a client that is not Claude Code", async () => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, { "x-opencode-session": "tool-description-cap" })
    expect(caps()).toEqual([undefined])
  })

  it("stays what the operator set", async () => {
    process.env.CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH = "2048"
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, CLAUDE_CODE)
    expect(caps()).toEqual(["2048"])
  })
})
