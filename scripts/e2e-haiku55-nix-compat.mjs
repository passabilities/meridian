#!/usr/bin/env node
/**
 * Credentialless installed Nix qualification, NOT real provider/client acceptance.
 * Build an exact committed archive using its unchanged lock, then disconnect the
 * owned Docker container from ALL networks. Run with the installed wrapper's Node:
 * E2E_NIX_OUT=/nix/store/...-meridian-... E2E_OUTPUT_DIR=/artifacts/fresh-run \
 *   /nix/store/...-nodejs-.../bin/node /artifacts/e2e-haiku55-nix-compat.mjs
 * On macOS use e2e-haiku55-nix-darwin.sh on a disposable credentialless runner.
 * No npm-native override, SDK patch, source-helper bundle or credential input.
 */
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { mkdirSync, readFileSync, writeFileSync, realpathSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
assert(!process.versions.bun, 'Original-child observation requires native Node')
assert(['linux', 'darwin'].includes(process.platform))
assert(['arm64', 'x64'].includes(process.arch))
const out = realpathSync(process.env.E2E_NIX_OUT ?? '')
assert(out.startsWith('/nix/store/') && out.includes('-meridian-'))
const output = resolve(process.env.E2E_OUTPUT_DIR ?? '')
assert(process.env.E2E_OUTPUT_DIR && output !== resolve('.'), 'Use an explicit owned fresh artifacts directory')
mkdirSync(output, { mode: 0o700 }) // Existing receipts must never be overwritten.
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const report = { schema: 1, result: 'RUNNING', acceptance: false,
  scope: 'Built/installed Nix wrapper-selected native CLI + actual installed public SDK + production HTTP/process gate; credentialless scripted loopback, NOT real provider/Pi/model or registry acceptance',
  outPath: out, platform: `${process.platform}/${process.arch}`, node: process.version, nodeExecutable: process.execPath,
  harnessSha256: hash(readFileSync(new URL(import.meta.url))), network: {}, versions: {}, identities: {}, wrapperWitness: null,
  cases: [], requests: [], actors: [], synchronousSubprocesses: [], failures: [], cleanup: { fixtureRetained: true, joined: false } }
writeFileSync(join(output, 'harness.mjs'), readFileSync(new URL(import.meta.url)))
const fail = error => report.failures.push(String(error))
async function bounded(promise, ms, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms) })]) }
  finally { clearTimeout(timer) }
}
const home = join(output, 'home'), work = join(output, 'work'), config = join(home, '.claude')
for (const path of [home, work, config, join(output, 'tmp'), join(output, 'meridian'), join(output, 'store')]) mkdirSync(path, { recursive: true, mode: 0o700 })
writeFileSync(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }))
for (const key of Object.keys(process.env)) delete process.env[key]
const safeEnv = { HOME: home, CLAUDE_CONFIG_DIR: config, XDG_CONFIG_HOME: join(home, 'xdg-config'), XDG_CACHE_HOME: join(home, 'xdg-cache'), XDG_DATA_HOME: join(home, 'xdg-data'),
  TMPDIR: join(output, 'tmp'), PATH: `${dirname(process.execPath)}:${dirname(realpathSync('/usr/bin/env'))}:/usr/bin:/bin`, LANG: 'C.UTF-8',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', ENABLE_TOOL_SEARCH: 'false',
  MERIDIAN_CONFIG_DIR: join(output, 'meridian'), MERIDIAN_SESSION_DIR: join(output, 'store'), MERIDIAN_WORKDIR: work,
  MERIDIAN_TELEMETRY_PERSIST: '0', MERIDIAN_CREDENTIALS_READONLY: '1', MERIDIAN_NO_UPDATE_CHECK: '1', MERIDIAN_PASSTHROUGH: '1' }
Object.assign(process.env, safeEnv)
const actors = []
let activeCase = 'setup', selectedNative, fixture, proxy, admission = true, activeHandlers = 0
let fixtureClose = false, proxyClose = false
const sockets = []
function ownSocket(socket, label) {
  const state = { label, close: false }
  const closed = new Promise(resolveClosed => socket.once('close', () => { state.close = true; resolveClosed() }))
  sockets.push({ socket, state, closed })
}
function observe(child, command, args, label = activeCase) {
  if (actors.some(actor => actor.child === child)) return child
  const state = { label, command: String(command), pid: child.pid ?? null,
    sdkGate: Array.isArray(args) && args.includes('meridian-sdk-gate'), gatePublished: false, nativeExecObserved: false,
    exit: false, close: false, stdoutClose: !child.stdout, stderrClose: !child.stderr, code: null, signal: null, errors: [], stderr: '', escalations: [] }
  report.actors.push(state)
  let resolveJoined
  const joined = new Promise(resolveJoin => { resolveJoined = resolveJoin })
  const check = () => { if (state.close && state.stdoutClose && state.stderrClose) resolveJoined() }
  child.once('exit', (code, signal) => { state.exit = true; state.code = code; state.signal = signal })
  child.once('close', (code, signal) => { state.close = true; state.code = code; state.signal = signal; check() })
  child.stdout?.once('close', () => { state.stdoutClose = true; check() })
  child.stderr?.once('close', () => { state.stderrClose = true; check() })
  child.once('error', error => { state.errors.push(String(error)) })
  child.stderr?.on('data', chunk => { state.stderr = (state.stderr + chunk.toString()).slice(-8192) })
  const actor = { child, state, joined, gatePath: state.sdkGate ? args[args.indexOf('meridian-sdk-gate') + 1] : null }
  actors.push(actor)
  return child
}
const originals = { spawn: childProcess.spawn, execFile: childProcess.execFile, exec: childProcess.exec }
for (const method of Object.keys(originals)) childProcess[method] = function (...args) {
  return observe(originals[method].apply(this, args), args[0], Array.isArray(args[1]) ? args[1] : [])
}
const synchronousOriginals = { spawnSync: childProcess.spawnSync, execFileSync: childProcess.execFileSync, execSync: childProcess.execSync }
for (const method of Object.keys(synchronousOriginals)) childProcess[method] = function (...args) {
  const state = { method, command: String(args[0]), label: activeCase }
  report.synchronousSubprocesses.push(state)
  try {
    const result = synchronousOriginals[method].apply(this, args)
    if (method === 'spawnSync') {
      Object.assign(state, { pid: result.pid, status: result.status, signal: result.signal,
        error: result.error ? String(result.error) : null,
        stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? '') })
    }
    return result
  } catch (error) { state.error = String(error); throw error }
}
syncBuiltinESMExports()
async function witnessGate(actor) {
  if (!actor.gatePath || actor.state.close) return
  try {
    const gate = readFileSync(actor.gatePath, 'utf8')
    // The gate is generated by unmodified production code, with dummy API
    // credentials only. Preserve identity and selected fields, not its raw env.
    assert(gate.includes(`'${selectedNative}'`), 'Production gate did not select wrapper-default CLI')
    assert(gate.includes("'ANTHROPIC_API_KEY=owned-loopback-dummy-key'"))
    assert(gate.includes(`'HOME=${home}'`))
    assert(!gate.includes('CLAUDE_CODE_OAUTH_TOKEN=') && !gate.includes('ANTHROPIC_AUTH_TOKEN='))
    assert(gate.includes("'ANTHROPIC_BASE_URL=http://127.0.0.1:"))
    actor.state.gatePublished = true
    actor.state.gateSha256 = hash(gate)
    let executable
    if (process.platform === 'linux') executable = realpathSync(`/proc/${actor.child.pid}/exe`)
    else {
      // Darwin has no /proc. Inspect the original gate PID while its native
      // process is blocked awaiting this fixture response; join the probe too.
      const probe = childProcess.spawn('/bin/ps', ['-p', String(actor.child.pid), '-o', 'comm='], { env: safeEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      let command = ''
      probe.stdout.on('data', chunk => { command += chunk })
      await joinOwned(actors.filter(item => item.child === probe), 'Darwin native executable probe')
      assert.equal(probe.exitCode, 0)
      executable = realpathSync(command.trim())
    }
    if (executable.startsWith(dirname(selectedNative).replace(/\/bin$/, '')) && executable !== '/bin/sh') {
      actor.state.nativeExecObserved = true
      actor.state.actualExecutable = executable
      actor.state.actualExecutableSha256 ??= hash(readFileSync(executable))
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ESRCH') throw error
  }
}
const receipt = `NIX_HAIKU55_${randomUUID()}`
function fixtureResponse(body, id) {
  const flowReceipt = `${receipt}_${activeCase}`
  const message = { id: `msg_owned_${id}`, type: 'message', role: 'assistant', model: body.model,
    content: [{ type: 'text', text: flowReceipt }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 20, output_tokens: 10 } }
  if (!body.stream) return { type: 'application/json', text: JSON.stringify(message) }
  const events = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: flowReceipt } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ]
  return { type: 'text/event-stream', text: events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('') }
}
async function joinOwned(owned, label) {
  try { await bounded(Promise.all(owned.map(actor => actor.joined)), 5000, `${label}: original close/pipes deadline`) }
  catch (error) {
    fail(error)
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      for (const actor of owned) if (!actor.state.close) {
        actor.state.escalations.push({ signal, at: new Date().toISOString(), accepted: actor.child.kill(signal) })
      }
      try { await bounded(Promise.all(owned.map(actor => actor.joined)), 3000, `${label}: ${signal} join deadline`); return }
      catch (error) { fail(error) }
    }
    admission = false
  }
}
try {
  const interfaces = Object.entries(networkInterfaces()).flatMap(([name, values]) => values.map(value => ({ name, address: value.address, internal: value.internal })))
  if (process.platform === 'linux') {
    report.network = { fence: 'Docker owned container disconnected from all networks before execution', interfaces, routeTable: readFileSync('/proc/net/route', 'utf8'), generation: 'owned 127.0.0.1 fake Anthropic only', sandboxExec: false }
    assert(interfaces.length > 0 && interfaces.every(value => value.internal), 'Refuse non-loopback interface')
    assert.equal(report.network.routeTable.trim().split('\n').length, 1, 'Refuse external IPv4 route')
    const machineId = readFileSync('/etc/machine-id', 'utf8').trim()
    assert.match(machineId, /^[0-9a-f]{32}$/, 'Owned minimal container needs a real task-owned machine identity')
    report.identities.ownedMachineIdSha256 = hash(machineId)
  } else {
    // macOS sandbox-exec cannot launch the setuid /bin/ps used by production
    // process-incarnation checks. Use the disposable CI runner with cleared env,
    // isolated config and a dummy API profile pointed at the owned loopback API.
    // Unlike disconnected Linux, this does not claim an OS-wide network fence.
    report.network = { fence: null, generation: 'owned 127.0.0.1 fake Anthropic only', sandboxExec: false,
      limitation: 'No OS-wide network fence; SDK gate env and every observed generation endpoint are asserted' }
  }
  report.identities.coreutilsBin = dirname(realpathSync('/usr/bin/env'))
  report.identities.sleepExecutable = safeEnv.PATH.split(':').map(directory => join(directory, 'sleep')).find(existsSync)
  assert(report.identities.sleepExecutable, 'Production POSIX gate needs sleep on sanitized PATH')
  const target = join(out, 'lib/meridian'), wrapper = join(out, 'bin/meridian')
  report.versions.meridian = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version
  report.identities.packageSha256 = hash(readFileSync(join(target, 'package.json')))
  report.identities.serverSha256 = hash(readFileSync(join(target, 'dist/server.js')))
  report.identities.wrapperSha256 = hash(readFileSync(wrapper))
  report.identities.wrapperText = readFileSync(wrapper, 'utf8')
  report.identities.removedBundledNativePackages = readdirSync(join(target, 'node_modules/@anthropic-ai')).filter(name => name === 'claude-code' || name.startsWith('claude-code-') || name.startsWith('claude-agent-sdk-'))
  assert.equal(report.identities.removedBundledNativePackages.length, 0)
  const witnessPath = join(output, 'wrapper-witness.json'), preload = join(output, 'wrapper-witness.mjs')
  writeFileSync(preload, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(witnessPath)}, JSON.stringify({selected:process.env.MERIDIAN_CLAUDE_PATH,node:process.version,execPath:process.execPath}));\n`)
  const wrapped = childProcess.spawn(wrapper, ['--version'], { env: { ...safeEnv, NODE_OPTIONS: `--import=${preload}` }, stdio: ['ignore', 'pipe', 'pipe'], cwd: work })
  let wrappedText = ''
  wrapped.stdout.on('data', chunk => { wrappedText += chunk })
  await joinOwned(actors.filter(actor => actor.child === wrapped), 'installed-wrapper-version')
  assert.equal(wrapped.exitCode, 0)
  report.versions.wrapper = wrappedText.trim()
  report.wrapperWitness = JSON.parse(readFileSync(witnessPath, 'utf8'))
  assert.equal(realpathSync(report.wrapperWitness.execPath), realpathSync(process.execPath), 'Run the qualification under installed wrapper Node')
  selectedNative = report.wrapperWitness.selected
  assert(typeof selectedNative === 'string' && selectedNative.startsWith('/nix/store/') && selectedNative.includes('-claude-code-'))
  report.identities.selectedNative = selectedNative
  report.identities.selectedNativeRealpath = realpathSync(selectedNative)
  report.identities.selectedNativeSha256 = hash(readFileSync(selectedNative))
  process.env.MERIDIAN_CLAUDE_PATH = selectedNative // The observed wrapper DEFAULT, never an npm override.
  const native = childProcess.spawn(selectedNative, ['--version'], { env: safeEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: work })
  let nativeText = ''
  native.stdout.on('data', chunk => { nativeText += chunk })
  await joinOwned(actors.filter(actor => actor.child === native), 'installed-native-version')
  assert.equal(native.exitCode, 0)
  report.versions.native = nativeText.trim()
  assert.match(nativeText, /^2\.1\.(\d+)\s+\(Claude Code\)/)
  assert(Number(/^2\.1\.(\d+)/.exec(nativeText)[1]) >= 293)
  const require = createRequire(join(target, 'package.json'))
  const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk')
  report.identities.sdkEntry = sdkEntry
  report.identities.sdkEntrySha256 = hash(readFileSync(sdkEntry))
  report.versions.sdk = JSON.parse(readFileSync(join(dirname(sdkEntry), 'package.json'), 'utf8')).version
  assert.equal(report.versions.sdk, '0.2.141')
  const sdk = await import(pathToFileURL(sdkEntry).href)
  let requestCount = 0
  fixture = createServer(async (request, response) => {
    activeHandlers++
    try {
      assert(admission, 'Fixture admission retired')
      assert(++requestCount <= 64, 'Fixture request limit exceeded')
      assert.equal(request.method, 'POST')
      let bytes = 0, chunks = []
      for await (const chunk of request) { bytes += chunk.length; assert(bytes <= 2_000_000, 'Fixture body limit'); chunks.push(chunk) }
      const bodyBytes = Buffer.concat(chunks), body = JSON.parse(bodyBytes)
      const route = new URL(request.url, 'http://127.0.0.1')
      if (route.pathname === '/v1/messages/count_tokens') { response.setHeader('content-type', 'application/json'); response.end('{"input_tokens":20}'); return }
      assert.equal(route.pathname, '/v1/messages')
      assert([...route.searchParams].every(([key, value]) => key === 'beta' && value === 'true'), 'Unexpected fixture query parameter')
      const rejected = body.model === 'claude-haiku-5-5' && body.thinking?.type === 'enabled'
      const gates = actors.filter(actor => actor.state.sdkGate && actor.state.label === activeCase)
      for (const actor of gates) await witnessGate(actor)
      report.requests.push({ case: activeCase, path: request.url, bodySha256: hash(bodyBytes), bodyBytes: bytes,
        model: body.model, thinking: body.thinking ?? null, outputConfig: body.output_config ?? null, stream: body.stream ?? false, rejected,
        headers: Object.fromEntries(['anthropic-version', 'anthropic-beta', 'user-agent'].filter(name => request.headers[name]).map(name => [name, request.headers[name]])) })
      if (rejected) { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Owned fixture: Haiku 5.5 rejects manual enabled/budget_tokens' } })); return }
      const reply = fixtureResponse(body, requestCount)
      response.writeHead(200, { 'content-type': reply.type, 'request-id': `owned-${requestCount}` })
      response.end(reply.text)
    } catch (error) { fail(`fixture: ${error}`); response.writeHead(400, { 'content-type': 'application/json' }); response.end('{"type":"error","error":{"type":"invalid_request_error","message":"owned fixture contract failure"}}') }
    finally { activeHandlers-- }
  })
  fixture.on('connection', socket => ownSocket(socket, 'fixture'))
  fixture.once('close', () => { fixtureClose = true })
  fixture.requestTimeout = 10000
  fixture.listen(0, '127.0.0.1')
  await once(fixture, 'listening')
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`
  const control = await fetch(`${fixtureUrl}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-5-5', thinking: { type: 'enabled', budget_tokens: 2048 } }), signal: AbortSignal.timeout(3000) })
  assert.equal(control.status, 400); await control.text()
  report.fixtureNegativeControl = { status: control.status, manual55Rejected: true }
  const { startProxyServer } = await import(pathToFileURL(join(target, 'dist/server.js')).href)
  proxy = await startProxyServer({ port: 0, host: '127.0.0.1', silent: true,
    profiles: [{ id: 'owned-api', type: 'api', apiKey: 'owned-loopback-dummy-key', baseUrl: fixtureUrl }], defaultProfile: 'owned-api' })
  proxy.server.on('connection', socket => ownSocket(socket, 'proxy'))
  proxy.server.once('close', () => { proxyClose = true })
  if (!proxy.server.listening) await once(proxy.server, 'listening')
  const proxyUrl = `http://127.0.0.1:${proxy.server.address().port}`
  const catalog = await (await fetch(`${proxyUrl}/v1/models`, { signal: AbortSignal.timeout(5000) })).json()
  assert.equal(catalog.data.find(model => model.id === 'claude-haiku-5-5').context_window, 1_000_000)
  assert.equal(catalog.data.find(model => model.id === 'claude-haiku-4-5').context_window, 200_000)
  report.catalogQualified = true
  const cases = [
    { name: 'alias-default-json', model: 'haiku', expected: 'claude-haiku-5-5' },
    { name: 'alias-default-sse', model: 'haiku', expected: 'claude-haiku-5-5', stream: true },
    { name: 'explicit55-enabled-budget', model: 'claude-haiku-5-5', expected: 'claude-haiku-5-5', thinking: { type: 'enabled', budgetTokens: 2048 } },
    { name: 'alias-enabled-budget-summarized', model: 'haiku', expected: 'claude-haiku-5-5', stream: true, thinking: { type: 'enabled', budgetTokens: 2048, display: 'summarized' }, effort: 'medium' },
    { name: 'explicit55-adaptive-summarized', model: 'claude-haiku-5-5', expected: 'claude-haiku-5-5', thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high' },
    // Existing production HTTP builder takes the SDK's budgetTokens field.
    // The earlier snake_case attempt is retained separately, not qualified as
    // budget-preserving: unchanged base passes it through without translating.
    { name: 'explicit45-enabled-control', model: 'claude-haiku-4-5-20251001', expected: 'claude-haiku-4-5-20251001', thinking: { type: 'enabled', budgetTokens: 2048 } },
    ...[false, true].flatMap(stream => [
      { name: `explicit55-disabled-${stream ? 'sse' : 'json'}`, model: 'claude-haiku-5-5', stream, thinking: { type: 'disabled' }, reject: true },
      { name: `alias-adaptive-omitted-${stream ? 'sse' : 'json'}`, model: 'haiku', stream, thinking: { type: 'adaptive', display: 'omitted' }, reject: true },
    ]),
  ]
  const seenSessions = new Set()
  for (const arm of cases) {
    activeCase = arm.name
    const flowReceipt = `${receipt}_${arm.name}`
    const row = { ...arm, result: 'RUNNING' }; report.cases.push(row)
    const before = report.requests.length, actorBefore = actors.length
    try {
      const response = await fetch(`${proxyUrl}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'owned-nix-qualification', 'x-session-affinity': `${arm.name}-${randomUUID()}` },
        body: JSON.stringify({ model: arm.model, stream: arm.stream ?? false, max_tokens: 128, system: 'Owned credentialless Nix compatibility fixture.',
          messages: [{ role: 'user', content: `Return the fixture receipt for ${arm.name}.` }], tools: [], ...(arm.thinking ? { thinking: arm.thinking } : {}), ...(arm.effort ? { output_config: { effort: arm.effort } } : {}) }), signal: AbortSignal.timeout(45000) })
      row.httpStatus = response.status
      const text = await response.text()
      row.responseSha256 = hash(text)
      if (arm.reject) {
        const body = JSON.parse(text)
        assert.equal(response.status, 400); assert.equal(body.error.type, 'invalid_request_error'); assert.match(body.error.message, /cannot reliably honor/)
        assert.equal(report.requests.length, before, 'Guard sent a generation request')
        assert(!actors.slice(actorBefore).some(actor => actor.state.sdkGate), 'Guard spawned a production SDK gate')
        row.rejectedBeforeQuery = true; row.error = body.error
      } else {
        assert.equal(response.status, 200, text.slice(-3000))
        assert(text.includes(flowReceipt), 'Installed HTTP did not materialize this case\'s actual SDK/native fixture receipt')
        assert(!text.includes('event: error'), text.slice(-3000))
        const wires = report.requests.slice(before)
        assert(wires.length > 0 && wires.length <= 6, `Expected bounded native wire requests; saw ${wires.length}`)
        for (const wire of wires) {
          assert.equal(wire.model, arm.expected); assert.equal(wire.rejected, false)
          if (arm.expected === 'claude-haiku-5-5') { assert.equal(wire.thinking?.type, 'adaptive'); assert(!('budget_tokens' in (wire.thinking ?? {}))) }
          else { assert.equal(wire.thinking?.type, 'enabled'); assert.equal(wire.thinking?.budget_tokens, 2048) }
          if (arm.thinking?.display) assert.equal(wire.thinking?.display, arm.thinking.display)
          if (arm.effort) assert.equal(wire.outputConfig?.effort, arm.effort)
        }
        const rows = await (await fetch(`${proxyUrl}/telemetry/requests?limit=20&hops=1`, { signal: AbortSignal.timeout(5000) })).json()
        const freshRows = rows.filter(item => item.sdkSessionId && !seenSessions.has(item.sdkSessionId))
        assert.equal(freshRows.length, 1, 'Expected exactly one fresh session, not an earlier case receipt')
        const telemetry = freshRows[0]
        assert.equal(telemetry.resolvedModel, arm.expected)
        seenSessions.add(telemetry.sdkSessionId)
        row.telemetry = Object.fromEntries(['model', 'resolvedModel', 'sdkSessionId', 'status', 'adapter'].map(name => [name, telemetry[name]]))
        const history = await bounded(sdk.getSessionMessages(telemetry.sdkSessionId, { dir: work }), 5000, 'Public SDK history deadline')
        const messages = history.filter(message => message.type === 'assistant')
        assert(messages.some(message => JSON.stringify(message.message.content).includes(flowReceipt)), 'Public installed SDK history lacks fixture receipt')
        const models = [...new Set(messages.map(message => message.message.model))]
        assert.deepEqual(models, [arm.expected], 'Public SDK history does not prove selected native model')
        row.history = { materialized: true, observedModels: models, sha256: hash(JSON.stringify(history)) }
        const gates = actors.slice(actorBefore).filter(actor => actor.state.sdkGate)
        assert(gates.length > 0, 'No original production SDK gate observed')
        assert(gates.every(actor => actor.state.gatePublished && actor.state.nativeExecObserved), 'Missing physical production gate/native-exec witness')
      }
      row.result = 'PASS'
    } catch (error) { row.result = 'FAIL'; row.failure = String(error); fail(`${arm.name}: ${error}`) }
    await joinOwned(actors.slice(actorBefore), arm.name)
    for (const actor of actors.slice(actorBefore).filter(actor => actor.state.sdkGate)) {
      if (actor.state.code !== 0 || !actor.state.exit || !actor.state.close || !actor.state.stdoutClose || !actor.state.stderrClose) {
        row.result = 'FAIL'; fail(`${arm.name}: SDK gate original exit/close/both-pipe witness failed`)
      }
    }
    if (!admission) break
  }
} catch (error) { fail(error) }
finally {
  admission = false
  if (proxy) try { await bounded(proxy.close(), 20000, 'Installed proxy shutdown deadline') } catch (error) { fail(error) }
  await joinOwned(actors, 'final native actors')
  report.cleanup.joined = actors.length > 0 && actors.every(actor => actor.state.close && actor.state.stdoutClose && actor.state.stderrClose)
  report.cleanup.nativeActorCount = actors.length
  report.cleanup.productionGateCount = actors.filter(actor => actor.state.sdkGate).length
  report.cleanup.proxyListenerClose = !proxy || proxyClose
  report.cleanup.fixtureListenerClose = !fixture
  report.cleanup.activeHandlers = activeHandlers
  // Unknown actor custody retains the live fixture and container. No broad PID
  // kills, fabricated close or exitCode-only join. Even successful state is kept.
  if (report.cleanup.joined && fixture) {
    try {
      const closed = new Promise((resolveClose, reject) => fixture.close(error => error ? reject(error) : resolveClose()))
      for (const owned of sockets) if (owned.state.label === 'fixture' && !owned.state.close) owned.socket.destroy()
      await bounded(closed, 5000, 'Fixture listener physical close deadline')
      report.cleanup.fixtureListenerClose = fixtureClose
    } catch (error) { fail(error) }
  }
  if (report.cleanup.joined) try { await bounded(Promise.all(sockets.map(owned => owned.closed)), 5000, 'Owned HTTP socket close deadline') } catch (error) { fail(error) }
  report.cleanup.sockets = sockets.map(owned => owned.state)
  if (!report.cleanup.joined || !report.cleanup.proxyListenerClose || !report.cleanup.fixtureListenerClose || activeHandlers || sockets.some(owned => !owned.state.close)) fail('Physical native/listener/socket cleanup unqualified; fixtures/container retained')
  for (const actor of actors) if (!actor.state.exit || actor.state.errors.length) fail(`Actor exit/error witness: ${actor.state.label}`)
  for (const probe of report.synchronousSubprocesses) {
    // Node's spawnSync returns after the child and its captured output finish.
    // Production Darwin identity probes are synchronous by design. Require a
    // successful completed probe; do not pretend they expose async pipe events.
    if (process.platform !== 'darwin' || probe.method !== 'spawnSync'
      || !['/usr/sbin/ioreg', '/usr/sbin/sysctl', '/bin/ps'].includes(probe.command)
      || probe.status !== 0 || probe.signal || probe.error) fail(`Unqualified synchronous probe: ${JSON.stringify(probe)}`)
  }
  for (const method of Object.keys(originals)) childProcess[method] = originals[method]
  for (const method of Object.keys(synchronousOriginals)) childProcess[method] = synchronousOriginals[method]
  syncBuiltinESMExports()
  report.result = report.failures.length ? 'FAIL' : 'PASS'
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ result: report.result, acceptance: false, output, native: report.versions.native, sdk: report.versions.sdk, failures: report.failures, cases: report.cases.map(({ name, result }) => ({ name, result })), cleanup: report.cleanup }))
  process.exitCode = report.result === 'PASS' ? 0 : 1
}
