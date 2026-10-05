#!/usr/bin/env bun
// Real proxy + real SDK + real CLI against a scripted Messages API: no model
// calls. What does one tool turn cost upstream when the client's tool set is
// "deferred" (a `defer_loading` tool, or auto-defer past the threshold)?
//
// Measured on a live proxy 2026-10-05 (Claude Code; two sessions with 199 and
// 215 tools, 195 and 211 of them counted as deferred): 42 of 45 tool turns made
// 2-8 Messages calls each, every one at the session's full context, and the
// extra calls re-read 29.3M of the 85.5M tokens the proxy spent that morning.
// The turn cap that stops the SDK at the tool boundary was lifted for deferred
// tools, to leave a turn for ToolSearch discovery. But passthrough strips the
// SDK's built-in tools (`tools: []`) and ToolSearch is one of them, so the CLI
// never offers it and sends every tool loaded: the 323 tool calls in that
// proxy's SDK transcripts included no ToolSearch, and every one of the extra
// calls was discarded.
//
// Claims, per mode (non-stream and stream) and per shape (one call; two
// parallel calls, one of them to the "deferred" tool):
//
//   PREMISE  the CLI's request declares every client tool loaded and no
//            ToolSearch. If this ever fails, deferral has become real, a
//            discovery turn exists again, and the cap below is no longer safe
//            as it stands: revisit computePassthroughMaxTurns before touching
//            this assertion.
//   1. the turn is asked with maxTurns 1 and costs exactly ONE Messages call;
//   2. it ends in the SDK's canonical error_max_turns result, which is what
//      commits the transcript;
//   3. the client receives exactly the forwarded calls under its own names;
//   4. the follow-up resumes that session at the tool boundary, delivers the
//      client's real results as structured tool_result blocks, and costs one
//      Messages call.
//
//   bun scripts/e2e-deferred-tool-turn.mjs
//
// E2E_CLAUDE_PATH picks the CLI the SDK drives. Without it the proxy resolves
// one as it does in service (`claude` on PATH, then the packaged binary), which
// under bare `bun` is not necessarily the checkout's own: `npm run start` puts
// node_modules/.bin first on PATH, so pass that path to match a working proxy.
// The version seen on the wire is printed either way.
import assert from "node:assert/strict"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"

const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-deferred-turn-")))
const claudePath = process.env.E2E_CLAUDE_PATH ? resolve(process.env.E2E_CLAUDE_PATH) : undefined
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_WORKDIR: root, MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0",
  // The fixture profile authenticates with an API key, so the SDK child needs
  // nothing from the user's own Claude config; its transcripts stay under root.
  CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  ...(claudePath ? { MERIDIAN_CLAUDE_PATH: claudePath } : {}),
})

const loadedTool = { name: "read_fixture", description: "Read synthetic data without side effects", input_schema: { type: "object", properties: {} } }
const deferredTool = { name: "aux_fixture", description: "Auxiliary synthetic data, declared deferred by the client", input_schema: { type: "object", properties: {} }, defer_loading: true }
const clientTools = [loadedTool, deferredTool]

// One entry per query the proxy starts; the CLI forwards its key on every
// Messages call, so calls are counted per query, not per process.
let current = { run: "none", phase: "turn" }
let queryCount = 0
const queries = []
const results = []
const upstreamCalls = []
const upstreamErrors = []
let cliVersion

function sse(blocks, stopReason) {
  const events = [{ type: "message_start", message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", content: [], model: "claude-sonnet-5",
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } }]
  for (const [index, block] of blocks.entries()) {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } },
        { type: "content_block_stop", index })
    } else {
      events.push({ type: "content_block_start", index, content_block: { ...block, input: {} } },
        { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } },
        { type: "content_block_stop", index })
    }
  }
  events.push({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } }, { type: "message_stop" })
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream", "request-id": `deferred-turn-${upstreamCalls.length}` } })
}

const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  try {
    if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
    const body = await request.json()
    const names = (body.tools ?? []).map(tool => tool.name)
    const registered = tool => names.find(name => name.endsWith(tool.name))
    // The CLI's own side calls (titles, quota) carry no client tool.
    if (!registered(loadedTool)) return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    cliVersion ??= JSON.stringify(body.system ?? "").match(/cc_version=([0-9.]+[0-9])/)?.[1]
    const key = request.headers.get("x-gate-query")
    assert(key, "CLI did not forward the gate's query identity")
    const [run, phase] = key.split("|")
    const call = upstreamCalls.filter(row => row.key === key).length + 1
    const row = { key, run, phase, call, tools: body.tools ?? [], mentionsToolSearch: JSON.stringify(body).includes("ToolSearch"),
      toolResults: body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === "tool_result") : []) }
    upstreamCalls.push(row)
    if (phase === "followup") return sse([{ type: "text", text: "FOLLOWUP-DONE" }], "end_turn")
    if (call === 1) {
      const blocks = [{ type: "tool_use", id: `toolu_${run}_read`, name: registered(loadedTool), input: {} }]
      if (run.startsWith("parallel")) blocks.push({ type: "tool_use", id: `toolu_${run}_aux`, name: registered(deferredTool), input: {} })
      return sse(blocks, "tool_use")
    }
    // Anything past the first call is the SDK digesting the proxy's deny: the
    // turn this gate exists to prove is never requested.
    return sse([{ type: "text", text: "DIGEST" }], "end_turn")
  } catch (error) {
    upstreamErrors.push(String(error?.stack ?? error))
    return new Response(String(error), { status: 500 })
  }
} })

const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  const key = `${current.run}|${current.phase}|${++queryCount}`
  queries.push({ key, run: current.run, phase: current.phase, maxTurns: input.options?.maxTurns, sessionId: input.options?.sessionId,
    resume: input.options?.resume, resumeSessionAt: input.options?.resumeSessionAt, sdkTools: input.options?.tools })
  const actual = realQuery({ ...input, options: { ...input.options,
    env: { ...input.options?.env, ANTHROPIC_CUSTOM_HEADERS: `x-gate-query: ${key}` } } })
  return new Proxy(actual, { get(target, property) {
    if (property === Symbol.asyncIterator) return async function* () {
      for await (const message of actual) {
        if (message.type === "result") results.push({ key, subtype: message.subtype })
        yield message
      }
    }
    const value = Reflect.get(target, property, target)
    return typeof value === "function" ? value.bind(target) : value
  } })
})

const { startProxyServer } = await import("../src/proxy/server.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: [{ id: "fixture", type: "api", apiKey: "local-test-key", baseUrl: `http://127.0.0.1:${upstream.port}` }] })
const address = proxy.server.address()
assert(address && typeof address === "object")

async function request(run, stream, messages) {
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-opencode-session": `deferred-turn-${run}` },
    body: JSON.stringify({ model: "sonnet", stream, max_tokens: 256, tools: clientTools, messages }), signal: AbortSignal.timeout(120_000),
  })
  const raw = await response.text()
  assert.equal(response.status, 200, raw)
  const content = stream ? [] : JSON.parse(raw).content ?? []
  const events = stream ? raw.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5))) : []
  assert(!events.some(event => event.type === "error"), raw)
  for (const event of events) {
    if (event.type === "content_block_start") content[event.index] = { ...event.content_block, json: "" }
    if (event.delta?.type === "text_delta") content[event.index].text += event.delta.text
    if (event.delta?.type === "input_json_delta") content[event.index].json += event.delta.partial_json
    if (event.type === "content_block_stop" && content[event.index]?.type === "tool_use") content[event.index].input = JSON.parse(content[event.index].json || "{}")
  }
  if (stream) assert.equal(events.filter(event => event.type === "message_stop").length, 1, raw)
  const stop = stream ? events.findLast(event => event.type === "message_delta")?.delta.stop_reason : JSON.parse(raw).stop_reason
  return { content: content.filter(Boolean).map(({ json, ...block }) => block), stop }
}

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

async function runCase(shape, stream) {
  const run = `${shape}-${stream ? "stream" : "nonstream"}`
  console.log(`\n=== ${shape} tool turn, ${stream ? "stream" : "non-stream"} ===`)
  const expected = shape === "parallel" ? [loadedTool.name, deferredTool.name] : [loadedTool.name]
  const messages = [{ role: "user", content: "Read the synthetic fixture and report its receipt." }]

  current = { run, phase: "turn" }
  const turn = await request(run, stream, messages)
  const turnQueries = queries.filter(query => query.run === run && query.phase === "turn")
  const turnCalls = upstreamCalls.filter(row => row.run === run && row.phase === "turn")
  const first = turnCalls[0]
  check(turnQueries.length === 1, "the turn is one SDK query", `${turnQueries.length}`)

  const declared = (first?.tools ?? []).map(tool => `${tool.name}${tool.defer_loading ? "(deferred)" : ""}`)
  check(
    first !== undefined && !first.mentionsToolSearch && first.tools.every(tool => tool.defer_loading !== true) &&
      clientTools.every(tool => first.tools.some(sent => sent.name.endsWith(tool.name))),
    "PREMISE: the CLI declares every client tool loaded and offers no ToolSearch",
    `sdk tools=${JSON.stringify(turnQueries[0]?.sdkTools)} upstream tools=${declared.join(",")}`,
  )
  check(turnQueries[0]?.maxTurns === 1, "the turn is asked with maxTurns 1", `maxTurns=${turnQueries[0]?.maxTurns}`)
  check(turnCalls.length === 1, "the tool turn costs one Messages call", `${turnCalls.length} call(s)`)
  const turnResult = results.find(result => result.key === turnQueries[0]?.key)
  check(turnResult?.subtype === "error_max_turns", "the SDK ends on its canonical error_max_turns result", `subtype=${turnResult?.subtype}`)
  const forwarded = turn.content.filter(block => block.type === "tool_use")
  check(turn.stop === "tool_use" && forwarded.length === expected.length && expected.every(name => forwarded.some(block => block.name === name)) &&
      turn.content.every(block => block.type === "tool_use"),
    "the client receives exactly the forwarded calls under its own names",
    `stop=${turn.stop} content=${turn.content.map(block => block.type === "tool_use" ? block.name : `${block.type}:${block.text ?? ""}`).join(",")}`)

  current = { run, phase: "followup" }
  const receipt = `RECEIPT-${randomUUID()}`
  const followup = await request(run, stream, [...messages, { role: "assistant", content: turn.content },
    { role: "user", content: forwarded.map(block => ({ type: "tool_result", tool_use_id: block.id, content: `${receipt}:${block.name}` })) }])
  const followupQueries = queries.filter(query => query.run === run && query.phase === "followup")
  const followupCalls = upstreamCalls.filter(row => row.run === run && row.phase === "followup")
  check(followupQueries.length === 1 && followupQueries[0].resume === turnQueries[0]?.sessionId && typeof followupQueries[0].resumeSessionAt === "string",
    "the follow-up resumes the capped session at the tool boundary",
    `resume=${followupQueries[0]?.resume === turnQueries[0]?.sessionId} resumeSessionAt=${Boolean(followupQueries[0]?.resumeSessionAt)}`)
  const delivered = followupCalls[0]?.toolResults ?? []
  check(forwarded.length > 0 && forwarded.every(block => delivered.some(result => result.tool_use_id === block.id && JSON.stringify(result.content).includes(`${receipt}:${block.name}`))) &&
      !delivered.some(result => JSON.stringify(result.content).includes("forwarded to the client")),
    "the model sees the client's real results and no leftover deny",
    `${delivered.length} tool_result block(s)`)
  check(followupCalls.length === 1 && followup.stop === "end_turn" && followup.content.map(block => block.text).join("") === "FOLLOWUP-DONE",
    "the follow-up answers in one Messages call", `${followupCalls.length} call(s), stop=${followup.stop}`)
}

try {
  for (const stream of [false, true]) {
    for (const shape of ["single", "parallel"]) await runCase(shape, stream)
  }
  assert.deepEqual(upstreamErrors, [])
} finally {
  await proxy.close()
  await upstream.stop(true)
  observer.mockRestore()
}
console.log(`\nCLI on the wire: cc_version=${cliVersion ?? "unknown"} (${claudePath ?? "resolved by the proxy"})`)
// A failed run keeps its sessions and transcripts for inspection.
if (failures.length === 0) rmSync(root, { recursive: true, force: true })
console.log(JSON.stringify({ result: failures.length === 0 ? "PASS" : "FAIL", failures, ...(failures.length === 0 ? {} : { root }),
  callsPerQuery: Object.fromEntries(queries.map(query => [query.key, upstreamCalls.filter(row => row.key === query.key).length])) }))
process.exit(failures.length === 0 ? 0 : 1)
