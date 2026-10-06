#!/usr/bin/env bun
// Real proxy + real SDK + real CLI against a scripted Messages API: no model
// calls. A Claude Code conversation whose MCP servers come and go between its
// turns: is the model told what it can load as that changes, with the prompt
// the API receives still a growing prefix?
//
// Connected directly, Claude Code names the tools it defers in its turns: all
// of them in the first, then whatever came or went. In one machine's
// transcripts its MCP servers connected after a session's first request 72
// times in four days. The proxy named them in the system prompt instead, and
// the CLI records a conversation's system prompt on its first request and
// sends that record on every later one, whatever a later launch passes, until
// compaction (systemPromptSnapshot, on by default in 2.1.284): a tool that
// connected later was never named and one that went away stayed named. With
// the turn's own list off (deferredToolsInTurns false) this gate shows the
// API receiving turn 1's list on all four calls. The proxy now names them in
// the turn (RequestContext.deferredToolsInTurns, passthroughToolSearch.ts).
//
// Four turns in one conversation, the MCP tools varying between them:
//   1  two tools        every deferred tool named at the end of the turn
//   2  a third connects only the new one named; everything before the turn
//                       exactly as turn 1 sent it
//   3  no change        nothing named
//   4  one disconnects  it is named as gone
// and on every call: the same system prompt, the same loaded tools, no
// deferred tool's name in the system prompt, ToolSearch on offer, and each
// turn after the first resuming the session the one before left.
//
//   bun scripts/e2e-claude-code-deferred-tools-in-turns.mjs
//
// E2E_CLAUDE_PATH picks the CLI the SDK drives (default: as the proxy resolves
// it in service; pass node_modules/.bin/claude to match `npm run start`).
import assert from "node:assert/strict"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"

const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-deferred-in-turns-")))
const claudePath = process.env.E2E_CLAUDE_PATH ? resolve(process.env.E2E_CLAUDE_PATH) : undefined
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_WORKDIR: root, MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0",
  // The scripted API is not Anthropic's own; it forwards tool_reference blocks.
  MERIDIAN_PASSTHROUGH_TOOL_SEARCH: "force",
  CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  ...(claudePath ? { MERIDIAN_CLAUDE_PATH: claudePath } : {}),
})

const tool = name => ({ name, description: `${name} — synthetic, no side effects`, input_schema: { type: "object", properties: { input: { type: "string" } } } })
const OWN = ["Bash", "Read"].map(tool)
const mcp = (...indexes) => indexes.map(i => tool(`mcp__fixture__tool_${String(i).padStart(2, "0")}`))
const registered = i => `mcp__oc__mcp__fixture__tool_${String(i).padStart(2, "0")}`
const NOW_AVAILABLE = "The following deferred tools are now available via ToolSearch."
const GONE = "The following deferred tools are no longer available in this session."

let current = "none"
let queryCount = 0
const queries = []
const calls = []
const upstreamErrors = []
let cliVersion

function answer(text) {
  const events = [
    { type: "message_start", message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", content: [], model: "claude-sonnet-5",
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: "message_stop" },
  ]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream", "request-id": `in-turns-${calls.length}` } })
}

const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  try {
    if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
    const body = await request.json()
    // The CLI's own side calls (titles, quota) carry none of the client's tools.
    if (!(body.tools ?? []).some(sent => sent.name === "mcp__oc__Read")) {
      return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    }
    cliVersion ??= JSON.stringify(body.system ?? "").match(/cc_version=([0-9.]+[0-9])/)?.[1]
    const key = request.headers.get("x-gate-query")
    assert(key, "CLI did not forward the gate's query identity")
    calls.push({ key, turn: key.split("|")[0], body })
    return answer(`ANSWER-${calls.length}`)
  } catch (error) {
    upstreamErrors.push(String(error?.stack ?? error))
    return new Response(String(error), { status: 500 })
  }
} })

const realQuery = sdk.query
spyOn(sdk, "query").mockImplementation(input => {
  const key = `${current}|${++queryCount}`
  queries.push({ key, turn: current, sessionId: input.options?.sessionId, resume: input.options?.resume })
  return realQuery({ ...input, options: { ...input.options,
    env: { ...input.options?.env, ANTHROPIC_CUSTOM_HEADERS: `x-gate-query: ${key}` } } })
})

const { startProxyServer } = await import("../src/proxy/server.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: [{ id: "fixture", type: "api", apiKey: "local-test-key", baseUrl: `http://127.0.0.1:${upstream.port}` }] })
const address = proxy.server.address()
assert(address && typeof address === "object")

const session = randomUUID()
const history = []
/** One Claude Code turn: what the client sends, as a 2.1.290 client sends it. */
async function turn(name, text, tools) {
  current = name
  history.push({ role: "user", content: text })
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "claude-cli/2.1.290 (external, cli)" },
    body: JSON.stringify({ model: "sonnet", stream: false, max_tokens: 256, tools: [...OWN, ...tools], messages: history,
      metadata: { user_id: JSON.stringify({ session_id: session }) } }),
    signal: AbortSignal.timeout(120_000),
  })
  const raw = await response.text()
  assert.equal(response.status, 200, raw)
  history.push({ role: "assistant", content: JSON.parse(raw).content })
}

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}
/**
 * As the API reads a message list: without the breakpoints, which move to the
 * newest turn, and with string content as the one text block it stands for.
 * The CLI sends its own trailing `system` message as blocks while it is last
 * and as a string after, directly and through the proxy alike.
 */
const plain = messages => JSON.parse(JSON.stringify(messages, (key, v) => key === "cache_control" ? undefined : v))
  .map(message => typeof message.content === "string" ? { ...message, content: [{ type: "text", text: message.content }] } : message)
const text = message => typeof message?.content === "string" ? message.content
  : (message?.content ?? []).map(block => block.text ?? "").join("\n")
// The CLI puts its own environment in a `system` message after the first user
// message, so the client's turn is the last user message, not the last message.
const lastTurn = call => text(call.body.messages.findLast(message => message.role === "user"))
const loaded = call => (call.body.tools ?? []).filter(sent => !sent.defer_loading).map(sent => sent.name).sort().join(",")

try {
  await turn("t1", "first", mcp(0, 1))
  await turn("t2", "second", mcp(0, 1, 2))
  await turn("t3", "third", mcp(0, 1, 2))
  await turn("t4", "fourth", mcp(0, 2))

  const byTurn = name => calls.filter(call => call.turn === name)
  const [c1, c2, c3, c4] = ["t1", "t2", "t3", "t4"].map(name => byTurn(name)[0])
  console.log(`\nCLI on the wire: ${cliVersion ?? "unknown"}; ${calls.length} Messages calls for 4 turns`)
  check(["t1", "t2", "t3", "t4"].every(name => byTurn(name).length === 1), "each turn is one Messages call",
    ["t1", "t2", "t3", "t4"].map(name => byTurn(name).length).join("/"))
  assert(c1 && c2 && c3 && c4, "a turn reached no Messages call")

  const all = [c1, c2, c3, c4]
  check(all.every(call => (call.body.tools ?? []).some(sent => sent.name === "ToolSearch")), "ToolSearch is on offer on every call")
  check(all.every(call => !JSON.stringify(call.body.system).includes("mcp__fixture__")), "no deferred tool is named in the system prompt")
  check(all.every(call => JSON.stringify(call.body.system) === JSON.stringify(c1.body.system)), "the system prompt is the same on every call",
    all.map(call => JSON.stringify(call.body.system).length).join("/"))
  check(all.every(call => loaded(call) === loaded(c1)), "the loaded tools are the same on every call", loaded(c1))

  check(lastTurn(c1).startsWith("first") && lastTurn(c1).includes(NOW_AVAILABLE) && lastTurn(c1).includes(`\n${registered(0)}\n${registered(1)}\n</system-reminder>`),
    "turn 1 names every deferred tool after the client's text")
  const prefixHolds = (later, earlier) => JSON.stringify(plain(later.body.messages.slice(0, earlier.body.messages.length))) === JSON.stringify(plain(earlier.body.messages))
  check(prefixHolds(c2, c1) && prefixHolds(c3, c2) && prefixHolds(c4, c3), "each call's messages begin with the previous call's, unchanged")
  check(lastTurn(c2).includes(NOW_AVAILABLE) && lastTurn(c2).includes(`\n${registered(2)}\n</system-reminder>`) && !lastTurn(c2).includes(registered(0)),
    "turn 2 names only the tool that connected", lastTurn(c2).slice(0, 80).replace(/\n/g, "⏎"))
  check(!lastTurn(c3).includes("<system-reminder>"), "turn 3 names nothing", JSON.stringify(lastTurn(c3)).slice(0, 80))
  check(lastTurn(c4).includes(GONE) && lastTurn(c4).includes(`\n${registered(1)}\n`) && !lastTurn(c4).includes(NOW_AVAILABLE),
    "turn 4 names the tool that disconnected as gone")

  // Each turn's SDK query is given a fresh id for the session it leaves (the
  // proxy forks on resume), and the next turn resumes that one.
  const turnQueries = ["t1", "t2", "t3", "t4"].map(name => queries.find(query => query.turn === name))
  check(!turnQueries[0]?.resume && turnQueries.slice(1).every((query, i) => query?.resume && query.resume === turnQueries[i]?.sessionId),
    "each turn after the first resumes the session the one before left", turnQueries.map(query => query?.resume ? "resume" : "fresh").join("/"))
  check(upstreamErrors.length === 0, "the scripted API saw nothing it could not serve", upstreamErrors[0])
  if (process.env.E2E_DEBUG) {
    console.log("queries:", JSON.stringify(queries, null, 0))
    console.log("turn 1 last message:", JSON.stringify(c1.body.messages.at(-1)).slice(0, 1500))
    for (const [later, earlier, label] of [[c2, c1, "2v1"], [c3, c2, "3v2"], [c4, c3, "4v3"]]) {
      const a = plain(earlier.body.messages), b = plain(later.body.messages.slice(0, a.length))
      const at = a.findIndex((message, i) => JSON.stringify(message) !== JSON.stringify(b[i]))
      console.log(`prefix ${label}: ${a.length} vs ${later.body.messages.length} messages, first difference at ${at}`)
      if (at >= 0) {
        console.log("  earlier:", JSON.stringify(a[at]).slice(0, 700))
        console.log("  later:  ", JSON.stringify(b[at]).slice(0, 700))
      }
    }
  }
} finally {
  await proxy.close?.()
  upstream.stop(true)
  rmSync(root, { recursive: true, force: true })
}

console.log(failures.length === 0 ? "\nALL PASS" : `\n${failures.length} FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
