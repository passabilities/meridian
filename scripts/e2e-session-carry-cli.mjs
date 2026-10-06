#!/usr/bin/env bun
// Does a transcript carried to another account's config directory resume in
// the real CLI as the session it was? The real `claude` against a scripted
// Messages API, two config directories standing for two accounts; no model
// calls, no proxy.
//
// Turn 1 runs under the first directory: one tool round and an answer. Its
// transcript is copied into the second directory with Meridian's own
// copyTranscriptAs (sessionCarry.ts), as a new session id, and turn 2 resumes
// that copy there the way the proxy resumes every session: --resume of the
// copy, --fork-session into a new id. The gate holds that turn 2's request
// carries turn 1 as structured messages (the assistant's tool_use, the
// tool_result, the answer), with the system prompt turn 1 had, and nothing of
// the flattened replay the proxy used to send a moved conversation.
//
//   bun scripts/e2e-session-carry-cli.mjs [path to claude]
//
// The CLI defaults to `claude` on PATH; the proxy's SDK child may run another
// (node_modules/.bin/claude is the SDK's own).
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { copyTranscriptAs, findTranscriptFile } from "../src/proxy/sessionCarry.ts"

const CLI = process.argv[2] ? resolve(process.argv[2]) : "claude"
const MODEL = process.env.E2E_MODEL ?? "claude-sonnet-5-5"
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-carry-cli-")))
const work = join(root, "work")
const accountA = join(root, "account-a")
const accountB = join(root, "account-b")
for (const dir of [work, accountA, accountB]) mkdirSync(dir)
const fixture = join(work, "fixture.txt")
writeFileSync(fixture, `fixture ${randomUUID()}\n`)

const calls = []
function sse(blocks, stopReason, model) {
  const events = [{ type: "message_start", message: { id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`, type: "message", role: "assistant", content: [], model,
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }]
  for (const [index, block] of blocks.entries()) {
    if (block.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }, { type: "content_block_stop", index })
    } else {
      events.push({ type: "content_block_start", index, content_block: { ...block, input: {} } },
        { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }, { type: "content_block_stop", index })
    }
  }
  events.push({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } }, { type: "message_stop" })
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })
}
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
  const body = await request.json()
  const tools = (body.tools ?? []).map(tool => tool.name)
  if (!tools.includes("Read")) return sse([{ type: "text", text: "ok" }], "end_turn", body.model)
  calls.push(body)
  const text = JSON.stringify(body.messages)
  if (text.includes("SECOND-PROMPT")) return sse([{ type: "text", text: "TURN-2-DONE" }], "end_turn", body.model)
  if (!text.includes("tool_result")) {
    return sse([{ type: "tool_use", id: `toolu_${randomUUID().replaceAll("-", "").slice(0, 22)}`, name: "Read", input: { file_path: fixture } }], "tool_use", body.model)
  }
  return sse([{ type: "text", text: "TURN-1-DONE" }], "end_turn", body.model)
} })

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}
async function run(configDir, args) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^CLAUDE(CODE|_)|^ANTHROPIC_|^MERIDIAN_/.test(key)) delete env[key]
  Object.assign(env, { CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.port}`, ANTHROPIC_API_KEY: "carry-gate-key", DISABLE_AUTOUPDATER: "1" })
  const child = Bun.spawn([CLI, "-p", "--model", MODEL, "--allowedTools", "Read", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", ...args],
    { cwd: work, env, stdout: "pipe", stderr: "pipe" })
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, out: out.trim(), err: err.trim() }
}
const systemText = body => (Array.isArray(body?.system) ? body.system : [{ text: String(body?.system ?? "") }])
  .map(block => block.text ?? "").filter(text => !text.startsWith("x-anthropic-billing-header")).join("\n")

let version = "unknown"
try {
  version = (await new Response(Bun.spawn([CLI, "--version"], { stdout: "pipe" }).stdout).text()).trim()
  console.log(`\n=== a session carried to another config directory, ${version}, ${MODEL} ===`)
  const original = randomUUID()
  const first = await run(accountA, ["--session-id", original, "FIRST-PROMPT: read the fixture file and report."])
  check(first.code === 0 && first.out.includes("TURN-1-DONE"), "turn 1 runs under the first account's directory", `exit ${first.code} ${JSON.stringify(first.out.slice(0, 60))} ${first.code ? first.err.slice(-200) : ""}`)

  const source = await findTranscriptFile(accountA, original, work)
  check(Boolean(source), "its transcript is found under that directory", source)
  const carried = randomUUID()
  await copyTranscriptAs(source, accountB, carried)
  const fork = randomUUID()
  const second = await run(accountB, ["--resume", carried, "--fork-session", "--session-id", fork, "SECOND-PROMPT: say you are done."])
  check(second.code === 0 && second.out.includes("TURN-2-DONE"), "turn 2 resumes the copy under the second account's directory", `exit ${second.code} ${JSON.stringify(second.out.slice(0, 60))} ${second.code ? second.err.slice(-300) : ""}`)

  const last = calls.at(-1)
  const roles = (last?.messages ?? []).map(message => `${message.role}[${typeof message.content === "string" ? "text" : message.content.map(block => block.type).join(",")}]`)
  const assistantToolUse = (last?.messages ?? []).some(message => message.role === "assistant" && Array.isArray(message.content) && message.content.some(block => block.type === "tool_use" && block.name === "Read"))
  const toolResult = (last?.messages ?? []).some(message => message.role === "user" && Array.isArray(message.content) && message.content.some(block => block.type === "tool_result"))
  const text = JSON.stringify(last?.messages ?? [])
  check(assistantToolUse && toolResult && text.includes("FIRST-PROMPT") && text.includes("TURN-1-DONE") && text.includes("SECOND-PROMPT"),
    "turn 2's request carries turn 1 as structured messages", roles.join(" "))
  check(!text.includes("<conversation_history>") && !text.includes("[Assistant:"), "and nothing of a flattened replay")
  const firstSystem = systemText(calls[0])
  check(firstSystem.length > 0 && systemText(last) === firstSystem, "with the system prompt turn 1 had", `${firstSystem.length} characters`)
  const forkFile = await findTranscriptFile(accountB, fork, work)
  check(Boolean(forkFile) && !existsSync(join(accountA, "projects", readdirSync(join(accountA, "projects"))[0] ?? "", `${fork}.jsonl`)),
    "the turn is written under the second account's directory only", forkFile)
} finally {
  upstream.stop(true)
}
if (failures.length === 0) rmSync(root, { recursive: true, force: true })
console.log(JSON.stringify({ result: failures.length === 0 ? "PASS" : "FAIL", cli: version, model: MODEL, failures, ...(failures.length ? { root } : {}) }))
process.exit(failures.length === 0 ? 0 : 1)
