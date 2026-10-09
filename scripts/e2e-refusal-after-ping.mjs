#!/usr/bin/env bun
// Actual proxy + real SDK + real CLI: does priority routing still fail a
// stream over when the account's refusal arrives after the stream's own
// keep-alive ping?
//
// Live, 2026-10-08/09: 81 quota refusals reached Claude Code while other
// accounts could answer. Each came after an SDK slot wait longer than the
// 15-second heartbeat, so a `: ping` comment was the stream's first frame, and
// the failover sniffer, which let the first complete frame decide, took it as
// the account's answer. The client then got `event: error` (rate_limit_error)
// and retried a few seconds to a minute later.
//
// Both accounts are local stand-ins, so no model is called and nothing is
// spent: `refused` holds each request REFUSAL_DELAY_MS (default 20 s, past the
// default heartbeat) and then refuses it with the session-limit banner the CLI
// relays; `working` streams a short answer. The proxy, the Agent SDK and the
// Claude Code CLI between them are the real ones, at their real heartbeat.
//
//   bun scripts/e2e-refusal-after-ping.mjs
//   E2E_MERIDIAN_ROOT=<checkout> bun scripts/e2e-refusal-after-ping.mjs   # another tree's src
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = resolve(process.env.E2E_MERIDIAN_ROOT ?? '.')
const refusalDelayMs = Number(process.env.REFUSAL_DELAY_MS ?? 20_000)
const root = realpathSync(mkdtempSync(join(tmpdir(), 'meridian-refusal-after-ping-')))
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MERIDIAN_') || key.startsWith('CLAUDE_PROXY_')) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, 'config'),
  MERIDIAN_SESSION_DIR: join(root, 'sessions'),
  MERIDIAN_WORKDIR: root,
  MERIDIAN_TELEMETRY_PERSIST: '0',
  MERIDIAN_ROUTING: 'priority',
  MERIDIAN_PROFILE_ORDER: 'refused,working',
})

// How the CLI words a spent five-hour window (seen live 2026-10-09 07:38).
const SESSION_LIMIT = "You've hit your session limit · resets 8:40am (America/Chicago)"
const RECEIPT = `PINGOK${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`
const sse = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`

let refusedCalls = 0
const refusedAt = []
const refusedUpstream = Bun.serve({
  hostname: '127.0.0.1', port: 0, idleTimeout: 120,
  async fetch(request) {
    if (!new URL(request.url).pathname.endsWith('/messages')) return Response.json({ input_tokens: 100 })
    refusedCalls++
    await new Promise(r => setTimeout(r, refusalDelayMs))
    refusedAt.push(Date.now())
    return Response.json(
      { type: 'error', error: { type: 'api_error', message: SESSION_LIMIT } },
      { status: 400, headers: { 'x-should-retry': 'false', 'request-id': 'fixture-session-limit' } },
    )
  },
})

let workingCalls = 0
const workingUpstream = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(request) {
    if (!new URL(request.url).pathname.endsWith('/messages')) return Response.json({ input_tokens: 100 })
    workingCalls++
    const body = await request.json()
    const message = { id: 'msg_fixture_working', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } }
    if (!body.stream) {
      return Response.json({ ...message, content: [{ type: 'text', text: RECEIPT }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 4 } })
    }
    const frames = [
      sse('message_start', { type: 'message_start', message }),
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: RECEIPT } }),
      sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }),
      sse('message_stop', { type: 'message_stop' }),
    ]
    const encoder = new TextEncoder()
    return new Response(new ReadableStream({
      start(controller) { for (const frame of frames) controller.enqueue(encoder.encode(frame)); controller.close() },
    }), { headers: { 'content-type': 'text/event-stream' } })
  },
})

const { startProxyServer } = await import(pathToFileURL(join(repo, 'src/proxy/server.ts')).href)
const { telemetryStore } = await import(pathToFileURL(join(repo, 'src/telemetry/index.ts')).href)

const proxy = await startProxyServer({
  port: 0, host: '127.0.0.1', silent: true,
  profiles: [
    { id: 'refused', type: 'api', apiKey: 'local-fixture-key', baseUrl: `http://127.0.0.1:${refusedUpstream.port}` },
    { id: 'working', type: 'api', apiKey: 'local-fixture-key', baseUrl: `http://127.0.0.1:${workingUpstream.port}` },
  ],
  defaultProfile: 'refused',
})
try {
  const port = proxy.server.address().port
  const requestId = crypto.randomUUID()
  const sentAt = Date.now()
  const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': requestId, 'x-opencode-session': requestId },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 128, stream: true,
      messages: [{ role: 'user', content: 'Reply with the receipt.' }],
    }),
    signal: AbortSignal.timeout(Math.max(180_000, refusalDelayMs * 3)),
  })
  const headersAfterMs = Date.now() - sentAt
  const body = await response.text()
  const rows = telemetryStore.getRecent({ limit: 100 }).filter(row => row.requestId === requestId)
  let reply = ''
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    const event = JSON.parse(line.slice(5))
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') reply += event.delta.text
  }
  const record = {
    status: response.status,
    headersAfterMs,
    refusedAfterMs: refusedAt.length ? refusedAt[0] - sentAt : null,
    refusedCalls, workingCalls,
    pingsToClient: body.split(': ping\n\n').length - 1,
    errorFrame: body.includes('event: error'),
    reply,
    rows: rows.map(r => ({ profile: r.profileId, status: r.status, error: r.error })),
  }
  console.log(JSON.stringify(record))

  assert(refusedCalls > 0, 'the real CLI must reach the refusing stand-in')
  assert(record.refusedAfterMs !== null && record.refusedAfterMs > 15_000,
    'the refusal must come after the first keep-alive ping for this gate to test anything')
  assert.equal(response.status, 200)
  assert.equal(record.errorFrame, false, 'the refusal must not reach the client while another account can answer')
  assert.equal(reply, RECEIPT, 'the working account must answer through the same stream')
  assert(rows.some(r => r.profileId === 'refused' && r.status === 429), 'the refusal is recorded against the refusing account')
  assert(rows.some(r => r.profileId === 'working' && r.status === 200), 'the working account served the request')
  console.log(JSON.stringify({ result: 'PASS', root }))
} finally {
  await proxy.close()
  refusedUpstream.stop(true)
  workingUpstream.stop(true)
}
