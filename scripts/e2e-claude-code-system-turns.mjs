#!/usr/bin/env bun
// The real Claude Code client through a real proxy, SDK and CLI, against a
// scripted Messages API: no model calls. Does every tool round of a
// conversation resume its SDK session, or does one replay the whole history?
//
// claude-cli ends a tool-result request with a `system` turn (its
// mid-conversation-system feature), and on some models it appends a reminder
// that lives for that one request. On claude-fable-5-1 with 2.1.289 the turn is
//
//   system: [ "<total_tokens>N tokens left</total_tokens>" (cache_control),
//             "First privately list what you need next; ..." ]
//
// and the request after it carries the same turn as the plain string
// "<total_tokens>N tokens left</total_tokens>". Meridian hashed the reminder
// into the session's lineage, so every tool round after the first looked like
// edited history and was replayed into a new SDK session. On a live proxy on
// 2026-10-05, 32 such turns of nine Fable subagents wrote 5.4M tokens to the
// cache (168K each; the turns that resumed wrote 10K) and re-planned at 11K
// output tokens apiece. The one earlier gate with the real client,
// e2e-claude-code-client.mjs, stops after a single tool round, which is the one
// round that did resume.
//
// This gate runs ROUNDS tool rounds (default 5) and holds, for every request
// after the first: lineage `continuation`, an SDK query that resumes the
// session the round before it left, a history the API receives as structured
// tool_use/tool_result turns and not as a replay, and the request's own
// reminder delivered to the model.
//
//   bun scripts/e2e-claude-code-system-turns.mjs [model]
//
// The model defaults to claude-fable-5-1. E2E_CLAUDE_CLIENT picks the client
// (default: `claude` on PATH) and E2E_CLAUDE_PATH the CLI the SDK drives. Both
// versions are printed. If a client stops sending a one-request reminder the
// gate says so and still holds the resume claims.
//
// E2E_SUBAGENT=1 runs the rounds in an Agent-tool subagent instead: the
// scripted main thread delegates, and the subagent's requests (the ones with
// `x-claude-code-agent-id`) are the conversation held to the claims. That is
// the shape of the live failure: Fable subagents under a main thread.
//
// E2E_MCP_TOOLS=<n> gives the client a stdio MCP server with n tools it never
// calls. The proxy defers them (E76) beside the tools of its own the client
// defers on a direct connection, which it defers without them too (E80): the
// same rounds then have to resume with ToolSearch on offer, those tools out of
// every request and the query ended by the hook instead of the cap.
//
// The proxy runs in a git repository of its own, apart from the client's
// directory, and with no MERIDIAN_WORKDIR, as an installed proxy does. The gate
// also holds what a request carries (E80): the SDK child runs in the client's
// directory, which the client states among its messages; the system prompt
// the API receives is the client's with the proxy's notes and nothing more;
// every tool description is whole; and nothing of the directory the proxy
// runs in is in a request. With the SDK's claude_code preset on and the
// client's directory not found, every call carried that preset ahead of the
// client's own prompt, and the path and git status of the proxy's directory.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"

const MODEL = process.argv[2] ?? "claude-fable-5-1"
const ROUNDS = Number(process.env.ROUNDS ?? 5)
// The client runs in the fixture directory, so a relative path is resolved here.
const CLIENT = process.env.E2E_CLAUDE_CLIENT?.includes("/") ? resolve(process.env.E2E_CLAUDE_CLIENT) : process.env.E2E_CLAUDE_CLIENT ?? "claude"
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-cc-system-turns-")))
const work = join(root, "work")
mkdirSync(work)
// Where the proxy runs: a repository with a commit and an untracked file, so
// that its git status would be recognised in a request.
const proxyDir = join(root, "proxy")
const PROXY_COMMIT = "PROXY-REPOSITORY-COMMIT"
const PROXY_FILE = "PROXY-REPOSITORY-UNTRACKED.txt"
mkdirSync(proxyDir)
writeFileSync(join(proxyDir, "tracked.txt"), "tracked\n")
for (const args of [["init", "-q"], ["add", "tracked.txt"], ["commit", "-q", "-m", PROXY_COMMIT]]) {
  execFileSync("git", ["-c", "user.name=gate", "-c", "user.email=gate@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: proxyDir, stdio: "pipe" })
}
writeFileSync(join(proxyDir, PROXY_FILE), "untracked\n")
const fixtures = Array.from({ length: ROUNDS + 1 }, (_, index) => join(work, `fixture-${index}.txt`))
for (const [index, file] of fixtures.entries()) writeFileSync(file, `fixture ${index} ${randomUUID()}\n`)

const SUBAGENT = process.env.E2E_SUBAGENT === "1"
const SUBAGENT_TASK = "SUBAGENT-TASK: read the fixture files one after another and report."
const MCP_TOOLS = Number(process.env.E2E_MCP_TOOLS ?? 0)
let mcpConfig = '{"mcpServers":{}}'
if (MCP_TOOLS > 0) {
  const serverPath = join(root, "fixture-mcp.mjs")
  writeFileSync(serverPath, `
import { createInterface } from "node:readline"
const tools = Array.from({ length: ${MCP_TOOLS} }, (_, i) => ({
  name: "inventory_report_" + String(i).padStart(2, "0"),
  description: "Produces inventory report " + i + " for a warehouse region. Use only when asked for this report by number.",
  inputSchema: { type: "object", properties: { region: { type: "string", description: "Warehouse region code" } }, required: ["region"] },
}))
const send = message => process.stdout.write(JSON.stringify(message) + "\\n")
createInterface({ input: process.stdin }).on("line", line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.id === undefined) return
  const reply = result => send({ jsonrpc: "2.0", id: request.id, result })
  if (request.method === "initialize") return reply({ protocolVersion: request.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" }, instructions: "Inventory reports are read-only. Ask for one by number." })
  if (request.method === "tools/list") return reply({ tools })
  if (request.method === "tools/call") return reply({ content: [{ type: "text", text: "No rows." }] })
  if (request.method === "ping") return reply({})
  send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } })
})
`)
  mcpConfig = join(root, "mcp.json")
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [serverPath] } } }))
}

for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0",
  // The scripted API is a base URL that is not Anthropic's own, where deferral
  // stays off unless the operator vouches for the upstream (E76). It only
  // comes into play with E2E_MCP_TOOLS.
  MERIDIAN_PASSTHROUGH_TOOL_SEARCH: "force",
  // The fixture profile authenticates with an API key, so the SDK child needs
  // nothing from the user's own Claude config; its transcripts stay under root.
  CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  // And an API key's prompt cache is written for five minutes whatever the
  // conversation. This is the CLI's switch for the hour a subscription gets,
  // so that the lifetime asked for a subagent can be told from the default.
  ENABLE_PROMPT_CACHING_1H: "1",
  ...(process.env.E2E_CLAUDE_PATH ? { MERIDIAN_CLAUDE_PATH: resolve(process.env.E2E_CLAUDE_PATH) } : {}),
})

function sse(blocks, stopReason, model, inputTokens) {
  const events = [{ type: "message_start", message: { id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`, type: "message", role: "assistant", content: [], model,
    stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }]
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
    { headers: { "content-type": "text/event-stream", "request-id": `system-turns-${upstreamCalls.length}` } })
}

// The scripted model: one Read per round (two in the first, as a parallel
// call), then the answer. Usage grows so each round's token notice differs.
// With E2E_SUBAGENT the main thread only delegates and the rounds are the
// subagent's, told apart by the task its conversation opens with.
const upstreamCalls = []
const parentCalls = []
// How long the cache breakpoints of a Messages request ask to be kept.
const cacheLifetimes = body => [...new Set((JSON.stringify([body.system, body.tools, body.messages]).match(/"cache_control":\{[^{}]*\}/g) ?? [])
  .map(mark => mark.includes('"ttl":"1h"') ? "1h" : "5m"))]
const upstreamErrors = []
let cliVersion
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  try {
    if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
    const body = await request.json()
    const readName = (body.tools ?? []).map(tool => tool.name).find(name => name.endsWith("Read"))
    // The client's and the CLI's own side calls carry no Read tool.
    if (!readName) return sse([{ type: "text", text: "ok" }], "end_turn", body.model, 100)
    cliVersion ??= JSON.stringify(body.system ?? "").match(/cc_version=([0-9.]+[0-9])/)?.[1]
    if (SUBAGENT && !JSON.stringify(body.messages[0] ?? "").includes("SUBAGENT-TASK")) {
      parentCalls.push({ messages: body.messages, cache: cacheLifetimes(body), body })
      const agentName = (body.tools ?? []).map(tool => tool.name).find(name => name.endsWith("Agent"))
      if (parentCalls.length > 1 || !agentName) return sse([{ type: "text", text: "ALL-FIXTURES-READ" }], "end_turn", body.model, 9000)
      return sse([{ type: "tool_use", id: `toolu_delegate_${randomUUID().replaceAll("-", "").slice(0, 12)}`, name: agentName,
        input: { description: "Read fixtures", prompt: SUBAGENT_TASK, subagent_type: "general-purpose" } }], "tool_use", body.model, 4000)
    }
    const call = upstreamCalls.length + 1
    upstreamCalls.push({ call, messages: body.messages, tools: (body.tools ?? []).map(tool => tool.name), cache: cacheLifetimes(body), body })
    const read = index => ({ type: "tool_use", id: `toolu_round${call}_${index}_${randomUUID().replaceAll("-", "").slice(0, 12)}`, name: readName, input: { file_path: fixtures[index] } })
    if (call === 1) return sse([{ type: "text", text: "Reading two." }, read(0), read(1)], "tool_use", body.model, 100 + 5000 * call)
    if (call <= ROUNDS) return sse([read(call)], "tool_use", body.model, 100 + 5000 * call)
    return sse([{ type: "text", text: SUBAGENT ? "SUBAGENT-DONE" : "ALL-FIXTURES-READ" }], "end_turn", body.model, 100 + 5000 * call)
  } catch (error) {
    upstreamErrors.push(String(error?.stack ?? error))
    return new Response(String(error), { status: 500 })
  }
} })

const queries = []
const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  queries.push({ model: input.options?.model, cwd: input.options?.cwd, sessionId: input.options?.sessionId, resume: input.options?.resume,
    resumeSessionAt: input.options?.resumeSessionAt, maxTurns: input.options?.maxTurns,
    sdkTools: input.options?.tools ?? [], clientTools: input.options?.allowedTools?.length ?? 0,
    textPrompt: typeof input.prompt === "string" ? input.prompt : undefined })
  return realQuery(input)
})

// Where the proxy process is, and so where its SDK children run when a
// request names no directory of its own that exists here.
process.chdir(proxyDir)
const { startProxyServer } = await import("../src/proxy/server.ts")
const { telemetryStore } = await import("../src/telemetry/index.ts")
const { TOOL_SEARCH_TURN_BUDGET } = await import("../src/proxy/passthroughToolSearch.ts")
const { CLAUDE_CODE_DEFERRED_TOOLS } = await import("../src/proxy/transforms/claudecode.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: [{ id: "fixture", type: "api", apiKey: "local-test-key", baseUrl: `http://127.0.0.1:${upstream.port}` }] })
const address = proxy.server.address()
assert(address && typeof address === "object")
const proxyUrl = `http://127.0.0.1:${address.port}`

// What the client sends, recorded on its way to the proxy and stamped with a
// request id: the proxy's telemetry rows carry no agent id, and the id is how
// a row is tied back to the conversation it belongs to.
const clientRequests = []
const parentRequests = []
const requestIds = new Map()
const relay = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  const url = new URL(request.url)
  if (request.method !== "POST" || !url.pathname.endsWith("/messages")) {
    return fetch(proxyUrl + url.pathname + url.search, { method: request.method, headers: request.headers,
      ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: await request.arrayBuffer() }) })
  }
  const raw = await request.text()
  const body = JSON.parse(raw)
  const headers = new Headers(request.headers)
  if ((body.tools ?? []).some(tool => tool.name === "Read")) {
    const requestId = randomUUID()
    headers.set("x-request-id", requestId)
    const ofSubagent = Boolean(request.headers.get("x-claude-code-agent-id"))
    const list = ofSubagent === SUBAGENT ? clientRequests : parentRequests
    list.push(body)
    requestIds.set(requestId, list)
  }
  return fetch(proxyUrl + url.pathname + url.search, { method: "POST", headers, body: raw, signal: AbortSignal.timeout(180_000) })
} })

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}
const blocksOf = message => Array.isArray(message?.content) ? message.content : typeof message?.content === "string" ? [{ type: "text", text: message.content }] : []

let clientVersion = "unknown"
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
  // The subagent run lets the client start its Agent tool unasked: the model
  // is scripted and the directory is this gate's own.
  const child = Bun.spawn([CLIENT, "-p", SUBAGENT ? "Delegate reading the fixtures to a subagent." : "Read the fixture files one after another and report.", "--model", MODEL,
    ...(SUBAGENT ? ["--allowedTools", "Read,Agent", "--permission-mode", "bypassPermissions"] : ["--allowedTools", "Read"]),
    "--strict-mcp-config", "--mcp-config", mcpConfig, "--setting-sources", ""],
    { cwd: work, env, stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => child.kill(), 240_000)
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  clearTimeout(timer)

  console.log(`\n=== ${clientVersion}, ${MODEL}, ${ROUNDS} tool rounds${SUBAGENT ? " in a subagent" : ""}${MCP_TOOLS > 0 ? `, ${MCP_TOOLS} MCP tools` : ""} ===`)
  check(code === 0 && out.includes("ALL-FIXTURES-READ"), "the client finishes the conversation", `exit=${code} out=${JSON.stringify(out.trim().slice(0, 60))}${code === 0 ? "" : ` err=${JSON.stringify(err.slice(0, 300))}`}`)
  check(clientRequests.length === ROUNDS + 1, `${SUBAGENT ? "the subagent" : "the client"} makes one request per tool round and one for the answer`, `${clientRequests.length} request(s)`)
  const allRows = telemetryStore.getRecent({ limit: 200 }).sort((a, b) => a.timestamp - b.timestamp)
  const rowsOf = list => allRows.filter(row => requestIds.get(row.requestId) === list)
  if (SUBAGENT) {
    const parentRows = rowsOf(parentRequests)
    // The client may start the subagent in the background and come back for
    // its answer in a further request; how many is the client's business.
    const parentLineage = parentRows.map(row => row.lineageType)
    check(parentRequests.length >= 2 && parentLineage.length === parentRequests.length && parentLineage[0] === "new" && parentLineage.slice(1).every(type => type === "continuation"),
      "the main thread delegates and resumes with the subagent's answer", `${parentRequests.length} request(s): ${parentLineage.join(", ")}`)
    check(JSON.stringify(parentCalls.at(-1)?.messages ?? "").includes("SUBAGENT-DONE"), "the subagent's answer is the result the main thread reads")
  }

  // What the client did with its system turns, for the record: this is the
  // behaviour the fix exists for, and the gate must not pass by its absence.
  const tailBlocks = clientRequests.slice(1).map(body => body.messages.at(-1)?.role === "system" ? blocksOf(body.messages.at(-1)).length : 0)
  const shed = clientRequests.slice(2).map((body, index) => {
    const earlier = clientRequests[index + 1]
    const position = earlier.messages.length - 1
    return blocksOf(earlier.messages[position]).length - blocksOf(body.messages[position]).length
  })
  const sendsOneRequestReminder = tailBlocks.some(count => count > 1) && shed.some(count => count > 0)
  console.log(`  note  trailing system turn blocks per request: [${tailBlocks.join(", ")}]; blocks gone from that turn one request later: [${shed.join(", ")}]`)
  console.log(`  note  ${sendsOneRequestReminder ? "this client appends a one-request reminder to its trailing system turn" : "this client sends NO one-request reminder for this model: the resume claims below hold without the case the fix is for"}`)

  const rows = rowsOf(clientRequests)
  check(rows.length === ROUNDS + 1 && rows.every(row => row.status === 200), "the proxy answers each of them", `${rows.length} row(s), statuses ${[...new Set(rows.map(row => row.status))].join(",")}`)
  const lineage = rows.map(row => row.lineageType)
  check(lineage[0] === "new" && lineage.slice(1).every(type => type === "continuation") && rows.slice(1).every(row => row.isResume === true),
    "every request after the first is a continuation that resumes", lineage.join(", "))

  // The conversation's own queries, by the tool set it declares: the client's
  // side calls carry none, and a subagent's differs from its parent's.
  const main = queries.filter(query => query.clientTools > 0 && query.clientTools === (clientRequests[0]?.tools ?? []).length)
  const chained = main.slice(1).every((query, index) => typeof query.resume === "string" && query.resume.length > 0 && typeof query.resumeSessionAt === "string")
  check(main.length === ROUNDS + 1 && chained && !main[0].resume, "each SDK query after the first resumes at the round before it",
    main.map(query => query.resume ? "resume" : "fresh").join(", "))
  check(main.slice(1).every(query => query.textPrompt === undefined || !query.textPrompt.includes("<conversation_history>")),
    "no round is sent as a replay of the conversation")

  check(upstreamCalls.length === ROUNDS + 1, "each request costs one Messages call", `${upstreamCalls.length} call(s)`)
  // On a subscription the CLI keeps a main conversation's cache for an hour
  // and a subagent's for five minutes; the proxy's query for a subagent is to
  // ask for the same.
  const lifetimes = calls => calls.map(call => call.cache.join("+") || "none").join(", ")
  if (SUBAGENT) {
    check(upstreamCalls.every(call => call.cache.length > 0 && call.cache.every(lifetime => lifetime === "5m")),
      "the subagent's prompt cache is written for five minutes", lifetimes(upstreamCalls))
    check(parentCalls.length > 0 && parentCalls.every(call => call.cache.includes("1h")), "the main thread's is written for an hour", lifetimes(parentCalls))
  } else {
    check(upstreamCalls.every(call => call.cache.includes("1h")), "the conversation's prompt cache is written for an hour", lifetimes(upstreamCalls))
  }
  // The client's system prompt is the prompt. The proxy adds its replay note
  // (640 characters) and nothing else for a client on this host working in
  // the directory the child runs in: not the note separating the client's
  // environment from the child's (1.3K characters, naming one path four
  // times), not the scratchpad counter-instruction, not the deferred tools'
  // names (in the turn now), not a second copy of the identity line the child
  // puts first itself. The preset, before that, was 10K.
  const systemText = body => Array.isArray(body?.system) ? body.system.map(block => block.text ?? "").join("\n") : String(body?.system ?? "")
  const IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK."
  const conversations = [[SUBAGENT ? "the subagent" : "the conversation", clientRequests[0], upstreamCalls[0]?.body],
    ...(SUBAGENT ? [["the main thread", parentRequests[0], parentCalls[0]?.body]] : [])]
  for (const [name, sent, received] of conversations) {
    const text = systemText(received)
    const added = text.length - systemText(sent).length
    const extras = [["<env>", "the working-directory note"], ["passes through a proxy", "the working-directory note"],
      ["Do not use any scratchpad directory", "the scratchpad counter-instruction"], ["available-deferred-tools", "the deferred tools' names"]]
      .filter(([marker]) => text.includes(marker)).map(([, what]) => what)
    const identities = text.split(IDENTITY).length - 1
    check(Boolean(sent && received) && extras.length === 0 && identities <= 1 && added < 800,
      `the system prompt the API receives for ${name} is the client's and the replay note`,
      `${systemText(sent).length} characters from the client, ${text.length} to the API; identity line ${identities}x${extras.length > 0 ? `; also: ${[...new Set(extras)].join(", ")}` : ""}`)
  }
  // And its tools are its tools: the SDK child cuts an MCP tool's description
  // at 2,048 characters, which several of Claude Code's own run past. The
  // child writes an ellipsis as three full stops; nothing else may differ.
  for (const [name, sent, received] of conversations) {
    const received_ = new Map((received?.tools ?? []).map(tool => [tool.name.replace(/^mcp__[^_]+__/, ""), tool.description ?? ""]))
    const loaded = (sent?.tools ?? []).filter(tool => received_.has(tool.name))
    const cut = loaded.filter(tool => received_.get(tool.name) !== (tool.description ?? "").replaceAll("\u2026", "..."))
    const long = loaded.filter(tool => (tool.description ?? "").length > 2048)
    check(loaded.length > 0 && cut.length === 0, `every tool description the API receives for ${name} is whole`,
      `${loaded.length} tool(s) loaded, ${long.length} described at more than 2,048 characters${cut.length > 0 ? `; cut or changed: ${cut.map(tool => `${tool.name} ${(tool.description ?? "").length} -> ${received_.get(tool.name).length}`).join(", ")}` : ""}`)
  }
  // The client says where it works (2.1.290: among the messages, not in the
  // system prompt), and that is where its SDK queries run. Left in the proxy's
  // own directory, the child describes that one to the model as its
  // environment.
  const ofConversation = [...main, ...(SUBAGENT ? queries.filter(query => query.clientTools > 0 && query.clientTools === (parentRequests[0]?.tools ?? []).length) : [])]
  check(ofConversation.length > 0 && ofConversation.every(query => query.cwd === work), "every SDK query runs in the directory the client works in",
    [...new Set(ofConversation.map(query => query.cwd === work ? "the client's" : query.cwd === proxyDir ? "the proxy's" : String(query.cwd)))].join(", "))
  const everyCall = JSON.stringify([...upstreamCalls, ...parentCalls].map(call => call.body))
  check(!everyCall.includes(proxyDir) && !everyCall.includes(PROXY_COMMIT) && !everyCall.includes(PROXY_FILE),
    "nothing of the directory the proxy runs in is in a request: not its path, not its git status")
  const toolsSize = body => JSON.stringify(body?.tools ?? []).length
  console.log(`  note  tool definitions in the first request: ${toolsSize(clientRequests[0])} characters from the client, ${toolsSize(upstreamCalls[0]?.body)} to the API`)
  const deferred = main.length > 0 && main.every(query => JSON.stringify(query.sdkTools) === '["ToolSearch"]')
  console.log(`  note  ${main[0]?.clientTools ?? 0} client tools; ${upstreamCalls[0]?.tools.length ?? 0} declared to the API; ToolSearch ${deferred ? "on offer, turns ended by the hook" : "not on offer, turns ended by the cap"} (maxTurns ${[...new Set(main.map(query => query.maxTurns))].join(",")})`)
  // What the client defers on a direct connection, where its tool search is
  // on, the proxy defers however few there are (E80): the tools of its MCP
  // servers and the ones of its own it names. The rest of its own stay.
  const own = (clientRequests[0]?.tools ?? []).map(tool => tool.name).filter(name => !name.startsWith("mcp__"))
  const deferredOnDirect = own.filter(name => CLAUDE_CODE_DEFERRED_TOOLS.includes(name))
  const kept = own.filter(name => !CLAUDE_CODE_DEFERRED_TOOLS.includes(name))
  if (MCP_TOOLS > 0 || deferredOnDirect.length > 0) {
    check(deferred && main.every(query => query.maxTurns === TOOL_SEARCH_TURN_BUDGET), "with tools deferred, every round is asked with ToolSearch and the discovery budget",
      `sdk tools ${JSON.stringify(main[0]?.sdkTools)} maxTurns ${main[0]?.maxTurns}`)
    if (MCP_TOOLS > 0) {
      check(upstreamCalls.every(row => row.tools.includes("ToolSearch") && !row.tools.some(name => name.includes("inventory_report"))),
        "the server's tools are out of every request", `${upstreamCalls[0]?.tools.length} tool(s) declared, of ${main[0]?.clientTools}`)
    }
    const declares = (row, name) => row.tools.some(declared => declared.endsWith(`__${name}`))
    check(upstreamCalls.every(row => deferredOnDirect.every(name => !declares(row, name)) && kept.every(name => declares(row, name))),
      "the client's own tools that it defers on a direct connection are out of every request, and no other of its own",
      `out: ${deferredOnDirect.join(", ") || "none"}; loaded: ${kept.join(", ")}`)
    // Named in the turn, as the client names them with its own tool search on.
    const firstTurn = (upstreamCalls[0]?.messages ?? []).filter(message => message.role === "user")
      .map(message => typeof message.content === "string" ? message.content : blocksOf(message).map(block => block.text ?? "").join("\n")).join("\n")
    const named = [...deferredOnDirect, ...(MCP_TOOLS > 0 ? ["inventory_report_00"] : [])]
    check(firstTurn.includes("The following deferred tools are now available via ToolSearch.") && named.every(name => firstTurn.includes(`__${name}\n`)),
      "the deferred tools are named in the first turn, as the client names them", `${named.length} checked`)
  } else {
    check(main.every(query => query.maxTurns === 1), "without deferred tools every round is held to the one-turn cap", `maxTurns ${[...new Set(main.map(query => query.maxTurns))].join(",")}`)
  }
  const last = upstreamCalls.at(-1)?.messages ?? []
  const structuredRounds = last.filter(message => message.role === "assistant" && blocksOf(message).some(block => block.type === "tool_use")).length
  const results = last.flatMap(message => blocksOf(message).filter(block => block.type === "tool_result"))
  check(structuredRounds === ROUNDS && results.length === ROUNDS + 1 && fixtures.slice(0, ROUNDS + 1).every((_, index) => JSON.stringify(results).includes(`fixture ${index} `)),
    "the last call carries every round as structured tool_use and tool_result turns", `${structuredRounds} tool round(s), ${results.length} result(s)`)
  if (sendsOneRequestReminder) {
    const reminder = blocksOf(clientRequests.at(-1).messages.at(-1)).at(-1)?.text ?? ""
    const lastTurn = JSON.stringify(last.at(-1) ?? "")
    check(reminder.length > 0 && lastTurn.includes(JSON.stringify(reminder).slice(1, -1)), "the request's own reminder reaches the model", JSON.stringify(reminder.slice(0, 48)))
  }
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
console.log(JSON.stringify({ result: failures.length === 0 ? "PASS" : "FAIL", model: MODEL, rounds: ROUNDS, failures, ...(failures.length === 0 ? {} : { root }) }))
process.exit(failures.length === 0 ? 0 : 1)
