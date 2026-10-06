#!/usr/bin/env bun
// Live, with the real Claude Code client and real accounts: a main thread on a
// model the active account still serves, and an Agent-tool subagent on the
// model that account has no allowance left for. It is the shape of an
// orchestrated run: the main thread has to stay where it is, the subagent has
// to be served by the next account without the client seeing the refusal, its
// tool rounds have to resume there, and each conversation's prompt cache has
// to be written for as long as Claude Code keeps it on a direct connection (an
// hour for the main thread, five minutes for the subagent).
//
//   SPENT=personal ROOM=work bun scripts/e2e-claude-code-account-switch-live.mjs
//
// SPENT and ROOM are two Claude Max profiles of the installed proxy, as for
// e2e-model-allowance-failover-live.mjs: SPENT has used up its weekly
// allowance for SUBAGENT_MODEL (default claude-fable-5-1) and still serves
// MAIN_MODEL (default claude-haiku-4-5); ROOM has allowance left. The proxy is
// this checkout's, started in this process on a port of its own with its own
// config directory and session store and in a directory of its own, so a
// proxy already running is not touched. No MERIDIAN_WORKDIR is set, as on an
// installed proxy: the SDK children have to run where the client works, which
// the client states among its messages. E2E_CLAUDE_CLIENT picks the client (default `claude`
// on PATH) and E2E_CLAUDE_PATH the CLI the SDK drives (default this checkout's).
//
// E2E_MCP_TOOLS=<n> gives the client a stdio MCP server with n tools it never
// calls, as a session with MCP servers has. Past the auto-defer threshold the
// proxy defers them and the tools of its own that Claude Code defers on a
// direct connection (E76), and the same switch has to hold with ToolSearch on
// offer. The prompt each turn carried is printed, to set beside a run of the
// same task without the proxy.
//
// Costs one short Claude Code conversation: a few MAIN_MODEL requests on SPENT
// and a few SUBAGENT_MODEL requests on ROOM, each with the client's own system
// prompt and tools (some tens of thousands of tokens, most of them cached
// after the first request). Not in CI: it needs an account in that state.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

const say = console.log.bind(console)
const { SPENT, ROOM } = process.env
const MAIN_MODEL = process.env.MAIN_MODEL ?? "claude-haiku-4-5"
const SUBAGENT_MODEL = process.env.SUBAGENT_MODEL ?? "claude-fable-5-1"
const CLIENT = process.env.E2E_CLAUDE_CLIENT?.includes("/") ? resolve(process.env.E2E_CLAUDE_CLIENT) : process.env.E2E_CLAUDE_CLIENT ?? "claude"
const installed = join(process.env.MERIDIAN_CONFIG_DIR ?? join(homedir(), ".config", "meridian"), "profiles.json")
if (!SPENT || !ROOM || !existsSync(installed)) {
  say("SKIP: set SPENT and ROOM to two profiles of the installed proxy (see the header)")
  process.exit(1)
}
const profiles = JSON.parse(readFileSync(installed, "utf8"))
const pool = [ROOM, SPENT].map(id => profiles.find(profile => profile.id === id))
if (pool.some(profile => !profile)) {
  say(`SKIP: ${installed} has no profile named ${[ROOM, SPENT].filter((_, index) => !pool[index]).join(" or ")}`)
  process.exit(1)
}

const root = realpathSync(mkdtempSync(join(tmpdir(), "mswitch-")))
const work = join(root, "work")
const proxyDir = join(root, "proxy")
mkdirSync(work)
mkdirSync(join(root, "config"))
mkdirSync(proxyDir)
const codeWord = `plover-${randomUUID().slice(0, 8)}`
writeFileSync(join(work, "note.txt"), `The code word is ${codeWord}.\n`)
const MCP_TOOLS = Number(process.env.E2E_MCP_TOOLS ?? 0)
let mcpConfig = '{"mcpServers":{}}'
if (MCP_TOOLS > 0) {
  const serverPath = join(root, "fixture-mcp.mjs")
  writeFileSync(serverPath, `
import { createInterface } from "node:readline"
const tools = Array.from({ length: ${MCP_TOOLS} }, (_, i) => ({
  name: "inventory_report_" + String(i).padStart(2, "0"),
  description: "Produces inventory report " + i + " for a warehouse region. Use only when asked for this report by number.",
  inputSchema: { type: "object", properties: { region: { type: "string", description: "Warehouse region code" } }, required: ["region"] },
}))
const send = message => process.stdout.write(JSON.stringify(message) + "\\n")
createInterface({ input: process.stdin }).on("line", line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.id === undefined) return
  const reply = result => send({ jsonrpc: "2.0", id: request.id, result })
  if (request.method === "initialize") return reply({ protocolVersion: request.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } })
  if (request.method === "tools/list") return reply({ tools })
  if (request.method === "tools/call") return reply({ content: [{ type: "text", text: "No rows." }] })
  if (request.method === "ping") return reply({})
  send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } })
})
`)
  mcpConfig = JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [serverPath] } } })
}
// The spent account is the active one: the account every request goes to first.
writeFileSync(join(root, "config", "settings.json"), JSON.stringify({ routing: "active+priority", activeProfile: SPENT }))
// An operator's own pins must not decide what this gate measures.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
const cliPath = process.env.E2E_CLAUDE_PATH ? resolve(process.env.E2E_CLAUDE_PATH) : resolve(import.meta.dir, "../node_modules/.bin/claude")
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0",
  MERIDIAN_CLAUDE_PATH: cliPath,
})
// Where the proxy process is, and so where an SDK child runs when a request
// names no directory of its own that exists here.
process.chdir(proxyDir)
const { startProxyServer } = await import("../src/proxy/server.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true, profiles: pool, defaultProfile: SPENT })
const proxyUrl = `http://127.0.0.1:${proxy.server.address().port}`

// What the client sends, on its way to the proxy: which conversation a request
// belongs to, and a request id to find its telemetry rows by.
const sent = []
const relay = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  const url = new URL(request.url)
  if (request.method !== "POST" || !url.pathname.endsWith("/messages")) {
    return fetch(proxyUrl + url.pathname + url.search, { method: request.method, headers: request.headers,
      ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: await request.arrayBuffer() }) })
  }
  const raw = await request.text()
  const body = JSON.parse(raw)
  const headers = new Headers(request.headers)
  const requestId = randomUUID()
  headers.set("x-request-id", requestId)
  sent.push({ requestId, model: body.model, agentId: request.headers.get("x-claude-code-agent-id"), tools: (body.tools ?? []).length, stream: body.stream === true })
  return fetch(proxyUrl + url.pathname + url.search, { method: "POST", headers, body: raw, signal: AbortSignal.timeout(240_000) })
} })

const failures = []
function check(ok, label, detail = "") {
  say(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`)
  if (!ok) failures.push(label)
}
const versionOf = async (command) => {
  const child = Bun.spawn([command, "--version"], { stdout: "pipe", stderr: "pipe" })
  const out = (await new Response(child.stdout).text()).trim()
  await child.exited
  return out
}
/** Cache tokens written by every reply in a profile's transcripts of this run, by lifetime. */
function cacheWritten(profile, slug) {
  const dir = join(profile.claudeConfigDir, "projects", slug)
  const seen = new Set()
  const total = { "5m": 0, "1h": 0, replies: 0 }
  const walk = (path) => {
    for (const entry of existsSync(path) ? readdirSync(path, { withFileTypes: true }) : []) {
      if (entry.isDirectory()) walk(join(path, entry.name))
      else if (entry.name.endsWith(".jsonl")) {
        for (const line of readFileSync(join(path, entry.name), "utf8").split("\n")) {
          if (!line.includes('"cache_creation"')) continue
          const message = JSON.parse(line).message
          if (!message?.id || seen.has(message.id)) continue
          seen.add(message.id)
          total.replies++
          total["5m"] += message.usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0
          total["1h"] += message.usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0
        }
      }
    }
  }
  walk(dir)
  return total
}

// The SDK files a session's transcript under the directory its child ran in.
const slugOf = (directory) => directory.replace(/[^A-Za-z0-9]/g, "-")
const slug = slugOf(work)
let closed = false
try {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^CLAUDE(CODE|_)/.test(key) || key.startsWith("MERIDIAN_") || key.startsWith("ANTHROPIC_") || key === "ENABLE_TOOL_SEARCH") delete env[key]
  }
  Object.assign(env, { CLAUDE_CONFIG_DIR: join(root, "client-config"), ANTHROPIC_BASE_URL: `http://127.0.0.1:${relay.port}`,
    ANTHROPIC_AUTH_TOKEN: "meridian-e2e-dummy", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_SUBAGENT_MODEL: SUBAGENT_MODEL })
  const prompt = "Do not read any file yourself. Use the Agent tool exactly once, with subagent_type general-purpose, and have that subagent read the file note.txt in the current directory with the Read tool and report the code word it contains. Then reply with the code word and nothing else."
  const child = Bun.spawn([CLIENT, "-p", prompt, "--model", MAIN_MODEL, "--allowedTools", "Read,Agent", "--permission-mode", "bypassPermissions",
    "--strict-mcp-config", "--mcp-config", mcpConfig, "--setting-sources", ""], { cwd: work, env, stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => child.kill(), 420_000)
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  clearTimeout(timer)

  say(`\n=== ${await versionOf(CLIENT)} through ${await versionOf(cliPath)}; main thread ${MAIN_MODEL} with ${SPENT} active, subagent ${SUBAGENT_MODEL}${MCP_TOOLS > 0 ? `, ${MCP_TOOLS} MCP tools` : ""} ===`)
  check(code === 0 && out.includes(codeWord), "the client finishes, with what its subagent read",
    `exit=${code} out=${JSON.stringify(out.trim().slice(0, 80))}${code === 0 ? "" : ` err=${JSON.stringify(err.slice(0, 300))}`}`)

  const rows = (await (await fetch(`${proxyUrl}/telemetry/requests?limit=200&hops=1`)).json()).sort((a, b) => a.timestamp - b.timestamp)
  const hopsOf = (request) => rows.filter(row => row.requestId === request.requestId).sort((a, b) => (a.routeAttempt ?? 0) - (b.routeAttempt ?? 0))
  const tried = (request) => hopsOf(request).map(row => `${row.profileId}:${row.status}`).join(" -> ")
  const served = (request) => hopsOf(request).find(row => row.status === 200)
  // A conversation's own turns carry the client's tools; its side calls carry none.
  const subagent = sent.filter(request => request.agentId && request.tools > 0)
  const main = sent.filter(request => !request.agentId && request.tools > 0)
  const tokens = (requests) => {
    const total = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }
    for (const row of requests.map(served).filter(Boolean)) {
      total.input += row.inputTokens ?? 0
      total.cacheWrite += row.cacheCreationInputTokens ?? 0
      total.cacheRead += row.cacheReadInputTokens ?? 0
      total.output += row.outputTokens ?? 0
    }
    return `input ${total.input}, cache write ${total.cacheWrite}, cache read ${total.cacheRead}, output ${total.output}`
  }
  // The prompt one turn carried, whatever of it was read from the cache.
  const prompts = (requests) => requests.map(served).filter(Boolean)
    .map(row => (row.inputTokens ?? 0) + (row.cacheCreationInputTokens ?? 0) + (row.cacheReadInputTokens ?? 0)).join(", ")
  const toolsOf = (requests) => {
    const row = requests.map(served).find(Boolean)
    return row ? `${row.toolCount ?? "?"} tools${row.hasDeferredTools ? `, ${row.deferredToolCount ?? "some"} of them deferred` : ", none deferred"}` : "no served turn"
  }

  check(main.length >= 2 && main.every(request => tried(request) === `${SPENT}:200`),
    "every turn of the main thread is served by the active account, in one attempt",
    `${main.length} turn(s) of ${[...new Set(main.map(request => request.model))].join(",")}: ${main.map(tried).join(" | ")}`)
  const mainLineage = main.map(request => served(request)?.lineageType)
  check(mainLineage[0] === "new" && mainLineage.slice(1).every(type => type === "continuation"),
    "the main thread resumes its session after the subagent's answer", mainLineage.join(", "))

  check(subagent.length >= 2 && subagent.every(request => request.model === SUBAGENT_MODEL && request.stream),
    "the subagent asks for its own model, streamed", `${subagent.length} turn(s) of ${[...new Set(subagent.map(request => request.model))].join(",")}`)
  check(subagent.length >= 2 && tried(subagent[0]) === `${SPENT}:429 -> ${ROOM}:200`,
    "the subagent's first turn is refused by the active account and served by the next", subagent[0] ? tried(subagent[0]) : "no subagent turn")
  check(subagent.length >= 2 && subagent.slice(1).every(request => tried(request) === `${ROOM}:200`),
    "its later turns go straight to that account", subagent.slice(1).map(tried).join(" | "))
  const subagentLineage = subagent.map(request => served(request)?.lineageType)
  check(subagentLineage[0] === "new" && subagentLineage.length >= 2 && subagentLineage.slice(1).every(type => type === "continuation"),
    "and resume the session its first turn left there", subagentLineage.join(", "))

  const health = await (await fetch(`${proxyUrl}/profiles/health`)).json()
  check((health.exhaustedModels ?? []).some(entry => entry.id === SPENT) && !health.exhausted.some(entry => entry.id === SPENT),
    "the active account is out for the subagent's model and not out altogether",
    `exhaustedModels=${JSON.stringify(health.exhaustedModels)} exhausted=${JSON.stringify(health.exhausted)}`)

  // The lifetimes are read from the transcripts, once the proxy is done with them.
  await proxy.close()
  closed = true
  const ranIn = (directory) => pool.filter(profile => existsSync(join(profile.claudeConfigDir, "projects", slugOf(directory)))).map(profile => profile.id)
  check(ranIn(work).length === pool.length && ranIn(proxyDir).length === 0, "the SDK children ran in the directory the client works in, on both accounts",
    `transcripts under the client's directory: ${ranIn(work).join(", ") || "none"}; under the proxy's: ${ranIn(proxyDir).join(", ") || "none"}`)
  const onRoom = cacheWritten(pool[0], slug)
  const onSpent = cacheWritten(pool[1], slug)
  check(onRoom["5m"] > 0 && onRoom["1h"] === 0, "the subagent's prompt cache is written for five minutes",
    `${ROOM}: ${onRoom["5m"]} tokens for 5m, ${onRoom["1h"]} for 1h, over ${onRoom.replies} replies`)
  check(onSpent["1h"] > 0 && onSpent["5m"] === 0, "the main thread's is written for an hour",
    `${SPENT}: ${onSpent["1h"]} tokens for 1h, ${onSpent["5m"]} for 5m, over ${onSpent.replies} replies`)
  say(`  note  main thread, ${main.length} turn(s), ${toolsOf(main)}: ${tokens(main)}; prompt tokens per turn ${prompts(main)}`)
  say(`  note  subagent, ${subagent.length} turn(s), ${toolsOf(subagent)}: ${tokens(subagent)}; prompt tokens per turn ${prompts(subagent)}`)
  say(`  note  ${sent.length} request(s) in all, ${sent.filter(request => request.tools === 0).length} of them side calls without tools`)
} finally {
  if (!closed) await proxy.close()
  await relay.stop(true)
  // The SDK keeps a transcript per working directory inside each profile.
  for (const profile of pool) {
    for (const directory of [work, proxyDir]) rmSync(join(profile.claudeConfigDir, "projects", slugOf(directory)), { recursive: true, force: true })
  }
}
say(`\n${failures.length === 0 ? "PASS" : "FAIL"}: ${failures.length === 0 ? "one model moved to the next account, and nothing else did" : failures.join("; ")}`)
// A failed run keeps the proxy's session store and the client's transcript.
if (failures.length === 0) rmSync(root, { recursive: true, force: true })
else say(`  kept: ${root}`)
process.exit(failures.length === 0 ? 0 : 1)
