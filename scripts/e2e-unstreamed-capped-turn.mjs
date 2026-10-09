#!/usr/bin/env bun
// Does a passthrough tool turn the CLI answered without streaming reach the
// client as a tool call? The real proxy, SDK and CLI against a scripted
// Messages API, one API-key account, passthrough on; no model calls.
//
// Live, 2026-10-09 09:49-11:27, Sonnet subagents on two accounts got
// "429 Rate limited" again and again; the CLI retried, and the request that
// answered went out without streaming. The turn then reached the proxy as one
// assistant message with its call captured and no stream event, and the
// one-turn cap's stop went to Claude Code as a 500 instead of the call: 180
// turns, each answered and paid for, then asked again.
//
// The scripted API refuses every streaming request with that 429 and answers
// every request without streaming with a Bash call, so whatever retries the
// CLI makes, the turn can only be answered the way it was live.
//
//   bun scripts/e2e-unstreamed-capped-turn.mjs [model]
//   E2E_MERIDIAN_ROOT=<checkout> bun scripts/e2e-unstreamed-capped-turn.mjs   # another tree's src
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const MODEL = process.argv[2] ?? "claude-sonnet-5"
const repo = resolve(process.env.E2E_MERIDIAN_ROOT ?? ".")
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-unstreamed-capped-")))
mkdirSync(join(root, "work"))

for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_PASSTHROUGH: "1", CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  ...(process.env.E2E_CLAUDE_PATH ? { MERIDIAN_CLAUDE_PATH: resolve(process.env.E2E_CLAUDE_PATH) } : {}),
})

const COMMAND = { command: "ls -la src" }
let refusedStreams = 0
let unstreamedAnswers = 0
const startedAt = Date.now()
const at = () => ((Date.now() - startedAt) / 1000).toFixed(1)
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
  const body = await request.json()
  const bash = (body.tools ?? []).find(tool => typeof tool.name === "string" && tool.name.endsWith("Bash"))
  if (body.stream === true) {
    // Accepted, then refused before message_start: the burst rate limit that
    // makes the CLI send the request again without streaming. (A 429 for the
    // request itself is only retried, streamed, until the CLI gives up.)
    refusedStreams++
    return new Response(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Rate limited" } })}\n\n`,
      { status: 200, headers: { "content-type": "text/event-stream", "request-id": `req_fixture_${refusedStreams}` } })
  }
  unstreamedAnswers++
  console.log(`  note  ${at()} s: a request without streaming, after ${refusedStreams} refused stream(s)`)
  const content = bash
    ? [{ type: "text", text: "Listing the sources." }, { type: "tool_use", id: `toolu_unstreamed_${unstreamedAnswers}`, name: bash.name, input: COMMAND }]
    : [{ type: "text", text: "Done." }]
  return Response.json({ id: `msg_unstreamed_${unstreamedAnswers}`, type: "message", role: "assistant", model: body.model, content,
    stop_reason: bash ? "tool_use" : "end_turn", stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } })
} })

const { startProxyServer } = await import(pathToFileURL(join(repo, "src/proxy/server.ts")).href)
const { telemetryStore } = await import(pathToFileURL(join(repo, "src/telemetry/index.ts")).href)
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: [{ id: "fixture", type: "api", apiKey: "local-test-key", baseUrl: `http://127.0.0.1:${upstream.port}` }] })
const address = proxy.server.address()
assert(address && typeof address === "object")

const claudeCode = { "content-type": "application/json", "user-agent": "claude-cli/2.1.295 (external, cli)" }
const BASH_TOOL = { name: "Bash", description: "Run a shell command", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

try {
  console.log(`A passthrough tool turn answered without streaming, ${MODEL}, proxy ${repo}`)
  const sessionId = randomUUID()
  const firstId = randomUUID()
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
    method: "POST", headers: { ...claudeCode, "x-request-id": firstId }, signal: AbortSignal.timeout(600_000),
    body: JSON.stringify({ model: MODEL, max_tokens: 2_000, stream: true, tools: [BASH_TOOL],
      metadata: { user_id: JSON.stringify({ session_id: sessionId }) }, messages: [{ role: "user", content: "List the sources." }] }),
  })
  const text = await response.text()
  const events = []
  for (const line of text.split("\n")) if (line.startsWith("data:")) events.push(JSON.parse(line.slice(5)))
  const toolStart = events.find(e => e.type === "content_block_start" && e.content_block?.type === "tool_use")
  const input = events.filter(e => e.type === "content_block_delta" && e.delta?.type === "input_json_delta").map(e => e.delta.partial_json).join("")
  const stop = events.find(e => e.type === "message_delta")?.delta?.stop_reason
  const error = events.find(e => e.type === "error")?.error
  console.log(`  note  HTTP ${response.status} at ${at()} s; ${refusedStreams} stream(s) refused, ${unstreamedAnswers} answer(s) without streaming`)
  check(refusedStreams > 0 && unstreamedAnswers > 0, "the CLI answered the turn without streaming after its streams were refused",
    `${refusedStreams} refused, ${unstreamedAnswers} unstreamed`)
  check(response.status === 200 && !error, "the client gets no error", error ? `${error.type}: ${error.message}` : undefined)
  check(toolStart?.content_block?.name === "Bash", "the client gets the Bash call", toolStart ? toolStart.content_block.name : "no tool_use block")
  check(input === JSON.stringify(COMMAND), "with its whole input", input || "none")
  check(stop === "tool_use", "and a tool_use stop", stop ?? "no message_delta")

  if (toolStart) {
    // The client runs the call and sends its result: the session resumes at
    // the call, as after a streamed one, instead of replaying the history.
    const nextId = randomUUID()
    const next = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
      method: "POST", headers: { ...claudeCode, "x-request-id": nextId }, signal: AbortSignal.timeout(600_000),
      body: JSON.stringify({ model: MODEL, max_tokens: 2_000, stream: true, tools: [BASH_TOOL],
        metadata: { user_id: JSON.stringify({ session_id: sessionId }) },
        messages: [
          { role: "user", content: "List the sources." },
          { role: "assistant", content: [{ type: "text", text: "Listing the sources." }, { type: "tool_use", id: toolStart.content_block.id, name: "Bash", input: COMMAND }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: toolStart.content_block.id, content: "server.ts\nquery.ts" }] },
        ] }),
    })
    await next.text()
    const row = telemetryStore.getRecent({ limit: 50 }).find(r => r.requestId === nextId)
    check(next.status === 200 && row?.isResume === true && row?.lineageType === "continuation",
      "the client's result resumes the session at the call", row ? `isResume=${row.isResume}, lineage=${row.lineageType}` : `HTTP ${next.status}, no row`)
  }
} finally {
  await proxy.close?.()
  upstream.stop(true)
  rmSync(root, { recursive: true, force: true })
}
console.log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
