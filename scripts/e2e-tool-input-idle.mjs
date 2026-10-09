#!/usr/bin/env bun
// Does a turn survive the model API writing one long tool parameter with
// nothing but pings for longer than the turn's idle limit? The real proxy,
// SDK and CLI against a scripted Messages API, one API-key account, passthrough
// on; no model calls.
//
// The scripted model opens a Write call and sends only pings for QUIET seconds
// (default 20) before the input arrives, as the API can while it writes a whole
// file or a subagent's report. The turn limit is 8 s, the tool-input limit
// TOOL_INPUT_LIMIT_MS (default 40 s; 0 turns it off, the behaviour before it).
// A second conversation's text block goes quiet the same way and has to be
// answered "Upstream stalled" at the turn limit: the longer limit is for a tool
// call being written, nothing else. Live, 2026-10-07/08: all 120 mid-stream
// stalls at 90 s came with a tool call open, and the client was left with the
// call cut off (Write, SubagentHandback) and had the model write it again.
//
//   bun scripts/e2e-tool-input-idle.mjs [model]
//   TOOL_INPUT_LIMIT_MS=0 bun scripts/e2e-tool-input-idle.mjs   # before
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const MODEL = process.argv[2] ?? "claude-sonnet-5-5"
const QUIET = Number(process.env.QUIET ?? 20)
const TURN_LIMIT_MS = 8_000
const TOOL_INPUT_LIMIT_MS = Number(process.env.TOOL_INPUT_LIMIT_MS ?? 40_000)
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-tool-input-idle-")))
mkdirSync(join(root, "work"))

for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
// Set before the proxy is loaded: the limits are read once, at load.
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_PASSTHROUGH: "1", CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  MERIDIAN_UPSTREAM_IDLE_MS: String(TURN_LIMIT_MS), MERIDIAN_UPSTREAM_TOOL_INPUT_IDLE_MS: String(TOOL_INPUT_LIMIT_MS),
  ...(process.env.E2E_CLAUDE_PATH ? { MERIDIAN_CLAUDE_PATH: resolve(process.env.E2E_CLAUDE_PATH) } : {}),
})

const textOf = content => typeof content === "string" ? content
  : Array.isArray(content) ? content.map(block => block?.type === "text" ? block.text ?? "" : block?.type === "tool_result" ? textOf(block.content) : "").join("\n") : ""
const kindOf = body => {
  const asked = textOf(body.messages?.find(message => message.role === "user")?.content)
  return asked.includes("WRITE-REPORT") ? "write" : asked.includes("THINK-ALOUD") ? "text" : "other"
}
const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")
const messageStart = model => ({ type: "message_start", message: { id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`, type: "message", role: "assistant", content: [], model,
  stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } })
const REPORT = { file_path: "report.md", content: `# Report\n${"A finding, with its evidence.\n".repeat(40)}` }

const asked = []
const served = new Set()
const startedAt = Date.now()
const at = () => Date.now() - startedAt
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
  const body = await request.json()
  const kind = kindOf(body)
  const followUp = served.has(kind)
  served.add(kind)
  asked.push({ kind, followUp, at: at() })
  const encoder = new TextEncoder()
  const send = (controller, events) => controller.enqueue(encoder.encode(sse(events)))
  const quietly = async controller => {
    for (let waited = 0; waited < QUIET; waited += 5) {
      await Bun.sleep(5_000)
      send(controller, [{ type: "ping" }])
    }
  }
  if (kind === "write" && !followUp) {
    return new Response(new ReadableStream({ async start(controller) {
      send(controller, [messageStart(body.model),
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_report", name: "Write", input: {} } }])
      await quietly(controller)
      send(controller, [
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(REPORT) } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 400 } },
        { type: "message_stop" },
      ])
      controller.close()
    } }), { headers: { "content-type": "text/event-stream" } })
  }
  if (kind === "text" && !followUp) {
    return new Response(new ReadableStream({ async start(controller) {
      send(controller, [messageStart(body.model), { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me think " } }])
      await quietly(controller)
      send(controller, [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "about it." } }, { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } }, { type: "message_stop" }])
      controller.close()
    } }), { headers: { "content-type": "text/event-stream" } })
  }
  // Whatever the CLI asks after the proxy took a call for the client: answer at once.
  return new Response(sse([messageStart(body.model), { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Done." } }, { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }, { type: "message_stop" }]),
  { headers: { "content-type": "text/event-stream" } })
} })

const { startProxyServer } = await import("../src/proxy/server.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: [{ id: "fixture", type: "api", apiKey: "local-test-key", baseUrl: `http://127.0.0.1:${upstream.port}` }] })
const address = proxy.server.address()
assert(address && typeof address === "object")
const proxyUrl = `http://127.0.0.1:${address.port}`

const claudeCode = { "content-type": "application/json", "user-agent": "claude-cli/2.1.294 (external, cli)" }
const WRITE_TOOL = { name: "Write", description: "Write a file", input_schema: { type: "object", properties: { file_path: { type: "string" }, content: { type: "string" } }, required: ["file_path", "content"] } }
async function streamed(prompt) {
  const response = await fetch(`${proxyUrl}/v1/messages`, {
    method: "POST", headers: claudeCode, signal: AbortSignal.timeout(Math.max(240_000, (QUIET + 120) * 1_000)),
    body: JSON.stringify({ model: MODEL, max_tokens: 2_000, stream: true, tools: [WRITE_TOOL],
      metadata: { user_id: JSON.stringify({ session_id: randomUUID() }) }, messages: [{ role: "user", content: prompt }] }),
  })
  return { status: response.status, text: await response.text(), doneAt: at() }
}
const toolInputOf = text => {
  let json = ""
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue
    const event = JSON.parse(line.slice(5))
    if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") json += event.delta.partial_json
  }
  return json
}

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

try {
  console.log(`A quiet tool call, ${MODEL}, turn limit ${TURN_LIMIT_MS / 1000} s, tool-input limit ${TOOL_INPUT_LIMIT_MS > 0 ? `${TOOL_INPUT_LIMIT_MS / 1000} s` : "off"}, quiet ${QUIET} s`)
  const [write, text] = await Promise.all([streamed("WRITE-REPORT write the report to report.md"), streamed("THINK-ALOUD say something")])
  console.log(`  note  write: HTTP ${write.status}, done at ${(write.doneAt / 1000).toFixed(1)} s; text: HTTP ${text.status}, done at ${(text.doneAt / 1000).toFixed(1)} s`)
  console.log(`  note  the API was asked: ${asked.map(entry => `${entry.kind}${entry.followUp ? " (follow-up)" : ""} at ${(entry.at / 1000).toFixed(1)} s`).join(", ")}`)
  const input = toolInputOf(write.text)
  check(write.status === 200 && !write.text.includes("upstream_timeout"), "the quiet tool call is not answered \"Upstream stalled\"",
    write.text.includes("upstream_timeout") ? write.text.match(/Upstream stalled[^"]*/)?.[0] : undefined)
  check(input === JSON.stringify(REPORT), "the client gets the whole call", `${input.length} of ${JSON.stringify(REPORT).length} characters of input`)
  check(text.text.includes("upstream_timeout") && text.doneAt < QUIET * 1_000, "a quiet text block is still answered \"Upstream stalled\" at the turn's limit",
    `done at ${(text.doneAt / 1000).toFixed(1)} s`)
} finally {
  await proxy.close?.()
  upstream.stop(true)
  rmSync(root, { recursive: true, force: true })
}
console.log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
