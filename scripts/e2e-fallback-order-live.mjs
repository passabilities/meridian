#!/usr/bin/env bun
// Live, on real accounts: where an active+priority failover goes. The active
// profile is refused (it has no allowance left for MODEL), and the request has
// to land on the fallback with the most room, an account with capacity whose
// weekly limit resets within a day first (orderFallbacksByRoom), not on the
// one the configured order names first.
//
//   ACTIVE=personal bun scripts/e2e-fallback-order-live.mjs
//
// ACTIVE is a Claude Max profile of the installed proxy whose allowance for
// MODEL (default claude-fable-5-1) is spent. The pool is every Claude Max
// profile of the installed proxy (POOL=a,b,c narrows it). The proxy is this
// checkout's, started in this process on a port of its own with its own config
// directory, so a proxy already running is not touched. The usage the order
// reads is warmed the way the profile page warms it, with /v1/usage/quota/all
// (GETs on the usage endpoint, no model calls), and the configured order is
// set to the room order reversed, so only the room order can pick the account
// it picks.
//
// Costs one refused request on ACTIVE (no tokens) and one short MODEL request
// on the account that serves it; more refused ones if the accounts ahead of it
// refuse too. Not in CI: it needs accounts in that state.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

const say = console.log.bind(console)
const { ACTIVE } = process.env
const MODEL = process.env.MODEL ?? "claude-fable-5-1"
const installed = join(process.env.MERIDIAN_CONFIG_DIR ?? join(homedir(), ".config", "meridian"), "profiles.json")
if (!ACTIVE || !existsSync(installed)) { say("SKIP: set ACTIVE to a profile of the installed proxy (see the header)"); process.exit(1) }
const wanted = process.env.POOL?.split(",").map(id => id.trim()).filter(Boolean)
const pool = JSON.parse(readFileSync(installed, "utf8"))
  .filter(profile => (profile.type ?? "claude-max") === "claude-max" && (!wanted || wanted.includes(profile.id) || profile.id === ACTIVE))
if (!pool.some(profile => profile.id === ACTIVE) || pool.length < 3) { say(`SKIP: need ${ACTIVE} and at least two other Claude Max profiles`); process.exit(1) }

const root = realpathSync(mkdtempSync(join(tmpdir(), "mfallback-")))
mkdirSync(join(root, "config"))
const cliPath = process.env.E2E_CLAUDE_PATH ? resolve(process.env.E2E_CLAUDE_PATH) : resolve("node_modules/.bin/claude")
writeFileSync(join(root, "config", "settings.json"), JSON.stringify({ routing: "active+priority", activeProfile: ACTIVE }))
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_CLAUDE_PATH: cliPath,
})
process.chdir(root)

const { startProxyServer } = await import("../src/proxy/server.ts")
const { orderFallbacksByRoom } = await import("../src/proxy/routing.ts")
const { windowedModel } = await import("../src/proxy/limitDetection.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true, profiles: pool, defaultProfile: ACTIVE })
const address = proxy.server.address()
assert(address && typeof address === "object")
const proxyUrl = `http://127.0.0.1:${address.port}`
const failures = []
const check = (ok, label, detail) => { say(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures.push(label) }

try {
  const quota = await (await fetch(`${proxyUrl}/v1/usage/quota/all`)).json()
  const windowsOf = new Map((quota.profiles ?? []).map(entry => [entry.id, entry.windows ?? []]))
  const now = Date.now()
  const model = windowedModel(MODEL)
  const fallbacks = pool.map(profile => profile.id).filter(id => id !== ACTIVE)
  const roomOrder = orderFallbacksByRoom(fallbacks, id => windowsOf.get(id), { now, model })
  const share = (id, type) => {
    const window = (windowsOf.get(id) ?? []).find(w => w.type === type)
    return window?.utilization == null ? "?" : `${Math.round(window.utilization * 100)}%`
  }
  const weeklyReset = id => {
    const window = (windowsOf.get(id) ?? []).find(w => w.type === "seven_day")
    return window?.resetsAt ? `${Math.round((window.resetsAt - now) / 3_600_000)}h` : "?"
  }
  say(`Live: ${MODEL} with ${ACTIVE} active; usage as read just now (5h / 7d / ${model ?? "model"} 7d, weekly reset in):`)
  for (const id of roomOrder) say(`  ${id.padEnd(14)} ${share(id, "five_hour").padStart(4)} ${share(id, "seven_day").padStart(4)} ${share(id, `seven_day_${model}`).padStart(4)}  ${weeklyReset(id)}`)
  const configured = [...roomOrder].reverse()
  process.env.MERIDIAN_PROFILE_ORDER = [ACTIVE, ...configured].join(",")
  say(`  room order:       ${roomOrder.join(", ")}`)
  say(`  configured order: ${configured.join(", ")}`)

  const response = await fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "claude-cli/2.1.290 (external, cli)" },
    body: JSON.stringify({ model: MODEL, max_tokens: 50, stream: false, messages: [{ role: "user", content: "Reply with the single word OK." }],
      metadata: { user_id: JSON.stringify({ session_id: randomUUID() }) } }),
    signal: AbortSignal.timeout(180_000),
  })
  const body = await response.json()
  const rows = (await (await fetch(`${proxyUrl}/telemetry/requests?limit=50&hops=1`)).json()).sort((a, b) => (a.routeAttempt ?? 0) - (b.routeAttempt ?? 0))
  const tried = rows.map(row => `${row.profileId}:${row.status}`).join(" -> ")
  const served = rows.find(row => row.status === 200)?.profileId
  say(`  tried: ${tried}`)
  check(response.status === 200, "the request is answered", `${response.status} ${JSON.stringify(body).slice(0, 120)}`)
  check(rows[0]?.profileId === ACTIVE, "the active profile is tried first and refuses", rows[0] ? `${rows[0].profileId}:${rows[0].status}` : "no rows")
  const expected = roomOrder.find(id => rows.some(row => row.profileId === id && row.status === 200)) === served && roomOrder.filter(id => id !== served)
    .slice(0, roomOrder.indexOf(served ?? "")).every(id => rows.some(row => row.profileId === id && row.status !== 200))
  check(Boolean(served) && expected, "it is served by the first account in the room order that serves it",
    `served by ${served}; room order starts ${roomOrder[0]}, configured order ${configured[0]}`)
  check(served !== configured[0] || roomOrder[0] === configured[0], "not by the account the configured order names first", configured[0])
} finally {
  await proxy.close?.()
  const slug = root.replace(/[^A-Za-z0-9]/g, "-")
  for (const profile of pool) {
    const transcripts = join(profile.claudeConfigDir ?? join(homedir(), ".claude"), "projects", slug)
    if (existsSync(transcripts)) { rmSync(transcripts, { recursive: true, force: true }); say(`  removed ${transcripts}`) }
  }
  rmSync(root, { recursive: true, force: true })
}
say(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
