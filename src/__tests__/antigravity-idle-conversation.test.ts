import { afterEach, describe, expect, it } from "bun:test"
import { fileURLToPath } from "node:url"
import { createAntigravityServer } from "../proxy/backends/antigravity"
import { AntigravityRuntime } from "../proxy/backends/antigravityRuntime"
import { DEFAULT_PROXY_CONFIG, resolveBackendConfig } from "../proxy/types"

// A finished conversation keeps its live process for the next user turn. When it expires, that turn can only replay
// the whole history, so the idle wait is its own setting instead of the short client tool-result deadline.
const executable = fileURLToPath(new URL("./fixtures/agy-cli.cjs", import.meta.url))
const closing: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closing.splice(0)) await close() })
const nap = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe.skipIf(process.platform === "win32")("Antigravity idle conversation retention", () => {
  async function twoTurns(options: { pendingToolTimeoutMs: number; idleConversationMs?: number }) {
    const runtime = new AntigravityRuntime({ executable, turnTimeoutMs: 10000, ...options })
    const server = createAntigravityServer({ ...DEFAULT_PROXY_CONFIG, backend: "antigravity" }, runtime)
    closing.push(server.closeBackend)
    const send = async (body: unknown) => {
      const response = await server.app.fetch(new Request("http://local/v1/messages", { method: "POST", body: JSON.stringify(body) }))
      expect(response.status).toBe(200)
      return await response.json() as { content: Array<{ type: string; text?: string }> }
    }
    const first = { model: "fixture-model", max_tokens: 100, messages: [{ role: "user", content: "SKIP_TOOLS hello" }] }
    const reply = await send(first)
    await nap(400)
    await send({ ...first, messages: [...first.messages, { role: "assistant", content: reply.content }, { role: "user", content: "SKIP_TOOLS again" }] })
    return runtime
  }

  it("keeps a finished conversation for idleConversationMs, beyond the tool-result deadline", async () => {
    const runtime = await twoTurns({ pendingToolTimeoutMs: 100, idleConversationMs: 3000 })
    expect(runtime.idleConversationMs).toBe(3000)
    expect(runtime.reused).toBe(1)
  })

  it("defaults to the tool-result deadline", async () => {
    const runtime = await twoTurns({ pendingToolTimeoutMs: 100 })
    expect(runtime.idleConversationMs).toBe(100)
    expect(runtime.reused).toBe(0)
  })

  it("expires a shorter explicit idle window independently of the tool deadline", async () => {
    const runtime = await twoTurns({ pendingToolTimeoutMs: 3000, idleConversationMs: 100 })
    expect(runtime.reused).toBe(0)
  })

  it("preserves an existing long tool deadline when the new option is unset", () => {
    const runtime = new AntigravityRuntime({ executable, pendingToolTimeoutMs: 86_400_001 })
    closing.push(() => runtime.close())
    expect(runtime.idleConversationMs).toBe(86_400_001)
  })

  it("resolves independent environment deadlines and lets explicit configuration win", () => {
    const idle = process.env.MERIDIAN_AGY_IDLE_CONVERSATION_MS
    const tool = process.env.MERIDIAN_AGY_TOOL_TIMEOUT_MS
    try {
      process.env.MERIDIAN_AGY_IDLE_CONVERSATION_MS = "3000"
      process.env.MERIDIAN_AGY_TOOL_TIMEOUT_MS = "100"
      expect(resolveBackendConfig({ backend: "antigravity" }).antigravity).toMatchObject({
        idleConversationMs: 3000, pendingToolTimeoutMs: 100,
      })
      expect(resolveBackendConfig({ backend: "antigravity", antigravity: { idleConversationMs: 5000 } }).antigravity?.idleConversationMs).toBe(5000)
    } finally {
      if (idle === undefined) delete process.env.MERIDIAN_AGY_IDLE_CONVERSATION_MS
      else process.env.MERIDIAN_AGY_IDLE_CONVERSATION_MS = idle
      if (tool === undefined) delete process.env.MERIDIAN_AGY_TOOL_TIMEOUT_MS
      else process.env.MERIDIAN_AGY_TOOL_TIMEOUT_MS = tool
    }
  })

  it("rejects values outside 1..86400000 ms", () => {
    for (const idleConversationMs of [0, 1.5, 86_400_001]) expect(() => new AntigravityRuntime({ executable, idleConversationMs })).toThrow("idle conversation")
  })
})
