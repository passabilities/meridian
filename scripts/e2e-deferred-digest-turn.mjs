#!/usr/bin/env bun
/**
 * Real SDK/CLI + local API: a passthrough turn whose budget is lifted past one
 * turn (deferred tools) must stop at the tool boundary instead of paying for
 * the digest turn.
 *
 * With deferred tools the one-turn cap is lifted so ToolSearch discovery can
 * take a turn (#598, #860, #1367). Once the model has called a client tool and the
 * PreToolUse hook has denied it, the CLI used to start another model request
 * to digest the denial. The proxy discards that turn's output, but the request
 * is real: it carries the whole prompt again, and its usage was added to what
 * the client and the proxy's telemetry are told the turn cost.
 *
 * Claims, per transport (`--stream` or not):
 *   1. The client receives exactly the forwarded tool_use, stop_reason tool_use.
 *   2. The CLI sends no model request after the forwarded batch.
 *   3. Neither the response nor the proxy's telemetry counts a digest turn.
 *   4. The next request resumes the same SDK session at the tool checkpoint,
 *      and the model sees the client's real tool_result and not the denial.
 *
 * No subscription or model is involved: the CLI talks to a local fixture.
 *
 *   bun scripts/e2e-deferred-digest-turn.mjs [--stream]
 */
import assert from "node:assert/strict"
import { mkdtempSync, realpathSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"

const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-digest-")))
const stream = process.argv.includes("--stream")
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, { MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_WORKDIR: root, MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0" })

// Each kind of model request reports its own decimal digit of input usage, so
// any sum of them shows which kinds it counted. A digest turn is the tens digit.
const INPUT_TOKENS = { client: 100, digest: 10, followup: 1 }
const includesDigest = (inputTokens) => Math.floor(inputTokens / INPUT_TOKENS.digest) % 10 !== 0
const receipt = `RECEIPT-${randomUUID()}`
const toolId = "toolu_digest_read"
const tool = { name: "read_fixture", description: "Read synthetic data without side effects", input_schema: { type: "object", properties: {} } }
const deferredTool = { name: "aux_fixture", description: "Unused deferred fixture tool", input_schema: { type: "object", properties: {} }, defer_loading: true }
let phase = "handoff"
const calls = { handoff: [], followup: [] }
const upstreamErrors = []

function sse(kind, block, stopReason) {
  const events = [{ type: "message_start", message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", content: [], model: "fixture",
    stop_reason: null, stop_sequence: null, usage: { input_tokens: INPUT_TOKENS[kind], output_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: block.type === "text" ? { type: "text", text: "" } : { ...block, input: {} } },
  { type: "content_block_delta", index: 0, delta: block.type === "text" ? { type: "text_delta", text: block.text } : { type: "input_json_delta", partial_json: JSON.stringify(block.input) } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 10 } },
  { type: "message_stop" }]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream", "request-id": `req_${randomUUID()}` } })
}

const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  try {
    if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: INPUT_TOKENS.client })
    const body = await request.json()
    const registered = (body.tools ?? []).map(candidate => candidate.name).find(name => name.endsWith(`__${tool.name}`))
    if (!registered) return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    const history = JSON.stringify(body.messages)
    calls[phase].push({ sawDenial: history.includes("forwarded to the client") })
    if (phase === "followup") return sse("followup", { type: "text", text: history.includes(receipt) ? receipt : "NO RECEIPT" }, "end_turn")
    if (calls.handoff.length === 1) return sse("client", { type: "tool_use", id: toolId, name: registered, input: {} }, "tool_use")
    return sse("digest", { type: "text", text: "DIGEST" }, "end_turn")
  } catch (error) {
    upstreamErrors.push(String(error))
    return new Response(String(error), { status: 500 })
  }
} })

const queries = []
const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  queries.push({ phase, maxTurns: input.options?.maxTurns, sessionId: input.options?.sessionId, resume: input.options?.resume,
    resumeSessionAt: input.options?.resumeSessionAt })
  return realQuery(input)
})
const { startProxyServer } = await import("../src/proxy/server.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: [{ id: "fixture", type: "api", apiKey: "local-test-key", baseUrl: `http://127.0.0.1:${upstream.port}` }],
})
const address = proxy.server.address()
assert(address && typeof address === "object")

async function request(messages) {
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-opencode-session": `digest-${stream}` },
    body: JSON.stringify({ model: "haiku", stream, max_tokens: 256, tools: [tool, deferredTool], messages }), signal: AbortSignal.timeout(120_000),
  })
  const raw = await response.text()
  if (!stream) {
    const body = JSON.parse(raw)
    return { status: response.status, raw, content: body.content ?? [], stop: body.stop_reason, usage: body.usage }
  }
  const events = raw.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)))
  const content = []
  for (const event of events) {
    if (event.type === "content_block_start") content[event.index] = { ...event.content_block, json: "" }
    if (event.delta?.type === "text_delta") content[event.index].text += event.delta.text
    if (event.delta?.type === "input_json_delta") content[event.index].json += event.delta.partial_json
  }
  const usage = { ...events.find(event => event.type === "message_start")?.message.usage, ...events.findLast(event => event.type === "message_delta")?.usage }
  return { status: response.status, raw, content: content.filter(Boolean).map(({ json, ...block }) => block),
    stop: events.findLast(event => event.type === "message_delta")?.delta.stop_reason, usage }
}

try {
  const messages = [{ role: "user", content: "Read the synthetic fixture and report its receipt." }]
  const handoff = await request(messages)
  assert.equal(handoff.status, 200, handoff.raw)
  const telemetry = await (await fetch(`http://127.0.0.1:${address.port}/telemetry/requests?limit=10`)).json()
  const recorded = telemetry.find(row => row.status === 200)
  assert.equal(queries[0].maxTurns, 4, "Deferred tools no longer lift the one-turn cap; this probe no longer exercises the lifted budget")
  assert.equal(handoff.stop, "tool_use", handoff.raw)
  assert.deepEqual(handoff.content.map(block => block.type === "tool_use" ? `tool_use:${block.name}` : block.type), [`tool_use:${tool.name}`], handoff.raw)
  assert.equal(calls.handoff.length, 1, "The CLI sent a model request after the forwarded tool batch (digest turn)")
  assert(!includesDigest(handoff.usage.input_tokens), `The response reports a digest turn's usage: ${handoff.usage.input_tokens}`)
  assert(recorded, JSON.stringify(telemetry))
  assert(!includesDigest(recorded.inputTokens), `Telemetry records a digest turn's usage: ${recorded.inputTokens}`)

  phase = "followup"
  const followup = await request([...messages, { role: "assistant", content: handoff.content },
    { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: receipt }] }])
  assert.equal(followup.status, 200, followup.raw)
  assert.equal(followup.stop, "end_turn", followup.raw)
  assert.equal(followup.content.filter(block => block.type === "text").map(block => block.text).join(""), receipt)
  const last = queries.at(-1)
  assert.equal(last.resume, queries[0].sessionId, "Follow-up did not resume the handoff session")
  assert(last.resumeSessionAt, "Follow-up did not resume at the tool checkpoint")
  assert(calls.followup.every(call => !call.sawDenial), "The proxy's denial leaked into the resumed history")
  assert.deepEqual(upstreamErrors, [])
  console.log(JSON.stringify({ result: "PASS", stream, handoffCalls: calls.handoff.length, responseInput: handoff.usage.input_tokens,
    telemetryInput: recorded.inputTokens, root }))
} finally {
  await proxy.close()
  await upstream.stop(true)
  observer.mockRestore()
}
