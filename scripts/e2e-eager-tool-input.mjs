#!/usr/bin/env bun
// Does a passthrough tool call's input reach the client as it is written? The
// real proxy, SDK and CLI against a scripted Messages API, one API-key account,
// passthrough on; no model calls.
//
// The scripted model writes a Write call over WRITE_SECONDS (default 20) and
// behaves as the API does: when the request marks that tool
// `eager_input_streaming`, the input goes out in pieces as it is written;
// otherwise the whole input is held back and the stream carries nothing but
// pings until it is done. The turn limit is 8 s and the tool-input limit 12 s,
// so a held-back call is cut off and a streamed one is not.
//
// On Anthropic's API the proxy asks the CLI for eager input streaming itself
// (query.ts, streamsToolInputEagerly). This account's base URL is the scripted
// API, a gateway as far as the CLI and the proxy can tell, so the run sets the
// CLI's switch the way an operator would: EAGER=1 (default) sets
// CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1, EAGER=0 leaves it unset,
// which is what every request got before.
//
//   bun scripts/e2e-eager-tool-input.mjs [model]
//   EAGER=0 bun scripts/e2e-eager-tool-input.mjs   # before
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const MODEL = process.argv[2] ?? "claude-sonnet-5-5"
const EAGER = process.env.EAGER !== "0"
const WRITE_SECONDS = Number(process.env.WRITE_SECONDS ?? 20)
const PIECES = 10
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-eager-tool-input-")))
mkdirSync(join(root, "work"))

for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
delete process.env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING
// Set before the proxy is loaded: the limits are read once, at load.
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_PASSTHROUGH: "1", CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  MERIDIAN_UPSTREAM_IDLE_MS: "8000", MERIDIAN_UPSTREAM_TOOL_INPUT_IDLE_MS: "12000",
  ...(EAGER ? { CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING: "1" } : {}),
  ...(process.env.E2E_CLAUDE_PATH ? { MERIDIAN_CLAUDE_PATH: resolve(process.env.E2E_CLAUDE_PATH) } : {}),
})

const textOf = content => typeof content === "string" ? content
  : Array.isArray(content) ? content.map(block => block?.type === "text" ? block.text ?? "" : block?.type === "tool_result" ? textOf(block.content) : "").join("\n") : ""
const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")
const messageStart = model => ({ type: "message_start", message: { id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`, type: "message", role: "assistant", content: [], model,
  stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } })
const REPORT = { file_path: "report.md", content: `# Report\n${"A finding, with its evidence.\n".repeat(40)}` }
const REPORT_JSON = JSON.stringify(REPORT)

const seenTools = []
let served = false
const startedAt = Date.now()
const at = () => Date.now() - startedAt
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
  const body = await request.json()
  const asked = textOf(body.messages?.find(message => message.role === "user")?.content)
  const write = (body.tools ?? []).find(tool => typeof tool.name === "string" && tool.name.endsWith("Write"))
  if (write) seenTools.push({ name: write.name, eager: write.eager_input_streaming === true })
  const encoder = new TextEncoder()
  const send = (controller, events) => controller.enqueue(encoder.encode(sse(events)))
  if (asked.includes("WRITE-REPORT") && write && !served) {
    served = true
    const eager = write.eager_input_streaming === true
    return new Response(new ReadableStream({ async start(controller) {
      send(controller, [messageStart(body.model),
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_report", name: write.name, input: {} } }])
      const step = Math.ceil(REPORT_JSON.length / PIECES)
      for (let piece = 0; piece < PIECES; piece++) {
        await Bun.sleep(WRITE_SECONDS * 1_000 / PIECES)
        send(controller, eager
          ? [{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: REPORT_JSON.slice(piece * step, (piece + 1) * step) } }]
          : [{ type: "ping" }])
      }
      send(controller, [
        ...(eager ? [] : [{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: REPORT_JSON } }]),
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 400 } },
        { type: "message_stop" },
      ])
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

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

try {
  console.log(`A Write written over ${WRITE_SECONDS} s, ${MODEL}, turn limit 8 s, tool-input limit 12 s, CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING ${EAGER ? "=1" : "unset"}`)
  const response = await fetch(`${proxyUrl}/v1/messages`, {
    method: "POST", headers: claudeCode, signal: AbortSignal.timeout((WRITE_SECONDS + 120) * 1_000),
    body: JSON.stringify({ model: MODEL, max_tokens: 2_000, stream: true, tools: [WRITE_TOOL],
      metadata: { user_id: JSON.stringify({ session_id: randomUUID() }) }, messages: [{ role: "user", content: "WRITE-REPORT write the report to report.md" }] }),
  })
  const pieces = []
  let input = ""
  const text = await response.text()
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue
    const event = JSON.parse(line.slice(5))
    if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
      pieces.push(at())
      input += event.delta.partial_json
    }
  }
  console.log(`  note  HTTP ${response.status}, done at ${(at() / 1000).toFixed(1)} s; the API saw the Write tool as ${seenTools.map(tool => `${tool.name}${tool.eager ? " (eager)" : ""}`).join(", ") || "nothing"}`)
  check(seenTools.length > 0 && seenTools.every(tool => tool.eager), "the CLI marks the passthrough Write tool eager_input_streaming",
    seenTools.map(tool => `${tool.name}: ${tool.eager}`).join(", "))
  check(response.status === 200 && !text.includes("upstream_timeout"), "the call is not answered \"Upstream stalled\"",
    text.includes("upstream_timeout") ? text.match(/Upstream stalled[^"]*/)?.[0] : undefined)
  check(input === REPORT_JSON, "the client gets the whole call", `${input.length} of ${REPORT_JSON.length} characters of input`)
  check(pieces.length > 1, "the input reaches the client in pieces as it is written", `${pieces.length} piece(s)`)
} finally {
  await proxy.close?.()
  upstream.stop(true)
  rmSync(root, { recursive: true, force: true })
}
console.log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
