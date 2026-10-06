/**
 * A client that cancels a request routed by priority stops the model.
 *
 * Every attempt of a priority-routed request adopts the request's abort link,
 * which hears the client go away, the turn watchdog, a parent's cancellation
 * and shutdown. Only the outer handler, once the request is over, detaches it
 * (#1022). An attempt that detached it as it returned left the rest of the
 * request deaf: the client was gone and the model went on to the end of its
 * turn, on the account's allowance. A streaming client that had already
 * received bytes still stopped it by cancelling the body; one cancelled before
 * the first byte, in the queue for an SDK slot, or while the CLI started, did
 * not, and neither did any non-streaming one.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"
import { assistantMessage, resolveMockSdkSessionId } from "./helpers"

/** Each model turn's abort signal, in the order the turns started. */
let turns: Array<AbortSignal | undefined> = []
/** An account whose API refuses every turn. */
let refusing: string | undefined

installSdkMock(() => ({
  query: (params: any) => (async function* () {
    const dir: string = params.options?.env?.CLAUDE_CONFIG_DIR ?? ""
    if (refusing && dir.endsWith(`/${refusing}`)) throw new Error("API Error: 429 rate limited")
    const signal: AbortSignal | undefined = params.options?.abortController?.signal
    turns.push(signal)
    // A long turn, which ends early only when it is aborted.
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 3000)
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve() }, { once: true })
    })
    yield { ...assistantMessage([{ type: "text", text: "the whole turn" }]), session_id: resolveMockSdkSessionId(params.options, "cancel-session") }
  })(),
  createSdkMcpServer: () => ({ type: "sdk", name: "test", instance: {} }),
  tool: () => ({}),
}), "priority-client-cancel.test.ts")

installLoggerMock(() => ({
  claudeLog: () => {},
  withClaudeLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}))

installMcpToolsMock(() => ({
  createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }),
}))

const { createProxyServer, clearSessionCache } = await import("../proxy/server")
const { resetActiveProfile } = await import("../proxy/profiles")
const { __setFetchOAuthUsageOverride, resetOAuthUsageCache } = await import("../proxy/oauthUsage")
const { rateLimitStore } = await import("../proxy/rateLimitStore")

const savedEnv: Record<string, string | undefined> = {}
let root = ""

beforeEach(() => {
  turns = []
  refusing = undefined
  root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-priority-cancel-")))
  resetOAuthUsageCache()
  clearSessionCache()
  resetActiveProfile()
  rateLimitStore.clear()
  __setFetchOAuthUsageOverride(async () => null)
  for (const key of ["MERIDIAN_ROUTING", "MERIDIAN_PROFILE_ORDER"]) savedEnv[key] = process.env[key]
  process.env.MERIDIAN_ROUTING = "active+priority"
  process.env.MERIDIAN_PROFILE_ORDER = "work,personal"
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  __setFetchOAuthUsageOverride(null)
  rateLimitStore.clear()
  resetActiveProfile()
  rmSync(root, { recursive: true, force: true })
})

async function until(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`not so after ${timeoutMs} ms`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Start a request, wait for its model turn to begin, cancel it, and say whether the turn was stopped. */
async function cancelDuringTurn(stream: boolean, session: string): Promise<boolean> {
  const profiles = ["work", "personal"].map(id => ({ id, claudeConfigDir: join(root, id) }))
  const app = createProxyServer({ port: 0, host: "127.0.0.1", profiles, defaultProfile: "work" }).app
  const cancel = new AbortController()
  const pending = Promise.resolve(app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    signal: cancel.signal,
    headers: { "Content-Type": "application/json", "x-opencode-session": session },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 64, stream, messages: [{ role: "user", content: "a long task" }] }),
  })))
  // A failover waits out the refused account's retries before it moves on.
  await until(() => turns.length > 0, 10_000)
  cancel.abort()
  let stopped = true
  await until(() => turns.at(-1)?.aborted === true, 500).catch(() => { stopped = false })
  await pending.catch((error: unknown) => error)
  return stopped
}

describe("a client that cancels a request routed by priority", () => {
  it("stops the model", async () => {
    expect(await cancelDuringTurn(false, "cancel-plain")).toBe(true)
  })

  it("stops the model when it streams and goes before the first byte", async () => {
    expect(await cancelDuringTurn(true, "cancel-stream")).toBe(true)
  })

  it("stops the model on the account a failover reached", async () => {
    // `work` refuses the turn, and the request fails over to `personal`:
    // the first attempt's end must not leave the second deaf to the client.
    refusing = "work"
    expect(await cancelDuringTurn(false, "cancel-failover")).toBe(true)
  }, 20_000)
})
