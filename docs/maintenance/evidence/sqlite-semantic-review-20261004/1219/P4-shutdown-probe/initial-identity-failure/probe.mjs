import { mock } from 'bun:test'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const source = '/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/probe-source'
const root = process.argv[2]
if (!root || (statSync(root).mode & 0o777) !== 0o700) throw new Error('expected owned private disposable root')
const sessions = join(root, 'sessions')
for (const name of ['sessions', 'config', 'claude', 'plugins', 'xdg', 'work']) mkdirSync(join(root, name), { mode: 0o700 })
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MERIDIAN_') || key.startsWith('CLAUDE_PROXY_') || key.startsWith('ANTHROPIC_') || key === 'CLAUDE_CODE_OAUTH_TOKEN') delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, 'config'), MERIDIAN_SESSION_DIR: sessions,
  MERIDIAN_WORKDIR: join(root, 'work'), CLAUDE_CONFIG_DIR: join(root, 'claude'),
  XDG_CONFIG_HOME: join(root, 'xdg'), MERIDIAN_BOOKKEEPING: 'sqlite',
  MERIDIAN_ROUTING: 'manual', MERIDIAN_PASSTHROUGH: '0',
  MERIDIAN_CREDENTIALS_READONLY: '1', MERIDIAN_NO_UPDATE_CHECK: '1',
  MERIDIAN_SESSION_GC_GRACE_MS: '3600000', MERIDIAN_SESSION_GC_INTERVAL_MS: '3600000',
  MERIDIAN_SHUTDOWN_GRACE_MS: '50', MERIDIAN_TEST_DISABLE_SDK_PROCESS_GATE: '1',
  MERIDIAN_TELEMETRY_PERSIST: '0', MERIDIAN_BACKEND: 'claude',
})

const events = []
const beginning = performance.now()
const note = (name, fields = {}) => events.push({ name, elapsedMs: Number((performance.now() - beginning).toFixed(3)), ...fields })
const counters = { sdkQueries: 0, syntheticAuthChecks: 0, syntheticExecutableResolutions: 0, syntheticCredentialReads: 0, outboundFetchRefusals: 0, realCredentialReads: 0, spawnedSdkChildren: 0 }
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    counters.outboundFetchRefusals++
    throw new Error('P4 probe forbids non-loopback network')
  }
  return realFetch(input, init)
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function bounded(promise, name, ms = 6000) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} timed out`)), ms) })]) }
  finally { clearTimeout(timer) }
}
const queryStarted = deferred()
const cleanupStarted = deferred()
const releaseCleanup = deferred()
const cleanupFinished = deferred()
let heldFinalizer = false

// Keep the real pure model logic. Replace only executable/auth boundaries.
const modelPath = join(source, 'src/proxy/models.ts')
const models = await import(modelPath)
mock.module(modelPath, () => ({ ...models,
  resolveClaudeExecutableAsync: async () => { counters.syntheticExecutableResolutions++; return '/__p4_mock_cli_never_spawned__' },
  resolveClaudeExecutableSync: () => ({ path: '/__p4_mock_cli_never_spawned__', source: 'configured' }),
  getResolvedClaudeExecutableInfo: () => ({ path: '/__p4_mock_cli_never_spawned__', source: 'configured' }),
  getClaudeAuthStatusAsync: async () => { counters.syntheticAuthChecks++; return { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' } },
}))
const tokenPath = join(source, 'src/proxy/tokenRefresh.ts')
const tokens = await import(tokenPath)
const syntheticStore = { read: async () => { counters.syntheticCredentialReads++; return null }, write: async () => { throw new Error('P4 probe forbids credential writes') } }
mock.module(tokenPath, () => ({ ...tokens,
  createPlatformCredentialStore: () => syntheticStore,
  ensureFreshToken: async () => false, refreshOAuthToken: async () => false,
  startBackgroundRefresh: () => {}, stopBackgroundRefresh: () => {},
  readStoredCredentialPresence: async () => 'unknown', getStoredPlanFields: async () => ({}),
  getAuthRenewalStatus: async () => ({ refreshTokenExpiresAt: null, daysUntilRenewal: null, renewalRequiredSoon: false }),
}))
mock.module(join(source, 'src/logger.ts'), () => ({
  claudeLog: (name) => { if (name.startsWith('passthrough.client_abort') || name.includes('cleanup') || name.includes('bookkeeping')) note('productionLog', { event: name }) },
  withClaudeLogContext: (_context, callback) => callback(),
}))
mock.module(join(source, 'src/proxy/mcpTools.ts'), () => ({ createOpencodeMcpServer: () => ({ type: 'sdk', name: 'opencode', instance: {} }) }))

const { setSdkMock } = await import(join(source, 'src/__tests__/sdkMock.ts'))
const helpers = await import(join(source, 'src/__tests__/helpers.ts'))
setSdkMock(() => ({
  query(params) {
    counters.sdkQueries++
    return (async function* () {
      const sessionId = helpers.resolveMockSdkSessionId(params.options, 'p4-synthetic-sdk-session')
      note('mockSdkStarted')
      queryStarted.resolve()
      yield { ...helpers.messageStart(), session_id: sessionId }
      yield { ...helpers.textBlockStart(0), session_id: sessionId }
      const signal = params.options.abortController.signal
      await new Promise(resolve => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', resolve, { once: true })
      })
      note('mockSdkObservedAbort')
      throw Object.assign(new Error('synthetic SDK abort'), { name: 'AbortError' })
    })()
  },
  createSdkMcpServer: () => ({ type: 'sdk', name: 'test', instance: {} }),
  tool: () => ({}),
}), 'isolated P4 shutdown probe')

// Explicit fault injection: pause the ACTUAL production request's finalizer.
// The real SQL transcript-lease release still runs after the pause.
const lifecyclePath = join(source, 'src/proxy/sessionLifecycle.ts')
const lifecycle = await import(lifecyclePath)
const realReleaseJoinedTranscriptLease = lifecycle.releaseJoinedTranscriptLease
mock.module(lifecyclePath, () => ({ ...lifecycle,
  async releaseJoinedTranscriptLease(...args) {
    if (!heldFinalizer) {
      heldFinalizer = true
      note('actualRequestFinalizerPaused')
      cleanupStarted.resolve()
      await releaseCleanup.promise
      note('actualRequestFinalizerReleased')
    }
    await realReleaseJoinedTranscriptLease(...args)
    note('actualSqlTranscriptLeaseReleased')
    cleanupFinished.resolve()
  },
}))

const { startProxyServer } = await import(join(source, 'src/proxy/server.ts'))
const { retainedBookkeepingRuntimeDirectory } = await import(join(source, 'src/proxy/session/bookkeeping/runtimeIdentity.ts'))
const { acquireMaintenanceGuard } = await import(join(source, 'src/proxy/session/bookkeeping/guard.ts'))
const { connectionFor } = await import(join(source, 'src/proxy/session/bookkeeping/connection.ts'))
const { activeStoreBackend } = await import(join(source, 'src/proxy/session/bookkeeping/storeBackend.ts'))

function ownershipSnapshot(label) {
  let guardReleased = false
  let guardError
  try { const guard = acquireMaintenanceGuard(sessions); guardReleased = true; guard.close() }
  catch (error) { guardError = { name: error.name, message: error.message } }
  let connection
  try { const actual = connectionFor(sessions); connection = { refs: actual.refs, pending: actual.pending, phase: actual.phase, databaseOpen: Boolean(actual.db) } }
  catch (error) { connection = { unavailable: true, error: error.message } }
  const result = { label, guardReleased, guardError, runtimeIdentityRetained: retainedBookkeepingRuntimeDirectory() === sessions, sqliteBackendInstalled: Boolean(activeStoreBackend()), connection }
  note('ownershipSnapshot', result)
  return result
}

let instance
let response
let readResult
let closePromise
const watchdog = setTimeout(() => { console.error('P4 probe watchdog expired'); process.exit(70) }, 14000)
try {
  instance = await startProxyServer({ port: 0, host: '127.0.0.1', silent: true,
    backend: 'claude', pluginDir: join(root, 'plugins'), pluginConfigPath: join(root, 'config/plugins.json') })
  const address = instance.server.address()
  if (!address || typeof address === 'string') throw new Error('expected live TCP listener')
  const base = `http://127.0.0.1:${address.port}`
  note('actualProxyListening', { port: address.port })
  const request = fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-opencode-session': 'p4-shutdown-own-session' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', stream: true, max_tokens: 128, messages: [{ role: 'user', content: 'synthetic P4 request; never sent upstream' }] }) })
  await bounded(queryStarted.promise, 'actual SDK invocation')
  response = await bounded(request, 'HTTP streaming response')
  if (response.status !== 200) throw new Error(`unexpected response ${response.status}: ${await response.text()}`)
  readResult = response.text().then(body => ({ settled: true, bodyBytes: body.length }), error => ({ settled: true, error: error.name, message: error.message }))
  const initialOwnership = ownershipSnapshot('admitted request, before close')
  closePromise = instance.close()
  if (instance.close() !== closePromise) throw new Error('actual close() is not idempotent')
  let closed = false
  closePromise.then(() => { closed = true; note('actualClosePromiseFulfilled') })
  await bounded(cleanupStarted.promise, 'actual finalizer reached')
  const activeOwnership = ownershipSnapshot('actual finalizer active')
  if (activeOwnership.guardReleased || !activeOwnership.runtimeIdentityRetained) throw new Error('ownership unexpectedly released while finalizer active')
  await bounded(closePromise, 'actual close fulfillment after fixed two-second settlement window', 5000)
  if (!closed) throw new Error('close continuation not observed')
  const afterCloseBeforeSettlement = ownershipSnapshot('close fulfilled, actual finalizer still paused')
  const listenerClosed = !instance.server.listening
  releaseCleanup.resolve()
  await bounded(cleanupFinished.promise, 'real transcript-lease release')
  await bounded(readResult, 'HTTP response consumer settled')
  // Allow the ACTUAL stream completion/finally chain to decrement in-flight.
  await Bun.sleep(250)
  const afterSettlement = ownershipSnapshot('real finalizer finished plus 250ms')
  const cachedPromise = instance.close()
  const cachedPromiseIdentical = cachedPromise === closePromise
  await bounded(cachedPromise, 'cached close rejoin')
  await Bun.sleep(750)
  const eventualOwnership = ownershipSnapshot('real finalizer finished plus 1000ms and cached close rejoin')
  const result = {
    status: 'reproduced', sourceHead: '0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f',
    actualImplementation: join(source, 'src/proxy/server.ts'),
    serverSha256: createHash('sha256').update(readFileSync(join(source, 'src/proxy/server.ts'))).digest('hex'),
    environment: { platform: process.platform, arch: process.arch, bun: process.versions.bun, nodeCompatibility: process.versions.node },
    initialOwnership, activeOwnership, afterCloseBeforeSettlement, afterSettlement, eventualOwnership,
    listenerClosed, cachedPromiseIdentical, actualFinalizerJoined: true,
    unresolvedBackendOwnershipAfterActualCleanup: !eventualOwnership.guardReleased && eventualOwnership.runtimeIdentityRetained && eventualOwnership.sqliteBackendInstalled,
    counters, events,
    limitations: ['Credential/CLI boundaries and SDK are mocked; no inference or real SDK child.', 'The production request finalizer is deliberately paused at releaseJoinedTranscriptLease, then invokes the unchanged real SQL lease release.', 'The two-second ownership leak observation is same-process. Process exit is used only after observations to dispose the intentionally unreleased runtime; controller checks that the OS guard becomes available after exit.', 'This is a source-implementation probe on macOS arm64/Bun, not affected-client/model/Linux E2E.'],
  }
  if (!result.unresolvedBackendOwnershipAfterActualCleanup) result.status = 'not-reproduced'
  writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ status: result.status, listenerClosed, cachedPromiseIdentical, unresolvedBackendOwnershipAfterActualCleanup: result.unresolvedBackendOwnershipAfterActualCleanup, sdkQueries: counters.sdkQueries }))
} catch (error) {
  releaseCleanup.resolve()
  if (closePromise) await Promise.race([closePromise.catch(() => undefined), Bun.sleep(2000)])
  const result = { status: 'setup-or-probe-failure', error: { name: error.name, message: error.message, stack: error.stack }, counters, events }
  writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  console.error(JSON.stringify({ status: result.status, error: result.error.message }))
  process.exitCode = 1
} finally {
  clearTimeout(watchdog)
}
// Explicitly terminate this owned fixture process after durable observations.
// This is necessary because the reproduced cached-close path retains its SQL handle.
process.exit(process.exitCode ?? 0)
