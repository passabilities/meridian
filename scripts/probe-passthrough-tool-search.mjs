#!/usr/bin/env bun
// PROBE, not a gate: it reports, and exits 0 whatever it finds. Real proxy +
// real SDK/CLI against a scripted Messages API, no model calls.
//
// What does the CLI do with a passthrough session's deferred tools, and what
// ends a tool turn? scripts/e2e-deferred-tool-turn.mjs asserts today's answer
// (no ToolSearch on offer, every tool loaded, one Messages call under the turn
// cap). This script is for looking past it: it rewrites the SDK options the
// proxy built and the PreToolUse hook's output, so the alternatives can be
// tried against a real CLI before anything is built on them.
//
//   --case=direct|search   the scripted model calls the loaded tool at once, or
//                          calls ToolSearch for the deferred one first
//   --sdk-tools=ToolSearch pass `tools: ["ToolSearch"]` to the SDK in place of
//                          the proxy's `tools: []` (`omit` drops the option)
//   --max-turns=N          force the turn budget
//   --hook=continue-false  add `continue: false` beside the hook's deny
//   --hook=defer           answer the hook with permissionDecision "defer"
//   --claude=PATH          the CLI the SDK drives (default: this checkout's
//                          node_modules/.bin/claude)
//   --model=NAME           default sonnet; haiku has no tool search
//   --stream
//   --json                 the whole record instead of the summary
//   --keep                 leave the temp root (sessions, transcripts) in place
//
// Recorded 2026-10-05 on CLI 2.1.284 (see E2E.md, E75):
//
//   --case=direct --stream
//       tools: both loaded, no ToolSearch; 1 Messages call (2 before deferred
//       tools were held to the turn cap)
//   --case=search --stream
//       the CLI rejects the ToolSearch call (not on offer) and the capped turn
//       ends there: 1 call, the client gets the preamble text and max_tokens.
//       With --max-turns=4 the next call reaches the tool (3 calls)
//   --case=direct --stream --sdk-tools=ToolSearch --max-turns=4
//       tools: ToolSearch, a deferred placeholder, the loaded tool; the
//       advanced-tool-use beta appears; 2 calls (the second is the digest)
//   --case=direct --stream --max-turns=4 --hook=continue-false
//       1 call; result success, stop_reason tool_use; the tool call's assistant
//       message is in the transcript and the follow-up resumes at it
//   --case=search --stream --sdk-tools=ToolSearch --max-turns=4 --hook=continue-false
//       2 calls: ToolSearch, then the discovered tool; the client receives the
//       text and that one tool_use; the follow-up resumes with the tool loaded
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"

const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const scenario = arg("case", "direct")           // direct | search
const hookMode = arg("hook", "none")             // none | continue-false | defer
const maxTurnsOverride = arg("max-turns")        // force options.maxTurns
const stream = process.argv.includes("--stream")
const model = arg("model", "sonnet")
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-defer-probe-")))
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_WORKDIR: root, MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0",
  MERIDIAN_CLAUDE_PATH: arg("claude") ? resolve(arg("claude")) : resolve(import.meta.dir, "../node_modules/.bin/claude"),
  // An API-key fixture profile: the SDK child keeps its transcripts under root.
  CLAUDE_CONFIG_DIR: join(root, "claude-config"),
})

const tool = { name: "read_fixture", description: "Read synthetic data without side effects", input_schema: { type: "object", properties: {} } }
const deferredTool = { name: "aux_fixture", description: "Auxiliary deferred fixture tool for synthetic data", input_schema: { type: "object", properties: {} }, defer_loading: true }
let phase = "turn"
let queryNo = 0
const upstreamLog = []
const queries = []
const results = []
const hooks = []
const iterator = []
let ccVersion
let firstBody

function sse(blocks, stop, n) {
  const events = [{ type: "message_start", message: { id: `msg_probe_${n}`, type: "message", role: "assistant", content: [], model: "claude-haiku-4-5",
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
  events.push({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } }, { type: "message_stop" })
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream", "request-id": `probe-${n}` } })
}

const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
  const body = await request.json()
  const names = (body.tools ?? []).map(t => t.name)
  const registered = suffix => names.find(name => name.endsWith(suffix))
  if (!names.some(name => name.endsWith(tool.name))) {
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  }
  ccVersion ??= JSON.stringify(body.system ?? "").match(/cc_version=([0-9.]+)/)?.[1]
  if (!firstBody) firstBody = { beta: request.headers.get("anthropic-beta"), url: request.url, tools: body.tools, model: body.model, keys: Object.keys(body) }
  const key = request.headers.get("x-probe-query")
  const calls = upstreamLog.filter(row => row.query === key).length + 1
  const last = body.messages.at(-1)
  const lastSummary = Array.isArray(last?.content)
    ? last.content.map(b => b.type === "tool_result" ? `tool_result:${JSON.stringify(b.content).slice(0, 160)}` : `${b.type}:${String(b.text ?? "").slice(0, 80)}`)
    : String(last?.content).slice(0, 80)
  const row = { query: key, call: calls, tools: (body.tools ?? []).map(t => `${t.name}${t.defer_loading ? "(deferred)" : ""}${t.type && t.type !== "custom" ? `[${t.type}]` : ""}`),
    messages: body.messages.length, last: lastSummary }
  upstreamLog.push(row)
  const queryPhase = key.split(":")[0]
  if (queryPhase === "followup") { row.reply = "text"; return sse([{ type: "text", text: "FOLLOWUP-DONE" }], "end_turn", upstreamLog.length) }
  if (scenario === "search" && calls === 1) {
    row.reply = "ToolSearch"
    return sse([{ type: "text", text: "Searching for the tool." },
      { type: "tool_use", id: "toolu_probe_search", name: "ToolSearch", input: { query: `select:${registered(deferredTool.name) ?? "mcp__oc__aux_fixture"}`, max_results: 3 } }], "tool_use", upstreamLog.length)
  }
  const toolCallTurn = scenario === "search" ? 2 : 1
  if (calls === toolCallTurn) {
    const name = scenario === "search" ? (registered(deferredTool.name) ?? "mcp__oc__aux_fixture") : registered(tool.name)
    row.reply = `tool_use:${name}`
    return sse([{ type: "tool_use", id: "toolu_probe_call", name, input: {} }], "tool_use", upstreamLog.length)
  }
  row.reply = "digest-text"
  return sse([{ type: "text", text: "DIGEST" }], "end_turn", upstreamLog.length)
} })

const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  const key = `${phase}:${++queryNo}`
  const options = { ...input.options }
  if (maxTurnsOverride && phase === "turn") options.maxTurns = Number(maxTurnsOverride)
  if (arg("sdk-tools") !== undefined) options.tools = arg("sdk-tools") === "" ? [] : arg("sdk-tools") === "omit" ? undefined : arg("sdk-tools").split(",")
  if (arg("sdk-tools") === "omit") delete options.tools
  queries.push({ key, maxTurns: options.maxTurns, requestedMaxTurns: input.options?.maxTurns, sessionId: options.sessionId, resume: options.resume,
    forkSession: options.forkSession, resumeSessionAt: options.resumeSessionAt })
  const actualHooks = options.hooks
  const actual = realQuery({ ...input, options: { ...options,
    env: { ...options.env, ANTHROPIC_CUSTOM_HEADERS: `x-probe-query: ${key}` },
    hooks: { ...actualHooks,
      PreToolUse: actualHooks?.PreToolUse?.map(matcher => ({ ...matcher, hooks: matcher.hooks.map(hook => async (...args) => {
        const out = await hook(...args)
        let final = out
        if (args[0].tool_name !== "ToolSearch" && out?.decision === "block") {
          if (hookMode === "continue-false") final = { ...out, continue: false, stopReason: "forwarded to client" }
          if (hookMode === "defer") final = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "defer", permissionDecisionReason: out.reason } }
        }
        hooks.push({ key, name: args[0].tool_name, id: args[0].tool_use_id, out: JSON.stringify(final).slice(0, 200) })
        return final
      }) })),
    } } })
  return new Proxy(actual, { get(target, property) {
    if (property === Symbol.asyncIterator) return async function* () {
      for await (const message of actual) {
        if (message.type === "result") results.push({ key, subtype: message.subtype, num_turns: message.num_turns, stop_reason: message.stop_reason, is_error: message.is_error })
        if (message.type === "assistant" || message.type === "user") {
          iterator.push({ key, type: message.type, uuid: message.uuid,
            blocks: Array.isArray(message.message?.content) ? message.message.content.map(b => b.type === "tool_use" ? `tool_use:${b.name}` : b.type === "tool_result" ? `tool_result:${JSON.stringify(b.content).slice(0, 120)}` : b.type) : "str" })
        }
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

async function request(messages) {
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-opencode-session": "defer-probe" },
    body: JSON.stringify({ model, stream, max_tokens: 256, tools: [tool, deferredTool], messages }), signal: AbortSignal.timeout(120_000),
  })
  const raw = await response.text()
  const content = stream ? [] : JSON.parse(raw).content ?? []
  const events = stream ? raw.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5))) : []
  for (const event of events) {
    if (event.type === "content_block_start") content[event.index] = { ...event.content_block, json: "" }
    if (event.delta?.type === "text_delta") content[event.index].text += event.delta.text
    if (event.delta?.type === "input_json_delta") content[event.index].json += event.delta.partial_json
    if (event.type === "content_block_stop" && content[event.index]?.type === "tool_use") content[event.index].input = JSON.parse(content[event.index].json || "{}")
  }
  const stop = stream ? events.findLast(event => event.type === "message_delta")?.delta.stop_reason : JSON.parse(raw).stop_reason
  return { status: response.status, content: content.filter(Boolean).map(({ json, ...block }) => block), stop,
    errors: events.filter(event => event.type === "error"), raw: response.status === 200 ? undefined : raw.slice(0, 400) }
}

let report = {}
try {
  const messages = [{ role: "user", content: "Read the synthetic fixture and report its receipt." }]
  const first = await request(messages)
  const turnQueries = queries.filter(q => q.key.startsWith("turn"))
  const toolUse = first.content.find(block => block.type === "tool_use")
  const assistantRow = iterator.findLast(row => row.type === "assistant" && row.blocks.some?.(b => b.startsWith("tool_use:") && !b.endsWith("ToolSearch")))
  const sessionId = turnQueries.at(-1)?.sessionId
  const durable = sessionId ? (await sdk.getSessionMessages(sessionId, { dir: root })).map(row => row.uuid) : []
  let followup
  if (toolUse) {
    phase = "followup"
    followup = await request([...messages, { role: "assistant", content: first.content },
      { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "RECEIPT-42" }] }])
  }
  report = { scenario, hookMode, stream, ccVersion, firstBody, first, followup,
    upstreamCallsForTurn: upstreamLog.filter(row => row.query.startsWith("turn")).length,
    upstreamLog, queries, results, hooks, iterator,
    toolAssistantUuid: assistantRow?.uuid, toolAssistantDurable: assistantRow ? durable.includes(assistantRow.uuid) : null, root }
} catch (error) {
  report = { error: String(error?.stack ?? error), upstreamLog, queries, results, hooks, iterator }
} finally {
  await proxy.close()
  await upstream.stop(true)
  observer.mockRestore()
}
const keep = process.argv.includes("--keep")
if (!keep) rmSync(root, { recursive: true, force: true })
if (process.argv.includes("--json") || report.error) {
  console.log(JSON.stringify(report, null, 1))
} else {
  const say = console.log.bind(console)
  const shape = response => response ? `${response.status} stop=${response.stop} [${response.content.map(b => b.type === "tool_use" ? `tool_use:${b.name}` : `text:${b.text}`).join(", ")}]` : "(none)"
  say(`case=${scenario} hook=${hookMode} stream=${stream} sdk-tools=${arg("sdk-tools", "(proxy's own)")} cc_version=${ccVersion}`)
  say(`beta: ${report.firstBody?.beta}`)
  say(`Messages calls for the tool turn: ${report.upstreamCallsForTurn}`)
  for (const row of upstreamLog) say(`  ${row.query} call ${row.call} -> ${row.reply}   tools: ${row.tools.join(", ")}`)
  for (const query of queries) say(`  query ${query.key}: maxTurns=${query.maxTurns} (proxy asked ${query.requestedMaxTurns}) resume=${Boolean(query.resume)} resumeSessionAt=${Boolean(query.resumeSessionAt)}`)
  for (const result of results) say(`  result ${result.key}: ${result.subtype} stop_reason=${result.stop_reason} num_turns=${result.num_turns}`)
  for (const hook of hooks) say(`  hook ${hook.key} ${hook.name}: ${hook.out.slice(0, 110)}`)
  say(`client turn:      ${shape(report.first)}`)
  say(`client follow-up: ${shape(report.followup)}`)
  say(`tool call's assistant message in the transcript: ${report.toolAssistantDurable}`)
}
