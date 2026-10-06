#!/usr/bin/env bun
// Live, on two real accounts: a conversation's SDK session carried to the
// account that serves it next (sessionCarry.ts), there and back.
//
// The real client (`claude -p`, its own config directory, a dummy token)
// talks to this checkout's proxy, started in this process on a port of its
// own with its own config directory and session store, so a proxy already
// running is not touched. Routing is active+priority. Turn 1 runs on FROM
// with thinking on; the active profile is then switched to TO, which moves
// the conversation, and turn 2 has to resume the session FROM wrote, carried
// to TO: a continuation, no replay, the model still knowing turn 1. Switched
// back, turn 3 has to resume TO's session carried to FROM, not the one FROM
// was left with. Thinking blocks signed under one account go to the other.
//
//   FROM=engineering TO=personal bun scripts/e2e-session-carry-live.mjs
//
// Costs three short MODEL turns (default claude-haiku-4-5): about 15K prompt
// tokens each, most of them written to the cache of the account that serves
// the turn, and a few hundred output tokens. Not in CI: it needs two accounts.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"

const say = console.log.bind(console)
const { FROM, TO } = process.env
const MODEL = process.env.MODEL ?? "claude-haiku-4-5"
const CLIENT = process.env.E2E_CLAUDE_CLIENT ? resolve(process.env.E2E_CLAUDE_CLIENT) : "claude"
const installed = join(process.env.MERIDIAN_CONFIG_DIR ?? join(homedir(), ".config", "meridian"), "profiles.json")
if (!FROM || !TO || FROM === TO || !existsSync(installed)) { say("SKIP: set FROM and TO to two Claude Max profiles of the installed proxy"); process.exit(1) }
const pool = JSON.parse(readFileSync(installed, "utf8")).filter(profile => profile.id === FROM || profile.id === TO)
if (pool.length !== 2) { say(`SKIP: ${FROM} and ${TO} must both be profiles of the installed proxy`); process.exit(1) }

const root = realpathSync(mkdtempSync(join(tmpdir(), "mcarry-")))
const work = join(root, "work")
mkdirSync(work)
mkdirSync(join(root, "config"))
writeFileSync(join(root, "config", "settings.json"), JSON.stringify({ routing: "active+priority", activeProfile: FROM }))
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_PROFILE_ORDER: `${FROM},${TO}`,
  ...(process.env.E2E_CLAUDE_PATH ? { MERIDIAN_CLAUDE_PATH: resolve(process.env.E2E_CLAUDE_PATH) } : {}),
})

const queries = []
const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  queries.push({ dir: input.options?.env?.CLAUDE_CONFIG_DIR, resume: input.options?.resume, textPrompt: typeof input.prompt === "string" ? input.prompt : undefined })
  return realQuery(input)
})
const { startProxyServer } = await import("../src/proxy/server.ts")
const { telemetryStore, diagnosticLog } = await import("../src/telemetry/index.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true, profiles: pool, defaultProfile: FROM })
const address = proxy.server.address()
assert(address && typeof address === "object")
const proxyUrl = `http://127.0.0.1:${address.port}`
const failures = []
const check = (ok, label, detail) => { say(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures.push(label) }

async function setActive(profile) {
  const res = await fetch(`${proxyUrl}/profiles/active`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile }) })
  assert.equal(res.status, 200, `switching the active profile to ${profile}`)
}
const clientConfig = join(root, "client-config")
async function clientTurn(args) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^CLAUDE(CODE|_)|^ANTHROPIC_|^MERIDIAN_/.test(key)) delete env[key]
  Object.assign(env, { CLAUDE_CONFIG_DIR: clientConfig, ANTHROPIC_BASE_URL: proxyUrl, ANTHROPIC_AUTH_TOKEN: "meridian-e2e-dummy",
    DISABLE_AUTOUPDATER: "1", MAX_THINKING_TOKENS: "2048" })
  const child = Bun.spawn([CLIENT, "-p", "--model", MODEL, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", ...args],
    { cwd: work, env, stdout: "pipe", stderr: "pipe" })
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, out: out.trim(), err: err.trim() }
}
const conversationRows = () => telemetryStore.getRecent({ limit: 200 })
  .filter(row => (row.toolCount ?? 0) > 0 && row.status === 200).sort((a, b) => a.timestamp - b.timestamp)

try {
  say(`\n=== a conversation carried between ${FROM} and ${TO}, ${MODEL} ===`)
  const session = randomUUID()
  const turn1 = await clientTurn(["--session-id", session, "Work out 17 times 23, thinking it through first. Reply with the number only."])
  check(turn1.code === 0 && turn1.out.includes("391"), `turn 1 is answered on ${FROM}`, `${JSON.stringify(turn1.out.slice(0, 40))}${turn1.code ? ` ${turn1.err.slice(-300)}` : ""}`)
  const afterFirst = queries.length

  await setActive(TO)
  const turn2 = await clientTurn(["--resume", session, "Add 1 to the number you gave. Reply with the number only."])
  check(turn2.code === 0 && turn2.out.includes("392"), `turn 2 is answered on ${TO}, knowing turn 1`, `${JSON.stringify(turn2.out.slice(0, 40))}${turn2.code ? ` ${turn2.err.slice(-300)}` : ""}`)
  const afterSecond = queries.length

  await setActive(FROM)
  const turn3 = await clientTurn(["--resume", session, "Add 1 again. Reply with the number only."])
  check(turn3.code === 0 && turn3.out.includes("393"), `turn 3 is answered back on ${FROM}, knowing turn 2`, `${JSON.stringify(turn3.out.slice(0, 40))}${turn3.code ? ` ${turn3.err.slice(-300)}` : ""}`)

  const rows = conversationRows()
  const lines = rows.map(row => `${row.profileId} ${row.lineageType}${row.isResume ? "" : "(fresh)"} cache write ${row.cacheCreationInputTokens ?? 0} read ${row.cacheReadInputTokens ?? 0} out ${row.outputTokens ?? 0}`)
  for (const line of lines) say(`  note  ${line}`)
  const second = rows.filter(row => row.profileId === TO)
  const third = rows.filter(row => row.profileId === FROM).slice(1)
  check(second.length > 0 && second.every(row => row.lineageType === "continuation" && row.isResume), `turn 2 resumes on ${TO}: no replay`)
  check(third.length > 0 && third.every(row => row.lineageType === "continuation" && row.isResume), `turn 3 resumes on ${FROM}: no replay`)
  const replayed = queries.filter(query => query.textPrompt?.includes("<conversation_history>"))
  check(replayed.length === 0, "no SDK query is a flattened replay", `${queries.length} queries`)
  const carried = diagnosticLog.getRecent?.({ limit: 500 })?.filter(entry => String(entry.message ?? entry).includes("carried the conversation's session")) ?? []
  say(`  note  carry log lines: ${carried.length}; queries per turn: ${afterFirst}, ${afterSecond - afterFirst}, ${queries.length - afterSecond}`)
} finally {
  await proxy.close()
  observer.mockRestore()
}
// The profiles' own config directories keep what their SDK children wrote
// for this run's directory; remove it there too.
const slug = work.replace(/[^a-zA-Z0-9]/g, "-")
for (const profile of pool) {
  const dir = join(profile.claudeConfigDir ?? "", "projects", slug)
  if (profile.claudeConfigDir && existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); say(`  removed ${dir}`) }
}
rmSync(root, { recursive: true, force: true })
say(failures.length === 0 ? "ALL PASS" : `FAIL: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
