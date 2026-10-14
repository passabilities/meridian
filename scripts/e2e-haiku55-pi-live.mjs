#!/usr/bin/env node
// Actual Pi -> installed/source-built Meridian -> native SDK -> Haiku 5.5.
// Explicit access-only profile; never changes accounts, refreshes auth or enables Extra Usage.
// E2E_ALLOW_LIVE_MODEL=1 E2E_LIVE_PROFILE_FILE=<private owned grant>
// E2E_PI_PACKAGE=<actual package> E2E_NATIVE_BIN=<qualified native CLI>
// E2E_MERIDIAN_ROOT=<built checkout or fresh installed package> node this-file
// Bun's builtin-export synchronization is not qualified for this spawn observer.
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
assert(!process.versions.bun, 'Run with native Node: original-child observation is not qualified under Bun')
assert.equal(process.env.E2E_ALLOW_LIVE_MODEL, '1', 'Live model use requires explicit authorization')
const grant = process.env.E2E_LIVE_PROFILE_FILE
const piDir = process.env.E2E_PI_PACKAGE
const native = process.env.E2E_NATIVE_BIN
assert(grant && piDir && native, 'Select the private access-only grant, actual Pi and exact native CLI')
assert.equal(statSync(grant).mode & 0o077, 0, 'Grant must be private')
const profiles = JSON.parse(readFileSync(grant, 'utf8'))
assert(Array.isArray(profiles) && profiles.length === 1 && profiles[0].type === 'oauth-token'
  && typeof profiles[0].oauthToken === 'string' && profiles[0].oauthToken && !profiles[0].refreshToken,
'Use one supported access-only profile; no refresh credential')
const repo = resolve(process.env.E2E_MERIDIAN_ROOT ?? '.')
const clientModel = process.env.E2E_CLIENT_MODEL ?? 'haiku'
const root = mkdtempSync(join(tmpdir(), 'meridian-haiku55-pi-live-'))
// OAuth-token profiles isolate transcripts in this supported profile directory,
// not in an arbitrary ProfileConfig.env (which the public interface does not use).
assert(typeof profiles[0].id === 'string' && /^[a-zA-Z0-9_-]+$/.test(profiles[0].id), 'Use a safe owned profile ID')
const project = join(root, 'project'), agentDir = join(root, 'pi'), home = join(root, 'home')
const config = join(root, 'meridian', 'profiles', profiles[0].id)
for (const dir of [project, agentDir, home, config, join(root, 'meridian')]) mkdirSync(dir, { recursive: true, mode: 0o700 })
const receipt = `HAIKU55_READ_${randomUUID()}`
const file = join(project, 'receipt.txt')
writeFileSync(file, receipt + '\n')
for (const key of Object.keys(process.env)) if (key.startsWith('MERIDIAN_') || key.startsWith('CLAUDE_PROXY_')) delete process.env[key]
Object.assign(process.env, { HOME: home, MERIDIAN_CONFIG_DIR: join(root, 'meridian'), MERIDIAN_SESSION_DIR: join(root, 'store'),
  MERIDIAN_WORKDIR: project, MERIDIAN_TELEMETRY_PERSIST: '0', MERIDIAN_CREDENTIALS_READONLY: '1',
  MERIDIAN_NO_UPDATE_CHECK: '1', MERIDIAN_PASSTHROUGH: '1', MERIDIAN_CLAUDE_PATH: native, CLAUDE_CONFIG_DIR: config })
delete process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
const actors = []
const spawn = childProcess.spawn
childProcess.spawn = function (...args) {
  const child = spawn.apply(this, args)
  const state = { pid: child.pid ?? null, command: String(args[0]).split('/').at(-1),
    sdkGate: Array.isArray(args[1]) && (args[1].includes('meridian-sdk-gate') || args[2]?.env?.MERIDIAN_SDK_GATE_PATH !== undefined),
    close: false, stdoutClose: !child.stdout, stderrClose: !child.stderr }
  child.once('close', (code, signal) => { state.close = true; state.code = code; state.signal = signal })
  child.stdout?.once('close', () => { state.stdoutClose = true })
  child.stderr?.once('close', () => { state.stderrClose = true })
  actors.push(state)
  return child
}
syncBuiltinESMExports()
const report = { result: 'RUNNING', acceptance: false, model: 'claude-haiku-5-5', clientModel, platform: `${process.platform}/${process.arch}`,
  node: process.version, source: JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version,
  harnessSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'), actors,
  credentials: { accessOnly: true, refreshAuthorized: false, extraUsageAuthorized: false, accountSwitchAuthorized: false } }
let proxy, session, modelRuntime, timer
let sdkAttempted = false
const bounded = (promise, ms, label) => new Promise((resolvePromise, reject) => {
  const deadline = setTimeout(() => reject(new Error(label)), ms)
  Promise.resolve(promise).then(resolvePromise, reject).finally(() => clearTimeout(deadline))
})
try {
  const probe = childProcess.spawn(native, ['--version'], { env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: config,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let versionText = ''
  probe.stdout.on('data', chunk => { versionText += chunk })
  probe.stderr.resume()
  const probeKill = setTimeout(() => probe.kill('SIGKILL'), 10000)
  try {
    const [code] = await bounded(once(probe, 'close'), 12000, 'Native version probe original-close deadline')
    assert.equal(code, 0)
    report.nativeVersion = versionText.trim()
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(report.nativeVersion)
    assert(match && (Number(match[1]) > 2 || Number(match[1]) === 2 && (Number(match[2]) > 1 || Number(match[2]) === 1 && Number(match[3]) >= 293)), 'Haiku 5.5 requires Claude Code 2.1.293+')
  } finally { clearTimeout(probeKill) }
  const metadata = JSON.parse(readFileSync(join(piDir, 'package.json'), 'utf8'))
  assert.equal(metadata.name, '@earendil-works/pi-coding-agent')
  report.pi = metadata.version
  const pi = await import(pathToFileURL(join(piDir, metadata.exports['.'].import)).href)
  const { startProxyServer } = await import(pathToFileURL(join(repo, 'dist/server.js')).href)
  proxy = await startProxyServer({ port: 0, host: '127.0.0.1', silent: true, profiles, defaultProfile: profiles[0].id })
  if (!proxy.server.listening) await once(proxy.server, 'listening')
  const baseUrl = `http://127.0.0.1:${proxy.server.address().port}`
  const catalog = await (await fetch(`${baseUrl}/v1/models`)).json()
  const advertised = catalog.data?.find(model => model.id === report.model)
  assert(advertised?.context_window === 1000000 && advertised.capabilities?.thinking.types.enabled.supported === false, 'Installed HTTP catalog does not advertise Haiku 5.5 correctly')
  const modelsPath = join(agentDir, 'models.json'), authPath = join(agentDir, 'auth.json')
  writeFileSync(authPath, '{}', { mode: 0o600 })
  writeFileSync(modelsPath, JSON.stringify({ providers: { 'owned-meridian-live': { api: 'anthropic-messages', baseUrl,
    apiKey: 'owned-loopback-placeholder', headers: { 'x-meridian-agent': 'pi', 'x-meridian-profile': profiles[0].id,
      'user-agent': `pi-coding-agent/${metadata.version}`, 'x-session-affinity': `haiku55-${randomUUID()}` },
    models: [{ id: clientModel, name: 'Haiku 5.5 owned live gate', reasoning: true, input: ['text'], contextWindow: 1000000,
      maxTokens: 2048, cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } }] } } }), { mode: 0o600 })
  modelRuntime = await pi.ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false })
  const model = modelRuntime.getModel('owned-meridian-live', clientModel)
  assert(model && model.baseUrl === baseUrl, 'Actual Pi must use only the selected Meridian route')
  const loader = { getExtensions: () => ({ extensions: [], errors: [], runtime: pi.createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => `Owned release tool-receipt fixture. Working directory: ${project}. Use only declared tools.`,
    getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources: () => {}, reload: async () => {} }
  const reads = []
  const read = pi.createReadToolDefinition(project, { operations: {
    access: async path => assert.equal(path, file, 'Only the exact owned receipt may be read'),
    readFile: async path => { assert.equal(path, file); reads.push(path); return readFileSync(path) },
    detectImageMimeType: async path => { assert.equal(path, file); return undefined },
  } })
  const created = await pi.createAgentSession({ cwd: project, agentDir, modelRuntime, model, thinkingLevel: 'low', resourceLoader: loader,
    sessionManager: pi.SessionManager.create(project, join(root, 'pi-sessions')),
    settingsManager: pi.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: 'off', enableInstallTelemetry: false }),
    tools: ['read'], customTools: [read] })
  session = created.session
  assert.deepEqual(session.getActiveToolNames(), ['read'])
  timer = setTimeout(() => { void session.abort() }, 120000)
  sdkAttempted = true
  await bounded(session.prompt(`Use read to read ${file}, then return its exact receipt. Do not guess or use another tool.`), 130000, 'Actual Pi/native turn deadline')
  await session.waitForIdle()
  const last = session.messages.filter(message => message.role === 'assistant').at(-1)
  report.clientTerminal = { stopReason: last?.stopReason, error: last?.errorMessage?.replaceAll(profiles[0].oauthToken, '[redacted]') }
  assert(last && !['error', 'aborted'].includes(last.stopReason), report.clientTerminal.error ?? 'Actual Pi did not complete')
  assert(reads.length > 0, 'Actual Pi did not execute the real owned read')
  assert(JSON.stringify(last.content).includes(receipt), 'The model did not read back the tool receipt')
  report.actualReadBack = true
  report.ownedReadCount = reads.length
  const rows = await (await fetch(`${baseUrl}/telemetry/requests?limit=20&hops=1`)).json()
  report.requests = rows.map(({ adapter, model, requestModel, resolvedModel, sdkSessionId, status, error }) => ({ adapter, model, requestModel, resolvedModel, sdkSessionId, status, error }))
  assert(rows.length && rows.every(row => row.adapter === 'pi' && row.resolvedModel === report.model), 'Actual Pi routing/pin metadata missing')
  const require = createRequire(join(repo, 'package.json'))
  const sdkEntry = require.resolve('@anthropic-ai/claude-agent-sdk')
  report.sdk = JSON.parse(readFileSync(join(dirname(sdkEntry), 'package.json'), 'utf8')).version
  const sdk = await import(pathToFileURL(sdkEntry).href)
  const observed = new Set()
  const previousConfig = process.env.CLAUDE_CONFIG_DIR
  try {
    process.env.CLAUDE_CONFIG_DIR = config
    for (const id of new Set(rows.map(row => row.sdkSessionId).filter(Boolean))) {
      const history = await sdk.getSessionMessages(id, { dir: project })
      for (const message of history) if (message.type === 'assistant' && typeof message.message?.model === 'string') observed.add(message.message.model)
    }
  } finally {
    if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previousConfig
  }
  report.observedNativeModels = [...observed]
  assert(observed.size && [...observed].every(id => id === report.model), 'Supported SDK history does not prove the actual Haiku 5.5 model')
  report.actualReadBack = true
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.failure = String(error).replaceAll(profiles[0].oauthToken, '[redacted]')
} finally {
  clearTimeout(timer)
  try {
    if (session) { await bounded(session.abort(), 15000, 'Pi abort deadline'); await bounded(session.waitForIdle(), 15000, 'Pi idle deadline'); session.dispose() }
    if (proxy) await bounded(proxy.close(), 20000, 'Proxy joined shutdown deadline')
    if (modelRuntime && typeof modelRuntime.dispose === 'function') await bounded(modelRuntime.dispose(), 10000, 'Pi model runtime disposal deadline')
    assert(!sdkAttempted || actors.some(actor => actor.sdkGate), 'No original production SDK gate observed; physical cleanup is unqualified (retain fixtures/grant)')
    await bounded((async () => {
      while (!actors.every(actor => actor.close && actor.stdoutClose && actor.stderrClose)) await new Promise(resolveWait => setTimeout(resolveWait, 25))
    })(), 15000, 'Original child and both captured pipe closure deadline')
    report.cleanupJoined = true
  } catch (error) { report.cleanupJoined = false; report.cleanupFailure = String(error).replaceAll(profiles[0].oauthToken, '[redacted]'); report.result = 'FAIL' }
  childProcess.spawn = spawn
  syncBuiltinESMExports()
  report.acceptance = report.result === 'PASS' && report.cleanupJoined
  report.fixtureRetained = true
  writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ ...report, privateArtifacts: root }))
  process.exitCode = report.result === 'PASS' ? 0 : 1
}
