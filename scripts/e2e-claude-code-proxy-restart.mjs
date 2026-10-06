#!/usr/bin/env bun
// Does a conversation resume across a proxy restart, or is it replayed? The
// real client through the real proxy, SDK and CLI against a scripted Messages
// API: no model calls.
//
// Turn 1 (one tool round and an answer) runs through one proxy process; that
// process exits, and turn 2 runs through a new one with the same config
// directory and session store, as after a deploy or a supervisor restart. The
// gate holds that turn 2 resumes the session turn 1 left (lineage
// `continuation`, an SDK resume, no replay), and that the API receives it as
// turn 1's messages, unchanged, with the new turn after them.
//
//   bun scripts/e2e-claude-code-proxy-restart.mjs [model]
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLIENT = process.env.E2E_CLAUDE_CLIENT ? resolve(process.env.E2E_CLAUDE_CLIENT) : "claude"

if (process.env.RESTART_GATE_ROLE === "proxy") {
  // One proxy lifetime: serve the client's turn, report what happened, exit.
  const { spyOn } = await import("bun:test")
  const sdk = await import("@anthropic-ai/claude-agent-sdk")
  const queries = []
  const realQuery = sdk.query
  spyOn(sdk, "query").mockImplementation(input => {
    queries.push({ resume: input.options?.resume, replay: typeof input.prompt === "string" && input.prompt.includes("<conversation_history>") })
    return realQuery(input)
  })
  const { startProxyServer } = await import("../src/proxy/server.ts")
  const { telemetryStore } = await import("../src/telemetry/index.ts")
  const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
    profiles: [{ id: "fixture", type: "api", apiKey: "local-test-key", baseUrl: process.env.RESTART_GATE_UPSTREAM }] })
  const proxyUrl = `http://127.0.0.1:${proxy.server.address().port}`
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^CLAUDE(CODE|_)|^ANTHROPIC_|^MERIDIAN_|^RESTART_GATE_|^ENABLE_/.test(key)) delete env[key]
  Object.assign(env, { CLAUDE_CONFIG_DIR: process.env.RESTART_GATE_CLIENT_CONFIG, ANTHROPIC_BASE_URL: proxyUrl, ANTHROPIC_AUTH_TOKEN: "meridian-e2e-dummy", DISABLE_AUTOUPDATER: "1" })
  const child = Bun.spawn([CLIENT, "-p", "--model", process.env.RESTART_GATE_MODEL, "--allowedTools", "Read", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "",
    ...JSON.parse(process.env.RESTART_GATE_ARGS)], { cwd: process.env.RESTART_GATE_WORK, env, stdout: "pipe", stderr: "pipe" })
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  const rows = telemetryStore.getRecent({ limit: 50 }).filter(row => (row.toolCount ?? 0) > 0)
    .map(row => ({ lineage: row.lineageType, isResume: row.isResume, status: row.status }))
  await proxy.close()
  console.log(`RESULT ${JSON.stringify({ code, out: out.trim(), err: code ? err.slice(-400) : "", rows, queries })}`)
  process.exit(0)
}

const MODEL = process.argv[2] ?? "claude-fable-5-1"
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-restart-")))
const work = join(root, "work")
mkdirSync(work)
const fixture = join(work, "fixture.txt")
writeFileSync(fixture, `fixture ${randomUUID()}\n`)

// The scripted model: turn 1 reads the fixture and answers; turn 2 answers.
const calls = []
function sse(blocks, stopReason, model) {
  const events = [{ type: "message_start", message: { id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`, type: "message", role: "assistant", content: [], model,
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }]
  for (const [index, block] of blocks.entries()) {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }, { type: "content_block_stop", index })
    } else {
      events.push({ type: "content_block_start", index, content_block: { ...block, input: {} } },
        { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }, { type: "content_block_stop", index })
    }
  }
  events.push({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } }, { type: "message_stop" })
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })
}
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
  const body = await request.json()
  const read = (body.tools ?? []).map(tool => tool.name).find(name => name.endsWith("Read"))
  if (!read) return sse([{ type: "text", text: "ok" }], "end_turn", body.model)
  calls.push(body)
  const text = JSON.stringify(body.messages)
  if (text.includes("SECOND-PROMPT")) return sse([{ type: "text", text: "TURN-2-DONE" }], "end_turn", body.model)
  if (!text.includes("tool_result")) return sse([{ type: "tool_use", id: `toolu_${randomUUID().replaceAll("-", "").slice(0, 22)}`, name: read, input: { file_path: fixture } }], "tool_use", body.model)
  return sse([{ type: "text", text: "TURN-1-DONE" }], "end_turn", body.model)
} })

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}
async function proxyLifetime(args) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete env[key]
  Object.assign(env, {
    RESTART_GATE_ROLE: "proxy", RESTART_GATE_UPSTREAM: `http://127.0.0.1:${upstream.port}`, RESTART_GATE_MODEL: MODEL,
    RESTART_GATE_ARGS: JSON.stringify(args), RESTART_GATE_WORK: work, RESTART_GATE_CLIENT_CONFIG: join(root, "client-config"),
    MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"), MERIDIAN_PASSTHROUGH: "1",
    MERIDIAN_TELEMETRY_PERSIST: "0", CLAUDE_CONFIG_DIR: join(root, "claude-config"), ENABLE_PROMPT_CACHING_1H: "1",
  })
  const child = Bun.spawn([process.execPath, import.meta.path], { cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe" })
  const [out] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const line = out.split("\n").find(entry => entry.startsWith("RESULT "))
  return line ? JSON.parse(line.slice(7)) : { code: -1, out: "", err: out.slice(-400), rows: [], queries: [] }
}

try {
  console.log(`\n=== a conversation across a proxy restart, ${MODEL} ===`)
  const session = randomUUID()
  const first = await proxyLifetime(["--session-id", session, "FIRST-PROMPT: read the fixture file and report."])
  check(first.code === 0 && first.out.includes("TURN-1-DONE"), "turn 1 is answered by the first proxy process", `${JSON.stringify(first.out.slice(0, 40))} ${first.err}`)
  const callsBefore = calls.length
  const second = await proxyLifetime(["--resume", session, "SECOND-PROMPT: say you are done."])
  check(second.code === 0 && second.out.includes("TURN-2-DONE"), "turn 2 is answered by a new proxy process", `${JSON.stringify(second.out.slice(0, 40))} ${second.err}`)
  const lineage = second.rows.map(row => `${row.lineage}${row.isResume ? "" : "(fresh)"}`)
  check(second.rows.length > 0 && second.rows.every(row => row.lineage === "continuation" && row.isResume), "turn 2 resumes the session turn 1 left", lineage.join(", "))
  check(second.queries.length > 0 && second.queries.every(query => query.resume && !query.replay), "no SDK query of turn 2 is a replay", `${second.queries.length} queries`)
  const blocksOf = message => Array.isArray(message?.content) ? message.content : typeof message?.content === "string" ? [{ type: "text", text: message.content }] : []
  const normalized = message => JSON.stringify({ role: message.role, content: blocksOf(message).map(({ cache_control, ...block }) => block) })
  const before = calls[callsBefore - 1]?.messages ?? []
  const after = calls[callsBefore]?.messages ?? []
  const kept = before.slice(0, before.findLastIndex(message => message.role === "user") + 1)
  const prefixKept = kept.length > 0 && kept.every((message, index) => after[index] && normalized(message) === normalized(after[index]))
  check(prefixKept, "the API receives turn 1's messages unchanged, the new turn after them", `${kept.length} kept of ${after.length}`)
} finally {
  upstream.stop(true)
}
if (failures.length === 0) rmSync(root, { recursive: true, force: true })
console.log(JSON.stringify({ result: failures.length === 0 ? "PASS" : "FAIL", model: MODEL, failures, ...(failures.length ? { root } : {}) }))
process.exit(failures.length === 0 ? 0 : 1)
