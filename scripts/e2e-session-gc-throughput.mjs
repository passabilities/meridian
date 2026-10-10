#!/usr/bin/env bun
// How many orphaned transcripts does one session GC sweep delete, through the
// real Agent SDK in child processes, at the default settings? No model calls.
//
// Live, 2026-10-09: every turn leaves its fork's transcript for the GC, and
// parallel runs left 1,100-1,700 an hour. The GC deleted 16 a sweep, once a
// minute, behind a 256-transcript backlog that a 21-minute grace held to about
// 12 a minute. Orphaned transcripts stayed live until they filled the
// ownership ceiling, and every request that needed a new one was refused
// 503 overloaded_error ("session transcript ownership capacity is full").
//
// The gate registers ORPHANS live transcripts the way the proxy does, each a
// real file where the SDK keeps sessions, none pinned by a mapping. A first
// sweep retires them; after the grace (1 s here) a second sweep deletes as many
// as it may, each with the SDK's deleteSession in a gated child process. The
// backlog is set for both runs, so only the deletion rate differs.
//
//   bun scripts/e2e-session-gc-throughput.mjs
//   E2E_MERIDIAN_ROOT=<checkout> bun scripts/e2e-session-gc-throughput.mjs   # another tree's src
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const repo = resolve(process.env.E2E_MERIDIAN_ROOT ?? ".")
const ORPHANS = Number(process.env.ORPHANS ?? 300)
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-gc-throughput-")))
const profileDir = join(root, "profile")
const projectDir = join(root, "project")
mkdirSync(projectDir, { recursive: true })
const sessionsDir = join(profileDir, "projects", projectDir.replace(/[^a-zA-Z0-9]/g, "-"))
mkdirSync(sessionsDir, { recursive: true })

for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"), MERIDIAN_WORKDIR: projectDir,
  MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_SESSION_GC_GRACE_MS: "1000", MERIDIAN_SESSION_GC_MAX_PENDING: "1000",
})

const { createProxyServer } = await import(pathToFileURL(join(repo, "src/proxy/server.ts")).href)
const { registerLiveTranscript } = await import(pathToFileURL(join(repo, "src/proxy/sessionLifecycle.ts")).href)
const { setSessionStoreDir } = await import(pathToFileURL(join(repo, "src/proxy/sessionStore.ts")).href)
setSessionStoreDir(join(root, "sessions"))

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

try {
  console.log(`${ORPHANS} orphaned transcripts, proxy ${repo}`)
  const files = []
  for (let i = 0; i < ORPHANS; i++) {
    const sessionId = randomUUID()
    const file = join(sessionsDir, `${sessionId}.jsonl`)
    writeFileSync(file, `${JSON.stringify({ type: "user", sessionId, message: { role: "user", content: "orphan" } })}\n`)
    files.push(file)
    await registerLiveTranscript({ sessionId, configDir: profileDir, projectDir })
  }
  const proxy = createProxyServer({ port: 0, host: "127.0.0.1", defaultProfile: "p", profiles: [{ id: "p", claudeConfigDir: profileDir }] })
  await proxy.sweepSessionGc()
  await new Promise(resolve => setTimeout(resolve, 1_500))
  const startedAt = Date.now()
  await proxy.sweepSessionGc()
  const seconds = (Date.now() - startedAt) / 1000
  const deleted = files.filter(file => !existsSync(file)).length
  console.log(`  note  the second sweep deleted ${deleted} transcript file(s) in ${seconds.toFixed(1)} s` +
    (deleted ? `, ${(seconds / deleted * 1000).toFixed(0)} ms each` : ""))
  check(deleted === 64, "one sweep deletes 64 orphaned transcripts through the SDK", `${deleted}`)
  check(seconds < 30, "within the sweep's 30-second budget", `${seconds.toFixed(1)} s`)
} finally {
  setSessionStoreDir(null)
  rmSync(root, { recursive: true, force: true })
}
console.log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
