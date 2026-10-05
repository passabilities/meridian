#!/usr/bin/env bun
// Live: the REAL OpenCode client, with an MCP server that takes its tool set
// past the auto-defer threshold, talking to the real model through this
// checkout's proxy. scripts/e2e-deferred-tool-turn-live.mjs is the same
// question asked of Claude Code; the two clients differ in what stays loaded.
// OpenCode's own tools have no name to tell them from a server's, so only its
// six core tools stay in the prompt and everything else is deferred.
//
//   core      a call to `read`, one of the six: no ToolSearch, one Messages
//             call for the tool turn;
//   discover  a question only an MCP tool can answer: the model has to load
//             the tool with ToolSearch, call it, and the client has to run it
//             (the answer is a value only the server knows).
//
// The client gets its own config, data and state directories and a dummy API
// key; the proxy keeps its real Claude Max authentication. Needs `npm run
// build` first (the client loads this checkout's OpenCode plugin from dist/),
// a real OpenCode, and costs a few cents of real tokens.
//
//   E2E_OPENCODE_BIN=opencode bun scripts/e2e-opencode-deferral-live.mjs
//
// PROBE_MODEL picks the model (claude-sonnet-5-5 by default). E2E_CLAUDE_PATH
// picks the CLI the proxy's SDK drives (default: this checkout's
// node_modules/.bin/claude).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { spyOn } from "bun:test"
import * as sdk from "@anthropic-ai/claude-agent-sdk"
import { setSessionStoreDir } from "../src/proxy/sessionStore.ts"

const say = console.log.bind(console)
const bin = process.env.E2E_OPENCODE_BIN || "opencode"
const version = spawnSync(bin, ["--version"], { encoding: "utf8" })
if (version.status !== 0) {
  say(`SKIP: no OpenCode at ${bin}; this gate drives the real client`)
  process.exit(1)
}
const sdkCli = process.env.E2E_CLAUDE_PATH ? resolve(process.env.E2E_CLAUDE_PATH) : resolve(import.meta.dir, "../node_modules/.bin/claude")
const sdkCliVersion = spawnSync(sdkCli, ["--version"], { encoding: "utf8" }).stdout.trim()
const MODEL = process.env.PROBE_MODEL ?? "claude-sonnet-5-5"
const FILLER_TOOLS = 80

const root = realpathSync(mkdtempSync(join(tmpdir(), "opencode-deferral-live-")))
const config = join(root, "config"), project = join(root, "project")
for (const dir of [config, project]) mkdirSync(dir)
// An operator's own pins must not decide what this gate measures.
for (const key of Object.keys(process.env)) {
  if ((key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) && key !== "MERIDIAN_CONFIG_DIR") delete process.env[key]
}
Object.assign(process.env, { MERIDIAN_WORKDIR: root, MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_NO_UPDATE_CHECK: "1", MERIDIAN_CLAUDE_PATH: sdkCli })
setSessionStoreDir(join(root, "store"))

const fileNonce = `CLIENT-READ-${randomUUID()}`
const file = join(project, "receipt.txt")
writeFileSync(file, fileNonce)
// `order_receipt` answers with a value made here and written nowhere else.
const RECEIPT = `RCPT-${randomUUID()}`
const server = join(root, "fixture-mcp.cjs")
writeFileSync(server, `
const readline = require("node:readline")
const filler = Array.from({ length: ${FILLER_TOOLS} }, (_, i) => ({
  name: "inventory_report_" + String(i).padStart(2, "0"),
  description: "Produces inventory report " + i + " for a warehouse region. Use only when the user asks for this report by number.",
  inputSchema: { type: "object", properties: { region: { type: "string", description: "Warehouse region code" } }, required: ["region"] },
}))
const tools = [{
  name: "order_receipt",
  description: "Look up the receipt code of a customer order by its order number.",
  inputSchema: { type: "object", properties: { order: { type: "string", description: "The order number" } }, required: ["order"] },
}, ...filler]
const send = message => process.stdout.write(JSON.stringify(message) + "\\n")
readline.createInterface({ input: process.stdin }).on("line", line => {
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.id === undefined) return
  const reply = result => send({ jsonrpc: "2.0", id: request.id, result })
  if (request.method === "initialize") return reply({ protocolVersion: request.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } })
  if (request.method === "tools/list") return reply({ tools })
  if (request.method === "tools/call") {
    const name = request.params?.name
    return reply({ content: [{ type: "text", text: name === "order_receipt" ? "Receipt code for order " + request.params?.arguments?.order + ": ${RECEIPT}" : "No rows." }] })
  }
  if (request.method === "ping") return reply({})
  send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } })
})
`)

// One record per SDK query. A Messages call is one assistant message id.
let phase = "setup"
const queries = []
const realQuery = sdk.query
const observer = spyOn(sdk, "query").mockImplementation(input => {
  const options = input.options ?? {}
  const system = typeof options.systemPrompt === "string" ? options.systemPrompt : options.systemPrompt?.append ?? ""
  const record = { phase, model: options.model, maxTurns: options.maxTurns, resumed: Boolean(options.resume),
    sdkTools: options.tools ?? [], clientTools: options.allowedTools?.length ?? 0,
    announced: (system.match(/^mcp__oc__/gm) ?? []).length, calls: new Map(), toolUses: [], result: undefined }
  queries.push(record)
  const actual = realQuery(input)
  return new Proxy(actual, { get(target, property) {
    if (property === Symbol.asyncIterator) return async function* () {
      for await (const message of actual) {
        if (message.type === "assistant" && message.message?.id) {
          const usage = message.message.usage ?? {}
          record.calls.set(message.message.id, (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.input_tokens ?? 0))
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
const url = `http://127.0.0.1:${proxy.server.address().port}`
writeFileSync(join(config, "opencode.json"), JSON.stringify({
  $schema: "https://opencode.ai/config.json", plugin: [resolve(import.meta.dir, "../dist/meridian")],
  model: `anthropic/${MODEL}`, small_model: `anthropic/${MODEL}`, share: "disabled", permission: "allow",
  mcp: { fixture: { type: "local", command: [process.execPath, server], enabled: true } },
  provider: { anthropic: { options: { apiKey: "meridian-e2e-dummy", baseURL: url },
    models: { [MODEL]: { name: "Live model", limit: { context: 200000, output: 4096 }, reasoning: false, tool_call: true, modalities: { input: ["text"], output: ["text"] } } } } },
}))

async function runClient(name, prompt) {
  phase = name
  const env = { ...process.env, OPENCODE_CONFIG_DIR: config, OPENCODE_DISABLE_AUTOUPDATE: "1" }
  for (const kind of ["CONFIG", "DATA", "CACHE", "STATE"]) env[`XDG_${kind}_HOME`] = join(root, `${name}-${kind.toLowerCase()}`)
  for (const key of Object.keys(env)) if (/^(MERIDIAN_|CLAUDE_PROXY_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(key)) delete env[key]
  const child = spawn(bin, ["run", "--format", "json", prompt], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = "", stderr = ""
  child.stdout.on("data", chunk => { stdout += chunk })
  child.stderr.on("data", chunk => { stderr += chunk })
  const timer = setTimeout(() => child.kill("SIGKILL"), 300_000)
  const exit = await new Promise((resolveExit, reject) => { child.on("error", reject); child.on("exit", resolveExit) })
  clearTimeout(timer)
  const events = stdout.split("\n").filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
  return { exit, stdout, stderr, errors: events.filter(event => event.type === "error"), toolEnds: events.filter(event => event.type === "tool_use") }
}

const failures = []
const check = (ok, label, detail) => {
  say(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}
const runs = {}
try {
  runs.core = await runClient("core", `Read ${file} with the read tool and reply with only its content.`)
  runs.discover = await runClient("discover", "Look up the receipt code of customer order 42 with the fixture server's order receipt tool, then reply with only the receipt code.")
} finally {
  await proxy.close()
  observer.mockRestore()
}

const roster = name => queries.filter(query => query.phase === name && query.clientTools > 80)
say(`\n=== OpenCode tool deferral, live (model=${MODEL}) ===`)
say(`  client: OpenCode ${version.stdout.trim()} (${bin})`)
say(`  SDK CLI: ${sdkCliVersion} (${sdkCli})`)
for (const name of Object.keys(runs)) {
  const line = proxyLog.find(entry => entry.startsWith(`${name} `) && entry.includes("deferred="))
  say(`  ${name}: proxy ${line?.replace(/^.*\[PROXY\]\s*\S+\s*/, "") ?? "(no deferred= line)"}`)
  for (const [index, query] of roster(name).entries()) {
    say(`    query ${index + 1}: model=${query.model} tools=${query.clientTools} sdkTools=${JSON.stringify(query.sdkTools)} announced=${query.announced} maxTurns=${query.maxTurns} resumed=${query.resumed} ` +
      `calls=${query.calls.size} result=${query.result} tool_use=[${query.toolUses.join(",")}] prompt per call=${[...query.calls.values()].join(" | ")}`)
  }
}

say("\n  core (a tool that stays loaded)")
check(runs.core.exit === 0 && runs.core.errors.length === 0 && runs.core.stdout.includes(fileNonce), "the client read the file and answered with its content",
  `exit=${runs.core.exit} errors=${runs.core.errors.length}${runs.core.exit === 0 ? "" : ` stderr=${runs.core.stderr.slice(-300)}`}`)
check(roster("core").length > 0 && roster("core").every(query => JSON.stringify(query.sdkTools) === '["ToolSearch"]' && query.announced >= FILLER_TOOLS),
  "every query offers ToolSearch and names the deferred tools", roster("core").map(query => `announced=${query.announced}`).join("; "))
const coreTurns = roster("core").filter(query => query.toolUses.length > 0)
check(coreTurns.length >= 1 && coreTurns.every(query => query.calls.size === 1 && !query.toolUses.includes("ToolSearch")),
  "the call to a loaded tool is one Messages call, with no ToolSearch",
  coreTurns.map(query => `${query.calls.size} call(s) [${query.toolUses.join(",")}]`).join("; ") || "no tool turn seen")

say("\n  discover (a tool that is not in the prompt)")
check(runs.discover.exit === 0 && runs.discover.errors.length === 0 && runs.discover.stdout.includes(RECEIPT), "the client ran the MCP tool and answered with the value only its server knows",
  `exit=${runs.discover.exit} errors=${runs.discover.errors.length}${runs.discover.exit === 0 ? "" : ` stderr=${runs.discover.stderr.slice(-300)}`}`)
const used = roster("discover").flatMap(query => query.toolUses)
const searchAt = used.indexOf("ToolSearch")
const callAt = used.findIndex(name => name.endsWith("order_receipt"))
check(searchAt >= 0 && callAt > searchAt, "the model loaded the tool with ToolSearch and then called it", `tool_use=[${used.join(",")}]`)

say(`\n${failures.length === 0 ? "PASS" : "FAIL"}`)
// A failed run keeps the client's state and the proxy's session store.
if (failures.length === 0) rmSync(root, { recursive: true, force: true })
else say(`  kept: ${root}`)
assert.equal(failures.length, 0)
