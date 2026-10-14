#!/usr/bin/env bun
// Real CLI auth + real HTTP sockets. A fresh proxy whose first auth check is
// slower than any caller waits: delays the real auth subprocess, never invents
// an authentication payload. Retained contributor prototype, not an admitted
// live gate: task-owned native credential scope and child cleanup need review.
// Do not run against an owner/default credential store. See the E2E hold.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const DELAY_MS = 8000
const root = mkdtempSync(join(tmpdir(), 'meridian-auth-cold-start-'))
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MERIDIAN_') || key.startsWith('CLAUDE_PROXY_')) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, 'config'),
  MERIDIAN_SESSION_DIR: join(root, 'sessions'),
  MERIDIAN_WORKDIR: root,
  MERIDIAN_TELEMETRY_PERSIST: '0',
  MERIDIAN_NO_UPDATE_CHECK: '1',
  MERIDIAN_CREDENTIALS_READONLY: '1',
})
const models = await import('../src/proxy/models.ts')
const realCli = await models.resolveClaudeExecutableAsync()
const version = spawnSync(realCli, ['--version'], { encoding: 'utf8', timeout: 15000 })
assert.equal(version.status, 0, 'Real Claude CLI version probe failed')
const calls = join(root, 'calls')
const wrapper = join(root, 'claude-probe')
// Every auth-status run starts DELAY_MS late, as a cold binary paging itself in
// on a loaded host does; SDK invocations are forwarded untouched. `finished`
// is recorded only when the real CLI ran to completion.
writeFileSync(wrapper, `#!${process.execPath}\n` + `
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const auth = args[0] === 'auth' && args[1] === 'status';
if (auth) {
  appendFileSync(${JSON.stringify(calls)}, 'started\\n');
  await new Promise(r => setTimeout(r, ${DELAY_MS}));
}
const child = spawn(${JSON.stringify(realCli)}, args, {stdio:'inherit'});
child.on('error', () => process.exit(1));
child.on('exit', (code) => {
  if (auth) appendFileSync(${JSON.stringify(calls)}, 'finished\\n');
  process.exit(code ?? 1);
});
`)
chmodSync(wrapper, 0o700)
process.env.MERIDIAN_CLAUDE_PATH = wrapper
models.resetCachedClaudePath()
const { startProxyServer } = await import('../src/proxy/server.ts')
const instance = await startProxyServer({ port: 0, host: '127.0.0.1', silent: true })
const address = instance.server.address()
assert(address && typeof address === 'object')
const url = `http://127.0.0.1:${address.port}`
const count = (word) => existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(line => line === word).length : 0
async function health() {
  const started = performance.now()
  const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(DELAY_MS * 2) })
  assert.equal(response.status, 200)
  const body = await response.json()
  return { ms: Math.round(performance.now() - started), status: body.status, loggedIn: body.auth?.loggedIn }
}
try {
  const startedAt = performance.now()
  const first = await health()
  assert.equal(first.status, 'degraded', 'First probe had an answer before the delayed check could give one')
  assert(first.ms < DELAY_MS - 1000, `First probe waited ${first.ms} ms on the delayed check`)
  const landed = await models.pendingAuthStatusRefresh?.()
  // Let a killed wrapper's SIGTERM land, and a finishing one record it.
  await new Promise(r => setTimeout(r, 500))
  const second = await health()
  const checkMs = Math.round(performance.now() - startedAt)
  const expectKilled = process.argv.includes('--expect-killed')
  if (expectKilled) {
    assert.equal(count('finished'), 0, 'Baseline let the delayed check run to completion')
    assert.equal(second.status, 'degraded', 'Baseline answered without a completed check')
  } else {
    assert.equal(landed?.loggedIn, true, 'The delayed check did not answer, or Claude is not logged in')
    assert.equal(count('finished'), 1, 'The delayed check was killed before it answered')
    assert.equal(second.status, 'healthy', 'The answer of the delayed check did not reach /health')
    assert.equal(second.loggedIn, true)
  }
  assert.equal(count('started'), 1, 'Probes started more than one auth check')
  console.log(JSON.stringify({ result: 'PASS', baselineKilled: expectKilled,
    platform: `${process.platform}/${process.arch}`, claude: version.stdout.trim(),
    firstProbe: first, secondProbe: second, checkMs, authChecks: count('started'),
    ...(expectKilled ? {} : { actualLogin: true }), artifact: root }))
} finally {
  await instance.close()
}
