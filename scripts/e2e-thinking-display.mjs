#!/usr/bin/env bun
// Live: does a request whose `thinking.display` the bundled Claude Code CLI
// does not know still run, through the REAL proxy, Agent SDK and subprocess?
//
// Interactive Claude Code (seen on 2.1.287, connector-text mode) sends
// `thinking: { type: "adaptive", display: "updates" }`. The SDK hands `display`
// to its subprocess as `--thinking-display updates`; the bundled CLI accepts
// only summarized/omitted/highlights and exited 1 before the turn started, so
// every such request failed with `sdk_termination reason=process_exit exit=1`.
//
// The interactive client cannot be driven headlessly (`claude -p` sends
// `display: "omitted"`), so this gate posts that client's request shape
// directly: Claude Code User-Agent and `metadata.user_id`, streamed, with the
// offending thinking config. Everything after the HTTP boundary is real.
//
//   bun scripts/e2e-thinking-display.mjs
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setSessionStoreDir } from '../src/proxy/sessionStore.ts'

const say = console.log.bind(console)

// Operator settings can force thinking off (a per-adapter `thinking: disabled`
// feature or a beta policy that strips interleaved thinking), and then
// `display` never reaches the subprocess and the gate passes vacuously.
const WORKDIR = realpathSync(mkdtempSync(join(tmpdir(), 'mthinkdisp-')))
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MERIDIAN_') || key.startsWith('CLAUDE_PROXY_')) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(WORKDIR, 'config'),
  MERIDIAN_WORKDIR: WORKDIR,
  MERIDIAN_TELEMETRY_PERSIST: '0',
})
setSessionStoreDir(join(WORKDIR, 'store'))

const { startProxyServer } = await import('../src/proxy/server.ts')

const PORT = Number(process.env.PROBE_PORT ?? 3562)
const MODEL = process.env.PROBE_MODEL ?? 'sonnet'

const proxyLog = []
for (const k of ['log', 'error', 'debug', 'warn']) console[k] = (...a) => { proxyLog.push(a.map(String).join(' ')) }
const inst = await startProxyServer({ port: PORT, host: '127.0.0.1' })

const failures = []
const check = (ok, label, detail) => {
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

async function ask(display, word) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'claude-cli/2.1.287 (external, cli)',
      'x-api-key': 'meridian-e2e-dummy',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 256,
      stream: true,
      thinking: { type: 'adaptive', ...(display ? { display } : {}) },
      messages: [{ role: 'user', content: `Reply with exactly the word ${word}.` }],
      metadata: { user_id: JSON.stringify({ session_id: randomUUID() }) },
    }),
  })
  const events = (await res.text()).split('\n')
    .filter(l => l.startsWith('data: '))
    .flatMap(l => { try { return [JSON.parse(l.slice(6))] } catch { return [] } })
  const deltas = events.filter(e => e.delta?.type === 'text_delta').map(e => e.delta.text).join('')
  return { status: res.status, answered: deltas.includes(word), errored: events.some(e => e.type === 'error'), deltas }
}

say(`\n=== thinking.display the bundled CLI does not know ===`)
say(`  model: ${MODEL}   adapter: claude-code (by User-Agent)`)

const updates = await ask('updates', 'ALPHA')
check(updates.status === 200 && updates.answered && !updates.errored,
  'display "updates" (Claude Code connector-text mode) answers',
  `status=${updates.status} answered=${updates.answered} errorEvent=${updates.errored} text=${JSON.stringify(updates.deltas.slice(0, 40))}`)

const summarized = await ask('summarized', 'BRAVO')
check(summarized.status === 200 && summarized.answered && !summarized.errored,
  'display "summarized" (a value the SDK accepts) still answers',
  `status=${summarized.status} answered=${summarized.answered} errorEvent=${summarized.errored}`)

const forcedOff = proxyLog.filter(l => l.includes('thinking disabled'))
check(forcedOff.length === 0, 'thinking reached the SDK (not forced off by config)',
  forcedOff.length ? forcedOff[0].slice(0, 160) : 'no thinking-disabled line')
const dropped = proxyLog.filter(l => /thinking display "updates" dropped/.test(l))
check(dropped.length === 1, 'the dropped display was logged once', `${dropped.length} log line(s)`)

say(`\n=== verdict ===`)
if (failures.length) {
  say(`  FAIL: ${failures.length} check(s)`)
  for (const f of failures) say(`    - ${f}`)
  say('\n  recent proxy diagnostics:')
  for (const l of proxyLog.filter(l => /\[PROXY\]|sdk_termination|thinking/.test(l)).slice(-12)) say(`    ${l.slice(0, 220)}`)
} else {
  say('  PASS: an unknown thinking display no longer kills the SDK subprocess')
}
await inst.close()
process.exit(failures.length ? 1 : 0)
