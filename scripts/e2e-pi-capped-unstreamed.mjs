#!/usr/bin/env bun
// Actual Pi + real SDK/CLI. --controlled forces E61's local API fallback;
// --live separately checks a receipt/continuation with an explicitly selected
// read-only OAuth snapshot. Neither mode asserts generated model wording.
// E2E_MERIDIAN_ROOT, E2E_PI_CLI, E2E_NODE_BIN, E2E_CLAUDE_BIN,
// E2E_PLUGIN_PATH are required. --live also requires E2E_LIVE_PROFILE_FILE.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spyOn } from 'bun:test'

const args = process.argv.slice(2)
assert(args.length === 1 && ['--controlled', '--live'].includes(args[0]), 'Select exactly --controlled or --live')
const controlled = args[0] === '--controlled'
const repo = realpathSync(process.env.E2E_MERIDIAN_ROOT ?? '.')
const requiredPath = name => { assert(process.env[name], `Set ${name}`); return realpathSync(process.env[name]) }
const pi = requiredPath('E2E_PI_CLI'), node = requiredPath('E2E_NODE_BIN')
const claude = requiredPath('E2E_CLAUDE_BIN'), plugin = requiredPath('E2E_PLUGIN_PATH')
const liveProfileFile = process.env.E2E_LIVE_PROFILE_FILE
assert(controlled ? !liveProfileFile : liveProfileFile, 'Only --live requires an explicit E2E_LIVE_PROFILE_FILE')
const metadata = path => JSON.parse(readFileSync(path, 'utf8'))
const piMetadata = metadata(join(dirname(pi), '..', '..', 'package.json'))
const scrubMetadata = metadata(join(dirname(plugin), '..', 'package.json'))
assert.equal(piMetadata.name, '@earendil-works/pi-coding-agent'); assert.equal(piMetadata.version, '1.0.2')
assert.equal(scrubMetadata.name, '@rynfar/meridian-plugin-pi-scrub'); assert.equal(scrubMetadata.version, '0.2.2')
const require = createRequire(join(repo, 'package.json'))
const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk')
assert.equal(metadata(join(dirname(sdkPath), 'package.json')).version, '0.2.141')

const root = realpathSync(mkdtempSync(join(tmpdir(), 'meridian-pi-capped-unstreamed-')))
const config = join(root, 'pi'), project = join(root, 'project'), cliConfig = join(root, 'cli-empty')
for (const dir of [config, project, cliConfig, join(root, 'plugins')]) mkdirSync(dir, { mode: 0o700 })
for (const key of Object.keys(process.env)) {
  if (/^(MERIDIAN_|CLAUDE_PROXY_|CLAUDE_|ANTHROPIC_|OPENAI_|PI_|E2E_)/.test(key)) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, 'config'), MERIDIAN_SESSION_DIR: join(root, 'sessions'),
  MERIDIAN_WORKDIR: project, MERIDIAN_CLAUDE_PATH: claude, MERIDIAN_PASSTHROUGH: '1',
  MERIDIAN_CREDENTIALS_READONLY: '1', MERIDIAN_NO_UPDATE_CHECK: '1', MERIDIAN_TELEMETRY_PERSIST: '0',
  CLAUDE_CONFIG_DIR: cliConfig, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
}) // Intentionally leave MERIDIAN_PASSTHROUGH_MAX_TURNS unset: default cap = 1.
const versions = {
  pi: spawnSync(node, [pi, '--version'], { encoding: 'utf8', timeout: 10000 }).stdout?.trim(),
  claude: spawnSync(claude, ['--version'], { encoding: 'utf8', timeout: 10000 }).stdout?.trim(),
  node: spawnSync(node, ['--version'], { encoding: 'utf8', timeout: 10000 }).stdout?.trim(), sdk: '0.2.141', scrub: '0.2.2',
}
assert.equal(versions.pi, '1.0.2'); assert.equal(versions.claude, '2.1.285 (Claude Code)')
const receipt = `PI-READ-${randomUUID()}`, receiptPath = join(project, 'receipt.txt')
const affinity = `pi-fallback-${randomUUID()}`, model = 'claude-opus-5-5', fixtureId = 'toolu_pi_fallback_read'
writeFileSync(receiptPath, receipt, { mode: 0o600 })
writeFileSync(join(project, 'AGENTS.md'), 'KEEP-PROJECT-CONTEXT: preserve this synthetic project instruction.\n')
const text = content => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter(block => block?.type === 'text').map(block => block.text).join('') : ''
const blocks = messages => messages.flatMap(message => Array.isArray(message?.content) ? message.content : [])
let proxy, upstream, child, childClosed, observer, failure, stage = 'setup', checkpointAtReceipt, interrupted = false
const onInterrupt = () => { interrupted = true; child?.kill('SIGKILL') }
process.on('SIGINT', onInterrupt); process.on('SIGTERM', onInterrupt)
let streamCalls = 0, nonstreamCalls = 0, upstreamReceipt = false
const before = [], after = [], queries = [], turns = [], fixtureErrors = []
const report = { mode: controlled ? 'controlled-local-API-not-live-Opus' : 'live-Opus', versions,
  platform: `${process.platform}/${process.arch}`, before, after, queries, turns, artifacts: root }

try {
  const sdk = await import(pathToFileURL(sdkPath).href)
  const { readSessionStoreSnapshot } = await import(pathToFileURL(join(repo, 'src/proxy/sessionStore.ts')).href)
  const { isForwardedDenial } = await import(pathToFileURL(join(repo, 'src/proxy/passthroughDenial.ts')).href)
  const mapping = () => Object.entries(readSessionStoreSnapshot()).find(([key]) => key === affinity || key.endsWith(`:${affinity}`))?.[1]
  const promptWitness = s => ({ identity: s.includes('operating inside pi, a coding agent harness'),
    docs: s.includes('Pi documentation'), additionalDocs: s.includes('Additional docs:'),
    generic: s.includes('You are an expert coding assistant.'), project: s.includes('KEEP-PROJECT-CONTEXT'),
    tools: s.includes('<tools>'), leftoverDocsWrapper: s.includes('<docs>') || s.includes('</docs>') })
  globalThis.__piCappedWitness = (side, ctx) => {
    const results = blocks(ctx.messages ?? []).filter(block => block.type === 'tool_result' && text(block.content) === receipt)
    const witness = { adapter: ctx.adapter, profile: ctx.headers.get('x-meridian-profile'),
      stream: ctx.stream, ...promptWitness(ctx.systemContext ?? ''), receiptIds: results.map(block => block.tool_use_id) }
    if (side === 'before' && results.length && !checkpointAtReceipt) {
      const stored = mapping()
      checkpointAtReceipt = stored && { source: stored.claudeSessionId,
        uuid: stored.passthroughToolCallAssistantUuid, ids: stored.passthroughToolCallIds }
    }
    ;(side === 'before' ? before : after).push(witness)
    return ctx
  }
  const paths = ['before', 'after'].map(side => {
    const path = join(root, `${side}.mjs`)
    writeFileSync(path, `export default {name:'pi-capped-${side}',onRequest(ctx){return globalThis.__piCappedWitness('${side}',ctx)}}`)
    return path
  })
  const pluginConfigPath = join(root, 'plugins.json')
  writeFileSync(pluginConfigPath, JSON.stringify({ plugins: [paths[0], plugin, paths[1]].map(path => ({ path, enabled: true })) }))
  const originalQuery = sdk.query
  observer = spyOn(sdk, 'query').mockImplementation(input => {
    const options = input.options, system = options.systemPrompt
    // The request witness precedes queue admission. Re-read the supported
    // Meridian mapping here if its prior turn was still publishing then.
    if (before.at(-1)?.receiptIds.length && !checkpointAtReceipt?.uuid) {
      const stored = mapping()
      checkpointAtReceipt = stored && { source: stored.claudeSessionId,
        uuid: stored.passthroughToolCallAssistantUuid, ids: stored.passthroughToolCallIds }
    }
    queries.push({ maxTurns: options.maxTurns, model: options.model, opusModelPin: options.env?.ANTHROPIC_DEFAULT_OPUS_MODEL,
      executable: options.pathToClaudeCodeExecutable,
      resume: options.resume, checkpoint: options.resumeSessionAt, fork: options.forkSession, target: options.sessionId,
      configIsIsolated: options.env?.CLAUDE_CONFIG_DIR?.startsWith(root + '/'),
      ...promptWitness(typeof system === 'string' ? system : system?.append ?? '') })
    return originalQuery(input) // Observe the supported call; never replace SDK/model behavior.
  })
  let profiles
  if (controlled) {
    upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      try {
        if (!new URL(request.url).pathname.endsWith('/messages')) return Response.json({ input_tokens: 10 })
        const body = await request.json()
        if (body.stream) {
          streamCalls++
          const error = { type: 'error', error: { details: null, type: 'rate_limit_error', message: 'Rate limited' } }
          return new Response(`event: error\ndata: ${JSON.stringify(error)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        }
        nonstreamCalls++
        const real = blocks(body.messages ?? []).filter(block => block.type === 'tool_result'
          && block.tool_use_id === fixtureId && text(block.content) === receipt && block.is_error !== true)
        upstreamReceipt ||= real.length === 1
        const tool = body.tools?.find(candidate => candidate.name.endsWith('__read'))
        assert(tool || upstreamReceipt, 'fixture: real SDK did not register Pi read')
        const content = upstreamReceipt ? [{ type: 'text', text: 'The client receipt was received.' }]
          : [{ type: 'tool_use', id: fixtureId, name: tool.name, input: { path: receiptPath } }]
        return Response.json({ id: `msg_pi_fixture_${nonstreamCalls}`, type: 'message', role: 'assistant', model: body.model,
          content, stop_reason: upstreamReceipt ? 'end_turn' : 'tool_use', stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
      } catch (error) {
        fixtureErrors.push(error.message)
        return Response.json({ error: { type: 'api_error', message: 'Local fixture failed' } }, { status: 500 })
      }
    } })
    profiles = [{ id: 'fixture', type: 'api', apiKey: 'local-fixture-key', baseUrl: `http://127.0.0.1:${upstream.port}` }]
  } else {
    assert.equal(statSync(liveProfileFile).mode & 0o077, 0, 'Live snapshot file must be private')
    profiles = metadata(liveProfileFile)
    assert(Array.isArray(profiles) && profiles.length === 1, 'Select exactly one explicit live snapshot profile')
    assert(profiles[0].type === 'oauth-token' && typeof profiles[0].id === 'string'
      && /^[a-z0-9_-]{1,80}$/i.test(profiles[0].id) && typeof profiles[0].oauthToken === 'string' && profiles[0].oauthToken,
    'Live snapshot must be a supported explicit OAuth-token profile')
  }
  const profileId = profiles[0].id
  const { startProxyServer } = await import(pathToFileURL(join(repo, 'src/proxy/server.ts')).href)
  proxy = await startProxyServer({ port: 0, host: '127.0.0.1', silent: true, profiles,
    defaultProfile: profileId, pluginConfigPath, pluginDir: join(root, 'plugins') })
  const url = `http://127.0.0.1:${proxy.server.address().port}`
  const pluginResponse = await fetch(url + '/plugins/list', { signal: AbortSignal.timeout(10000) })
  assert.equal(pluginResponse.status, 200)
  const loaded = (await pluginResponse.json()).plugins.find(entry => entry.name === 'pi-scrub')
  assert.equal(loaded?.status, 'active'); assert.equal(loaded.version, '0.2.2')
  writeFileSync(join(config, 'models.json'), JSON.stringify({ providers: { meridian: { baseUrl: url, apiKey: 'local-client-key',
    api: 'anthropic-messages', headers: { 'x-meridian-agent': 'pi', 'x-session-affinity': affinity, 'x-meridian-profile': profileId },
    models: [{ id: model, name: model, reasoning: false, input: ['text'], contextWindow: 200000,
      maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }))
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }))
  async function turn(prompt) {
    assert(!interrupted, 'Harness was interrupted before the next Pi turn')
    const env = { ...process.env, PI_CODING_AGENT_DIR: config, PI_OFFLINE: '1', PI_TELEMETRY: '0' }
    for (const key of Object.keys(env)) if (/^(MERIDIAN_|CLAUDE_PROXY_|CLAUDE_|ANTHROPIC_|OPENAI_|GOOGLE_|GEMINI_|AWS_|AZURE_|E2E_)/.test(key)) delete env[key]
    for (const kind of ['CONFIG', 'DATA', 'CACHE', 'STATE']) env[`XDG_${kind}_HOME`] = join(root, kind.toLowerCase())
    child = spawn(node, [pi, '--provider', 'meridian', '--model', model, '--mode', 'json', '--print',
      '--session', join(root, 'pi-session.jsonl'), '--offline', '--approve', '--no-extensions', '--no-skills',
      '--no-prompt-templates', '--no-themes', '--thinking', 'off', '--tools', 'read', prompt],
    { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', bytes = 0, capped = false, timedOut = false
    const current = child
    childClosed = new Promise((resolveClose, reject) => { current.once('error', reject); current.once('close', code => resolveClose(code)) })
    const capture = (chunk, output) => {
      bytes += chunk.length
      if (bytes > 1024 * 1024) { capped = true; current.kill('SIGKILL') }
      else if (output) stdout += chunk.toString()
    }
    current.stdout.on('data', chunk => capture(chunk, true)); current.stderr.on('data', chunk => capture(chunk, false))
    const deadline = setTimeout(() => { timedOut = true; current.kill('SIGKILL') }, 180000)
    let exit
    try { exit = await childClosed } finally {
      clearTimeout(deadline); current.stdout.destroy(); current.stderr.destroy(); child = undefined; childClosed = undefined
    }
    const events = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line))
    const result = { exit, bytes, capped, timedOut, events: events.length,
      errors: events.filter(event => event.message?.stopReason === 'error' || event.message?.stopReason === 'aborted').length,
      readEnds: events.filter(event => event.type === 'tool_execution_end' && event.toolName === 'read')
        .map(event => ({ id: event.toolCallId, isError: event.isError, exactReceipt: text(event.result?.content) === receipt })),
      assistantEnds: events.filter(event => event.type === 'message_end' && event.message?.role === 'assistant').length }
    turns.push(result)
    assert(!capped && !timedOut, 'product: actual Pi exceeded output/deadline bound')
    assert.equal(exit, 0, 'product: actual Pi exited unsuccessfully')
    assert.equal(result.errors, 0, 'product: actual Pi received an error or aborted assistant message')
    return result
  }
  stage = 'product-tool-receipt'
  const first = await turn(`Use read exactly once to read ${receiptPath}, then acknowledge receiving its contents. Do not use other tools.`)
  assert.equal(first.readEnds.length, 1, 'product: actual Pi must execute exactly one read')
  assert(!first.readEnds[0].isError && first.readEnds[0].exactReceipt, 'product: actual Pi read must return the exact receipt')
  const deliveredId = first.readEnds[0].id
  assert(before.some(entry => entry.receiptIds.includes(deliveredId)), 'product: Pi did not deliver the correlated exact tool_result')
  assert(before.some(entry => entry.identity && entry.docs && entry.additionalDocs && entry.project && entry.tools), 'Actual Pi prompt did not reach the routing witness')
  assert(after.length && after.every(entry => entry.adapter === 'pi' && entry.profile === profileId && entry.stream
    && !entry.identity && !entry.docs && !entry.additionalDocs && entry.generic && entry.project && entry.tools), 'Scrub/routing/project content witness failed')
  assert(queries.length && queries.every(entry => entry.maxTurns === 1 && /^opus(?:\[1m\])?$/.test(entry.model)
    && entry.opusModelPin === model && entry.executable === claude && entry.configIsIsolated), 'SDK must use pinned Opus alias, exact CLI, isolated config and default one-turn cap')
  assert(checkpointAtReceipt?.uuid && checkpointAtReceipt.ids?.includes(deliveredId), 'product: forwarded call lacked a stored assistant checkpoint')
  const checkpointQuery = queries.find(entry => entry.resume === checkpointAtReceipt.source && entry.checkpoint === checkpointAtReceipt.uuid)
  assert(checkpointQuery?.fork && checkpointQuery.target !== checkpointAtReceipt.source, 'product: exact tool-result checkpoint must resume into a durable fork')
  const firstMapping = mapping()
  assert(firstMapping?.claudeSessionId === checkpointQuery.target, 'product: completed receipt fork must be published')
  if (controlled) {
    assert(streamCalls > 0 && nonstreamCalls > 0 && upstreamReceipt, 'fixture: streaming refusal/nonstream retry/real upstream receipt were not observed')
    assert.deepEqual(fixtureErrors, [])
    assert.equal(deliveredId, fixtureId)
  }
  stage = 'product-saved-followup'
  const queryFrom = queries.length
  const continued = await turn('Give a brief acknowledgement without using tools.')
  assert.equal(continued.readEnds.length, 0, 'product: saved-session follow-up must not repeat the client read')
  assert(continued.assistantEnds > 0 && queries.slice(queryFrom).some(entry => entry.resume === firstMapping.claudeSessionId), 'product: saved Pi follow-up must resume the published receipt fork')
  // Same publication allowance as E41, without reading private SDK files.
  await new Promise(resolve => setTimeout(resolve, 1500))
  const active = mapping()
  assert(active?.currentTranscript, 'product: final mapped transcript locator is missing')
  const previousConfig = process.env.CLAUDE_CONFIG_DIR
  let history
  try {
    process.env.CLAUDE_CONFIG_DIR = active.currentTranscript.configDir
    history = await sdk.getSessionMessages(active.claudeSessionId, { dir: active.currentTranscript.projectDir ?? project })
  } finally { process.env.CLAUDE_CONFIG_DIR = previousConfig }
  report.observedAssistantModels = [...new Set(history.filter(row => row.message?.role === 'assistant')
    .map(row => row.message.model).filter(value => typeof value === 'string'))]
  if (!controlled) assert(report.observedAssistantModels.length
    && report.observedAssistantModels.every(value => value === model), 'product: supported live assistant metadata must identify the implicated Opus model')
  const answers = blocks(history.map(row => row.message)).filter(block => block.type === 'tool_result' && block.tool_use_id === deliveredId)
  assert.equal(answers.length, 1, 'product: active SDK fork must contain exactly one answer for the actual Pi call')
  assert(!isForwardedDenial(answers[0]) && answers[0].is_error !== true && text(answers[0].content) === receipt,
    'product: active SDK answer must be the exact client receipt, never the forwarding denial')
  assert(queries.every(entry => entry.maxTurns === 1 && /^opus(?:\[1m\])?$/.test(entry.model)
    && entry.opusModelPin === model && entry.executable === claude && entry.configIsIsolated), 'Follow-up changed SDK cap/Opus pin/CLI/config')
  assert(!interrupted, 'Harness was interrupted')
  report.checkpointFork = true; report.savedFollowup = true; report.exactClientReceipt = true
} catch (error) {
  failure = error
  report.failure = { stage, name: error.name, message: error instanceof assert.AssertionError ? error.message : 'Harness setup or I/O failed; raw diagnostics withheld' }
} finally {
  const cleanup = await Promise.allSettled([
    (async () => { if (child) { child.kill('SIGKILL'); try { await childClosed } finally { child.stdout.destroy(); child.stderr.destroy() } } })(),
    (async () => { await proxy?.close() })(),
    (async () => { await upstream?.stop(true) })(),
  ])
  if (cleanup.some(result => result.status === 'rejected')) {
    failure ??= new Error('Owned process/server cleanup failed')
    report.cleanupFailed = true
  }
  observer?.mockRestore()
  delete globalThis.__piCappedWitness
  process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onInterrupt)
  Object.assign(report, { result: failure ? 'FAIL' : 'PASS', streamCalls, nonstreamCalls, upstreamReceipt,
    fixtureErrors, qualification: `${controlled ? 'Controlled API response model is an SDK alias, not proof of an actual provider model. ' : ''}Scrub content witness only; leftover <docs> wrappers remain separately qualified. Reporter Pi version/OS are unspecified.` })
  writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(report))
}
if (failure) process.exitCode = 1
