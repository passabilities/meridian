#!/usr/bin/env bun
// Wire shape and cache behaviour: what does Meridian send upstream for Claude
// Code's auto-mode permission check, and does each check read back from the
// prompt cache what the check before it wrote?
//
// The check re-sends the conversation's transcript every time, with what
// happened since appended. Claude Code sends it as a block per entry with its
// own cache breakpoints. Replayed through Meridian as one text block it could
// reuse nothing: every check wrote the whole prompt to the cache again
// (measured live: 3.66M cache-write tokens in 22 minutes, 83% of all written).
//
// The REAL Claude Code CLI runs in auto mode against this checkout's proxy,
// which drives the REAL Agent SDK and this checkout's own CLI, the one `npm run
// start` resolves (`E2E_SDK_CLAUDE_PATH` names another). Only the model is a
// stand-in: a scripted Messages API on localhost that plays an agent making
// shell writes outside its project (each one goes to the classifier), answers
// the classifier, records every request body, and keeps a prompt cache the way
// the API documents it — an entry is written at each `cache_control`
// breakpoint, and a request reads the longest entry ending at one of the 20
// block boundaries at or before one of its own breakpoints. No model call, no
// credential: the client and the proxy both get dummy keys, and the child
// environment is scrubbed of `CLAUDE*`, `ANTHROPIC_*` and `MERIDIAN_*`.
//
// The proxy's working directory is a git repository, as a checkout's is, and a
// tracked file in it changes half-way through each conversation. Under the
// SDK's claude_code preset the SDK child opens every prompt with `git status`
// of that directory, so a prompt cached behind it is lost to the next check
// when the status moves. The preset is off for Claude Code by default (E80)
// and the status with it; E2E_PRESET=1 turns it back on, as an operator may,
// to hold the layout against the very thing it keeps out.
//
// Three runs: the layout on, the layout off (`MERIDIAN_AUXILIARY_PROMPT_CACHE=0`,
// the prompt as it was always sent), and the layout on against an API that
// refuses the first request carrying a breakpoint inside a message, as it would
// if a CLI added its own beside Meridian's.
//
// This proves what reaches the API and how the documented cache treats it. The
// real cache, and real token counts, want a live run: see E2E.md.
//
//   bun scripts/e2e-claude-code-permission-check-cache.mjs
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const say = console.log.bind(console)
const repo = resolve(process.env.E2E_MERIDIAN_ROOT ?? '.')

const which = spawnSync('command', ['-v', 'claude'], { shell: true, encoding: 'utf8' })
if (which.status !== 0 || !which.stdout.trim()) {
  say('SKIP: the `claude` CLI is not on PATH; this gate drives the real client')
  process.exit(1)
}
const CLI = which.stdout.trim()
const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout.trim()
// The proxy takes `claude` from PATH before its own packaged one. `npm run
// start` puts this checkout's first; a bare `bun` run would find the client.
const checkoutCli = join(repo, 'node_modules', '.bin', 'claude')
const sdkCli = process.env.E2E_SDK_CLAUDE_PATH ?? (existsSync(checkoutCli) ? checkoutCli : CLI)
const sdkVersion = spawnSync(sdkCli, ['--version'], { encoding: 'utf8' }).stdout.trim()

for (const key of Object.keys(process.env)) {
  if (/^(MERIDIAN_|CLAUDE_PROXY_|CLAUDE(CODE|_)|ANTHROPIC_)/.test(key)) delete process.env[key]
}
const root = realpathSync(mkdtempSync(join(tmpdir(), 'mcccheck-')))
// The proxy's working directory, and so every SDK child's: a repository with
// one tracked file, clean until a run changes it.
const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'mcccheck-work-')))
const TRACKED = join(workdir, 'notes.txt')
const git = (...args) => spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: workdir, encoding: 'utf8',
  env: { ...process.env, GIT_AUTHOR_NAME: 'gate', GIT_AUTHOR_EMAIL: 'gate@example.invalid', GIT_COMMITTER_NAME: 'gate', GIT_COMMITTER_EMAIL: 'gate@example.invalid' } })
writeFileSync(TRACKED, 'as committed\n')
if ([git('init', '-q', '-b', 'main'), git('add', '.'), git('commit', '-q', '-m', 'first commit')].some(step => step.status !== 0)) {
  say('SKIP: `git` could not make the repository the proxy runs in')
  process.exit(1)
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, 'config'), MERIDIAN_SESSION_DIR: join(root, 'sessions'),
  MERIDIAN_WORKDIR: workdir, MERIDIAN_TELEMETRY_PERSIST: '0', MERIDIAN_CLAUDE_PATH: sdkCli,
})
const PRESET = process.env.E2E_PRESET === '1'
if (PRESET) {
  mkdirSync(join(root, 'config'), { recursive: true })
  writeFileSync(join(root, 'config', 'sdk-features.json'), JSON.stringify({ 'claude-code': { codeSystemPrompt: true } }))
}

const ROUNDS = 9
/** The tracked file changes once this many checks have been answered. */
const CHANGE_AFTER = 5
const CHECK_MARKER = 'You are a security monitor for autonomous AI coding agents'
const hash = value => createHash('sha256').update(value).digest('hex')
const blocksOf = content => typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
const textOf = content => blocksOf(content).map(block => block?.text ?? '').join('')

/** Every block of a request in cache order (system, then messages), with the text through its end. */
function cacheUnits(body) {
  const units = []
  let prefix = ''
  const push = (where, block) => {
    const { cache_control: marker, ...rest } = block
    prefix = hash(prefix + JSON.stringify(rest))
    units.push({ where, chars: JSON.stringify(rest).length, prefix, marker })
  }
  for (const block of Array.isArray(body.system) ? body.system : body.system ? [{ type: 'text', text: body.system }] : []) push('system', block)
  for (const message of body.messages ?? []) for (const block of blocksOf(message.content)) push(message.role, block)
  return units
}

function createStandIn({ outside, refuseFirstMessageBreakpoint, afterCheck }) {
  const calls = []
  const cache = new Set()
  const errors = []
  let refused = 0
  let answered = 0

  /** The documented cache: read the longest entry within the lookback of a breakpoint, then write every breakpoint. */
  function account(units) {
    const total = units.reduce((sum, unit) => sum + unit.chars, 0)
    let read = 0
    units.forEach((unit, index) => {
      if (!unit.marker) return
      for (let back = index; back >= Math.max(0, index - 20); back--) {
        if (!cache.has(units[back].prefix)) continue
        read = Math.max(read, units.slice(0, back + 1).reduce((sum, entry) => sum + entry.chars, 0))
        break
      }
    })
    const lastMarker = units.findLastIndex(unit => unit.marker)
    const covered = lastMarker < 0 ? 0 : units.slice(0, lastMarker + 1).reduce((sum, unit) => sum + unit.chars, 0)
    for (const unit of units) if (unit.marker) cache.add(unit.prefix)
    return { total, read, written: Math.max(0, covered - read), plain: total - Math.max(covered, read) }
  }

  function reply(body) {
    const system = Array.isArray(body.system) ? body.system.map(block => block?.text ?? '').join('\n') : String(body.system ?? '')
    const tools = Array.isArray(body.tools) ? body.tools.map(tool => tool?.name) : []
    if (system.includes(CHECK_MARKER)) {
      const asked = textOf(body.messages?.findLast(message => message.role === 'user')?.content)
      return { kind: 'check', blocks: [{ type: 'text', text: asked.includes('<severity>') ? '<severity>5' : '<block>no' }], stop: 'end_turn' }
    }
    const bash = tools.find(name => typeof name === 'string' && /(^|_)Bash$/.test(name))
    if (!bash) return { kind: 'side', blocks: [{ type: 'text', text: 'ok' }], stop: 'end_turn' }
    const results = (body.messages ?? []).flatMap(message => blocksOf(message.content)).filter(block => block?.type === 'tool_result').length
    if (results >= ROUNDS) return { kind: 'turn', blocks: [{ type: 'text', text: 'ALL DONE' }], stop: 'end_turn' }
    // Long enough that nine of them outgrow one cache chunk, as a real transcript does in minutes.
    const note = `step ${results + 1}: ${'record the build stamp for the release notes; '.repeat(70)}`
    return {
      kind: 'turn',
      blocks: [{ type: 'tool_use', id: `toolu_${randomUUID().replaceAll('-', '').slice(0, 22)}`, name: bash,
        input: { command: `date > ${outside}/stamp${results + 1}.txt # ${note}`, description: `Write stamp ${results + 1}` } }],
      stop: 'tool_use',
    }
  }

  function respond(body, answer, usage) {
    const id = `msg_${randomUUID().replaceAll('-', '').slice(0, 24)}`
    const model = typeof body.model === 'string' ? body.model : 'claude-sonnet-5'
    const events = [{ type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } }]
    answer.blocks.forEach((block, index) => {
      if (block.type === 'text') {
        events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
        events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } })
      } else {
        events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } })
        events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
      }
      events.push({ type: 'content_block_stop', index })
    })
    events.push({ type: 'message_delta', delta: { stop_reason: answer.stop, stop_sequence: null }, usage: { output_tokens: 8 } })
    events.push({ type: 'message_stop' })
    if (body.stream !== true) {
      return Response.json({ id, type: 'message', role: 'assistant', model, content: answer.blocks, stop_reason: answer.stop, stop_sequence: null, usage })
    }
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  }

  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 255,
    async fetch(request) {
      try {
        const url = new URL(request.url)
        if (request.method !== 'POST' || !url.pathname.endsWith('/messages')) return Response.json({ input_tokens: 100 })
        const body = await request.json()
        const answer = reply(body)
        const units = cacheUnits(body)
        const messageBreakpoints = units.filter(unit => unit.marker && unit.where !== 'system').length
        if (refuseFirstMessageBreakpoint && answer.kind === 'check' && messageBreakpoints > 0 && refused === 0) {
          refused++
          calls.push({ kind: 'check-refused', body, units })
          return Response.json({ type: 'error', error: { type: 'invalid_request_error',
            message: 'A maximum of 4 blocks with cache_control may be provided. Found 5.' } }, { status: 400 })
        }
        const usage = account(units)
        calls.push({ kind: answer.kind, body, units, usage })
        // Before the verdict goes back, so the next check's child sees it.
        if (answer.kind === 'check') afterCheck?.(++answered)
        return respond(body, answer, {
          input_tokens: Math.ceil(usage.plain / 4), output_tokens: 8,
          cache_read_input_tokens: Math.ceil(usage.read / 4), cache_creation_input_tokens: Math.ceil(usage.written / 4),
        })
      } catch (error) {
        errors.push(String(error?.stack ?? error))
        return new Response(String(error), { status: 500 })
      }
    },
  })
  return { server, calls, errors }
}

const { startProxyServer } = await import(pathToFileURL(join(repo, 'src/proxy/server.ts')).href)

/** One conversation of the real client in auto mode, through a fresh proxy and stand-in. */
async function run(label, { layout, refuseFirstMessageBreakpoint = false }) {
  if (layout) delete process.env.MERIDIAN_AUXILIARY_PROMPT_CACHE
  else process.env.MERIDIAN_AUXILIARY_PROMPT_CACHE = '0'
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'mcccheck-proj-')))
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'mcccheck-out-')))
  const config = realpathSync(mkdtempSync(join(tmpdir(), 'mcccheck-conf-')))
  writeFileSync(join(project, 'README.md'), 'scratch project\n')
  // The classifier is sent the user's instructions as a message of their own.
  writeFileSync(join(project, 'CLAUDE.md'), `# Scratch project\n\n${'- Keep build stamps outside the repository and never commit them.\n'.repeat(260)}`)
  mkdirSync(join(root, label), { recursive: true })
  writeFileSync(TRACKED, 'as committed\n')

  const standIn = createStandIn({ outside, refuseFirstMessageBreakpoint,
    afterCheck: count => { if (count === CHANGE_AFTER) writeFileSync(TRACKED, 'as committed\nand edited since\n') } })
  const proxy = await startProxyServer({ port: 0, host: '127.0.0.1', silent: true,
    profiles: [{ id: 'fixture', type: 'api', apiKey: 'local-fixture-key', baseUrl: `http://127.0.0.1:${standIn.server.port}` }],
    defaultProfile: 'fixture',
  })
  const proxyPort = proxy.server.address().port
  // The proxy log never prints bodies, so the client's own request shape is read off a relay.
  const clientChecks = []
  const relay = Bun.serve({
    hostname: '127.0.0.1', port: 0, idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url)
      const raw = request.method === 'POST' ? await request.text() : undefined
      if (raw && url.pathname === '/v1/messages') {
        const body = JSON.parse(raw)
        if (Array.isArray(body.stop_sequences) && body.stop_sequences.some(stop => stop === '</severity>' || stop === '</block>')) clientChecks.push(body)
      }
      url.port = String(proxyPort)
      return fetch(url, { method: request.method, headers: request.headers, body: raw, timeout: false, decompress: false })
    },
  })

  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(MERIDIAN_|CLAUDE_PROXY_|CLAUDE(CODE|_)|ANTHROPIC_)/.test(key)) delete env[key]
  const client = Bun.spawn([CLI, '-p', `Write ${ROUNDS} build stamps outside this project, one shell command at a time, then say ALL DONE.`,
    '--model', 'sonnet', '--permission-mode', 'auto', '--session-id', randomUUID()], {
    cwd: project,
    env: { ...env, CLAUDE_CONFIG_DIR: config, ANTHROPIC_BASE_URL: `http://127.0.0.1:${relay.port}`, ANTHROPIC_AUTH_TOKEN: 'meridian-e2e-dummy',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', DISABLE_ERROR_REPORTING: '1' },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  })
  const timer = setTimeout(() => client.kill(), 420000)
  const [out, err, status] = await Promise.all([new Response(client.stdout).text(), new Response(client.stderr).text(), client.exited])
  clearTimeout(timer)
  const logs = await fetch(`http://127.0.0.1:${proxyPort}/telemetry/logs?limit=2000`).then(response => response.json()).catch(() => [])
  relay.stop(true)
  await proxy.close()
  standIn.server.stop(true)
  return { label, status, out: out.trim(), err: err.trim(), calls: standIn.calls, errors: standIn.errors, clientChecks,
    logs: logs.map(entry => String(entry.message)) }
}

const failures = []
const check = (ok, label, detail) => {
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
const k = chars => `${(chars / 1000).toFixed(1)}K`
const pct = (part, whole) => `${Math.round(100 * part / Math.max(1, whole))}%`

// Each run has its own scratch directories and session; nothing else may differ.
const strip = text => text.replace(/mcccheck-[a-z]+-[A-Za-z0-9]+|[0-9a-f]{8}-[0-9a-f-]{27}/g, '#')
const userBlocks = body => body.messages.filter(message => message.role === 'user').flatMap(message => blocksOf(message.content))
const userText = body => strip(userBlocks(body).map(block => block?.text ?? '').join(''))
/** What the SDK child writes ahead of the prompt on its own: its session context, `git status` included. */
const SESSION_CONTEXT = /^<system-reminder>\nAs you answer the user's questions[\s\S]*?<\/system-reminder>\s*/
/** The blocks that carry Meridian's prompt: every user block but the child's own note. */
const promptBlocks = body => userBlocks(body).filter(block => !SESSION_CONTEXT.test(block?.text ?? ''))
const promptText = body => userText(body).replace(SESSION_CONTEXT, '')
const gitStatusOf = body => /# gitStatus\n[\s\S]*?\nStatus:\n([\s\S]*?)\n\nRecent commits:/.exec(userText(body))?.[1]
// All the model is told besides the prompt. The billing line is left out: the
// CLI derives part of it from the first characters of the user message.
const systemText = body => strip([
  ...(Array.isArray(body.system) ? body.system : []).map(block => block?.text ?? '').filter(text => !text.startsWith('x-anthropic-billing-header')),
  ...body.messages.filter(message => message.role === 'system').map(message => textOf(message.content)),
].join('\n'))

function report(result) {
  const checks = result.calls.filter(call => call.kind === 'check')
  say(`\n  --- ${result.label}: client exit ${result.status}, ${result.calls.length} upstream requests, ${checks.length} permission checks ---`)
  say(`    ${'check'.padEnd(6)} ${'blocks'.padStart(6)} ${'marks'.padStart(5)} ${'prompt'.padStart(8)} ${'read'.padStart(8)} ${'written'.padStart(8)} ${'uncached'.padStart(8)}  git status ahead of it`)
  checks.forEach((call, index) => {
    say(`    ${String(index + 1).padEnd(6)} ${String(promptBlocks(call.body).length).padStart(6)} ${String(call.units.filter(unit => unit.marker).length).padStart(5)}`
      + ` ${k(call.usage.total).padStart(8)} ${k(call.usage.read).padStart(8)} ${k(call.usage.written).padStart(8)} ${k(call.usage.plain).padStart(8)}  ${gitStatusOf(call.body) ?? 'none'}`)
  })
  return checks
}

say(`\n=== Claude Code permission-check prompt cache ===`)
say(`  client: ${version}   proxy: this checkout   SDK child: ${sdkVersion} (${sdkCli})`)
say(`  upstream: scripted stand-in with a documented-semantics cache (no model calls)   proxy directory: a git repository, one file changed after check ${CHANGE_AFTER}`)

const on = await run('layout-on', { layout: true })
const off = await run('layout-off', { layout: false })
const refused = await run('layout-refused', { layout: true, refuseFirstMessageBreakpoint: true })

// What the client itself sends, for the record: its own blocks and breakpoints.
const sample = on.clientChecks.at(-1)
if (sample) {
  const shape = sample.messages.map(message => {
    const blocks = blocksOf(message.content)
    return `${message.role}[${blocks.length} block${blocks.length === 1 ? '' : 's'}, breakpoints at ${blocks.flatMap((block, index) => block.cache_control ? [index] : []).join(',') || 'none'}]`
  }).join(' ')
  say(`\n  the client's own last check: ${shape}; ttl ${JSON.stringify(blocksOf(sample.messages[0]?.content)[0]?.cache_control ?? null)}`)
}

const onChecks = report(on)
const offChecks = report(off)
const refusedChecks = report(refused)
say('')

// 1. The runs exercised the thing under test.
for (const result of [on, off, refused]) {
  check(result.status === 0 && result.out.includes('ALL DONE'), `${result.label}: the client finished its conversation`,
    `exit ${result.status}${result.status === 0 ? '' : ` stderr=${result.err.slice(-300)}`}`)
  check(result.errors.length === 0, `${result.label}: the stand-in answered every request`, result.errors[0]?.slice(0, 200))
}
check(onChecks.length >= ROUNDS && offChecks.length >= ROUNDS, 'every shell write went to the classifier',
  `${onChecks.length} and ${offChecks.length} checks for ${ROUNDS} writes`)
check(on.clientChecks.length >= ROUNDS && on.clientChecks.every(body => body.messages.length >= 2),
  "the client sent its instructions and the transcript as separate messages", `${on.clientChecks.length} checks, ${on.clientChecks.at(-1)?.messages.length} messages`)

// 2. Before: one block, the CLI's breakpoints only, nothing read back but the system prompt.
const offStatus = offChecks.map(call => gitStatusOf(call.body))
if (PRESET) {
  check(offStatus.length > CHANGE_AFTER && offStatus.every(status => status !== undefined)
    && offStatus[CHANGE_AFTER - 1] === '(clean)' && offStatus[CHANGE_AFTER] !== '(clean)',
    "layout off, preset on: the SDK child opens every prompt with `git status` of the proxy's directory, as it is when the check is made",
    `check ${CHANGE_AFTER}: ${JSON.stringify(offStatus[CHANGE_AFTER - 1])}, check ${CHANGE_AFTER + 1}: ${JSON.stringify(offStatus[CHANGE_AFTER])}`)
} else {
  check(offStatus.length > CHANGE_AFTER && offStatus.every(status => status === undefined),
    'layout off: with the claude_code preset off, as it is by default, the SDK child puts no `git status` ahead of the prompt',
    `${offStatus.filter(status => status === undefined).length} of ${offStatus.length} checks without one`)
}
const offLate = offChecks.slice(-4)
check(offChecks.every(call => promptBlocks(call.body).length === 1),
  'layout off: the prompt goes upstream as one text block', `${offChecks.map(call => promptBlocks(call.body).length).join(',')}`)
// What never changes is the system prompt, which here is most of a short
// conversation's prompt; the instructions and the transcript are what is rewritten.
const offRest = offChecks.slice(1)
check(offRest.every(call => call.usage.read === offRest[0].usage.read && call.usage.written === call.usage.total - call.usage.read)
  && offRest.every((call, index) => index === 0 || call.usage.written > offRest[index - 1].usage.written),
  'layout off: every check reads back the same fixed part and writes all the rest again, more each time',
  `read ${k(offRest[0]?.usage.read ?? 0)} every time; wrote ${offRest.map(call => k(call.usage.written)).join(', ')}`)

// 3. THE FIX: blocks, Meridian's breakpoints alone, and each check reads the one before it.
const laidOut = onChecks.filter(call => promptBlocks(call.body).length > 1)
check(laidOut.length >= onChecks.length - 1, 'layout on: the prompt goes upstream as text blocks', `${laidOut.length} of ${onChecks.length} checks`)
check(laidOut.length > 0 && laidOut.every(call => call.units.every(unit => unit.where !== 'system' || !unit.marker)
  && call.units.filter(unit => unit.marker).length >= 1 && call.units.filter(unit => unit.marker).length <= 2
  && call.units.filter(unit => unit.marker).every(unit => JSON.stringify(unit.marker) === '{"type":"ephemeral"}')),
  "layout on: the only breakpoints on the wire are Meridian's, at most two, none of the CLI's",
  laidOut.map(call => call.units.filter(unit => unit.marker).length).join(','))
check(onChecks.every(call => call.units.filter(unit => unit.marker).length <= 4), 'layout on: never more breakpoints than the API accepts',
  onChecks.map(call => call.units.filter(unit => unit.marker).length).join(','))
const differing = onChecks.filter((call, index) => !offChecks[index] || promptText(call.body) !== promptText(offChecks[index].body)).length
check(differing === 0, "layout on: every check's prompt is, character for character, the one sent with the layout off",
  `${onChecks.length - differing} of ${onChecks.length} identical`)
// The one thing taken away is the child's own `git status`, which stood ahead
// of the prompt and of every breakpoint in it.
check(laidOut.length > 0 && laidOut.every(call => !userText(call.body).includes('# gitStatus')),
  'layout on: no `git status` stands ahead of a prompt laid out for caching',
  `${laidOut.filter(call => !userText(call.body).includes('# gitStatus')).length} of ${laidOut.length} without one`)
const otherwise = onChecks.filter((call, index) => !offChecks[index] || systemText(call.body) !== systemText(offChecks[index].body)).length
check(otherwise === 0, 'layout on: the system prompt and the environment note are the ones sent with the layout off',
  `${onChecks.length - otherwise} of ${onChecks.length} identical`)
// A file changed in the proxy's directory after check CHANGE_AFTER. The next
// check must still find everything that one had in the cache.
const beforeChange = onChecks[CHANGE_AFTER - 1]
const afterChange = onChecks[CHANGE_AFTER]
const cachedBefore = beforeChange ? beforeChange.usage.read + beforeChange.usage.written : 0
check(Boolean(beforeChange && afterChange) && cachedBefore > 0 && afterChange.usage.read >= cachedBefore,
  "layout on: a file changing in the proxy's directory costs the next check nothing that was cached",
  `check ${CHANGE_AFTER} left ${k(cachedBefore)} cached; check ${CHANGE_AFTER + 1} read ${k(afterChange?.usage.read ?? 0)}`)
// With the layout off a check reads back only the fixed part. With it on, the
// instructions and the transcript come back too.
const onLate = onChecks.slice(-4)
check(onLate.every((call, index) => call.usage.read > offLate[index].usage.read && call.usage.read > call.usage.total * 0.85),
  'layout on: late checks read back the transcript as well, not only the fixed part',
  onLate.map((call, index) => `${k(offLate[index].usage.read)} -> ${k(call.usage.read)} of ${k(call.usage.total)} (${pct(call.usage.read, call.usage.total)})`).join(' | '))
const writtenOn = onLate.reduce((sum, call) => sum + call.usage.written, 0)
const writtenOff = offLate.reduce((sum, call) => sum + call.usage.written, 0)
check(writtenOn * 3 < writtenOff, 'layout on: the last four checks write less than a third of what they did',
  `${k(writtenOff)} -> ${k(writtenOn)} characters written`)
// Written or sent uncached: what a check pays for beyond a cache read.
const anew = call => call.usage.written + call.usage.plain
const anewOn = onLate.reduce((sum, call) => sum + anew(call), 0)
const anewOff = offLate.reduce((sum, call) => sum + anew(call), 0)
check(onLate.every((call, index) => anew(call) < anew(offLate[index])) && anewOn * 2 < anewOff,
  'layout on: every late check pays for less anew, and the last four for less than half as much between them',
  `${onLate.map((call, index) => `${k(anew(offLate[index]))} -> ${k(anew(call))}`).join(' | ')}; ${k(anewOff)} -> ${k(anewOn)} in all`)
check(laidOut.length > 0 && on.logs.filter(line => line.includes('auxiliary prompt laid out for caching')).length === laidOut.length,
  'the proxy logs each prompt it lays out', `${on.logs.filter(line => line.includes('auxiliary prompt laid out for caching')).length} lines`)

// 4. A refusal costs one retry, and the conversation still finishes.
const refusals = refused.calls.filter(call => call.kind === 'check-refused')
check(refusals.length === 1, 'refused: the stand-in refused exactly one check for its breakpoints', `${refusals.length}`)
check(refusedChecks.length >= ROUNDS && refusedChecks.every(call => promptBlocks(call.body).length === 1),
  'refused: that check and every one after it went upstream as plain text', `${refusedChecks.length} answered checks`)
check(refused.logs.filter(line => line.includes('cache breakpoints refused')).length === 1,
  'refused: the proxy says once that it turned the layout off', `${refused.logs.filter(line => line.includes('cache breakpoints refused')).length} lines`)

say(`\n=== verdict ===`)
if (failures.length) {
  say(`  FAIL: ${failures.length} check(s)`)
  for (const failure of failures) say(`    - ${failure}`)
} else {
  say('  PASS: a permission check reads back what the one before it wrote, with only Meridian\'s breakpoints on the wire, and a refusal falls back to the plain prompt')
}
process.exit(failures.length ? 1 : 0)
