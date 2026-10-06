/**
 * The prompt cache lifetime a Claude Code request's SDK query is given,
 * through the HTTP layer with a mocked SDK.
 *
 * See `claudeCodePromptCacheLifetime`: a subagent's conversation gets the five
 * minutes the CLI itself gives a subagent, by the CLI's own switch in the
 * child's environment; everything else is left to the child.
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
}), "claude-code-cache-lifetime-integration.test.ts")

installLoggerMock(() => ({
  claudeLog: () => {},
  withClaudeLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}))

installMcpToolsMock(() => ({
  createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }),
}))

const { createProxyServer, clearSessionCache } = await import("../proxy/server")

type TestApp = { fetch: (r: Request) => Response | Promise<Response> }

const SESSION = "4c9d2f0e-6a51-4b8e-9d37-2f1c8a6e0b45"

async function post(app: TestApp, headers: Record<string, string>, body: Record<string, unknown> = {}) {
  const res = await app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model: "claude-fable-5-1",
      max_tokens: 64,
      stream: false,
      metadata: { user_id: JSON.stringify({ session_id: SESSION }) },
      messages: [{ role: "user", content: "read the fixtures" }],
      ...body,
    }),
  }))
  expect(res.status).toBe(200)
  // A stream is only over, and its queries all made, once it has been read.
  await res.text()
}

const CLAUDE_CODE = { "user-agent": "claude-cli/2.1.289 (external, cli)" }
const lifetimes = () => capturedEnvs.map(env => env.CLAUDE_CODE_PROMPT_CACHE_TTL)

const savedTtl = process.env.CLAUDE_CODE_PROMPT_CACHE_TTL

beforeEach(() => {
  capturedEnvs = []
  resumeFindsMessageGone = false
  clearSessionCache()
  delete process.env.CLAUDE_CODE_PROMPT_CACHE_TTL
})

afterEach(() => {
  if (savedTtl === undefined) delete process.env.CLAUDE_CODE_PROMPT_CACHE_TTL
  else process.env.CLAUDE_CODE_PROMPT_CACHE_TTL = savedTtl
})

describe("the cache lifetime of a Claude Code request", () => {
  it("is five minutes for an Agent-tool subagent's conversation", async () => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, { ...CLAUDE_CODE, "x-claude-code-agent-id": "a65ce96ceed9428a7" })
    expect(lifetimes()).toEqual(["5m"])
  })

  it("is the SDK child's own choice for the main conversation", async () => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, CLAUDE_CODE)
    expect(lifetimes()).toEqual([undefined])
  })

  it("is the child's own choice for a request under an agent id from a client that is not Claude Code", async () => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, { "x-claude-code-agent-id": "a65ce96ceed9428a7" })
    expect(lifetimes()).toEqual([undefined])
  })

  it.each([
    ["a request that is not streamed", false],
    ["a streamed request", true],
  ])("is still five minutes when %s is replayed into a fresh session", async (_label, stream) => {
    // The replay writes the whole conversation again: the one query of a
    // subagent's where an hour's rate costs most.
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    const subagent = { ...CLAUDE_CODE, "x-claude-code-agent-id": "a65ce96ceed9428a7" }
    await post(app, subagent, { stream })

    capturedEnvs = []
    resumeFindsMessageGone = true
    await post(app, subagent, {
      stream,
      messages: [
        { role: "user", content: "read the fixtures" },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: "and the next one" },
      ],
    })
    // The resume that failed, and the replay.
    expect(lifetimes()).toEqual(["5m", "5m"])
  })

  it("stays what the operator set", async () => {
    process.env.CLAUDE_CODE_PROMPT_CACHE_TTL = "1h"
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, { ...CLAUDE_CODE, "x-claude-code-agent-id": "a65ce96ceed9428a7" })
    expect(lifetimes()).toEqual(["1h"])
  })
})
