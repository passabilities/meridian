#!/usr/bin/env bun
// Does a client that goes away stop the model, under each routing mode? The
// real client through the real proxy, SDK and CLI against a scripted Messages
// API that holds its first byte: no model calls.
//
// The client asks for a turn. Once the SDK child's request reaches the API,
// the client is killed before any output, as Esc does to a turn still
// thinking, or an orchestrator to a subagent it no longer wants. The gate
// holds that every request the SDK child has open at the API is closed within
// a few seconds, under manual routing and under active+priority, where an
// attempt detached the request's abort link as it returned and the model ran
// on to the end of its turn.
//
// The proxy is the built one under Node, as `npm run start` runs it: under
// Bun, @hono/node-server is never told of a client that leaves before the
// response's first byte, so no routing mode would see it go. Build first.
//
//   npm run build && bun scripts/e2e-claude-code-priority-cancel.mjs [model]
//
// CANCEL_GATE_SERVER names another build's dist/server.js (a build of the code
// before a fix, to see the gate fail on it).
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

if (process.env.CANCEL_GATE_ROLE === "proxy") {
  // Under Node: a proxy with two accounts on the scripted API, until killed.
  const { startProxyServer } = await import(pathToFileURL(process.env.CANCEL_GATE_SERVER).href)
  const baseUrl = process.env.CANCEL_GATE_UPSTREAM
  const proxy = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true,
    profiles: ["first", "second"].map(id => ({ id, type: "api", apiKey: "local-test-key", baseUrl })) })
  // Under Node the server is still binding when it is handed back.
  if (!proxy.server.address()) await new Promise(resolve => proxy.server.once("listening", resolve))
  console.log(`READY http://127.0.0.1:${proxy.server.address().port}`)
  await new Promise(() => {})
}

const CLIENT = process.env.E2E_CLAUDE_CLIENT ? resolve(process.env.E2E_CLAUDE_CLIENT) : "claude"
const SERVER = resolve(process.env.CANCEL_GATE_SERVER ?? join(import.meta.dir, "..", "dist", "server.js"))
const MODEL = process.argv[2] ?? "claude-sonnet-5-5"
/** How long the scripted API holds a turn's first byte. */
const HOLD_MS = 20_000
/** How soon after the client goes the SDK child's requests must be closed. */
const STOP_WITHIN_MS = 5_000
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-cancel-")))
const work = join(root, "work")
mkdirSync(work)

// The scripted API: every turn held, and when each request is closed noted.
let calls = []
const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, async fetch(request) {
  if (!new URL(request.url).pathname.endsWith("/messages")) return Response.json({ input_tokens: 100 })
  const body = await request.json()
  const call = { stream: body.stream === true, closedAt: undefined }
  calls.push(call)
  const closed = () => { call.closedAt ??= Date.now() }
  request.signal.addEventListener("abort", closed, { once: true })
  let cancelled = false
  const held = new ReadableStream({
    async start(controller) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, HOLD_MS)
        request.signal.addEventListener("abort", () => { clearTimeout(timer); resolve() }, { once: true })
      })
      if (!cancelled && !request.signal.aborted) controller.close()
    },
    cancel() {
      cancelled = true
      closed()
    },
  })
  return new Response(held, { headers: { "content-type": "text/event-stream" } })
} })

const failures = []
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(label)
}

async function cancelUnder(routing) {
  calls = []
  const proxyEnv = { ...process.env }
  for (const key of Object.keys(proxyEnv)) if (key.startsWith("MERIDIAN_") || key.startsWith("CLAUDE_PROXY_")) delete proxyEnv[key]
  Object.assign(proxyEnv, {
    CANCEL_GATE_ROLE: "proxy", CANCEL_GATE_SERVER: SERVER, CANCEL_GATE_UPSTREAM: `http://127.0.0.1:${upstream.port}`,
    MERIDIAN_ROUTING: routing, MERIDIAN_PROFILE_ORDER: "first,second",
    MERIDIAN_CONFIG_DIR: join(root, `config-${routing}`), MERIDIAN_SESSION_DIR: join(root, `sessions-${routing}`),
    MERIDIAN_TELEMETRY_PERSIST: "0", CLAUDE_CONFIG_DIR: join(root, `claude-config-${routing}`),
  })
  const proxy = Bun.spawn(["node", import.meta.path], { cwd: process.cwd(), env: proxyEnv, stdout: "pipe", stderr: "pipe" })
  const reader = proxy.stdout.getReader()
  let output = ""
  while (!output.includes("\n") && output.length < 4096) {
    const { value, done } = await reader.read()
    if (done) break
    output += new TextDecoder().decode(value)
  }
  const proxyUrl = output.match(/^READY (\S+)/m)?.[1]
  if (!proxyUrl) {
    proxy.kill()
    return { reached: false, detail: `proxy did not start: ${(output + await new Response(proxy.stderr).text()).slice(-400)}` }
  }
  const clientEnv = { ...process.env }
  for (const key of Object.keys(clientEnv)) if (/^CLAUDE(CODE|_)|^ANTHROPIC_|^MERIDIAN_|^CANCEL_GATE_|^ENABLE_/.test(key)) delete clientEnv[key]
  Object.assign(clientEnv, { CLAUDE_CONFIG_DIR: join(root, `client-config-${routing}`), ANTHROPIC_BASE_URL: proxyUrl,
    ANTHROPIC_AUTH_TOKEN: "meridian-e2e-dummy", DISABLE_AUTOUPDATER: "1" })
  const client = Bun.spawn([CLIENT, "-p", "--model", MODEL, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "", "Say hello."], { cwd: work, env: clientEnv, stdout: "pipe", stderr: "pipe" })
  const deadline = Date.now() + 60_000
  while (!calls.some(call => call.stream) && Date.now() < deadline) await Bun.sleep(50)
  const reached = calls.some(call => call.stream)
  const killedAt = Date.now()
  client.kill("SIGKILL")
  await client.exited
  const open = () => calls.filter(call => call.closedAt === undefined)
  while (reached && open().length > 0 && Date.now() - killedAt < HOLD_MS) await Bun.sleep(50)
  const stoppedAfterMs = reached && open().length === 0 ? Math.max(0, ...calls.map(call => call.closedAt - killedAt)) : null
  const stillOpen = open().length
  proxy.kill()
  await proxy.exited
  return { reached, requests: calls.length, stillOpen, stoppedAfterMs }
}

try {
  console.log(`\n=== a client that goes away before any output, ${MODEL}, proxy ${SERVER} under Node ===`)
  for (const routing of ["manual", "active+priority"]) {
    const result = await cancelUnder(routing)
    check(result.reached, `${routing}: the SDK child's turn reaches the API`, result.detail ?? `${result.requests} request(s)`)
    if (!result.reached) continue
    check(result.stoppedAfterMs !== null && result.stoppedAfterMs <= STOP_WITHIN_MS, `${routing}: the model is stopped once the client goes`,
      result.stoppedAfterMs === null ? `${result.stillOpen} request(s) still open ${HOLD_MS / 1000} s later` : `closed ${result.stoppedAfterMs} ms after`)
  }
} finally {
  upstream.stop(true)
}
if (failures.length === 0) rmSync(root, { recursive: true, force: true })
console.log(JSON.stringify({ result: failures.length === 0 ? "PASS" : "FAIL", model: MODEL, failures, ...(failures.length ? { root } : {}) }))
process.exit(failures.length === 0 ? 0 : 1)
