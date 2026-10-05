#!/usr/bin/env bun
// PROBE, not a gate: it reports, and exits 0 whatever it finds. Real proxy +
// real SDK/CLI against a scripted Messages API, no model calls.
//
// What does the CLI do with a passthrough session's deferred tools, and what
// ends a tool turn? The proxy's answer is in src/proxy/passthroughToolSearch.ts
// and scripts/e2e-deferred-tool-turn.mjs asserts it. This script is for looking
// past that: it scripts the model call by call and can rewrite the SDK options
// the proxy built and the PreToolUse hook's output, so an alternative can be
// tried against a real CLI before anything is built on it. The client declares
// four tools: read_fixture and list_fixture loaded, aux_fixture and
// extra_fixture `defer_loading`.
//
//   --case=direct|search   the scripted model calls a loaded tool at once, or
//                          calls ToolSearch for a deferred one first
//   --script=JSON          instead: one entry per Messages call of the turn,
//                          each a list of blocks (see `script` below)
//   --followup=JSON        what the client answers each forwarded call with
//   --env=KEY=VALUE        a proxy setting for the run (repeatable), for
//                          example MERIDIAN_PASSTHROUGH_TOOL_SEARCH=0
//   --sdk-tools=LIST       replace the SDK `tools` option the proxy built
//                          (empty for none, `omit` to drop the option)
//   --max-turns=N          force the turn budget
//   --hook=continue-false  add `continue: false` beside the hook's deny
//   --hook=defer           answer the hook with permissionDecision "defer"
//   --followup-sdk-tools=, --followup-env=   the same overrides for the
//                          follow-up query alone
//   --claude=PATH          the CLI the SDK drives (default: this checkout's
//                          node_modules/.bin/claude)
//   --model=NAME           default sonnet; haiku has no tool search
//   --stream
//   --shapes               print each call's message roles and block types
//   --announce             print how the wire first names a deferred tool
//   --json                 the whole record instead of the summary
//   --keep                 leave the temp root (sessions, transcripts) in place
//
// Recorded 2026-10-05 on CLI 2.1.284 unless said otherwise (E2E.md, E76):
//
//   --stream
//       ToolSearch, a deferred placeholder and the two loaded tools on the
//       wire, under the advanced-tool-use beta; 1 Messages call; success
//   --stream --case=search
//       2 calls: ToolSearch, then the tool it loaded, which the second call
//       declares; the client gets the text and that one tool_use
//   --stream --script='[["search:aux_fixture","tool:read_fixture"]]' --shapes
//       1 call; on resume the ToolSearch result is a tool_reference again.
//       Before the proxy carried it the CLI put "[Tool result missing due to
//       internal error]" there and the tool stayed unloaded
//   --stream --script='[["tool:extra_fixture:{\"wrong\":1}"]]'
//       a deferred tool that was never loaded, called under its registered
//       name with arguments its schema refuses: dispatched to the hook and
//       forwarded all the same. The client is what validates
//   --stream --script='[["bare:aux_fixture"]]'
//       the CLI rejects the bare name before any hook ("No such tool
//       available") and calls the model again: 2 calls, the client still gets
//       the call
//   --stream --followup='[{"type":"tool_reference","tool_name":"aux_fixture"}]'
//       a reference from the client to a name the SDK never registered is
//       dropped by the CLI; one to mcp__oc__aux_fixture loads that tool
//   --stream --case=search --followup-sdk-tools= --followup-env=ENABLE_TOOL_SEARCH=false
//       a session that used ToolSearch, resumed without it: every tool loaded,
//       the reference replaced by "[Tool references removed - tool search not
//       enabled]". 2.1.141 does the same
//   --stream --env=MERIDIAN_SUPPRESS_IMPLICIT_ATTACHMENTS=0 --announce
//       with attachments on, the CLI names the deferred tools itself, in the
//       trailing system message; passthrough has them off
//   --stream --env=MERIDIAN_PASSTHROUGH_TOOL_SEARCH=0
//       the kill switch: all four tools loaded, no ToolSearch, maxTurns 1,
//       1 call ending error_max_turns
//   --stream --env=MERIDIAN_PASSTHROUGH_TOOL_SEARCH=1
//       the default, which the probe otherwise overrides with `force`: its
//       scripted API is a base URL that is not Anthropic's own, so the result
//       is the kill switch's until the operator vouches for the upstream
//   --stream --claude=<the SDK's bundled 2.1.141>
//       `continue: false` is ignored: 2 calls, the second the digest. The
//       proxy marks the CLI and the follow-up has every tool loaded
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
  // The scripted API is not Anthropic's own base URL; this vouches for it.
  MERIDIAN_PASSTHROUGH_TOOL_SEARCH: "force",
  MERIDIAN_CLAUDE_PATH: arg("claude") ? resolve(arg("claude")) : resolve(import.meta.dir, "../node_modules/.bin/claude"),
  // An API-key fixture profile: the SDK child keeps its transcripts under root.
  CLAUDE_CONFIG_DIR: join(root, "claude-config"),
})
// --env=KEY=VALUE, repeatable: proxy settings for this run.
for (const pair of process.argv.filter(a => a.startsWith("--env=")).map(a => a.slice(6))) {
  process.env[pair.slice(0, pair.indexOf("="))] = pair.slice(pair.indexOf("=") + 1)
}

const tool = { name: "read_fixture", description: "Read synthetic data without side effects", input_schema: { type: "object", properties: {} } }
const deferredTool = { name: "aux_fixture", description: "Auxiliary deferred fixture tool for synthetic data", input_schema: { type: "object", properties: {} }, defer_loading: true }
const tool2 = { name: "list_fixture", description: "List synthetic data without side effects", input_schema: { type: "object", properties: {} } }
const deferredTool2 = { name: "extra_fixture", description: "Second deferred fixture tool for synthetic data", defer_loading: true,
  input_schema: { type: "object", properties: { key: { type: "string", description: "Which record" }, limit: { type: "integer" } }, required: ["key"] } }
const clientTools = [tool, tool2, deferredTool, deferredTool2]
// One entry per Messages call of the tool turn, each a list of blocks:
//   text:<words>   search:<tool suffix>   searchq:<free query>
//   tool:<tool suffix> (the registered name)   bare:<name as given>
//   either may carry its input: tool:extra_fixture:{"key":"a"}
// Calls past the end of the script get the text DIGEST.
const script = arg("script") ? JSON.parse(arg("script"))
  : scenario === "search" ? [["text:Searching for the tool.", `search:${deferredTool.name}`], [`tool:${deferredTool.name}`]]
  : [[`tool:${tool.name}`]]
// --followup=<json>: what the client answers each forwarded call with.
const followupContent = arg("followup") ? JSON.parse(arg("followup")) : "RECEIPT-42"
let phase = "turn"
let queryNo = 0
const upstreamLog = []
const queries = []
const results = []
const hooks = []
const iterator = []
let ccVersion
let firstBody
const announcements = []

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
  const shape = message => `${message.role}[${Array.isArray(message.content)
    ? message.content.map(b => b.type === "tool_use" ? `tool_use:${b.name}`
      : b.type === "tool_result" ? `tool_result:${JSON.stringify(b.content).slice(0, 110)}` : b.type).join(", ")
    : "text"}]`
  const row = { query: key, call: calls, tools: (body.tools ?? []).map(t => `${t.name}${t.defer_loading ? "(deferred)" : ""}${t.type && t.type !== "custom" ? `[${t.type}]` : ""}`),
    messages: body.messages.length, last: lastSummary, shape: body.messages.map(shape) }
  // How the CLI tells the model about tools it has not loaded.
  const wire = JSON.stringify([body.system, body.messages])
  const at = wire.indexOf(deferredTool.name)
  if (at >= 0 && !announcements.length) announcements.push(wire.slice(Math.max(0, at - 700), at + 400))
  upstreamLog.push(row)
  const queryPhase = key.split(":")[0]
  if (queryPhase === "followup") { row.reply = "text"; return sse([{ type: "text", text: "FOLLOWUP-DONE" }], "end_turn", upstreamLog.length) }
  const spec = script[calls - 1]
  if (!spec) { row.reply = "digest-text"; return sse([{ type: "text", text: "DIGEST" }], "end_turn", upstreamLog.length) }
  const blocks = spec.map((entry, index) => {
    const [kind, ...rest] = entry.split(":")
    const value = rest.join(":")
    const id = `toolu_probe_${calls}_${index}`
    if (kind === "text") return { type: "text", text: value }
    if (kind === "search") return { type: "tool_use", id, name: "ToolSearch", input: { query: `select:${registered(value) ?? `mcp__oc__${value}`}`, max_results: 3 } }
    if (kind === "searchq") return { type: "tool_use", id, name: "ToolSearch", input: { query: value, max_results: 3 } }
    const cut = value.indexOf(":")
    const name = cut < 0 ? value : value.slice(0, cut)
    const input = cut < 0 ? {} : JSON.parse(value.slice(cut + 1))
    if (kind === "tool") return { type: "tool_use", id, name: registered(name) ?? `mcp__oc__${name}`, input }
    return { type: "tool_use", id, name, input }
  })
  row.reply = spec.join(" + ")
  return sse(blocks, blocks.some(block => block.type === "tool_use") ? "tool_use" : "end_turn", upstreamLog.length)
} })

const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  const key = `${phase}:${++queryNo}`
  const options = { ...input.options }
  if (maxTurnsOverride && phase === "turn") options.maxTurns = Number(maxTurnsOverride)
  // --followup-sdk-tools / --followup-env: the same overrides for the follow-up
  // query alone, for a session whose deferral is switched off part-way.
  const sdkTools = phase === "followup" && arg("followup-sdk-tools") !== undefined ? arg("followup-sdk-tools") : arg("sdk-tools")
  if (sdkTools !== undefined) options.tools = sdkTools === "" ? [] : sdkTools === "omit" ? undefined : sdkTools.split(",")
  if (sdkTools === "omit") delete options.tools
  if (phase === "followup" && arg("followup-env")) {
    const pair = arg("followup-env")
    options.env = { ...options.env, [pair.slice(0, pair.indexOf("="))]: pair.slice(pair.indexOf("=") + 1) }
  }
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
    body: JSON.stringify({ model, stream, max_tokens: 256, tools: clientTools, messages }), signal: AbortSignal.timeout(120_000),
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
  const toolUses = first.content.filter(block => block.type === "tool_use")
  const toolUse = toolUses[0]
  const assistantRow = iterator.findLast(row => row.type === "assistant" && row.blocks.some?.(b => b.startsWith("tool_use:") && !b.endsWith("ToolSearch")))
  const sessionId = turnQueries.at(-1)?.sessionId
  const durable = sessionId ? (await sdk.getSessionMessages(sessionId, { dir: root })).map(row => row.uuid) : []
  let followup
  if (toolUse) {
    phase = "followup"
    followup = await request([...messages, { role: "assistant", content: first.content },
      { role: "user", content: toolUses.map(block => ({ type: "tool_result", tool_use_id: block.id, content: followupContent })) }])
  }
  report = { scenario, hookMode, stream, ccVersion, firstBody, first, followup, announcements,
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
  for (const row of upstreamLog) {
    say(`  ${row.query} call ${row.call} -> ${row.reply}   tools: ${row.tools.join(", ")}`)
    if (process.argv.includes("--shapes")) say(`      ${row.shape.join(" | ")}`)
  }
  for (const query of queries) say(`  query ${query.key}: maxTurns=${query.maxTurns} (proxy asked ${query.requestedMaxTurns}) resume=${Boolean(query.resume)} resumeSessionAt=${Boolean(query.resumeSessionAt)}`)
  for (const result of results) say(`  result ${result.key}: ${result.subtype} stop_reason=${result.stop_reason} num_turns=${result.num_turns}`)
  for (const hook of hooks) say(`  hook ${hook.key} ${hook.name}: ${hook.out.slice(0, 110)}`)
  say(`client turn:      ${shape(report.first)}`)
  say(`client follow-up: ${shape(report.followup)}`)
  say(`tool call's assistant message in the transcript: ${report.toolAssistantDurable}`)
  if (process.argv.includes("--announce")) say(`announcement: ${report.announcements[0] ?? "(deferred tool never named on the wire)"}`)
}
