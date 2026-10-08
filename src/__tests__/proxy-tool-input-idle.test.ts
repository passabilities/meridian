// The upstream idle limits are read when the server module loads, so this file
// sets them first and runs in a process of its own (see `npm test`).
process.env.MERIDIAN_UPSTREAM_IDLE_MS = "250"
process.env.MERIDIAN_UPSTREAM_TOOL_INPUT_IDLE_MS = "4000"

import { beforeEach, describe, expect, it } from "bun:test"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"
import {
  assistantMessage, withMockSdkSessionId, messageStart, textBlockStart, textDelta, toolUseBlockStart, inputJsonDelta,
  blockStop, messageDelta, messageStop,
} from "./helpers"

// While the model writes one long tool parameter the API can send nothing but
// pings; the SDK child passes those on and the guard discards them. Live,
// 2026-10-07/08, all 120 mid-stream stalls at the 90 s limit had a tool call
// open. Here the quiet stretch is four times the turn's limit and a quarter of
// the tool-input limit.
const QUIET_MS = 1_000
let quietInside: "tool-input" | "text" = "tool-input"
installSdkMock(() => ({
  query: (params: { options: Record<string, unknown> }) => (async function* () {
    const sdk = <T>(event: T) => withMockSdkSessionId(event as never, params.options)
    yield sdk(messageStart())
    if (quietInside === "tool-input") {
      yield sdk(toolUseBlockStart(0, "Write", "toolu_long"))
      await new Promise((resolve) => setTimeout(resolve, QUIET_MS))
      yield sdk(inputJsonDelta(0, JSON.stringify({ file_path: "report.md", content: "the whole report" })))
      yield sdk(blockStop(0))
      yield sdk(messageDelta("tool_use"))
      yield sdk(messageStop())
      yield sdk(assistantMessage([{ type: "tool_use", id: "toolu_long", name: "Write", input: { file_path: "report.md", content: "the whole report" } }]))
      return
    }
    yield sdk(textBlockStart(0))
    yield sdk(textDelta(0, "Thinking out loud"))
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS))
    yield sdk(blockStop(0))
    yield sdk(messageDelta())
    yield sdk(messageStop())
    yield sdk(assistantMessage([{ type: "text", text: "Thinking out loud" }]))
  })(),
  createSdkMcpServer: () => ({ type: "sdk", name: "fixture", instance: {} }),
  tool: () => ({}),
}), "proxy-tool-input-idle.test.ts")
installLoggerMock(() => ({
  claudeLog: () => {},
  withClaudeLogContext: <T>(_context: unknown, fn: () => T) => fn(),
}))
installMcpToolsMock(() => ({ createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }) }))
const { createProxyServer, clearSessionCache } = await import("../proxy/server")

async function streamed(app: ReturnType<typeof createProxyServer>["app"]) {
  const response = await app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-opencode-session": crypto.randomUUID() },
    body: JSON.stringify({ model: "haiku", max_tokens: 100, stream: true, messages: [{ role: "user", content: "write the report" }] }),
  }))
  const raw = await response.text()
  const errors = raw.split("\n").filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)) as { type?: string; error?: { type?: string; message?: string } })
    .filter((event) => event.type === "error")
  return { status: response.status, raw, errors }
}

describe("upstream idle limit while a tool call's input is written", () => {
  beforeEach(() => clearSessionCache())

  it("waits out a quiet tool call past the turn's limit", async () => {
    quietInside = "tool-input"
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1", silent: true })
    const result = await streamed(app)
    expect(result.errors).toEqual([])
    expect(result.raw).toContain("toolu_long")
    expect(result.raw).toContain("message_stop")
  })

  it("still holds a quiet stretch with no tool call open to the turn's limit", async () => {
    quietInside = "text"
    const { app } = createProxyServer({ port: 0, host: "127.0.0.1", silent: true })
    const result = await streamed(app)
    expect(result.errors.map((event) => event.error?.type)).toEqual(["upstream_timeout"])
  })
})
