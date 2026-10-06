/**
 * A started proxy keeps each account's last usage reading in its session
 * directory, and a proxy started after it takes those readings as its own:
 * the endpoint refuses a read taken soon after another (429), so a restart
 * would otherwise place its first move knowing nothing of its accounts.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"
import { setSessionStoreDir } from "../proxy/sessionStore"
import type { CredentialStore } from "../proxy/tokenRefresh"

installSdkMock(() => ({
  query: () => Object.assign((async function* () {})(), { close: () => {} }),
  createSdkMcpServer: () => ({ type: "sdk", name: "test", instance: {} }),
  tool: () => ({}),
}), "proxy-usage-kept.test.ts")

installLoggerMock(() => ({
  claudeLog: () => {},
  withClaudeLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}))

installMcpToolsMock(() => ({
  createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }),
}))

const { startProxyServer } = await import("../proxy/server")
const { fetchOAuthUsage, peekOAuthUsage, resetOAuthUsageCache } = await import("../proxy/oauthUsage")

const store: CredentialStore = {
  read: async () => ({ claudeAiOauth: { accessToken: "token", refreshToken: "refresh", expiresAt: Date.now() + 60_000 } }),
  write: async () => true,
}

describe("a started proxy", () => {
  let sessionDir = ""

  beforeEach(() => {
    resetOAuthUsageCache()
    sessionDir = mkdtempSync(join(tmpdir(), "meridian-usage-kept-"))
    setSessionStoreDir(sessionDir)
  })

  afterEach(() => {
    resetOAuthUsageCache()
    setSessionStoreDir(null)
    rmSync(sessionDir, { recursive: true, force: true })
  })

  it("keeps each account's last usage reading in its session directory for the proxy started after it", async () => {
    const first = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true })
    const read = await fetchOAuthUsage({
      profileId: "kept", force: true, store,
      fetchImpl: async () => new Response(JSON.stringify({
        five_hour: { utilization: 40, resets_at: new Date(Date.now() + 60 * 60_000).toISOString() },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    })
    await first.close()
    expect(existsSync(join(sessionDir, "usage.json"))).toBe(true)

    resetOAuthUsageCache()
    const second = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true })
    try {
      expect(peekOAuthUsage("kept")).toEqual({ ...read!, restored: true })
    } finally {
      await second.close()
    }
  })

  // Test files share a process: a reading taken after the proxy closed belongs
  // to whatever runs next, not to that proxy's session directory.
  it("keeps no reading taken after it closed", async () => {
    const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true })
    await proxy.close()

    await fetchOAuthUsage({
      profileId: "after-close", force: true, store,
      fetchImpl: async () => new Response(JSON.stringify({
        five_hour: { utilization: 40, resets_at: new Date(Date.now() + 60 * 60_000).toISOString() },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    })

    expect(existsSync(join(sessionDir, "usage.json"))).toBe(false)
  })
})
