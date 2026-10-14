#!/usr/bin/env bun
// Headless production process-gate proof. No SDK query, Claude process, model,
// network request or real credential. Run with Bun, or bundle for stock Node.
import assert from 'node:assert/strict'
import { ChildProcess, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSdkProcessGate, getSdkGateNodeExecutable } from '../src/proxy/session/sdkProcessGate.ts'

assert.notEqual(process.platform, 'win32', 'These inherited-pipe and TERM-resistance controls are POSIX-specific; Windows has a separate wrapper contract')
const node = getSdkGateNodeExecutable()
const nodeVersion = spawnSync(node, ['--version'], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' })
assert.equal(nodeVersion.status, 0)
assert.equal(nodeVersion.error, undefined)
const root = mkdtempSync(join(tmpdir(), 'sdk-close-join-proof-'))
const facts = []
let failure, cleanupKnown = true
async function within(promise, milliseconds, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
try {
  for (const mode of ['ordinary-exit', 'delayed-pipes', 'resists-term']) {
    const dir = join(root, mode)
    mkdirSync(dir)
    let ignoredTerm = false
    cleanupKnown = false
    const gate = await createSdkProcessGate(dir, async () => undefined, text => { ignoredTerm ||= text.includes('ignored') })
    const releasePath = join(dir, 'release-owned-pipe-holder')
    const pipeHolder = `const {existsSync}=require('node:fs');console.log('ready');setInterval(()=>{if(existsSync(${JSON.stringify(releasePath)}))process.exit(0)},10);setTimeout(()=>process.exit(75),10000)`
    const program = mode === 'delayed-pipes'
      ? `const {spawn}=require('node:child_process');const helper=spawn(process.execPath,['-e',${JSON.stringify(pipeHolder)}],{stdio:['ignore','inherit','inherit']});helper.unref();process.exit(0)`
      : mode === 'resists-term'
        ? `process.on('SIGTERM',()=>console.error('ignored'));console.log('ready');setInterval(()=>{},1000)`
        : `console.log('ready')`
    const child = gate.spawnClaudeCodeProcess({ command: node, args: ['-e', program], env: { PATH: process.env.PATH }, signal: new AbortController().signal })
    let stdout = '', closed = false, exited = false
    // Capture the original handle before any await; never replace an exit
    // observation with a synthetic close or destroy pipes to make a join pass.
    const close = new Promise(resolve => child.once('close', () => { closed = true; resolve() }))
    const exit = new Promise(resolve => child.once('exit', () => { exited = true; resolve() }))
    let readyResolve
    const ready = new Promise(resolve => { readyResolve = resolve })
    child.stdout.on('data', chunk => { stdout += chunk.toString(); if (stdout.includes('ready')) readyResolve() })
    let fact
    try {
      assert(child instanceof ChildProcess, 'POSIX gate must return the original native child handle')
      await within(ready, 5000, 'owned child readiness missing')
      if (mode === 'delayed-pipes') await within(exit, 2000, 'original parent did not exit')
      const budgetMs = mode === 'delayed-pipes' ? 100 : 1000
      const start = performance.now()
      const joined = await gate.closeAndJoin(budgetMs)
      fact = { mode, budgetMs, joined, closeAtVerdict: closed, exitAtVerdict: exited, ignoredTerm,
        exitCodeAtVerdict: child.exitCode, signalAtVerdict: child.signalCode,
        elapsedMs: Math.round(performance.now() - start) }
      facts.push(fact)
    } finally {
      // Even baseline assertion failures must join the exact owned handles.
      // Release the owned helper explicitly, rather than racing a short sleep.
      // It is also finite if orchestration fails; the resistant root is gated.
      if (mode === 'delayed-pipes') writeFileSync(releasePath, 'release\n')
      const cleanupVerdict = await gate.closeAndJoin(4000)
      await within(close, 2000, 'original child/pipes close missing during cleanup')
      const finalJoin = await gate.closeAndJoin(1000)
      if (fact) Object.assign(fact, { cleanupVerdict, finalJoin, originalCloseJoined: closed })
      assert.equal(finalJoin, true, 'publication and original process must join before fixture removal')
      cleanupKnown = true
    }
  }
} catch (error) { failure = error }
finally { if (cleanupKnown) rmSync(root, { recursive: true, force: true }) }

const summary = { result: failure ? 'FAIL' : 'observed', error: failure?.message,
  scope: 'production SDK process gate with controlled actual Node children; no SDK query/model/Claude CLI',
  platform: process.platform, arch: process.arch, driver: process.version, bun: process.versions.bun ?? null,
  nodeChild: nodeVersion.stdout.trim(), artifactSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  fixtureRemoved: cleanupKnown, fixtureRetained: cleanupKnown ? undefined : root, facts }
try {
  if (failure) throw failure
  assert.equal(facts.length, 3)
  const ordinary = facts.find(f => f.mode === 'ordinary-exit')
  const delayed = facts.find(f => f.mode === 'delayed-pipes')
  const resistant = facts.find(f => f.mode === 'resists-term')
  assert.equal(ordinary.joined, true)
  assert.equal(ordinary.closeAtVerdict, true)
  assert.equal(delayed.exitAtVerdict, true, 'held-pipe arm must have an exited parent')
  assert.equal(delayed.closeAtVerdict, false, 'held-pipe arm must retain the original pipe lifetime')
  assert.equal(delayed.joined, false, 'exit without owned pipe-close must not authorize join')
  assert.equal(resistant.ignoredTerm, true, 'resistant child did not arm its TERM handler')
  assert.equal(resistant.joined, true, 'SIGKILL must retain an original-close observation phase')
  assert.equal(resistant.closeAtVerdict, true)
  assert.equal(resistant.signalAtVerdict, 'SIGKILL', 'join must follow the actual owned escalation signal')
  assert(facts.every(f => f.originalCloseJoined && f.finalJoin), 'all original actors and gate publications must be joined')
  summary.result = 'PASS'
} catch (error) {
  summary.result = 'FAIL'; summary.error = error.message; process.exitCode = 1
}
console.log(JSON.stringify(summary))
