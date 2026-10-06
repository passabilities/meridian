#!/usr/bin/env bun
// Does a conversation that moves between accounts reach the model whole?
// The real proxy, SDK and CLI against a scripted Messages API, two API-key
// accounts on it; no model calls. What each turn sends the model is read off
// the scripted API, where the SDK child's own request lands.
//
// Two conversations each take a turn on the first account, two on the second
// (the active profile switched between them, as a person or supervisor does),
// and come back to the first:
//
//   keyless    a client that sends no session key (ForgeCode), kept under its
//              conversation's fingerprint;
//   compacted  a keyed client (OpenCode) that compacts the conversation on the
//              second account, so the copy the first account kept no longer
//              matches it.
//
// The gate holds that a move resumes the conversation's session, so the model
// is sent its earlier turns as messages, not a flattened replay; and that the
// way back carries the replies given on the second account, which a resume of
// the copy the first account was left with sends without.
//
//   bun scripts/e2e-session-carry-proxy.mjs [model]
//
// The two accounts share the CLI's config directory (an API-key profile names
// none), so a carry here is a copy within it under a new session id.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const MODEL = process.argv[2] ?? "claude-sonnet-5-5"
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-carry-proxy-")))
const work = join(root, "work")
mkdirSync(work)

for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_TELEMETRY_PERSIST: "0", CLAUDE_CONFIG_DIR: join(root, "claude-config"),
  ...(process.env.E2E_CLAUDE_PATH ? { MERIDIAN_CLAUDE_PATH: resolve(process.env.E2E_CLAUDE_PATH) } : {}),
})

const textOf = content => typeof content === "string" ? content
  : Array.isArray(content) ? content.map(block => block?.type === "text" ? block.text ?? "" : block?.type === "tool_result" ? textOf(block.content) : "").join("\n") : ""
const MARK = /\b(KEYLESS|COMPACTED)-Q(\d)\b/g
/** The question a message asks: the last one in it, as a replay carries the earlier ones too. */
const askedIn = text => [...text.matchAll(MARK)].at(-1)

// The scripted model: each turn answers with the account it was asked on.
const turns = []
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith("/messages")) return new Response("{}", { headers: { "content-type": "application/json" } })
  const body = await request.json()
  const account = request.headers.get("x-api-key")?.replace("key-", "") ?? "?"
  const asked = askedIn(textOf(body.messages?.findLast(message => message.role === "user")?.content))
  const text = asked ? `${asked[1]}-ANSWER-${asked[2]}-FROM-${account.toUpperCase()}` : "ok"
  if (asked) turns.push({ conversation: asked[1], turn: Number(asked[2]), account, messages: body.messages })
  const events = [
    { type: "message_start", message: { id: `msg_${randomUUID().replaceAll("-", "").slice(0, 24)}`, type: "message", role: "assistant", content: [], model: body.model,
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })
} })

const { startProxyServer } = await import("../src/proxy/server.ts")
const baseUrl = `http://127.0.0.1:${upstream.port}`
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
  profiles: ["first", "second"].map(id => ({ id, type: "api", apiKey: `key-${id}`, baseUrl })) })
const address = proxy.server.address()
assert(address && typeof address === "object")
const proxyUrl = `http://127.0.0.1:${address.port}`

async function setActive(profile) {
  const response = await fetch(`${proxyUrl}/profiles/active`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile }) })
  assert.equal(response.status, 200, `switching to ${profile}`)
}

const CLIENTS = {
  keyless: { headers: { "x-meridian-agent": "forgecode" }, system: `<current_working_directory>${work}</current_working_directory>` },
  compacted: { headers: { "x-opencode-session": `compacted-${randomUUID()}` }, system: `<env>\n  Working directory: ${work}\n</env>` },
}

/** One turn: the history so far and the next question; returns the reply, added to the history. */
async function turn(client, history, question) {
  history.push({ role: "user", content: question })
  const response = await fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...CLIENTS[client].headers },
    body: JSON.stringify({ model: MODEL, max_tokens: 200, stream: false, system: CLIENTS[client].system, messages: history }),
    signal: AbortSignal.timeout(180_000),
  })
  const body = await response.json()
  assert.equal(response.status, 200, `${question}: ${JSON.stringify(body).slice(0, 300)}`)
  const reply = body.content.map(block => block.text ?? "").join("")
  history.push({ role: "assistant", content: reply })
  return reply
}

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}
/**
 * What turn `n` of a conversation sent the model: its messages' roles and
 * texts, and whether the turn was a replay, its question sent inside the
 * flattened history rather than after the session's own messages.
 */
function sent(conversation, n) {
  const found = turns.filter(entry => entry.conversation === conversation && entry.turn === n).at(-1)
  assert(found, `${conversation} turn ${n} never reached the API`)
  const messages = found.messages.map(message => ({ role: message.role, text: textOf(message.content) }))
  return { account: found.account, messages, replayed: messages.findLast(message => message.role === "user")?.text.includes("<conversation_history>") === true }
}
const assistantSaid = (turn, text) => turn.messages.some(message => message.role === "assistant" && message.text.includes(text))

try {
  console.log(`Carry through the proxy, ${MODEL}, scripted API, two API-key accounts`)
  // keyless
  const keyless = []
  await setActive("first")
  await turn("keyless", keyless, "KEYLESS-Q1 first question")
  await setActive("second")
  await turn("keyless", keyless, "KEYLESS-Q2 second question")
  await turn("keyless", keyless, "KEYLESS-Q3 third question")
  await setActive("first")
  await turn("keyless", keyless, "KEYLESS-Q4 fourth question")
  // compacted
  const compacted = []
  await setActive("first")
  await turn("compacted", compacted, "COMPACTED-Q1 first question")
  await setActive("second")
  compacted.splice(0, compacted.length, { role: "user", content: "Summary of the conversation so far: one question, answered." }, { role: "assistant", content: "Noted." })
  await turn("compacted", compacted, "COMPACTED-Q2 second question")
  await turn("compacted", compacted, "COMPACTED-Q3 third question")
  await setActive("first")
  await turn("compacted", compacted, "COMPACTED-Q4 fourth question")

  const k2 = sent("KEYLESS", 2), k4 = sent("KEYLESS", 4)
  check(k2.account === "second" && !k2.replayed && assistantSaid(k2, "KEYLESS-ANSWER-1-FROM-FIRST"),
    "keyless: the move resumes the session, the first answer a message of its own", `${k2.account}, replayed=${k2.replayed}`)
  check(k4.account === "first" && !k4.replayed && assistantSaid(k4, "KEYLESS-ANSWER-2-FROM-SECOND") && assistantSaid(k4, "KEYLESS-ANSWER-3-FROM-SECOND"),
    "keyless: the way back carries the second account's answers", `${k4.account}, replayed=${k4.replayed}, roles ${k4.messages.map(m => m.role[0]).join("")}, `
      + `last asked ${JSON.stringify(k4.messages.findLast(message => message.role === "user")?.text.replace(/\s+/g, " ").slice(0, 120))}`)
  const c4 = sent("COMPACTED", 4)
  check(c4.account === "first" && !c4.replayed && assistantSaid(c4, "COMPACTED-ANSWER-2-FROM-SECOND") && assistantSaid(c4, "COMPACTED-ANSWER-3-FROM-SECOND"),
    "compacted: the way back resumes the session it went on in, not a replay", `${c4.account}, replayed=${c4.replayed}, roles ${c4.messages.map(m => m.role[0]).join("")}`)
  check(!assistantSaid(c4, "COMPACTED-ANSWER-1-FROM-FIRST"),
    "compacted: what the summary replaced is not sent again")
} finally {
  await proxy.close?.()
  upstream.stop(true)
  rmSync(root, { recursive: true, force: true })
}
console.log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
