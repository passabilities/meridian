/**
 * The proxy's session GC, at its default settings, can retire as many
 * transcripts as turns create.
 *
 * Live, 2026-10-09: a retired transcript waits out the grace (the session
 * turn's hold and a minute, 21 minutes) before it can be deleted, and at most
 * 256 may wait. That let about 12 a minute through, while parallel runs
 * created 1,100-1,700 an hour. Orphaned transcripts stayed live until they
 * filled the ownership ceiling, and from 21:00 every request that needed a new
 * one was refused 503 `session transcript ownership capacity is full`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"

installSdkMock(() => ({
  query: () => (async function* () {})(),
  createSdkMcpServer: () => ({ type: "sdk", name: "test", instance: {} }),
  tool: () => ({}),
}), "proxy-session-gc-capacity.test.ts")
installLoggerMock(() => ({ claudeLog: () => {}, withClaudeLogContext: (_ctx, fn) => fn() }))
installMcpToolsMock(() => ({ createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }) }))

const { createProxyServer } = await import("../proxy/server")
const { setSessionStoreDir } = await import("../proxy/sessionStore")
const { registerLiveTranscript } = await import("../proxy/sessionLifecycle")

const GC_SETTINGS = [
  "MERIDIAN_SESSION_GC_MAX_PENDING", "MERIDIAN_SESSION_GC_MAX_DELETES", "MERIDIAN_SESSION_GC_GRACE_MS",
  "MERIDIAN_SESSION_GC_INTERVAL_MS", "MERIDIAN_WORKDIR", "MERIDIAN_CONFIG_DIR",
]
let root: string
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-gc-capacity-")))
  for (const key of GC_SETTINGS) savedEnv[key] = process.env[key]
  // The test preload raises the backlog for the whole run; this file is
  // about the default.
  for (const key of GC_SETTINGS) delete process.env[key]
  Object.assign(process.env, { MERIDIAN_WORKDIR: root, MERIDIAN_CONFIG_DIR: join(root, "config") })
  setSessionStoreDir(join(root, "sessions"))
  mkdirSync(join(root, "personal"))
})

afterEach(() => {
  setSessionStoreDir(null)
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
})

describe("session GC capacity", () => {
  it("retires every orphaned transcript in one sweep, past the 256 the backlog used to hold", async () => {
    const configDir = join(root, "personal")
    for (let i = 0; i < 300; i++) {
      await registerLiveTranscript({ sessionId: crypto.randomUUID(), configDir })
    }
    const proxy = createProxyServer({
      port: 0, host: "127.0.0.1", defaultProfile: "personal",
      profiles: [{ id: "personal", claudeConfigDir: configDir }],
    })
    await proxy.sweepSessionGc?.()

    const sidecar = JSON.parse(readFileSync(join(root, "sessions", "session-gc.json"), "utf8")) as {
      resources: Record<string, { state: string }>
    }
    const states = Object.values(sidecar.resources).map(resource => resource.state)
    expect(states.filter(state => state === "retired")).toHaveLength(300)
  }, 60_000)
})
