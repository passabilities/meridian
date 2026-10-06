/**
 * The system prompt a Claude Code client's request is run with.
 *
 * Claude Code sends its own system prompt with every request: the main
 * conversation's is the text the SDK's `claude_code` preset holds, a
 * subagent's is that subagent's, the permission check's is the classifier's.
 * With the preset layered on top, the main conversation carried that text
 * twice and every other request carried the main conversation's prompt ahead
 * of its own. Measured with the real client against a scripted API,
 * 2026-10-05 (CLI 2.1.284 under the SDK): 12.2K characters of system prompt
 * on every Messages call, a main thread's 24.5K against the 12.2K it sent and
 * a subagent's 15.3K against 3.1K.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"
import { assistantMessage, resolveMockSdkSessionId } from "./helpers"

let systemPrompts: unknown[] = []

installSdkMock(() => ({
  query: (params: any) => {
    systemPrompts.push(params.options?.systemPrompt)
    const sessionId = resolveMockSdkSessionId(params.options, "test-session")
    return (async function* () {
      yield { ...assistantMessage([{ type: "text", text: "ok" }]), session_id: sessionId }
    })()
  },
  createSdkMcpServer: () => ({ type: "sdk", name: "test", instance: {} }),
  tool: () => ({}),
}), "claude-code-system-prompt.test.ts")

installLoggerMock(() => ({
  claudeLog: () => {},
  withClaudeLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}))

installMcpToolsMock(() => ({
  createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }),
}))

const { createProxyServer, clearSessionCache } = await import("../proxy/server")
const { getFeaturesForAdapter, updateAdapterFeatures } = await import("../proxy/sdkFeatures")

type TestApp = { fetch: (r: Request) => Response | Promise<Response> }

const CLAUDE_CODE = { "user-agent": "claude-cli/2.1.290 (external, cli)" }
const CLIENT_PROMPT = "You are an interactive agent that helps users with software engineering tasks. CLIENT-PROMPT-MARK"

async function post(app: TestApp, headers: Record<string, string>) {
  const res = await app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model: "claude-fable-5-1",
      max_tokens: 64,
      stream: false,
      system: [{ type: "text", text: CLIENT_PROMPT }],
      metadata: { user_id: JSON.stringify({ session_id: "6f1d2c3b-4a59-4e68-8f70-1a2b3c4d5e6f" }) },
      messages: [{ role: "user", content: "read the fixtures" }],
    }),
  }))
  expect(res.status).toBe(200)
}

const savedConfigDir = process.env.MERIDIAN_CONFIG_DIR
let configDir = ""

beforeEach(() => {
  systemPrompts = []
  clearSessionCache()
  // The operator's own feature settings must not decide what a default is.
  configDir = mkdtempSync(join(tmpdir(), "meridian-cc-system-prompt-"))
  process.env.MERIDIAN_CONFIG_DIR = configDir
})

afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.MERIDIAN_CONFIG_DIR
  else process.env.MERIDIAN_CONFIG_DIR = savedConfigDir
  rmSync(configDir, { recursive: true, force: true })
})

describe("the Claude Code adapter's system prompt defaults", () => {
  it("leave the preset off and keep the client's own prompt", () => {
    const features = getFeaturesForAdapter("claude-code")
    expect(features.codeSystemPrompt).toBe(false)
    expect(features.clientSystemPrompt).toBe(true)
  })

  it("give way to what the operator set", () => {
    updateAdapterFeatures("claude-code", { codeSystemPrompt: true })
    expect(getFeaturesForAdapter("claude-code").codeSystemPrompt).toBe(true)
  })
})

describe("the system prompt of a Claude Code request", () => {
  it("is the client's own, not the preset with the client's appended to it", async () => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, CLAUDE_CODE)
    expect(systemPrompts).toHaveLength(1)
    expect(typeof systemPrompts[0]).toBe("string")
    expect(systemPrompts[0] as string).toContain("CLIENT-PROMPT-MARK")
  })

  it("is the same for a subagent's request, which sends that subagent's prompt", async () => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, { ...CLAUDE_CODE, "x-claude-code-agent-id": "a65ce96ceed9428a7" })
    expect(typeof systemPrompts[0]).toBe("string")
    expect(systemPrompts[0] as string).toContain("CLIENT-PROMPT-MARK")
  })

  it("has the preset under it again when the operator turns that on", async () => {
    updateAdapterFeatures("claude-code", { codeSystemPrompt: true })
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, CLAUDE_CODE)
    expect(systemPrompts[0]).toMatchObject({ type: "preset", preset: "claude_code" })
    expect((systemPrompts[0] as { append: string }).append).toContain("CLIENT-PROMPT-MARK")
  })

  it("still has the preset under it for a client that is not Claude Code", async () => {
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
    await post(app, {})
    expect(systemPrompts[0]).toMatchObject({ type: "preset", preset: "claude_code" })
  })
})
