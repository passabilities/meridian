#!/usr/bin/env bun
/**
 * Credentialless compatibility, NOT provider acceptance. Actual public Agent SDK
 * + native Claude Code + production model pins/query options, owned scripted API.
 *
 * bun scripts/e2e-haiku55-native-compat.mjs
 * E2E_MERIDIAN_ROOT=/archive-or-candidate E2E_NATIVE_BIN=/absolute/claude \
 *   E2E_OUTPUT_DIR=/new/private/artifacts bun scripts/e2e-haiku55-native-compat.mjs
 *
 * For an installed pack (which omits src), supply E2E_HELPERS_MODULE pointing to
 * a Bun bundle exporting buildQueryOptions, mapModelToClaudeModel,
 * resolveSdkModelDefaults and explicitModelPin from that pack's exact source.
 * The report distinguishes this source-helper qualification from installed HTTP
 * qualification. E2E_SDK_ENTRY selects the installed pack's actual public SDK.
 * No SDK/CLI internals are parsed or patched. HTTP is deliberately not claimed:
 * the server's pre-spawn process gate hides the original ChildProcess behind a
 * public SpawnedProcess facade, and its auth-status path has separate custody.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'

assert(process.versions.bun, 'Run with Bun to import the actual production TypeScript helpers')
const sourceRoot = await realpath(resolve(process.env.E2E_MERIDIAN_ROOT ?? fileURLToPath(new URL('..', import.meta.url))))
const requireTarget = createRequire(join(sourceRoot, 'package.json'))
const sdkEntry = process.env.E2E_SDK_ENTRY ?? requireTarget.resolve('@anthropic-ai/claude-agent-sdk')
const native = await realpath(process.env.E2E_NATIVE_BIN ?? join(dirname(requireTarget.resolve('@anthropic-ai/claude-code/package.json')), 'bin/claude.exe'))
const helpersEntry = process.env.E2E_HELPERS_MODULE
const output = process.env.E2E_OUTPUT_DIR
  ? resolve(process.env.E2E_OUTPUT_DIR)
  : await mkdtemp(join(tmpdir(), 'meridian-haiku55-compat-'))
if (process.env.E2E_OUTPUT_DIR) await mkdir(output, { mode: 0o700 }) // Reject existing evidence directories.
const ownerHome = homedir()
const harnessBytes = await readFile(fileURLToPath(import.meta.url))
await writeFile(join(output, 'harness.mjs'), harnessBytes, { mode: 0o600 })
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = {
  schema: 1, result: 'RUNNING', acceptance: false,
  scope: 'Actual public Agent SDK + native Claude Code + production model/query helpers; owned scripted API, not production HTTP, real provider, auth readiness, or coding-client acceptance',
  platform: process.platform, arch: process.arch, bun: process.versions.bun,
  sourceRoot, native, sdkEntry, helpersEntry: helpersEntry ?? null, output,
  harnessSha256: hash(harnessBytes),
  reproduction: { runtime: process.execPath, script: fileURLToPath(import.meta.url), env: { E2E_MERIDIAN_ROOT: sourceRoot, E2E_NATIVE_BIN: native, E2E_SDK_ENTRY: sdkEntry, ...(helpersEntry ? { E2E_HELPERS_MODULE: helpersEntry } : {}), E2E_OUTPUT_DIR: '<fresh-absolute-directory>' } },
  source: {}, versions: {}, network: {}, cases: [], requests: [], children: [], nativeFindings: [], failures: [],
  cleanup: { fixtureRetained: true, joined: false },
}
const fail = message => report.failures.push(String(message))
async function bounded(promise, ms, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms) })]) }
  finally { clearTimeout(timer) }
}
const home = join(output, 'home')
const config = join(home, '.claude')
const work = join(output, 'work')
for (const path of [home, config, work, join(output, 'tmp')]) await mkdir(path, { recursive: true, mode: 0o700 })
await writeFile(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }), { mode: 0o600 })
// The SDK merges options.env over process.env: clear the parent BEFORE importing
// the SDK/helpers, not merely its child. Never inherit tokens/proxies/accounts.
for (const key of Object.keys(process.env)) delete process.env[key]
const baseEnv = {
  HOME: home, CLAUDE_CONFIG_DIR: config, XDG_CONFIG_HOME: join(home, 'xdg-config'),
  XDG_CACHE_HOME: join(home, 'xdg-cache'), XDG_DATA_HOME: join(home, 'xdg-data'),
  TMPDIR: join(output, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8',
  ANTHROPIC_API_KEY: 'owned-loopback-dummy-key',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1',
  DISABLE_FEEDBACK_COMMAND: '1', CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
  ENABLE_CLAUDEAI_MCP_SERVERS: 'false', ENABLE_TOOL_SEARCH: 'false',
}
Object.assign(process.env, baseEnv)
let sandboxProfile
if (process.platform === 'darwin') {
  sandboxProfile = join(output, 'native.sb')
  await writeFile(sandboxProfile, `(version 1)\n(allow default)\n(deny network*)\n(allow network-outbound (remote ip "localhost:*"))\n(allow network-inbound (local ip "localhost:*"))\n(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc"))\n(deny file-read* (subpath ${JSON.stringify(join(ownerHome, '.claude'))}) (literal ${JSON.stringify(join(ownerHome, '.claude.json'))}) (subpath ${JSON.stringify(join(ownerHome, 'Library/Keychains'))}))\n`)
  report.network = { osFence: 'sandbox-exec: deny network*, permit localhost only; deny owner Claude config/Keychains and securityd lookup', sandboxProfileSha256: hash(await readFile(sandboxProfile)), generationBaseUrl: 'owned IPv4 loopback', descendants: 'sandbox inherited' }
} else {
  report.network = { osFence: false, generationBaseUrl: 'owned IPv4 loopback', guarantee: 'Every observed SDK native spawn is checked for loopback base URL, dummy key, no OAuth/auth token, isolated HOME/config and nonessential traffic disabled. No whole-OS or descendant network-absence claim.' }
}
const actors = []
function launch(args, env, label, signal) {
  const state = { label, pid: null, exit: false, close: false, stdoutClose: false, stderrClose: false, code: null, signal: null, errors: [], stderr: '' }
  report.children.push(state)
  const child = spawn(sandboxProfile ? '/usr/bin/sandbox-exec' : native,
    sandboxProfile ? ['-f', sandboxProfile, native, ...args] : args,
    { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'], ...(signal ? { signal } : {}) })
  state.pid = child.pid ?? null
  const joined = new Promise(resolveJoin => {
    const check = () => { if (state.close && state.stdoutClose && state.stderrClose) resolveJoin() }
    child.once('exit', (code, signal) => { state.exit = true; state.code = code; state.signal = signal })
    child.once('close', () => { state.close = true; check() })
    child.stdout.once('close', () => { state.stdoutClose = true; check() })
    child.stderr.once('close', () => { state.stderrClose = true; check() })
    child.once('error', error => { state.errors.push(String(error)) })
  })
  child.stderr.on('data', chunk => { state.stderr = (state.stderr + chunk.toString()).slice(-8192) })
  actors.push({ child, state, joined })
  return { child, state, joined }
}
let fixture
let activeCase
let admission = true
let apiCount = 0
const receipt = `HAIKU55_${randomUUID()}`
function responseFor(body) {
  const message = { id: `msg_fixture_${apiCount}`, type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: receipt }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 10 } }
  if (!body.stream) return Response.json(message)
  const events = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: receipt } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream', 'request-id': `fixture-${apiCount}` } })
}
try {
  report.versions.sdk = JSON.parse(await readFile(join(dirname(sdkEntry), 'package.json'), 'utf8')).version
  const pkg = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
  report.versions.meridian = pkg.version
  report.source.packageSha256 = hash(await readFile(join(sourceRoot, 'package.json')))
  report.source.sdkEntrySha256 = hash(await readFile(sdkEntry))
  if (helpersEntry) report.source.helpersBundleSha256 = hash(await readFile(helpersEntry))
  else for (const name of ['models', 'query']) report.source[`${name}Sha256`] = hash(await readFile(join(sourceRoot, `src/proxy/${name}.ts`)))
  report.source.nativeSha256 = hash(await readFile(native))
  const version = launch(['--version'], baseEnv, 'native-version')
  let versionText = ''
  version.child.stdout.on('data', chunk => { versionText = (versionText + chunk.toString()).slice(-8192) })
  version.child.stdin.end()
  await bounded(version.joined, 10_000, 'native --version close deadline')
  assert.equal(version.state.code, 0, version.state.stderr)
  report.versions.native = versionText.trim()
  const match = /^(\d+)\.(\d+)\.(\d+)\s+\(Claude Code\)/.exec(versionText.trim())
  assert(match, 'Not an actual native Claude Code version response')
  const [major, minor, patch] = match.slice(1).map(Number)
  if (!(major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 293))))) fail('Claude Code <2.1.293: official Haiku 5.5 minimum unmet (continuing negative controls)')
  assert.equal(report.versions.sdk, '0.2.141', 'This fixture is qualified for public Agent SDK 0.2.141')
  const sdk = await import(pathToFileURL(sdkEntry).href)
  const models = await import(pathToFileURL(helpersEntry ?? join(sourceRoot, 'src/proxy/models.ts')).href)
  const { buildQueryOptions } = helpersEntry ? models : await import(pathToFileURL(join(sourceRoot, 'src/proxy/query.ts')).href)
  fixture = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    try {
      assert(admission, 'Fixture admission retired')
      assert(++apiCount <= 64, 'Fixture request limit exceeded')
      const path = new URL(request.url).pathname
      if (path === '/v1/messages/count_tokens') return Response.json({ input_tokens: 20 })
      assert.equal(path, '/v1/messages', `Unexpected native request route ${path}`)
      assert.equal(request.method, 'POST')
      assert(Number(request.headers.get('content-length') ?? 0) <= 2_000_000, 'Oversized fixture request')
      const body = await request.json()
      const headers = Object.fromEntries(['content-type', 'anthropic-version', 'anthropic-beta', 'user-agent']
        .filter(name => request.headers.has(name)).map(name => [name, request.headers.get(name)]))
      assert(!Object.keys(headers).some(name => /auth|key|token/i.test(name)), 'Unsafe evidence header')
      const rejected = body.model === 'claude-haiku-5-5' && body.thinking?.type === 'enabled'
      report.requests.push({ case: activeCase ?? 'fixture-400-control', path, headers, body, rejected })
      if (rejected) return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'Haiku 5.5 supports adaptive thinking, not enabled/budget_tokens' } }, { status: 400 })
      return responseFor(body)
    } catch (error) {
      fail(`fixture: ${error}`)
      return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'fixture contract failed' } }, { status: 400 })
    }
  } })
  const baseUrl = `http://127.0.0.1:${fixture.port}`
  baseEnv.ANTHROPIC_BASE_URL = baseUrl
  process.env.ANTHROPIC_BASE_URL = baseUrl
  // Qualify the fixture's fail-closed behavior independently of native adaptation.
  const rejected = await fetch(`${baseUrl}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', thinking: { type: 'enabled', budget_tokens: 2048 } }), signal: AbortSignal.timeout(3000) })
  assert.equal(rejected.status, 400)
  await rejected.text()
  const cases = [
    { name: 'sdk-bare-alias', raw: true, model: 'haiku', expected: 'claude-haiku-5-5' },
    { name: 'meridian-alias-default', model: 'haiku', expected: 'claude-haiku-5-5' },
    { name: 'explicit55-disabled', model: 'claude-haiku-5-5', expected: 'claude-haiku-5-5', thinking: { type: 'disabled' }, rejectBeforeGeneration: true },
    { name: 'alias-enabled-budget-display', model: 'haiku', expected: 'claude-haiku-5-5', thinking: { type: 'enabled', budgetTokens: 2048, display: 'summarized' }, effort: 'medium' },
    { name: 'explicit55-enabled-budget', model: 'claude-haiku-5-5', expected: 'claude-haiku-5-5', thinking: { type: 'enabled', budgetTokens: 2048 } },
    { name: 'explicit55-adaptive-summarized', model: 'claude-haiku-5-5', expected: 'claude-haiku-5-5', thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high' },
    { name: 'alias-adaptive-omitted', model: 'haiku', expected: 'claude-haiku-5-5', thinking: { type: 'adaptive', display: 'omitted' }, effort: 'low', rejectBeforeGeneration: true },
    { name: 'explicit45-enabled-control', model: 'claude-haiku-4-5-20251001', expected: 'claude-haiku-4-5-20251001', thinking: { type: 'enabled', budgetTokens: 2048 } },
  ]
  for (const arm of cases) {
    activeCase = arm.name
    const row = { ...arm, status: 'RUNNING', publicResult: null, iteratorSettled: false, queryCloseCalled: false, materialized: false }
    report.cases.push(row)
    const before = report.requests.length
    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), 35_000)
    let turn
    try {
      const env = arm.raw ? { ...baseEnv } : { ...models.resolveSdkModelDefaults({}), ...baseEnv, ...models.explicitModelPin(arm.model) }
      const input = arm.raw ? { prompt: `Return the fixture receipt for ${arm.name}.`, options: {
        model: arm.model, pathToClaudeCodeExecutable: native, cwd: work, env, tools: [], mcpServers: {}, plugins: [],
        settingSources: [], settings: { autoMemoryEnabled: false, autoDreamEnabled: false, skipWebFetchPreflight: true },
        systemPrompt: 'Owned local compatibility fixture.', maxTurns: 1, abortController,
      } } : buildQueryOptions({
        prompt: `Return the fixture receipt for ${arm.name}.`, model: models.mapModelToClaudeModel(arm.model),
        claudeExecutable: native, workingDirectory: work, systemContext: 'Owned local compatibility fixture.',
        passthrough: true, stream: true, sdkAgents: {}, cleanEnv: env, hasDeferredTools: false, isUndo: false,
        blockedTools: [], incompatibleTools: [], mcpServerName: 'fixture', allowedMcpTools: [],
        settingSources: [], codeSystemPrompt: false, memory: false, dreaming: false, webFetchPreflight: false,
        thinking: arm.thinking, effort: arm.effort,
      }, abortController)
      assert(!arm.rejectBeforeGeneration, 'Expected production builder to refuse unsupported thinking before generation')
      row.sdkModel = input.options.model
      row.sdkThinking = input.options.thinking ?? null
      row.sdkHaikuPin = input.options.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? null
      input.options.spawnClaudeCodeProcess = options => {
        assert.equal(options.env.ANTHROPIC_BASE_URL, baseUrl)
        assert.equal(options.env.ANTHROPIC_API_KEY, baseEnv.ANTHROPIC_API_KEY)
        assert.equal(options.env.HOME, home)
        assert.equal(options.env.CLAUDE_CONFIG_DIR, config)
        assert.equal(options.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1')
        assert(!options.env.CLAUDE_CODE_OAUTH_TOKEN && !options.env.ANTHROPIC_AUTH_TOKEN, 'Unexpected credential')
        // Reconstruct the bounded environment, retaining production's own pins
        // and toggles, not arbitrary SDK-inherited variables.
        const childEnv = Object.fromEntries(Object.entries(input.options.env).filter(([, value]) => value !== undefined))
        assert(options.command === native, `SDK did not select the qualified native executable: ${options.command}`)
        return launch(options.args, childEnv, arm.name, options.signal).child
      }
      turn = sdk.query(input)
      let assistant = ''
      await bounded((async () => {
        for await (const message of turn) {
          if (message.type === 'assistant') assistant += (message.message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
          if (message.type === 'result') row.publicResult = { subtype: message.subtype, sessionId: message.session_id, errors: message.errors ?? [] }
        }
        row.iteratorSettled = true
      })(), 40_000, `${arm.name}: SDK iterator deadline`)
      assert.equal(row.publicResult?.subtype, 'success', JSON.stringify(row.publicResult))
      assert(assistant.includes(receipt), 'Actual SDK did not materialize fixture text')
      const history = await bounded(sdk.getSessionMessages(row.publicResult.sessionId, { dir: work }), 5000, 'public SDK history deadline')
      row.materialized = JSON.stringify(history).includes(receipt)
      assert(row.materialized, 'Public persisted SDK history lacks fixture receipt')
      const wires = report.requests.slice(before)
      assert(wires.length > 0 && wires.length <= 6, `Expected bounded native wire requests, saw ${wires.length}`)
      for (const { body, rejected } of wires) {
        assert.equal(body.model, arm.expected, `${arm.name}: wrong actual native wire model`)
        assert.equal(rejected, false, 'Native sent provider-invalid manual thinking on Haiku 5.5')
        if (arm.thinking?.type === 'disabled' && body.thinking?.type !== 'disabled') {
          report.nativeFindings.push({ case: arm.name, finding: 'Native disabled thinking is omitted from the API request; provider-default adaptive thinking means disabling is not proven', observed: body.thinking ?? null })
        }
        if (arm.thinking?.display && body.thinking?.display !== arm.thinking.display) {
          report.nativeFindings.push({ case: arm.name, finding: 'Native did not preserve requested thinking display', requested: arm.thinking.display, observed: body.thinking?.display ?? null })
        }
        if (arm.expected === 'claude-haiku-5-5') {
          assert.notEqual(body.thinking?.type, 'enabled')
          assert(!('budget_tokens' in (body.thinking ?? {})), 'Manual budget leaked into Haiku 5.5 wire')
          if (arm.thinking?.type === 'disabled') assert.equal(body.thinking?.type, 'disabled')
          else assert.equal(body.thinking?.type, 'adaptive', 'Native did not use adaptive Haiku 5.5 thinking')
        } else assert.equal(body.thinking?.type, 'enabled', 'Legacy manual-thinking control changed')
        if (arm.thinking?.display) assert.equal(body.thinking?.display, arm.thinking.display, 'Thinking display lost')
        if (arm.effort) assert.equal(body.output_config?.effort, arm.effort, 'Effort lost')
      }
      row.status = 'PASS'
    } catch (error) {
      if (arm.rejectBeforeGeneration && String(error).includes('cannot reliably honor')
        && !turn && report.requests.length === before && !actors.some(actor => actor.state.label === arm.name)) {
        row.status = 'PASS'
        row.rejectedBeforeGeneration = true
        row.rejection = String(error)
      } else { row.status = 'FAIL'; row.failure = String(error); fail(`${arm.name}: ${error}`) }
    }
    finally {
      clearTimeout(timer)
      if (turn) { try { turn.close(); row.queryCloseCalled = true } catch (error) { fail(`${arm.name}: query.close: ${error}`) } }
      const owned = actors.filter(actor => actor.state.label === arm.name)
      try { await bounded(Promise.all(owned.map(actor => actor.joined)), 5000, `${arm.name}: original process/pipe join deadline`) }
      catch (error) {
        fail(error)
        for (const actor of owned) if (!actor.state.close) actor.child.kill('SIGKILL')
        try { await bounded(Promise.all(owned.map(actor => actor.joined)), 3000, `${arm.name}: forced join deadline`) }
        catch (error) { fail(error); admission = false }
      }
      if (!owned.length && !row.rejectedBeforeGeneration) { fail(`${arm.name}: no original native child observed`); row.status = 'FAIL' }
      for (const { state } of owned) {
        if (!state.exit || state.code !== 0 || !state.close || !state.stdoutClose || !state.stderrClose) {
          fail(`${arm.name}: native exit/close/pipe witness failed`)
          row.status = 'FAIL'
        }
      }
    }
    if (!admission) break
  }
} catch (error) { fail(error) }
finally {
  admission = false
  for (const actor of actors) if (!actor.state.close) actor.child.kill('SIGKILL')
  try { await bounded(Promise.all(actors.map(actor => actor.joined)), 5000, 'final original process/pipe join deadline') }
  catch (error) { fail(error) }
  if (fixture) {
    try { await bounded(fixture.stop(true), 5000, 'fixture stop deadline') }
    catch (error) { fail(error) }
  }
  report.cleanup.joined = actors.every(({ state }) => state.close && state.stdoutClose && state.stderrClose)
  if (!report.cleanup.joined) fail('Unknown cleanup: original ChildProcess.close/both captured pipe closures missing; fixture retained')
  report.result = report.failures.length ? 'FAIL' : 'PASS'
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ result: report.result, acceptance: false, output, failures: report.failures, native: report.versions.native, sdk: report.versions.sdk, cases: report.cases.map(({ name, status }) => ({ name, status })), nativeFindings: report.nativeFindings, cleanup: report.cleanup }))
  process.exitCode = report.failures.length ? 1 : 0
}
