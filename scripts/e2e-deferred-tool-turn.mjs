#!/usr/bin/env bun
// Real proxy + real SDK + real CLI against a scripted Messages API: no model
// calls. What does a tool turn cost upstream when the client's tool set is
// deferred (a `defer_loading` tool, or auto-defer past the threshold), and are
// the deferred tools really out of the prompt?
//
// Two things were wrong here, both measured on a live proxy on 2026-10-05 (two
// Claude Code sessions with 199 and 215 tools). The turn cap was lifted for
// such sessions to leave a turn for ToolSearch, so 42 of 45 tool turns made 2-8
// Messages calls, every one at the session's full context. And the deferral
// itself did nothing: passthrough strips the SDK's built-in tools, ToolSearch
// among them, so the CLI sent every tool loaded, about 134K tokens of
// definitions on every call. The first is fixed by holding those sessions to
// the cap; the second by offering ToolSearch and ending the query at the
// PreToolUse deny instead (src/proxy/passthroughToolSearch.ts).
//
// That second fix depends on the CLI honouring `continue: false` beside a deny.
// 2.1.284 and 2.1.289 do. 2.1.141, which Agent SDK 0.2.141 bundles, does not,
// and the proxy then falls back to the first fix alone. This gate finds out
// which CLI it is driving from the first tool turn and holds that mode's
// claims:
//
// DEFERRAL (the CLI stops when asked), stream and non-stream:
//   direct    one call to a loaded tool: ToolSearch on offer, the deferred
//             tools absent from the request and named in the system prompt,
//             ONE Messages call, the follow-up resumes at the call;
//   parallel  two calls in one message: still one Messages call, both forwarded;
//   search    ToolSearch, then the tool it loaded beside a loaded one: two
//             Messages calls, the client sees no ToolSearch, and the loaded
//             tool is still loaded after the resume;
//   mixed     ToolSearch ahead of a client call in ONE message: the ToolSearch
//             result is back in place on resume, not the CLI's placeholder;
//   mixedafter  the same with ToolSearch AFTER the client call: the resume
//             point cuts that call off, and its result is not sent alone;
//   bare      a call the CLI rejects before any hook is still handed to the
//             client, and is not taken for a CLI ignoring the stop;
//   retry     the same, with the model then repeating the call under its
//             registered name: the client gets one call, not two;
//   overrun   a model that only ever searches ends as `max_tokens`, not an
//             error, after exactly the budget's Messages calls, and with no
//             text the model did not write;
//   haiku     the same as direct on Haiku 4.5, which the CLI gives tool search
//             (only Claude 3 models go without);
//   unvouched  an upstream that is not Anthropic's own keeps every tool loaded
//             and the one-turn cap, until the operator vouches for it. The
//             scripted API is one: the rest of the gate runs under
//             MERIDIAN_PASSTHROUGH_TOOL_SEARCH=force.
//
// FALLBACK (the CLI calls the model again after the stop):
//   the first tool turn still reaches the client, at the price of the digest;
//   from then on a deferred-tools session has every tool loaded, no ToolSearch,
//   maxTurns 1, and each tool turn is ONE Messages call ending in the SDK's
//   error_max_turns result.
//
//   bun scripts/e2e-deferred-tool-turn.mjs
//
// E2E_CLAUDE_PATH picks the CLI the SDK drives. Without it the proxy resolves
// one as it does in service (`claude` on PATH, then the packaged binary), which
// under bare `bun` is not necessarily the checkout's own: `npm run start` puts
// node_modules/.bin first on PATH, so pass that path to match a working proxy.
// `E2E_CLAUDE_PATH=sdk-bundled` is the binary the Agent SDK package ships for
// this platform. E2E_EXPECT=deferral|fallback fails the run if the CLI lands in
// the other mode; CI sets it for the CLI the proxy resolves, and runs the
// SDK's bundled one beside it in whichever mode that is. The version seen on
// the wire is printed either way. E2E_SHAPES=mixed,mixedafter narrows the
// first group of deferral shapes while working on one.
//
// The scripted API also refuses what the real one does and a stand-in would
// wave through: every request must pair each tool_use with a tool_result and
// the other way round.
import assert from "node:assert/strict"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"

function sdkBundledCli() {
  const manifest = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
  return join(dirname(manifest), process.platform === "win32" ? "claude.exe" : "claude")
}

const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-deferred-turn-")))
const claudePath = process.env.E2E_CLAUDE_PATH === "sdk-bundled" ? sdkBundledCli()
  : process.env.E2E_CLAUDE_PATH ? resolve(process.env.E2E_CLAUDE_PATH) : undefined
const expectedMode = process.env.E2E_EXPECT
assert(!expectedMode || expectedMode === "deferral" || expectedMode === "fallback", `E2E_EXPECT=${expectedMode}`)
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_WORKDIR: root, MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0",
  // The scripted API is a base URL that is not Anthropic's own, where deferral
  // stays off unless the operator says the upstream forwards tool_reference
  // blocks. This one does.
  MERIDIAN_PASSTHROUGH_TOOL_SEARCH: "force",
  // The fixture profile authenticates with an API key, so the SDK child needs
  // nothing from the user's own Claude config; its transcripts stay under root.
  CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  ...(claudePath ? { MERIDIAN_CLAUDE_PATH: claudePath } : {}),
})

const tool = (name, description, deferred) => ({ name, description, input_schema: { type: "object", properties: {} }, ...(deferred ? { defer_loading: true } : {}) })
const readTool = tool("read_fixture", "Read synthetic data without side effects")
const listTool = tool("list_fixture", "List synthetic data without side effects")
const auxTool = tool("aux_fixture", "Auxiliary synthetic data, declared deferred by the client", true)
const extraTool = tool("extra_fixture", "More synthetic data, declared deferred by the client", true)
const clientTools = [readTool, listTool, auxTool, extraTool]
const deferredTools = [auxTool, extraTool]

// One entry per query the proxy starts; the CLI forwards its key on every
// Messages call, so calls are counted per query, not per process.
let current = { run: "none", phase: "turn" }
let queryCount = 0
const queries = []
const results = []
const upstreamCalls = []
const upstreamErrors = []
const pairingErrors = []
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

/**
 * What the API refuses with a 400 and this scripted one would otherwise wave
 * through: a tool_result with no tool_use in the assistant message before it,
 * and a tool_use the next message does not answer.
 */
function unpaired(messages) {
  const blocksOf = (message, type) => Array.isArray(message?.content) ? message.content.filter(block => block.type === type) : []
  const problems = []
  for (const [index, message] of messages.entries()) {
    if (message.role === "user") {
      const called = new Set(messages[index - 1]?.role === "assistant" ? blocksOf(messages[index - 1], "tool_use").map(block => block.id) : [])
      for (const result of blocksOf(message, "tool_result")) {
        if (!called.has(result.tool_use_id)) problems.push(`tool_result ${result.tool_use_id} answers no tool_use`)
      }
    } else if (message.role === "assistant" && index < messages.length - 1) {
      const answered = new Set(blocksOf(messages[index + 1], "tool_result").map(block => block.tool_use_id))
      for (const use of blocksOf(message, "tool_use")) {
        if (!answered.has(use.id)) problems.push(`tool_use ${use.id} (${use.name}) has no tool_result`)
      }
    }
  }
  return problems
}

/** What the scripted model answers, by the run's shape and the call's number. */
function scripted(shape, call, run, registered) {
  const call_ = (suffix, target) => ({ type: "tool_use", id: `toolu_${run}_${suffix}`, name: registered(target), input: {} })
  const search = (suffix, query) => ({ type: "tool_use", id: `toolu_${run}_${suffix}`, name: "ToolSearch", input: { query, max_results: 3 } })
  const digest = [{ type: "text", text: "DIGEST" }]
  if (shape === "overrun") return [search(`search${call}`, "synthetic data")]
  if (shape === "direct" || shape === "haiku" || shape === "unvouched") return call === 1 ? [call_("read", readTool)] : digest
  if (shape === "parallel") return call === 1 ? [call_("read", readTool), call_("list", listTool)] : digest
  if (shape === "search") {
    if (call === 1) return [{ type: "text", text: "Loading the tool." }, search("search", `select:${registered(auxTool)}`)]
    return call === 2 ? [call_("aux", auxTool), call_("read", readTool)] : digest
  }
  if (shape === "mixed") return call === 1 ? [search("search", `select:${registered(auxTool)}`), call_("read", readTool)] : digest
  if (shape === "mixedafter") return call === 1 ? [call_("read", readTool), search("search", `select:${registered(auxTool)}`)] : digest
  // The client's own name for the tool, without the namespace the SDK
  // registered it under: the CLI has no tool by that name.
  if (shape === "bare") return call === 1 ? [{ type: "tool_use", id: `toolu_${run}_aux`, name: auxTool.name, input: {} }] : digest
  // The same, and then what a model does next: the call again under the
  // name the SDK registered.
  if (shape === "retry") {
    if (call === 1) return [{ type: "tool_use", id: `toolu_${run}_aux`, name: auxTool.name, input: {} }]
    return call === 2 ? [call_("again", auxTool)] : digest
  }
  throw new Error(`no script for ${shape}`)
}

const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  try {
    if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
    const body = await request.json()
    const names = (body.tools ?? []).map(sent => sent.name)
    // A deferred tool the model has not loaded is not in the request at all.
    const registered = target => names.find(name => name.endsWith(target.name)) ?? `mcp__oc__${target.name}`
    // The CLI's own side calls (titles, quota) carry no client tool.
    if (!names.some(name => name.endsWith(readTool.name))) return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    cliVersion ??= JSON.stringify(body.system ?? "").match(/cc_version=([0-9.]+[0-9])/)?.[1]
    const key = request.headers.get("x-gate-query")
    assert(key, "CLI did not forward the gate's query identity")
    const [run, phase] = key.split("|")
    const call = upstreamCalls.filter(row => row.key === key).length + 1
    const row = { key, run, phase, call, tools: body.tools ?? [], system: JSON.stringify(body.system ?? ""),
      toolResults: body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === "tool_result") : []) }
    upstreamCalls.push(row)
    for (const problem of unpaired(body.messages)) pairingErrors.push(`${key} call ${call}: ${problem}`)
    if (phase === "followup") return sse([{ type: "text", text: "FOLLOWUP-DONE" }], "end_turn")
    const blocks = scripted(run.split("-")[0], call, run, registered)
    return sse(blocks, blocks.some(block => block.type === "tool_use") ? "tool_use" : "end_turn")
  } catch (error) {
    upstreamErrors.push(String(error?.stack ?? error))
    return new Response(String(error), { status: 500 })
  }
} })

const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  const key = `${current.run}|${current.phase}|${++queryCount}`
  const record = { key, run: current.run, phase: current.phase, maxTurns: input.options?.maxTurns, sessionId: input.options?.sessionId,
    resume: input.options?.resume, resumeSessionAt: input.options?.resumeSessionAt, sdkTools: input.options?.tools,
    executable: input.options?.pathToClaudeCodeExecutable, promptResults: [] }
  queries.push(record)
  // The tool results the proxy itself hands the SDK. The CLI repairs some of
  // what it is given before the API sees it, so the upstream alone cannot say.
  const prompt = typeof input.prompt === "string" ? input.prompt : (async function* () {
    for await (const message of input.prompt) {
      for (const block of Array.isArray(message?.message?.content) ? message.message.content : []) {
        if (block?.type === "tool_result") record.promptResults.push(block.tool_use_id)
      }
      yield message
    }
  })()
  const actual = realQuery({ ...input, prompt, options: { ...input.options,
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
const { TOOL_SEARCH_TURN_BUDGET, cliIgnoresStop } = await import("../src/proxy/passthroughToolSearch.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: [{ id: "fixture", type: "api", apiKey: "local-test-key", baseUrl: `http://127.0.0.1:${upstream.port}` }] })
const address = proxy.server.address()
assert(address && typeof address === "object")

async function request(run, stream, messages) {
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-opencode-session": `deferred-turn-${run}` },
    body: JSON.stringify({ model: run.startsWith("haiku") ? "haiku" : "sonnet", stream, max_tokens: 256, tools: clientTools, messages }), signal: AbortSignal.timeout(120_000),
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
const declared = row => (row?.tools ?? []).map(sent => `${sent.name}${sent.defer_loading ? "(deferred)" : ""}`).join(",")
const shown = turn => turn.content.map(block => block.type === "tool_use" ? block.name : `${block.type}:${block.text ?? ""}`).join(",")
const hasTool = (row, target) => (row?.tools ?? []).some(sent => sent.name.endsWith(target.name))
const prompt = "Read the synthetic fixture and report its receipt."

/** The turn, then the client's results for whatever it was handed. */
async function exchange(run, stream) {
  const messages = [{ role: "user", content: prompt }]
  current = { run, phase: "turn" }
  const turn = await request(run, stream, messages)
  const turnQueries = queries.filter(query => query.run === run && query.phase === "turn")
  const turnCalls = upstreamCalls.filter(row => row.run === run && row.phase === "turn")
  const forwarded = turn.content.filter(block => block.type === "tool_use")
  const receipt = `RECEIPT-${randomUUID()}`
  let followup, followupQueries = [], followupCalls = []
  if (forwarded.length > 0) {
    current = { run, phase: "followup" }
    followup = await request(run, stream, [...messages, { role: "assistant", content: turn.content },
      { role: "user", content: forwarded.map(block => ({ type: "tool_result", tool_use_id: block.id, content: `${receipt}:${block.name}` })) }])
    followupQueries = queries.filter(query => query.run === run && query.phase === "followup")
    followupCalls = upstreamCalls.filter(row => row.run === run && row.phase === "followup")
  }
  return { turn, turnQueries, turnCalls, forwarded, receipt, followup, followupQueries, followupCalls,
    turnResult: results.find(result => result.key === turnQueries[0]?.key) }
}

function checkForwarded(x, expected, withText = false) {
  check(x.turn.stop === "tool_use" && x.forwarded.length === expected.length && expected.every(target => x.forwarded.some(block => block.name === target.name)) &&
      x.turn.content.every(block => block.type === "tool_use" || (withText && block.type === "text")) && !shown(x.turn).includes("ToolSearch"),
    "the client receives exactly the forwarded calls under its own names", `stop=${x.turn.stop} content=${shown(x.turn)}`)
}

function checkFollowup(x) {
  check(x.followupQueries.length === 1 && x.followupQueries[0].resume === x.turnQueries[0]?.sessionId && typeof x.followupQueries[0].resumeSessionAt === "string",
    "the follow-up resumes the session at the tool call",
    `resume=${x.followupQueries[0]?.resume === x.turnQueries[0]?.sessionId} resumeSessionAt=${Boolean(x.followupQueries[0]?.resumeSessionAt)}`)
  const delivered = x.followupCalls[0]?.toolResults ?? []
  check(x.forwarded.length > 0 && x.forwarded.every(block => delivered.some(result => result.tool_use_id === block.id && JSON.stringify(result.content).includes(`${x.receipt}:${block.name}`))) &&
      !delivered.some(result => JSON.stringify(result.content).includes("forwarded to the client")),
    "the model sees the client's real results and no leftover deny", `${delivered.length} tool_result block(s)`)
  check(x.followupCalls.length === 1 && x.followup?.stop === "end_turn" && x.followup.content.map(block => block.text).join("") === "FOLLOWUP-DONE",
    "the follow-up answers in one Messages call", `${x.followupCalls.length} call(s), stop=${x.followup?.stop}`)
}

const label = (shape, stream) => `${shape}-${stream ? "stream" : "nonstream"}`
const heading = (shape, stream) => console.log(`\n=== ${shape}, ${stream ? "stream" : "non-stream"} ===`)

async function deferralCase(shape, stream) {
  heading(shape, stream)
  const x = await exchange(label(shape, stream), stream)
  const first = x.turnCalls[0]
  check(x.turnQueries.length === 1, "the turn is one SDK query", `${x.turnQueries.length}`)
  check(JSON.stringify(x.turnQueries[0]?.sdkTools) === '["ToolSearch"]' && x.turnQueries[0]?.maxTurns === TOOL_SEARCH_TURN_BUDGET,
    "the SDK is asked for ToolSearch and the discovery budget", `tools=${JSON.stringify(x.turnQueries[0]?.sdkTools)} maxTurns=${x.turnQueries[0]?.maxTurns}`)
  check(first !== undefined && first.tools.some(sent => sent.name === "ToolSearch") && hasTool(first, readTool) && hasTool(first, listTool) &&
      deferredTools.every(target => !hasTool(first, target)),
    "the CLI offers ToolSearch and leaves the deferred tools out of the request", declared(first))
  check(first !== undefined && deferredTools.every(target => first.system.includes(`mcp__oc__${target.name}`)) && first.system.includes("available-deferred-tools"),
    "the system prompt names the deferred tools")

  if (shape === "direct" || shape === "parallel" || shape === "haiku") {
    check(x.turnCalls.length === 1, "the tool turn costs one Messages call", `${x.turnCalls.length} call(s)`)
    check(x.turnResult?.subtype === "success", "the query ends in a success result", `subtype=${x.turnResult?.subtype}`)
    checkForwarded(x, shape === "parallel" ? [readTool, listTool] : [readTool])
    checkFollowup(x)
  }
  if (shape === "search") {
    check(x.turnCalls.length === 2, "the turn costs two Messages calls: the ToolSearch round and the tool call", `${x.turnCalls.length} call(s)`)
    check(hasTool(x.turnCalls[1], auxTool) && !hasTool(x.turnCalls[1], extraTool), "the second call declares the tool ToolSearch loaded, and only that one", declared(x.turnCalls[1]))
    checkForwarded(x, [auxTool, readTool], true)
    checkFollowup(x)
    check(hasTool(x.followupCalls[0], auxTool), "the loaded tool is still loaded after the resume", declared(x.followupCalls[0]))
  }
  if (shape === "mixed") {
    check(x.turnCalls.length === 1, "the turn costs one Messages call", `${x.turnCalls.length} call(s)`)
    checkForwarded(x, [readTool])
    checkFollowup(x)
    const searched = (x.followupCalls[0]?.toolResults ?? []).find(result => result.tool_use_id.endsWith("_search"))
    check(JSON.stringify(searched?.content ?? "").includes('"tool_reference"') && hasTool(x.followupCalls[0], auxTool),
      "the ToolSearch result is back in place on resume and its tool is loaded",
      `${JSON.stringify(searched?.content ?? null).slice(0, 110)} tools=${declared(x.followupCalls[0])}`)
    check((x.followupQueries[0]?.promptResults ?? []).some(id => id.endsWith("_search")), "it is the proxy that puts it back",
      (x.followupQueries[0]?.promptResults ?? []).join(","))
  }
  if (shape === "mixedafter") {
    check(x.turnCalls.length === 1, "the turn costs one Messages call", `${x.turnCalls.length} call(s)`)
    checkForwarded(x, [readTool])
    checkFollowup(x)
    // The resume point is the read call's fragment; the ToolSearch call after
    // it is cut off, and its result alone would answer no tool_use.
    const handed = x.followupQueries[0]?.promptResults ?? []
    check(handed.length === 1 && handed[0].endsWith("_read"), "the proxy hands the SDK the client's result and no result for the call the resume cut off", handed.join(","))
    const results = x.followupCalls[0]?.toolResults ?? []
    check(results.length === 1 && results[0].tool_use_id.endsWith("_read"), "and the API is sent none", results.map(result => result.tool_use_id).join(","))
  }
  if (shape === "bare" || shape === "retry") {
    checkForwarded(x, [auxTool])
    check(x.forwarded.length === 1 && x.forwarded[0].id.endsWith("_aux"), "the client is handed the rejected call once, and not the retry", x.forwarded.map(block => block.id).join(","))
    check(x.turnCalls.length === 2, "the SDK makes one more Messages call after the rejection, and it is discarded", `${x.turnCalls.length} call(s)`)
    check(!cliIgnoresStop(x.turnQueries[0]?.executable), "that call is not taken for a CLI ignoring the stop")
    checkFollowup(x)
  }
  if (shape === "overrun") {
    check(x.turnCalls.length === TOOL_SEARCH_TURN_BUDGET, "the turn stops at the budget", `${x.turnCalls.length} call(s), budget ${TOOL_SEARCH_TURN_BUDGET}`)
    check(x.turn.stop === "max_tokens" && x.forwarded.length === 0 && !shown(x.turn).includes("ToolSearch"),
      "the client gets a truncated turn it can continue, not an error", `stop=${x.turn.stop} content=${shown(x.turn) || "(empty)"}`)
    check(x.turn.content.length === 0, "and no text the model did not write", shown(x.turn) || "(empty)")
  }
}

/** A session whose tools are marked for deferral and all loaded anyway. */
async function loadedCase(shape, stream, why) {
  heading(`${shape} (${why})`, stream)
  const x = await exchange(label(shape, stream), stream)
  const first = x.turnCalls[0]
  check(x.turnQueries.length === 1, "the turn is one SDK query", `${x.turnQueries.length}`)
  check(first !== undefined && !JSON.stringify(first.tools).includes("ToolSearch") && first.tools.every(sent => sent.defer_loading !== true) &&
      clientTools.every(target => hasTool(first, target)) && !first.system.includes("available-deferred-tools"),
    "the CLI declares every client tool loaded, and no ToolSearch", `sdk tools=${JSON.stringify(x.turnQueries[0]?.sdkTools)} upstream tools=${declared(first)}`)
  check(x.turnQueries[0]?.maxTurns === 1, "the turn is asked with maxTurns 1", `maxTurns=${x.turnQueries[0]?.maxTurns}`)
  check(x.turnCalls.length === 1, "the tool turn costs one Messages call", `${x.turnCalls.length} call(s)`)
  check(x.turnResult?.subtype === "error_max_turns", "the SDK ends on its canonical error_max_turns result", `subtype=${x.turnResult?.subtype}`)
  checkForwarded(x, shape === "parallel" ? [readTool, listTool] : [readTool])
  checkFollowup(x)
}

let mode = "unknown"
try {
  // The first tool turn says which CLI this is: one Messages call if it
  // stopped when the hook asked, more if it went on to digest the deny.
  heading("probe", true)
  const probe = await exchange(label("direct", true) + "-probe", true)
  mode = probe.turnCalls.length === 1 ? "deferral" : "fallback"
  console.log(`  mode: ${mode} (${probe.turnCalls.length} Messages call(s) for the first tool turn)`)
  check(!expectedMode || expectedMode === mode, `this CLI is expected in ${expectedMode ?? mode} mode`, `it is in ${mode} mode`)
  check(JSON.stringify(probe.turnQueries[0]?.sdkTools) === '["ToolSearch"]', "the first deferred-tools query offers ToolSearch", JSON.stringify(probe.turnQueries[0]?.sdkTools))
  checkForwarded(probe, [readTool])
  check(probe.followupCalls.length === 1 && probe.followup?.stop === "end_turn", "its follow-up is answered in one Messages call", `${probe.followupCalls.length} call(s)`)
  check(cliIgnoresStop(probe.turnQueries[0]?.executable) === (mode === "fallback"), "the proxy has the CLI down for what it did",
    `cliIgnoresStop=${cliIgnoresStop(probe.turnQueries[0]?.executable)}`)

  if (mode === "deferral") {
    for (const stream of [false, true]) {
      for (const shape of (process.env.E2E_SHAPES?.split(",") ?? ["direct", "parallel", "search", "mixed", "mixedafter", "overrun"])) await deferralCase(shape, stream)
    }
    for (const stream of [false, true]) {
      for (const shape of ["bare", "retry"]) await deferralCase(shape, stream)
    }
    await deferralCase("haiku", true)
    // The scripted API without the operator's word for it: the CLI leaves its
    // own tool search off for such a base URL, and the proxy must not force it.
    delete process.env.MERIDIAN_PASSTHROUGH_TOOL_SEARCH
    await loadedCase("unvouched", true, "an upstream nobody vouched for")
    process.env.MERIDIAN_PASSTHROUGH_TOOL_SEARCH = "force"
  } else {
    for (const stream of [false, true]) {
      for (const shape of ["direct", "parallel"]) await loadedCase(shape, stream, "fallback")
    }
  }
  check(pairingErrors.length === 0, "every request pairs tool_use with tool_result as the API requires", pairingErrors.slice(0, 4).join("; "))
  assert.deepEqual(upstreamErrors, [])
} finally {
  await proxy.close()
  await upstream.stop(true)
  observer.mockRestore()
}
console.log(`\nCLI on the wire: cc_version=${cliVersion ?? "unknown"} (${claudePath ?? "resolved by the proxy"}), mode ${mode}`)
// A failed run keeps its sessions and transcripts for inspection.
if (failures.length === 0) rmSync(root, { recursive: true, force: true })
console.log(JSON.stringify({ result: failures.length === 0 ? "PASS" : "FAIL", mode, failures, ...(failures.length === 0 ? {} : { root }),
  callsPerQuery: Object.fromEntries(queries.map(query => [query.key, upstreamCalls.filter(row => row.key === query.key).length])) }))
process.exit(failures.length === 0 ? 0 : 1)
