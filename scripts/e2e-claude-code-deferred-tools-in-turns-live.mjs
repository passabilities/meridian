#!/usr/bin/env bun
// Live, on a real account: a Claude Code conversation whose MCP server tools
// change between turns, through this checkout's proxy. Holds what the scripted
// gate (e2e-claude-code-deferred-tools-in-turns.mjs) cannot: that the model is
// told of a tool that connected after the first turn, and that the API still
// reads the conversation's earlier prompt from cache on the turn that tells it.
//
//   PROFILE=work bun scripts/e2e-claude-code-deferred-tools-in-turns-live.mjs
//
// PROFILE is a Claude Max profile of the installed proxy. The proxy is started
// in this process on a port of its own, with its own config directory and
// session store, so a proxy already running is not touched. The requests are
// Claude Code-shaped (its user agent and session metadata) and carry a system
// prompt long enough to be cached. Three turns:
//   1  two MCP tools    the model answers OK
//   2  a third connects the model is asked which deferred tools it was told of
//                       and must name the new one; the API reads turn 1's
//                       prompt from cache
//   3  no change        the API reads turn 2's prompt from cache
//
// Costs three short MODEL requests (default claude-haiku-4-5) on PROFILE, a
// few thousand tokens each, most of them cached after the first. Not in CI.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

const say = console.log.bind(console)
const PROFILE = process.env.PROFILE
const MODEL = process.env.MODEL ?? "claude-haiku-4-5"
const installed = join(process.env.MERIDIAN_CONFIG_DIR ?? join(homedir(), ".config", "meridian"), "profiles.json")
if (!PROFILE || !existsSync(installed)) {
  say("SKIP: set PROFILE to a profile of the installed proxy (see the header)")
  process.exit(1)
}
const profile = JSON.parse(readFileSync(installed, "utf8")).find(entry => entry.id === PROFILE)
if (!profile) { say(`SKIP: ${installed} has no profile named ${PROFILE}`); process.exit(1) }

const root = realpathSync(mkdtempSync(join(tmpdir(), "mdeferlive-turns-")))
mkdirSync(join(root, "config"))
const cliPath = process.env.E2E_CLAUDE_PATH ? resolve(process.env.E2E_CLAUDE_PATH) : resolve("node_modules/.bin/claude")
writeFileSync(join(root, "config", "settings.json"), JSON.stringify({ routing: "active", activeProfile: PROFILE }))
for (const key of Object.keys(process.env)) {
  if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: join(root, "sessions"),
  MERIDIAN_PASSTHROUGH: "1", MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_CLAUDE_PATH: cliPath,
})
process.chdir(root)

const { startProxyServer } = await import("../src/proxy/server.ts")
const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true, profiles: [profile], defaultProfile: PROFILE })
const address = proxy.server.address()
assert(address && typeof address === "object")
const proxyUrl = `http://127.0.0.1:${address.port}`

const tool = (name, description) => ({ name, description, input_schema: { type: "object", properties: { input: { type: "string" } } } })
const OWN = [tool("Bash", "Run a shell command."), tool("Read", "Read a file.")]
const MCP = {
  alpha: tool("mcp__fixture__alpha_inventory", "Report the alpha inventory."),
  beta: tool("mcp__fixture__beta_inventory", "Report the beta inventory."),
  gamma: tool("mcp__fixture__gamma_inventory", "Report the gamma inventory."),
}
// Past the API's smallest cacheable prompt, as a real client's always is.
const SYSTEM = `You are a careful assistant in a test of tool announcements. ${"Answer exactly what is asked, in as few words as possible. ".repeat(160)}`
const session = randomUUID()
const history = []
const failures = []
const check = (ok, label, detail) => { say(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures.push(label) }

async function turn(text, tools) {
  history.push({ role: "user", content: text })
  const response = await fetch(`${proxyUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "claude-cli/2.1.290 (external, cli)" },
    body: JSON.stringify({ model: MODEL, max_tokens: 200, stream: false, system: SYSTEM, tools: [...OWN, ...tools], messages: history,
      metadata: { user_id: JSON.stringify({ session_id: session }) } }),
    signal: AbortSignal.timeout(180_000),
  })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body).slice(0, 400))
  history.push({ role: "assistant", content: body.content })
  const usage = body.usage ?? {}
  const prompt = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
  const answer = (body.content ?? []).filter(block => block.type === "text").map(block => block.text).join("")
  say(`  turn: prompt ${prompt} (read ${usage.cache_read_input_tokens ?? 0}, written ${usage.cache_creation_input_tokens ?? 0}, fresh ${usage.input_tokens ?? 0}); answer ${JSON.stringify(answer.slice(0, 120))}`)
  return { usage, prompt, answer }
}

try {
  say(`Live: ${MODEL} on ${PROFILE}, through this checkout's proxy (${cliPath})`)
  const one = await turn("Reply with the single word OK.", [MCP.alpha, MCP.beta])
  const two = await turn("Which deferred tools have you been told are available in this conversation? List their full names, comma-separated, and nothing else.", [MCP.alpha, MCP.beta, MCP.gamma])
  const three = await turn("Reply with the single word OK.", [MCP.alpha, MCP.beta, MCP.gamma])
  check(two.answer.includes("gamma_inventory"), "the model is told of the tool that connected after the first turn", JSON.stringify(two.answer.slice(0, 160)))
  check(two.answer.includes("alpha_inventory") && two.answer.includes("beta_inventory"), "and still knows the ones it was told of first")
  check((two.usage.cache_read_input_tokens ?? 0) >= 0.9 * one.prompt, "the turn that names it reads the first turn's prompt from cache",
    `${two.usage.cache_read_input_tokens ?? 0} read of ${one.prompt}`)
  check((three.usage.cache_read_input_tokens ?? 0) >= 0.9 * two.prompt, "the next turn reads that one's from cache",
    `${three.usage.cache_read_input_tokens ?? 0} read of ${two.prompt}`)
} finally {
  await proxy.close?.()
  // The SDK child files its transcripts under the profile's config dir, by this run's directory.
  const slug = root.replace(/[^A-Za-z0-9]/g, "-")
  const transcripts = join(profile.claudeConfigDir ?? join(homedir(), ".claude"), "projects", slug)
  if (existsSync(transcripts)) { rmSync(transcripts, { recursive: true, force: true }); say(`  removed ${transcripts}`) }
  rmSync(root, { recursive: true, force: true })
}
say(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILED: ${failures.join("; ")}`)
process.exit(failures.length === 0 ? 0 : 1)
