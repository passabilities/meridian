#!/usr/bin/env bun
// Live: the REAL Claude Code client, with an MCP server of many tools, talking
// to the real model through this checkout's proxy. Are the server's tools kept
// out of the prompt, can the model still reach one, and what does a tool turn
// cost upstream?
//
// The scripted gate (scripts/e2e-deferred-tool-turn.mjs) holds the mechanism
// against the real CLI without model calls. This one shows the real model,
// client and SDK agreeing with it, in three client runs:
//
//   loaded    deferral switched off (MERIDIAN_PASSTHROUGH_TOOL_SEARCH=0): every
//             tool in the prompt. One Bash call. The baseline.
//   deferred  the same exchange with deferral on: the MCP server's tools are
//             gone from the prompt, the client's own stay, and the tool turn is
//             still one Messages call.
//   discover  the model is asked for something only an MCP tool can answer: it
//             has to find the tool with ToolSearch, call it, and the client has
//             to run it for real (the answer is a value only the server knows).
//
// The MCP server is a fixture written to the run's temp directory: one tool
// that answers, and FILLER_TOOLS more that only take up room, as a real
// server's unused tools do. The client gets its own CLAUDE_CONFIG_DIR and a
// dummy bearer token; the proxy keeps its real Claude Max authentication. The
// client's environment is scrubbed of `CLAUDE*` variables so running this from
// inside Claude Code cannot hand it a live session, and of ENABLE_TOOL_SEARCH
// so the client does not defer on its own side.
//
// Costs a few cents of real tokens and needs Claude Max and the `claude` CLI.
//
//   bun scripts/e2e-deferred-tool-turn-live.mjs
//
// PROBE_MODEL picks the model (default sonnet). E2E_CLAUDE_PATH picks the CLI
// the proxy's SDK drives (default: this checkout's node_modules/.bin/claude,
// the one `npm run start` uses). FILLER_TOOLS sizes the server (default 60).
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"
import { setSessionStoreDir } from "../src/proxy/sessionStore.ts"

const say = console.log.bind(console)
const which = spawnSync("command", ["-v", "claude"], { shell: true, encoding: "utf8" })
if (which.status !== 0 || !which.stdout.trim()) {
  say("SKIP: the `claude` CLI is not on PATH; this gate drives the real client")
  process.exit(1)
}
const CLIENT = which.stdout.trim()
const clientVersion = spawnSync(CLIENT, ["--version"], { encoding: "utf8" }).stdout.trim()
const sdkCli = process.env.E2E_CLAUDE_PATH ? resolve(process.env.E2E_CLAUDE_PATH) : resolve(import.meta.dir, "../node_modules/.bin/claude")
const sdkCliVersion = spawnSync(sdkCli, ["--version"], { encoding: "utf8" }).stdout.trim()
const MODEL = process.env.PROBE_MODEL ?? "sonnet"
const FILLER_TOOLS = Number(process.env.FILLER_TOOLS ?? 60)

const WORKDIR = realpathSync(mkdtempSync(join(tmpdir(), "mdeferlive-")))
// An operator's own pins must not decide what this gate measures.
for (const key of Object.keys(process.env)) {
  if ((key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) && key !== "MERIDIAN_CONFIG_DIR") delete process.env[key]
}
Object.assign(process.env, { MERIDIAN_WORKDIR: WORKDIR, MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_CLAUDE_PATH: sdkCli })
setSessionStoreDir(join(WORKDIR, "store"))

// The MCP server. `order_receipt` answers with a value made here and written
// nowhere else, so an answer that carries it proves the client ran the tool.
const RECEIPT = `RCPT-${randomUUID()}`
const serverPath = join(WORKDIR, "fixture-mcp.mjs")
writeFileSync(serverPath, `
import { createInterface } from "node:readline"
const filler = Array.from({ length: ${FILLER_TOOLS} }, (_, i) => ({
  name: "inventory_report_" + String(i).padStart(2, "0"),
  description: ("Produces inventory report " + i + " for a warehouse region. ").repeat(4) +
    "Parameters select the region, the reporting window, the grouping and the output format; results are paginated. " +
    "Use only when the user asks for this specific report by number.",
  inputSchema: { type: "object", properties: {
    region: { type: "string", description: "Warehouse region code, for example EU-WEST or US-EAST" },
    from: { type: "string", description: "Start of the reporting window, ISO 8601 date" },
    to: { type: "string", description: "End of the reporting window, ISO 8601 date" },
    group_by: { type: "string", enum: ["sku", "supplier", "bin", "day"], description: "How rows are grouped" },
    format: { type: "string", enum: ["table", "csv", "json"], description: "Output format" },
    page: { type: "integer", description: "Page of results, starting at 1" },
  }, required: ["region"] },
}))
const tools = [{
  name: "order_receipt",
  description: "Look up the receipt code of a customer order by its order number.",
  inputSchema: { type: "object", properties: { order: { type: "string", description: "The order number" } }, required: ["order"] },
}, ...filler]
const send = message => process.stdout.write(JSON.stringify(message) + "\\n")
createInterface({ input: process.stdin }).on("line", line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.id === undefined) return
  const reply = result => send({ jsonrpc: "2.0", id: request.id, result })
  if (request.method === "initialize") return reply({ protocolVersion: request.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } })
  if (request.method === "tools/list") return reply({ tools })
  if (request.method === "tools/call") {
    const name = request.params?.name
    return reply({ content: [{ type: "text", text: name === "order_receipt" ? "Receipt code for order " + request.params?.arguments?.order + ": ${RECEIPT}" : "No rows." }] })
  }
  if (request.method === "ping") return reply({})
  send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } })
})
`)
const mcpConfigPath = join(WORKDIR, "mcp.json")
writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [serverPath] } } }))

// One record per SDK query. A Messages call is one assistant message id: the
// SDK surfaces a call's blocks as several assistant messages sharing it.
let phase = "setup"
const queries = []
const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  const options = input.options ?? {}
  const system = typeof options.systemPrompt === "string" ? options.systemPrompt : options.systemPrompt?.append ?? ""
  const record = { phase, model: options.model, maxTurns: options.maxTurns, resumed: Boolean(options.resume), resumeSessionAt: Boolean(options.resumeSessionAt),
    sdkTools: options.tools ?? [], clientTools: options.allowedTools?.length ?? 0,
    announced: (system.match(/^mcp__oc__mcp__fixture__/gm) ?? []).length,
    calls: new Map(), toolUses: [], result: undefined }
  queries.push(record)
  const actual = realQuery(input)
  return new Proxy(actual, { get(target, property) {
    if (property === Symbol.asyncIterator) return async function* () {
      for await (const message of actual) {
        if (message.type === "assistant" && message.message?.id) {
          const usage = message.message.usage ?? {}
          record.calls.set(message.message.id, {
            read: usage.cache_read_input_tokens ?? 0, write: usage.cache_creation_input_tokens ?? 0,
            input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 })
          for (const block of message.message.content ?? []) if (block.type === "tool_use") record.toolUses.push(block.name)
        }
        if (message.type === "result") record.result = message.subtype
        yield message
      }
    }
    const value = Reflect.get(target, property, target)
    return typeof value === "function" ? value.bind(target) : value
  } })
})

const proxyLog = []
for (const k of ["log", "error", "debug", "warn"]) console[k] = (...a) => { proxyLog.push(`${phase} ${a.map(String).join(" ")}`) }
const { startProxyServer } = await import("../src/proxy/server.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1" })
const address = proxy.server.address()

const failures = []
const check = (ok, label, detail) => {
  say(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

async function runClient(name, prompt) {
  phase = name
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^CLAUDE(CODE|_)/.test(key) || key.startsWith("MERIDIAN_") || key.startsWith("ANTHROPIC_") || key === "ENABLE_TOOL_SEARCH") delete env[key]
  }
  Object.assign(env, { CLAUDE_CONFIG_DIR: join(WORKDIR, `client-config-${name}`), ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`, ANTHROPIC_AUTH_TOKEN: "meridian-e2e-dummy" })
  const proc = Bun.spawn([CLIENT, "-p", prompt, "--model", MODEL, "--permission-mode", "default",
    "--mcp-config", mcpConfigPath, "--strict-mcp-config",
    "--allowedTools", "Bash(echo:*)", "mcp__fixture__order_receipt"],
  { cwd: WORKDIR, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => proc.kill(), 300_000)
  const [out, err, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  clearTimeout(timer)
  return { status, out: out.trim(), err: err.trim() }
}

const nonce = `deferred-turn-${randomUUID()}`
const echoPrompt = `Run this exact shell command with the Bash tool: echo ${nonce}\nThen reply with only the command's output.`
const runs = {}
try {
  process.env.MERIDIAN_PASSTHROUGH_TOOL_SEARCH = "0"
  runs.loaded = await runClient("loaded", echoPrompt)
  delete process.env.MERIDIAN_PASSTHROUGH_TOOL_SEARCH
  runs.deferred = await runClient("deferred", echoPrompt)
  runs.discover = await runClient("discover",
    "Look up the receipt code of customer order 42 with the order receipt tool of the fixture MCP server, then reply with only the receipt code.")
} finally {
  await proxy.close()
  observer.mockRestore()
}

const total = call => call.read + call.write + call.input
const withTools = name => queries.filter(query => query.phase === name && query.clientTools > 0)
const toolTurns = name => withTools(name).filter(query => query.toolUses.length > 0 && !query.resumed)
const firstCall = name => [...(withTools(name)[0]?.calls.values() ?? [])][0]

say(`\n=== tool deferral, live (model=${MODEL}, ${FILLER_TOOLS + 1} MCP tools) ===`)
say(`  client: ${clientVersion} (${CLIENT})`)
say(`  SDK CLI: ${sdkCliVersion} (${sdkCli})`)
for (const name of Object.keys(runs)) {
  const line = proxyLog.find(entry => entry.startsWith(`${name} `) && entry.includes("deferred="))
  say(`  ${name}: proxy ${line?.replace(/^.*\[PROXY\]\s*\S+\s*/, "") ?? "(no deferred= line: nothing marked for deferral)"}`)
  for (const [index, query] of withTools(name).entries()) {
    const calls = [...query.calls.values()]
    say(`    query ${index + 1}: model=${query.model} tools=${query.clientTools} sdkTools=${JSON.stringify(query.sdkTools)} announced=${query.announced} maxTurns=${query.maxTurns} resumed=${query.resumed} ` +
      `calls=${calls.length} result=${query.result} tool_use=[${query.toolUses.join(",")}] ` +
      `prompt/out per call=${calls.map(call => `${total(call)}(read ${call.read})/${call.output}`).join(" | ")}`)
  }
}
const ignored = proxyLog.find(entry => entry.includes("calls the model again after a hook asks it to stop"))
if (ignored) say(`  proxy: ${ignored.replace(/^.*\[PROXY\]\s*\S+\s*/, "")}`)

say("\n  loaded (deferral off)")
check(runs.loaded.status === 0 && runs.loaded.out.includes(nonce), "the client ran the tool and answered with its output",
  `exit=${runs.loaded.status} out=${runs.loaded.out.slice(0, 80)}${runs.loaded.status === 0 ? "" : ` err=${runs.loaded.err.slice(-300)}`}`)
check(withTools("loaded").length > 0 && withTools("loaded").every(query => query.sdkTools.length === 0 && query.maxTurns === 1 && query.announced === 0),
  "every query has all tools loaded, no ToolSearch and the one-turn cap")
check(toolTurns("loaded").length >= 1 && toolTurns("loaded").every(query => query.calls.size === 1), "the tool turn is one Messages call",
  toolTurns("loaded").map(query => `${query.calls.size} call(s)`).join("; ") || "no tool turn seen")

say("\n  deferred (the same exchange)")
check(runs.deferred.status === 0 && runs.deferred.out.includes(nonce), "the client ran the tool and answered with its output",
  `exit=${runs.deferred.status} out=${runs.deferred.out.slice(0, 80)}${runs.deferred.status === 0 ? "" : ` err=${runs.deferred.err.slice(-300)}`}`)
check(withTools("deferred").length > 0 && withTools("deferred").every(query => JSON.stringify(query.sdkTools) === '["ToolSearch"]' && query.announced === FILLER_TOOLS + 1),
  "every query offers ToolSearch and names the MCP server's tools, and only those",
  withTools("deferred").map(query => `sdkTools=${JSON.stringify(query.sdkTools)} announced=${query.announced}`).join("; "))
check(toolTurns("deferred").length >= 1 && toolTurns("deferred").every(query => query.calls.size === 1 && query.result === "success" && !query.toolUses.includes("ToolSearch")),
  "a call to one of the client's own tools is still one Messages call, with no ToolSearch",
  toolTurns("deferred").map(query => `${query.calls.size} call(s), ${query.result}, [${query.toolUses.join(",")}]`).join("; ") || "no tool turn seen")
const loadedPrompt = firstCall("loaded") ? total(firstCall("loaded")) : 0
const deferredPrompt = firstCall("deferred") ? total(firstCall("deferred")) : 0
check(loadedPrompt > 0 && deferredPrompt > 0 && deferredPrompt < loadedPrompt * 0.8,
  "the prompt is smaller by the MCP server's tool definitions",
  `${loadedPrompt} tokens loaded, ${deferredPrompt} deferred: ${loadedPrompt - deferredPrompt} fewer per call (${Math.round((1 - deferredPrompt / loadedPrompt) * 100)}%)`)
const resumedDeferred = withTools("deferred").filter(query => query.resumed)
check(resumedDeferred.length >= 1 && resumedDeferred.every(query => query.resumeSessionAt && [...query.calls.values()].every(call => call.read > 0)),
  "the follow-up resumes at the tool call and reads the turn's prompt back from the cache",
  resumedDeferred.map(query => [...query.calls.values()].map(call => `read=${call.read} write=${call.write}`).join(",")).join("; ") || "no resumed query seen")

say("\n  discover (a tool that is not in the prompt)")
check(runs.discover.status === 0 && runs.discover.out.includes(RECEIPT), "the client ran the MCP tool and answered with the value only its server knows",
  `exit=${runs.discover.status} out=${runs.discover.out.slice(0, 80)}${runs.discover.status === 0 ? "" : ` err=${runs.discover.err.slice(-300)}`}`)
const discovery = withTools("discover").find(query => query.toolUses.includes("ToolSearch"))
const searchAt = discovery?.toolUses.indexOf("ToolSearch") ?? -1
const callAt = discovery?.toolUses.findIndex(name => name.endsWith("mcp__fixture__order_receipt")) ?? -1
check(discovery !== undefined && callAt > searchAt, "the model loaded the tool with ToolSearch and then called it, in one query",
  discovery ? `tool_use=[${discovery.toolUses.join(",")}] ${discovery.calls.size} Messages call(s), ${discovery.result}` : `no ToolSearch seen: ${withTools("discover").map(query => `[${query.toolUses.join(",")}]`).join(" ")}`)
const discoveryCalls = discovery ? [...discovery.calls.values()] : []
check(discoveryCalls.length >= 2 && discoveryCalls.slice(1).every(call => call.read > 0),
  "the call after the ToolSearch round reads the prompt back from the cache",
  discoveryCalls.map(call => `prompt ${total(call)} read ${call.read} write ${call.write}`).join(" | "))

const all = queries.filter(query => query.clientTools > 0)
say(`\n${failures.length === 0 ? "PASS" : "FAIL"}: ${all.reduce((sum, query) => sum + query.calls.size, 0)} Messages call(s) across ${all.length} tool-bearing queries`)
// A failed run keeps the client's config and the proxy's session store.
if (failures.length === 0) rmSync(WORKDIR, { recursive: true, force: true })
else say(`  kept: ${WORKDIR}`)
process.exit(failures.length === 0 ? 0 : 1)
