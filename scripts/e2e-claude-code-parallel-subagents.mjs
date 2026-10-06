#!/usr/bin/env bun
// The orchestrator shape through the real proxy, SDK and CLI, against a
// scripted Messages API: no model calls. A main thread starts AGENTS
// subagents at once, in the background as the client runs them by default,
// and each works through its tool rounds while the others do. One round of
// each runs past the client's 30-second progress-summary timer, so the client
// forks every subagent's transcript for a summary while that round is pending
// (the SDK host turns the summaries on, as an orchestrator's does).
//
// For every conversation, the main thread and each subagent, it holds: one
// Messages call per request; every request after a conversation's first a
// continuation that resumes its SDK session, never a replay; every call's
// messages beginning with the previous call's, so the API can read them from
// cache; and the summaries answered on their own, without moving any turn off
// its session. A direct connection gives each of these for free; through the
// proxy each one broken is a conversation written to the cache again.
//
//   bun scripts/e2e-claude-code-parallel-subagents.mjs [model]
//
// The model defaults to claude-fable-5-1. AGENTS (default 4) subagents,
// ROUNDS (default 4) tool rounds each, LONG_SLEEP seconds (default 35) for
// the round that outlasts the timer. PROFILES (default 1) accounts on the
// scripted API: with two and MERIDIAN_ROUTING=active+priority every request
// goes through priority dispatch, which needs a pool of more than one.
// E2E_CLAUDE_CLIENT picks the client (default: `claude` on PATH) and
// E2E_CLAUDE_PATH the CLI the SDK drives.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"

const MODEL = process.argv[2] ?? "claude-fable-5-1"
const AGENTS = Number(process.env.AGENTS ?? 4)
const ROUNDS = Math.max(2, Number(process.env.ROUNDS ?? 4))
const LONG_SLEEP = Number(process.env.LONG_SLEEP ?? 35)
const CLIENT = process.env.E2E_CLAUDE_CLIENT?.includes("/") ? resolve(process.env.E2E_CLAUDE_CLIENT) : process.env.E2E_CLAUDE_CLIENT ?? "claude"
const SUMMARY_PROMPT = "Describe your most recent action in 3-5 words"
const TASK = k => `PARALLEL-TASK-${k}`
const DONE = k => `SUBAGENT-${k}-DONE`

const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-cc-parallel-")))
const work = join(root, "work")
mkdirSync(work)
const fixture = (k, round) => join(work, `agent-${k}-round-${round}.txt`)
for (let k = 1; k <= AGENTS; k++) {
  for (let round = 1; round <= ROUNDS; round++) writeFileSync(fixture(k, round), `agent ${k} round ${round} ${randomUUID()}\n`)
}

// The routing asked for outlives the sweep of the shell's Meridian settings.
const ROUTING = process.env.MERIDIAN_ROUTING
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0",
  ...(ROUTING ? { MERIDIAN_ROUTING: ROUTING } : {}),
  // The fixture profile authenticates with an API key, so the SDK child needs
  // nothing from the user's own Claude config; its transcripts stay under root.
  CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  // The CLI's switch for the hour a subscription's cache gets, so that the
  // five minutes asked for a subagent can be told from the default.
  ENABLE_PROMPT_CACHING_1H: "1",
  ...(process.env.E2E_CLAUDE_PATH ? { MERIDIAN_CLAUDE_PATH: resolve(process.env.E2E_CLAUDE_PATH) } : {}),
})

const textOf = content => typeof content === "string" ? content
  : Array.isArray(content) ? content.map(block => block?.type === "text" ? block.text ?? "" : block?.type === "tool_result" ? textOf(block.content) : "").join("\n") : ""
const blocksOf = message => Array.isArray(message?.content) ? message.content : typeof message?.content === "string" ? [{ type: "text", text: message.content }] : []
const toolNamed = (tools, name) => tools.find(tool => tool === name || tool.endsWith(`__${name}`))
const subagentOf = messages => Number(textOf(messages[0]?.content).match(/PARALLEL-TASK-(\d+)/)?.[1] ?? 0)
const isSummary = messages => textOf(messages.findLast(message => message.role === "user")?.content).includes(SUMMARY_PROMPT)

function sse(blocks, stopReason, model) {
  const events = [{ type: "message_start", message: { id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`, type: "message", role: "assistant", content: [], model,
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }]
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
    { headers: { "content-type": "text/event-stream", "request-id": `parallel-${upstreamCalls.length}` } })
}
const say = text => [{ type: "text", text }]
const toolUse = (name, input) => ({ type: "tool_use", id: `toolu_${randomUUID().replaceAll("-", "").slice(0, 22)}`, name, input })

// How long the cache breakpoints of a Messages request ask to be kept.
const cacheLifetimes = body => [...new Set((JSON.stringify([body.system, body.tools, body.messages]).match(/"cache_control":\{[^{}]*\}/g) ?? [])
  .map(mark => mark.includes('"ttl":"1h"') ? "1h" : "5m"))]

// The scripted model. The main thread starts every subagent in one turn and
// acknowledges whatever comes back. Subagent k runs `sleep 1`, then the long
// sleep, then reads its fixtures, one round at a time, and reports DONE(k).
// A progress summary is answered with a label. Calls without a Read tool are
// the client's and the CLI's own side calls.
const upstreamCalls = []
const upstreamErrors = []
let markAllDone = () => {}
const allDone = new Promise(resolve => { markAllDone = resolve })
const finished = new Set()
let cliVersion
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  try {
    if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
    const body = await request.json()
    const messages = body.messages ?? []
    const tools = (body.tools ?? []).map(tool => tool.name)
    cliVersion ??= JSON.stringify(body.system ?? "").match(/cc_version=([0-9.]+[0-9])/)?.[1]
    const record = (conversation, kind) => upstreamCalls.push({ conversation, kind, messages, cache: cacheLifetimes(body), body, at: Date.now() })
    if (isSummary(messages)) {
      record(`agent-${subagentOf(messages) || "?"}`, "summary")
      return sse(say("Sleeping in the shell"), "end_turn", body.model)
    }
    const read = toolNamed(tools, "Read")
    if (!read) {
      record("side", "side")
      return sse(say("ok"), "end_turn", body.model)
    }
    const k = subagentOf(messages)
    if (k > 0) {
      record(`agent-${k}`, "turn")
      const results = messages.flatMap(blocksOf).filter(block => block.type === "tool_result").length
      const bash = toolNamed(tools, "Bash")
      if (results === 0) return sse([toolUse(bash, { command: "sleep 1", description: "Short pause" })], "tool_use", body.model)
      if (results === 1) return sse([toolUse(bash, { command: `sleep ${LONG_SLEEP}`, description: "Long pause" })], "tool_use", body.model)
      if (results < ROUNDS) return sse([toolUse(read, { file_path: fixture(k, results + 1) })], "tool_use", body.model)
      finished.add(k)
      if (finished.size === AGENTS) markAllDone()
      return sse(say(DONE(k)), "end_turn", body.model)
    }
    record("main", "turn")
    const agent = toolNamed(tools, "Agent")
    const started = messages.some(message => message.role === "assistant" && blocksOf(message).some(block => block.type === "tool_use" && block.name === agent))
    if (agent && !started) {
      return sse(Array.from({ length: AGENTS }, (_, index) => toolUse(agent, {
        description: `Parallel task ${index + 1}`,
        prompt: `${TASK(index + 1)}: run \`sleep 1\`, then \`sleep ${LONG_SLEEP}\`, then read your fixture files one at a time, then report.`,
        subagent_type: "general-purpose",
        run_in_background: true,
      })), "tool_use", body.model)
    }
    return sse(say("MAIN-ACK"), "end_turn", body.model)
  } catch (error) {
    upstreamErrors.push(String(error?.stack ?? error))
    return new Response(String(error), { status: 500 })
  }
} })

const queries = []
const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  queries.push({ sessionId: input.options?.sessionId, resume: input.options?.resume, resumeSessionAt: input.options?.resumeSessionAt,
    textPrompt: typeof input.prompt === "string" ? input.prompt : undefined })
  return realQuery(input)
})

const { startProxyServer } = await import("../src/proxy/server.ts")
const { telemetryStore } = await import("../src/telemetry/index.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: Array.from({ length: Math.max(1, Number(process.env.PROFILES ?? 1)) }, (_, index) => ({
    id: index === 0 ? "fixture" : `fixture-${index + 1}`, type: "api", apiKey: "local-test-key", baseUrl: `http://127.0.0.1:${upstream.port}`,
  })) })
const address = proxy.server.address()
assert(address && typeof address === "object")
const proxyUrl = `http://127.0.0.1:${address.port}`

// What the client sends, on its way to the proxy, stamped with a request id
// so each telemetry row is tied back to its conversation.
const clientRequests = []
const relay = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  const url = new URL(request.url)
  if (request.method !== "POST" || !url.pathname.endsWith("/messages")) {
    return fetch(proxyUrl + url.pathname + url.search, { method: request.method, headers: request.headers,
      ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: await request.arrayBuffer() }) })
  }
  const raw = await request.text()
  const body = JSON.parse(raw)
  const headers = new Headers(request.headers)
  const requestId = randomUUID()
  headers.set("x-request-id", requestId)
  const agentId = request.headers.get("x-claude-code-agent-id")
  const tools = (body.tools ?? []).map(tool => tool.name)
  const kind = isSummary(body.messages ?? []) ? "summary" : toolNamed(tools, "Read") ? "turn" : "side"
  const entry = { requestId, conversation: agentId ? `agent-${subagentOf(body.messages ?? []) || agentId}` : "main", agentId, kind, body, at: Date.now() }
  clientRequests.push(entry)
  const response = await fetch(proxyUrl + url.pathname + url.search, { method: "POST", headers, body: raw, signal: AbortSignal.timeout(300_000) })
  if (response.ok) return response
  // What the client was told, kept for the report: telemetry keeps only the error's type.
  const answer = await response.text()
  entry.refusal = `${response.status} ${answer.slice(0, 400)}`
  return new Response(answer, { status: response.status, headers: response.headers })
} })

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}
const timeout = ms => new Promise(resolve => setTimeout(() => resolve("timeout"), ms))

let clientVersion = "unknown"
const startedAt = Date.now()
try {
  const versionProcess = Bun.spawn([CLIENT, "--version"], { stdout: "pipe", stderr: "pipe" })
  clientVersion = (await new Response(versionProcess.stdout).text()).trim()
  await versionProcess.exited

  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^CLAUDE(CODE|_)/.test(key) || key.startsWith("MERIDIAN_") || key.startsWith("ANTHROPIC_") || key === "ENABLE_TOOL_SEARCH" || key === "ENABLE_PROMPT_CACHING_1H") delete env[key]
  }
  Object.assign(env, { CLAUDE_CONFIG_DIR: join(root, "client-config"), ANTHROPIC_BASE_URL: `http://127.0.0.1:${relay.port}`,
    ANTHROPIC_AUTH_TOKEN: "meridian-e2e-dummy", DISABLE_AUTOUPDATER: "1" })
  const child = Bun.spawn([CLIENT, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--model", MODEL, "--permission-mode", "bypassPermissions", "--allowedTools", "Bash,Read,Agent",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", ""],
  { cwd: work, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  // Drained as it runs: the client blocks once it fills a pipe.
  const drained = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  // The SDK host turns progress summaries on in its initialize request.
  child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: "init-1", request: { subtype: "initialize", agentProgressSummaries: true } })}\n`)
  child.stdin.write(`${JSON.stringify({ type: "user", session_id: "", parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "text", text: `Start the ${AGENTS} parallel tasks in the background.` }] } })}\n`)
  child.stdin.flush()

  const outcome = await Promise.race([allDone.then(() => "done"), timeout((LONG_SLEEP + 150) * 1000)])
  // Then let the main thread take in what the subagents sent back: wait until
  // nothing has reached the API for eight seconds.
  for (let quiet = 0; quiet < 8_000;) {
    const before = upstreamCalls.length
    await Bun.sleep(1_000)
    quiet = upstreamCalls.length === before ? quiet + 1_000 : 0
  }
  child.stdin.end()
  if (await Promise.race([child.exited, timeout(15_000)]) === "timeout") child.kill()
  const [, stderr] = await Promise.race([drained, timeout(3_000).then(() => ["", ""])])
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(0)

  console.log(`\n=== ${clientVersion}, ${MODEL}, ${AGENTS} subagents in parallel, ${ROUNDS} tool rounds each, one of ${LONG_SLEEP}s; ${seconds}s ===`)
  const kinds = list => Object.entries(list.reduce((counts, entry) => ({ ...counts, [`${entry.conversation}/${entry.kind}`]: (counts[`${entry.conversation}/${entry.kind}`] ?? 0) + 1 }), {}))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `${key} ${count}`).join(", ")
  console.log(`  note  client requests: ${kinds(clientRequests)}`)
  console.log(`  note  Messages calls:  ${kinds(upstreamCalls)}`)
  for (const entry of clientRequests.filter(entry => entry.refusal)) console.log(`  note  ${entry.conversation}/${entry.kind} was answered ${entry.refusal}`)
  check(outcome === "done" && finished.size === AGENTS, `the main thread starts ${AGENTS} subagents and every one finishes`,
    `${finished.size} finished${outcome === "done" ? "" : `; stderr ${JSON.stringify(String(stderr).trim().slice(-300))}`}`)

  const rows = telemetryStore.getRecent({ limit: 2000 })
  const rowOf = new Map(rows.map(row => [row.requestId, row]))
  const agents = Array.from({ length: AGENTS }, (_, index) => `agent-${index + 1}`)
  if (/priority/i.test(ROUTING ?? "")) {
    // Priority dispatch numbers each request's attempts; no other routing does.
    const clientRows = clientRequests.map(entry => rowOf.get(entry.requestId))
    const dispatched = clientRows.filter(row => row?.routeAttempt !== undefined)
    check(clientRows.length > 0 && dispatched.length === clientRows.length, `every request is routed by ${ROUTING}`,
      `${dispatched.length} of ${clientRows.length} through priority dispatch; route kinds ${[...new Set(clientRows.map(row => row?.routeKind ?? "missing"))].join(", ")}`)
  }
  const summaries = clientRequests.filter(entry => entry.kind === "summary")
  check(summaries.length > 0, "the client forks the subagents for progress summaries while their long rounds run",
    agents.map(name => `${name} ${summaries.filter(entry => entry.conversation === name).length}`).join(", "))

  // Each conversation's own turns, in the order the client sent them.
  for (const name of ["main", ...agents]) {
    const turns = clientRequests.filter(entry => entry.conversation === name && entry.kind === "turn")
    const turnRows = turns.map(entry => rowOf.get(entry.requestId))
    const lineage = turnRows.map(row => row
      ? `${row.lineageType}${row.isResume ? "" : "(fresh)"}${row.status === 200 ? "" : ` [${row.status} ${row.error ?? ""}]`}`
      : "missing")
    const expected = name === "main" ? turns.length >= 2 : turns.length === ROUNDS + 1
    check(expected && turnRows.every(row => row?.status === 200) && turnRows[0]?.lineageType === "new"
      && turnRows.slice(1).every(row => row.lineageType === "continuation" && row.isResume === true),
    `${name}: every request after its first is a continuation that resumes`, `${turns.length} request(s): ${lineage.join(", ")}`)

    // What reached the API for it, call by call: each begins with the one
    // before, up to that call's last user turn (the CLI may end a request
    // with a system turn the next one rewrites).
    const calls = upstreamCalls.filter(call => call.conversation === name && call.kind === "turn")
    check(calls.length === turns.length, `${name}: one Messages call per request`, `${turns.length} request(s), ${calls.length} call(s)`)
    const normalized = message => JSON.stringify({ role: message.role, content: blocksOf(message).map(({ cache_control, ...block }) => block) })
    const broken = []
    for (let index = 1; index < calls.length; index++) {
      const previous = calls[index - 1].messages
      const lastUser = previous.findLastIndex(message => message.role === "user")
      const kept = previous.slice(0, lastUser + 1)
      const same = kept.every((message, position) => calls[index].messages[position] && normalized(message) === normalized(calls[index].messages[position]))
      if (!same) {
        const at = kept.findIndex((message, position) => !calls[index].messages[position] || normalized(message) !== normalized(calls[index].messages[position]))
        broken.push(`call ${index + 1} at message ${at} of ${kept.length}`)
      }
    }
    check(calls.length > 1 && broken.length === 0, `${name}: every call's messages begin with the call before it`, broken.join("; ") || `${calls.length} calls, ${calls.at(-1)?.messages.length ?? 0} messages at the end`)
  }

  // Nothing went upstream as a replay of a conversation. A progress summary
  // is answered from the subagent's latest step, in a session of its own, by
  // design (claudecode.ts, agentSummaryReplayMessages).
  const replays = queries.filter(query => query.textPrompt?.includes("<conversation_history>") && !query.textPrompt.includes(SUMMARY_PROMPT))
  check(replays.length === 0, "no SDK query replays a conversation", `${queries.length} queries, ${replays.length} replayed`)
  // The summaries: one call each, and every one of them answered.
  const summaryCalls = upstreamCalls.filter(call => call.kind === "summary")
  const summaryRows = summaries.map(entry => rowOf.get(entry.requestId))
  check(summaryCalls.length === summaries.length && summaryRows.every(row => row?.status === 200), "each progress summary is answered with one Messages call",
    `${summaries.length} summaries, ${summaryCalls.length} call(s), statuses ${[...new Set(summaryRows.map(row => row?.status ?? "missing"))].join(",")}`)
  // The client sends one every 30 seconds for each subagent still running.
  // Answered in a session of its own, a summary still begins with what its
  // subagent's turns begin with, the tools and the system prompt, so the API
  // reads those from cache instead of writing them again for each one. The
  // first system block is the client's billing line, which the API does not
  // cache; it is left out of the comparison.
  const withoutMarks = value => JSON.parse(JSON.stringify(value ?? null, (key, inner) => key === "cache_control" ? undefined : inner))
  const systemBlocks = body => (Array.isArray(body.system) ? body.system : [{ type: "text", text: String(body.system ?? "") }])
    .filter(block => !String(block.text ?? "").startsWith("x-anthropic-billing-header"))
  const prefixOf = call => JSON.stringify([withoutMarks(call.body.tools), withoutMarks(systemBlocks(call.body))])
  const turnPrefixes = new Set(upstreamCalls.filter(call => call.kind === "turn" && call.conversation.startsWith("agent-")).map(prefixOf))
  const unmatched = summaryCalls.filter(call => !turnPrefixes.has(prefixOf(call)))
  const sizes = call => `${JSON.stringify(call.body.tools ?? []).length} tool / ${JSON.stringify(systemBlocks(call.body)).length} system characters`
  check(summaryCalls.length > 0 && unmatched.length === 0, "each summary reaches the API with its subagent's tools and system prompt, ahead of a short replay",
    `${summaryCalls.length - unmatched.length} of ${summaryCalls.length}; summary ${summaryCalls[0] ? sizes(summaryCalls[0]) : "-"}, subagent turn ${[...upstreamCalls].find(call => call.kind === "turn" && call.conversation.startsWith("agent-")) ? sizes(upstreamCalls.find(call => call.kind === "turn" && call.conversation.startsWith("agent-"))) : "-"}; messages ${summaryCalls.map(call => JSON.stringify(call.messages).length).join("/")} characters`)
  if (unmatched.length > 0) {
    const turn = upstreamCalls.find(call => call.kind === "turn" && call.conversation.startsWith("agent-"))
    const [toolsA, systemA] = JSON.parse(prefixOf(unmatched[0]))
    const [toolsB, systemB] = JSON.parse(prefixOf(turn))
    const toolNames = list => (list ?? []).map(tool => tool.name).join(",")
    console.log(`  note  tools  summary [${toolNames(toolsA)}]\n        turn    [${toolNames(toolsB)}]`)
    const textA = systemA.map(block => block.text ?? "").join("\n¶\n"), textB = systemB.map(block => block.text ?? "").join("\n¶\n")
    const at = [...textA].findIndex((char, index) => char !== textB[index])
    console.log(`  note  system ${textA.length} vs ${textB.length} characters, first difference at ${at}: summary ${JSON.stringify(textA.slice(Math.max(0, at - 60), at + 140))}\n        turn ${JSON.stringify(textB.slice(Math.max(0, at - 60), at + 140))}`)
  }
  // The client's side calls are not the conversation's business, but each
  // costs one call too.
  const sides = clientRequests.filter(entry => entry.kind === "side")
  check(upstreamCalls.filter(call => call.kind === "side").length === sides.length, "each side call costs one Messages call",
    `${sides.length} side request(s), ${upstreamCalls.filter(call => call.kind === "side").length} call(s)`)
  // A subagent's cache is written for five minutes, the main thread's for an
  // hour, as the client on a subscription would have them.
  const lifetimes = name => [...new Set(upstreamCalls.filter(call => call.conversation === name && call.kind === "turn").flatMap(call => call.cache))].join("+") || "none"
  check(agents.every(name => lifetimes(name) === "5m") && lifetimes("main").includes("1h"),
    "each subagent's prompt cache is written for five minutes and the main thread's for an hour",
    `main ${lifetimes("main")}; ${agents.map(name => `${name} ${lifetimes(name)}`).join(", ")}`)
  assert.deepEqual(upstreamErrors, [])
} finally {
  await proxy.close()
  await relay.stop(true)
  await upstream.stop(true)
  observer.mockRestore()
}
console.log(`\nclient ${clientVersion}; CLI on the wire: cc_version=${cliVersion ?? "unknown"} (${process.env.MERIDIAN_CLAUDE_PATH ?? "resolved by the proxy"})`)
// A failed run keeps its sessions and transcripts for inspection.
if (failures.length === 0) rmSync(root, { recursive: true, force: true })
console.log(JSON.stringify({ result: failures.length === 0 ? "PASS" : "FAIL", model: MODEL, agents: AGENTS, rounds: ROUNDS, failures, ...(failures.length === 0 ? {} : { root }) }))
process.exit(failures.length === 0 ? 0 : 1)
