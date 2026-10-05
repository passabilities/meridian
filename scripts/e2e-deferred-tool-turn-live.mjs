#!/usr/bin/env bun
// Live: what does one tool turn cost upstream when the REAL Claude Code client
// talks to the real model through this checkout's proxy?
//
// Claude Code declares more tools than the auto-defer threshold, so the proxy
// counts its session as having deferred tools. Until 2026-10 that lifted the
// passthrough turn cap, and every tool turn was followed by a second Messages
// call in which the model digested the proxy's deny (and often more, as it
// retried the denied call), each at the session's full context. The scripted
// gate (scripts/e2e-deferred-tool-turn.mjs) holds the mechanism against the
// real CLI without model calls; this one shows the real model, client and SDK
// agreeing with it.
//
// The client gets its own CLAUDE_CONFIG_DIR and a dummy bearer token; the proxy
// keeps its real Claude Max authentication. The client's environment is
// scrubbed of `CLAUDE*` variables so running this from inside Claude Code
// cannot hand it a live session. One Bash(echo) call, default permission mode
// with that call pre-allowed, so no auto-mode classifier runs.
//
// Costs a few cents of real tokens and needs Claude Max and the `claude` CLI.
//
//   bun scripts/e2e-deferred-tool-turn-live.mjs
//
// PROBE_MODEL picks the model (default sonnet). E2E_CLAUDE_PATH picks the CLI
// the proxy's SDK drives (default: this checkout's node_modules/.bin/claude,
// the one `npm run start` uses).
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"
import { setSessionStoreDir } from "../src/proxy/sessionStore.ts"

const say = console.log.bind(console)
const which = spawnSync("command", ["-v", "claude"], { shell: true, encoding: "utf8" })
if (which.status !== 0 || !which.stdout.trim()) {
  say("SKIP: the `claude` CLI is not on PATH; this gate drives the real client")
  process.exit(1)
}
const CLIENT = which.stdout.trim()
const clientVersion = spawnSync(CLIENT, ["--version"], { encoding: "utf8" }).stdout.trim()
const sdkCli = process.env.E2E_CLAUDE_PATH ?? resolve(import.meta.dir, "../node_modules/.bin/claude")
const sdkCliVersion = spawnSync(sdkCli, ["--version"], { encoding: "utf8" }).stdout.trim()
const MODEL = process.env.PROBE_MODEL ?? "sonnet"

const WORKDIR = realpathSync(mkdtempSync(join(tmpdir(), "mdeferlive-")))
// An operator's own pins must not decide what this gate measures.
for (const key of Object.keys(process.env)) {
  if ((key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) && key !== "MERIDIAN_CONFIG_DIR") delete process.env[key]
}
Object.assign(process.env, { MERIDIAN_WORKDIR: WORKDIR, MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_CLAUDE_PATH: sdkCli })
setSessionStoreDir(join(WORKDIR, "store"))

// One record per SDK query. A Messages call is one assistant message id: the
// SDK surfaces a call's blocks as several assistant messages sharing it.
const queries = []
const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  const options = input.options ?? {}
  const record = { model: options.model, maxTurns: options.maxTurns, resumed: Boolean(options.resume), resumeSessionAt: Boolean(options.resumeSessionAt),
    deferred: options.env?.ENABLE_TOOL_SEARCH === "true", clientTools: options.allowedTools?.length ?? 0,
    calls: new Map(), toolUses: [], result: undefined }
  queries.push(record)
  const actual = realQuery(input)
  return new Proxy(actual, { get(target, property) {
    if (property === Symbol.asyncIterator) return async function* () {
      for await (const message of actual) {
        if (message.type === "assistant" && message.message?.id) {
          const usage = message.message.usage ?? {}
          record.calls.set(message.message.id, {
            read: usage.cache_read_input_tokens ?? 0, write: usage.cache_creation_input_tokens ?? 0,
            input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 })
          for (const block of message.message.content ?? []) if (block.type === "tool_use") record.toolUses.push(block.name)
        }
        if (message.type === "result") record.result = message.subtype
        yield message
      }
    }
    const value = Reflect.get(target, property, target)
    return typeof value === "function" ? value.bind(target) : value
  } })
})

const proxyLog = []
for (const k of ["log", "error", "debug", "warn"]) console[k] = (...a) => { proxyLog.push(a.map(String).join(" ")) }
const { startProxyServer } = await import("../src/proxy/server.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1" })
const address = proxy.server.address()

const failures = []
const check = (ok, label, detail) => {
  say(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

const nonce = `deferred-turn-${randomUUID()}`
let client = { status: -1, out: "", err: "" }
try {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^CLAUDE(CODE|_)/.test(key) || key.startsWith("MERIDIAN_") || key.startsWith("ANTHROPIC_")) delete env[key]
  }
  Object.assign(env, { CLAUDE_CONFIG_DIR: join(WORKDIR, "client-config"), ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`, ANTHROPIC_AUTH_TOKEN: "meridian-e2e-dummy" })
  const proc = Bun.spawn([CLIENT, "-p",
    `Run this exact shell command with the Bash tool: echo ${nonce}\nThen reply with only the command's output.`,
    "--model", MODEL, "--permission-mode", "default", "--allowedTools", "Bash(echo:*)"],
  { cwd: WORKDIR, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => proc.kill(), 300_000)
  const [out, err, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  clearTimeout(timer)
  client = { status, out: out.trim(), err: err.trim() }
} finally {
  await proxy.close()
  observer.mockRestore()
}

say(`\n=== deferred tool turn, live (model=${MODEL}) ===`)
say(`  client: ${clientVersion} (${CLIENT})`)
say(`  SDK CLI: ${sdkCliVersion} (${sdkCli})`)
const deferLine = proxyLog.find(line => line.includes("deferred="))
say(`  proxy: ${deferLine?.replace(/^.*\[PROXY\]\s*\S+\s*/, "") ?? "(no deferred= line)"}`)
for (const [index, query] of queries.entries()) {
  const calls = [...query.calls.values()]
  say(`  query ${index + 1}: model=${query.model} tools=${query.clientTools} deferred=${query.deferred} maxTurns=${query.maxTurns} resumed=${query.resumed} ` +
    `calls=${calls.length} result=${query.result} tool_use=[${query.toolUses.join(",")}] ` +
    `per-call read/write/out=${calls.map(call => `${call.read}/${call.write}/${call.output}`).join(" | ")}`)
}

const withTools = queries.filter(query => query.clientTools > 0)
const toolTurns = withTools.filter(query => query.toolUses.length > 0 && !query.resumed)
const followups = withTools.filter(query => query.resumed)
check(client.status === 0 && client.out.includes(nonce), "the client ran the tool and answered with its output",
  `exit=${client.status} out=${client.out.slice(0, 80)}${client.status === 0 ? "" : ` err=${client.err.slice(-300)}`}`)
check(withTools.length > 0 && withTools.every(query => query.deferred), "the proxy counts the client's tool set as deferred",
  `${withTools.filter(query => query.deferred).length}/${withTools.length} tool-bearing queries`)
check(withTools.length > 0 && withTools.every(query => query.maxTurns === 1), "every tool-bearing query is asked with maxTurns 1",
  `maxTurns=${withTools.map(query => query.maxTurns).join(",")}`)
check(toolTurns.length >= 1 && toolTurns.every(query => query.calls.size === 1 && query.result === "error_max_turns"),
  "the tool turn is one Messages call ending in the canonical error_max_turns result",
  toolTurns.map(query => `${query.calls.size} call(s), ${query.result}`).join("; ") || "no tool turn seen")
check(followups.length >= 1 && followups.every(query => query.resumeSessionAt && query.calls.size === 1 && query.result === "success"),
  "the follow-up resumes at the tool boundary and answers in one Messages call",
  followups.map(query => `resumeSessionAt=${query.resumeSessionAt} ${query.calls.size} call(s), ${query.result}`).join("; ") || "no resumed query seen")
check(followups.length >= 1 && followups.every(query => [...query.calls.values()].every(call => call.read > 0)),
  "the resumed turn reads the capped turn's prompt back from the cache",
  followups.map(query => [...query.calls.values()].map(call => `read=${call.read} write=${call.write}`).join(",")).join("; "))
const extra = withTools.reduce((sum, query) => sum + Math.max(0, query.calls.size - 1), 0)
say(`\n${failures.length === 0 ? "PASS" : "FAIL"}: ${withTools.reduce((sum, query) => sum + query.calls.size, 0)} Messages call(s) across ${withTools.length} tool-bearing queries, ${extra} beyond one per query`)
// A failed run keeps the client's config and the proxy's session store.
if (failures.length === 0) rmSync(WORKDIR, { recursive: true, force: true })
else say(`  kept: ${WORKDIR}`)
process.exit(failures.length === 0 ? 0 : 1)
