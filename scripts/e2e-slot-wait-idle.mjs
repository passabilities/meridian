#!/usr/bin/env bun
// Does a stream's upstream idle limit run while the request waits for an SDK
// slot? The real proxy, SDK and CLI against a scripted Messages API, one
// API-key account, one SDK slot (MERIDIAN_MAX_CONCURRENT=1); no model calls.
//
// A Claude Code turn holds the slot for HOLD seconds (default 25), streaming a
// word a second, so it never stalls. Queued behind it come a subagent's
// progress summary, a side call under a 10 s limit, and another
// conversation's streamed turn under a 15 s one. Each waits longer than its
// limit for the slot, asking the model nothing in that time, and is answered
// once it has the slot. Under an orchestrator every slot can be held by
// subagents' turns this way: in 15 minutes a live proxy answered 128 streamed
// requests "Upstream stalled", 107 of them subagents' new sessions cut at their
// limit with nothing from the model, while answered requests waited a median
// 40 s for a slot (2026-10-06).
//
// The gate holds that neither queued request is answered "Upstream stalled",
// and that no request whose client was already given an error goes on to ask
// the model.
//
//   bun scripts/e2e-slot-wait-idle.mjs [model]
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const MODEL = process.argv[2] ?? "claude-sonnet-5-5"
const HOLD = Number(process.env.HOLD ?? 25)
const SIDE_LIMIT_MS = 10_000
const TURN_LIMIT_MS = 15_000
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-slot-wait-")))
const work = join(root, "work")
mkdirSync(work)

for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
// Set before the proxy is loaded: the turn limit is read once, at load.
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_PASSTHROUGH: "1", CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  MERIDIAN_MAX_CONCURRENT: "1",
  MERIDIAN_UPSTREAM_AUXILIARY_IDLE_MS: String(SIDE_LIMIT_MS), MERIDIAN_UPSTREAM_IDLE_MS: String(TURN_LIMIT_MS),
  ...(process.env.E2E_CLAUDE_PATH ? { MERIDIAN_CLAUDE_PATH: resolve(process.env.E2E_CLAUDE_PATH) } : {}),
})

const textOf = content => typeof content === "string" ? content
  : Array.isArray(content) ? content.map(block => block?.type === "text" ? block.text ?? "" : block?.type === "tool_result" ? textOf(block.content) : "").join("\n") : ""
const SUMMARY_PROMPT = "Describe your most recent action in 3-5 words using present tense (-ing)."
const kindOf = body => {
  const asked = textOf(body.messages?.findLast(message => message.role === "user")?.content)
  return asked.includes("HOLD-TURN") ? "holder" : asked.includes(SUMMARY_PROMPT) ? "summary" : asked.includes("QUEUED-TURN") ? "queued turn" : "other"
}

const sse = events => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")
const opening = model => [
  { type: "message_start", message: { id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`, type: "message", role: "assistant", content: [], model,
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
]
const closing = [
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } },
  { type: "message_stop" },
]

// The scripted model: the holder streams a word a second; the others answer at once.
const asked = []
const startedAt = Date.now()
const at = () => Date.now() - startedAt
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
  const body = await request.json()
  const kind = kindOf(body)
  asked.push({ kind, at: at() })
  if (kind !== "holder") {
    const answer = kind === "summary" ? "Reading b.ts" : `ANSWERED-${kind.toUpperCase().replace(" ", "-")}`
    return new Response(sse([...opening(body.model), { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: answer } }, ...closing]),
      { headers: { "content-type": "text/event-stream" } })
  }
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({ async start(controller) {
    controller.enqueue(encoder.encode(sse(opening(body.model))))
    for (let word = 1; word <= HOLD; word++) {
      await Bun.sleep(1_000)
      controller.enqueue(encoder.encode(sse([{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `word${word} ` } }])))
    }
    controller.enqueue(encoder.encode(sse(closing)))
    controller.close()
  } }), { headers: { "content-type": "text/event-stream" } })
} })

const { startProxyServer } = await import("../src/proxy/server.ts")
const { telemetryStore } = await import("../src/telemetry/index.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: [{ id: "fixture", type: "api", apiKey: "local-test-key", baseUrl: `http://127.0.0.1:${upstream.port}` }] })
const address = proxy.server.address()
assert(address && typeof address === "object")
const proxyUrl = `http://127.0.0.1:${address.port}`

const claudeCode = { "content-type": "application/json", "user-agent": "claude-cli/2.1.291 (external, cli)" }
const sessionOf = id => ({ user_id: JSON.stringify({ session_id: id }) })
/** Send a streamed request; resolve with what the client read and when it was done. */
async function streamed(label, headers, body) {
  const requestId = randomUUID()
  const response = await fetch(`${proxyUrl}/v1/messages`, {
    method: "POST", headers: { ...headers, "x-request-id": requestId }, body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(240_000),
  })
  const text = await response.text()
  return { label, requestId, status: response.status, text, doneAt: at() }
}

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

try {
  console.log(`Slot wait and the idle limit, ${MODEL}, one SDK slot, side-call limit ${SIDE_LIMIT_MS / 1000} s, turn limit ${TURN_LIMIT_MS / 1000} s, holder ${HOLD} s`)
  const holder = streamed("holder", claudeCode, { model: MODEL, max_tokens: 200, metadata: sessionOf(randomUUID()),
    messages: [{ role: "user", content: "HOLD-TURN stream for a while" }] })
  // Queued once the holder has the slot.
  for (let waited = 0; !asked.some(entry => entry.kind === "holder"); waited += 100) {
    if (waited > 60_000) throw new Error("the holder never reached the API")
    await Bun.sleep(100)
  }
  const summary = streamed("summary", { ...claudeCode, "x-claude-code-agent-id": "a4a81dc1bbf7ee837" }, {
    model: MODEL, max_tokens: 128, metadata: sessionOf(randomUUID()),
    tools: [{ name: "Read", description: "Read a file", input_schema: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } }],
    messages: [
      { role: "user", content: "Read b.ts" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_read_b", name: "Read", input: { file_path: "b.ts" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_read_b", content: "export const b = 2" },
        { type: "text", text: `${SUMMARY_PROMPT} Name the file or function, not the branch. Do not use tools.` }] },
    ],
  })
  await Bun.sleep(500)
  const queuedTurn = streamed("queued turn", claudeCode, { model: MODEL, max_tokens: 200, metadata: sessionOf(randomUUID()),
    messages: [{ role: "user", content: "QUEUED-TURN answer once you can" }] })
  const results = await Promise.all([holder, summary, queuedTurn])

  const rows = telemetryStore.getRecent({ limit: 100 })
  const rowOf = result => rows.find(row => row.requestId === result.requestId)
  for (const result of results) {
    const row = rowOf(result)
    const stalled = result.text.includes("upstream_timeout")
    console.log(`  note  ${result.label}: HTTP ${result.status}, ${stalled ? "Upstream stalled" : "answered"}, done at ${(result.doneAt / 1000).toFixed(1)} s, `
      + `waited ${row ? (row.sdkQueueWaitMs / 1000).toFixed(1) : "?"} s for the slot`)
  }
  console.log(`  note  the API was asked: ${asked.map(entry => `${entry.kind} at ${(entry.at / 1000).toFixed(1)} s`).join(", ")}`)
  const [held, side, turn] = results
  check(held.status === 200 && held.text.includes(`word${HOLD}`) && !held.text.includes("upstream_timeout"), "the holder streams to the end")
  const waitedPast = (result, limit) => (rowOf(result)?.sdkQueueWaitMs ?? 0) > limit
  check(waitedPast(side, SIDE_LIMIT_MS) && waitedPast(turn, TURN_LIMIT_MS), "each queued request waits for the slot longer than its limit",
    `summary ${(rowOf(side)?.sdkQueueWaitMs ?? 0) / 1000} s, turn ${(rowOf(turn)?.sdkQueueWaitMs ?? 0) / 1000} s`)
  check(!side.text.includes("upstream_timeout") && side.text.includes("Reading b.ts"), "the progress summary is answered, not \"Upstream stalled\"",
    side.text.replace(/\s+/g, " ").slice(-160))
  check(!turn.text.includes("upstream_timeout") && turn.text.includes("ANSWERED-QUEUED-TURN"), "the queued turn is answered, not \"Upstream stalled\"",
    turn.text.replace(/\s+/g, " ").slice(-160))
  const askedAfterFailing = results.filter(result => result.text.includes("upstream_timeout")
    && asked.some(entry => entry.kind === result.label && entry.at >= result.doneAt))
  check(askedAfterFailing.length === 0, "no request the client was given an error for asks the model afterwards",
    askedAfterFailing.map(result => result.label).join(", ") || "none")
} finally {
  await proxy.close?.()
  upstream.stop(true)
  rmSync(root, { recursive: true, force: true })
}
console.log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
