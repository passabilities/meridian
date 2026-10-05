#!/usr/bin/env bun
// Wire shape: what does the REAL Claude Code CLI send for a background
// subagent's progress summary, and does the adapter isolate it?
//
// While a subagent runs in the background the CLI forks its transcript on a
// 30-second timer to ask for a 3-5 word progress label (`agent_summary`). The fork
// carries that subagent's own session key, tools and streaming. Read as a
// turn it replaced the subagent's mapping, so the subagent's next real turn
// replayed its whole history — on every turn longer than the timer.
//
// No model calls, no proxy and no credentials: the client talks to a scripted
// stand-in for the Messages API on localhost, with its own CLAUDE_CONFIG_DIR
// and a dummy bearer token. The stand-in plays a main agent that launches one
// background subagent, and a subagent that runs `sleep 1` and then `sleep 45`,
// so the timer fires while the second tool call is pending. The child
// environment is scrubbed of `CLAUDE*` and `ANTHROPIC_*` variables so running
// this from inside Claude Code cannot hand the client a live session.
//
// The fork is identified structurally — a second request for a tool round the
// stand-in already answered — never by its prompt, so a CLI that rewords the
// prompt FAILS the detection check instead of passing vacuously. The capture
// runs twice: without the gateway hint headers (the shape decides) and with
// them (the CLI's own request class decides).
//
// An isolated fork is answered from a session of its own, so the capture also
// checks what the adapter would replay for it: the latest step, not the
// transcript the client sent.
//
// This proves what the client sends and what the adapter does with it. It
// does not run the proxy: session resume across a fork, and the prompt the
// SDK is handed for one, are covered by proxy-concurrency-coordination.test.ts
// and still want a live run.
//
//   bun scripts/e2e-claude-code-agent-summary.mjs
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { agentSummaryReplayMessages, isClaudeCodeAuxiliaryRequest } from '../src/proxy/adapters/claudecode.ts'

const say = console.log.bind(console)

const which = spawnSync('command', ['-v', 'claude'], { shell: true, encoding: 'utf8' })
if (which.status !== 0 || !which.stdout.trim()) {
  say('SKIP: the `claude` CLI is not on PATH; this gate drives the real client')
  process.exit(1)
}
const CLI = which.stdout.trim()
const version = spawnSync(CLI, ['--version'], { encoding: 'utf8' }).stdout.trim()

const SUMMARY_WAIT_MS = 75000
const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const text = value => ({ blocks: [{ type: 'text', text: value }], stop: 'end_turn' })
const toolUse = (name, input) => ({
  blocks: [{ type: 'tool_use', id: `toolu_${crypto.randomUUID().replaceAll('-', '').slice(0, 22)}`, name, input }],
  stop: 'tool_use',
})
const timeout = ms => new Promise(resolve => setTimeout(() => resolve('timeout'), ms))
// Mid-conversation `system` messages can trail a turn; the turn is what precedes them.
const finalTurn = messages => messages.findLast(message => message?.role !== 'system')
const blockTypes = message => typeof message?.content === 'string' ? 'string'
  : Array.isArray(message?.content) ? message.content.map(block => block?.type + (block?.cache_control ? '*' : '')).join(',') : '?'
const shape = messages => messages.map(message => `${message.role}[${blockTypes(message)}]`).join(' ')

function respond(body, reply) {
  const id = `msg_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
  const model = typeof body.model === 'string' ? body.model : 'claude-sonnet-5'
  const headers = { 'request-id': `req_${id.slice(4)}` }
  if (body.stream !== true) {
    return Response.json({
      id, type: 'message', role: 'assistant', model, content: reply.blocks,
      stop_reason: reply.stop, stop_sequence: null, usage,
    }, { headers })
  }
  const events = [['message_start', {
    type: 'message_start',
    message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage },
  }]]
  reply.blocks.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(['content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }])
      events.push(['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } }])
    } else {
      events.push(['content_block_start', {
        type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      }])
      events.push(['content_block_delta', {
        type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      }])
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }])
  })
  events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: reply.stop, stop_sequence: null }, usage: { output_tokens: 12 } }])
  events.push(['message_stop', { type: 'message_stop' }])
  return new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), {
    headers: { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}

/** One client run against a fresh stand-in. Returns every /v1/messages request it made. */
async function capture({ hintHeaders }) {
  const recorded = []
  const answeredRounds = new Map()
  let markFork = () => {}
  const forkSeen = new Promise(resolve => { markFork = resolve })
  let markSubagentDone = () => {}
  const subagentDone = new Promise(resolve => { markSubagentDone = resolve })
  const startedAt = Date.now()

  function decide(headers, body) {
    const messages = Array.isArray(body.messages) ? body.messages : []
    const tools = Array.isArray(body.tools) ? body.tools.map(tool => tool?.name) : []
    const results = messages.flatMap(message => Array.isArray(message?.content) ? message.content : [])
      .filter(block => block?.type === 'tool_result').length
    const agentId = headers.get('x-claude-code-agent-id')
    if (agentId) {
      if (!tools.includes('Bash')) return { kind: 'subagent-side', ...text('ok') }
      // A tool round the stand-in already answered, asked again: a fork of
      // the subagent's transcript, whatever its prompt says.
      const answered = answeredRounds.get(agentId) ?? new Set()
      answeredRounds.set(agentId, answered)
      if (answered.has(results)) return { kind: 'fork', ...text('Running sleep command') }
      answered.add(results)
      if (results === 0) return { kind: 'subagent-turn', ...toolUse('Bash', { command: 'sleep 1', description: 'Short pause' }) }
      if (results === 1) return { kind: 'subagent-turn', ...toolUse('Bash', { command: 'sleep 45', description: 'Long pause' }) }
      return { kind: 'subagent-final', ...text('SUBAGENT DONE') }
    }
    const agentTool = tools.find(name => name === 'Agent' || name === 'Task')
    if (!agentTool) return { kind: 'main-side', ...text('ok') }
    if (results === 0) {
      return { kind: 'main-turn', ...toolUse(agentTool, {
        description: 'Sleep twice',
        prompt: 'Run the shell command `sleep 1`, then in a separate Bash call run `sleep 45`, then report.',
        subagent_type: 'general-purpose',
        run_in_background: true,
      }) }
    }
    return { kind: 'main-turn', ...text('LAUNCHED') }
  }

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method === 'POST' && url.pathname === '/v1/messages') {
        const body = await req.json()
        const reply = decide(req.headers, body)
        recorded.push({ at: Date.now() - startedAt, headers: Object.fromEntries(req.headers), body, kind: reply.kind })
        if (reply.kind === 'fork') markFork()
        if (reply.kind === 'subagent-final') markSubagentDone()
        return respond(body, reply)
      }
      if (req.method === 'POST' && url.pathname === '/v1/messages/count_tokens') return Response.json({ input_tokens: 100 })
      return Response.json({ type: 'error', error: { type: 'not_found_error', message: 'not scripted' } }, { status: 404 })
    },
  })

  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(CLAUDE(CODE|_)|ANTHROPIC_)/.test(key)) delete env[key]
  }
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'mccsum-proj-')))
  writeFileSync(join(project, 'README.md'), 'scratch project\n')
  const proc = Bun.spawn([
    CLI, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', 'sonnet', '--permission-mode', 'default', '--allowedTools', 'Bash(sleep:*)', 'Agent',
  ], {
    cwd: project,
    env: {
      ...env,
      CLAUDE_CONFIG_DIR: realpathSync(mkdtempSync(join(tmpdir(), 'mccsum-conf-'))),
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
      ANTHROPIC_AUTH_TOKEN: 'meridian-e2e-dummy',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_ERROR_REPORTING: '1',
      ...(hintHeaders ? { CLAUDE_CODE_GATEWAY_HINT_HEADERS: '1' } : {}),
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  // Drained concurrently: the client blocks once it fills a pipe (see E55).
  const drained = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])

  // The SDK host turns progress summaries on in its initialize request.
  proc.stdin.write(`${JSON.stringify({
    type: 'control_request', request_id: 'init-1', request: { subtype: 'initialize', agentProgressSummaries: true },
  })}\n`)
  proc.stdin.write(`${JSON.stringify({
    type: 'user', session_id: '', parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text: 'Launch one background subagent that sleeps twice, then reply LAUNCHED.' }] },
  })}\n`)
  proc.stdin.flush()

  const outcome = await Promise.race([forkSeen.then(() => 'fork'), timeout(SUMMARY_WAIT_MS)])
  // Let the turn the fork ran beside finish, so the capture holds the request after it too.
  if (outcome === 'fork') await Promise.race([subagentDone, timeout(30000)])
  await Bun.sleep(500)
  proc.stdin.end()
  if (await Promise.race([proc.exited, timeout(8000)]) === 'timeout') proc.kill()
  const [, stderr] = await Promise.race([drained, timeout(2000).then(() => ['', ''])])
  server.stop(true)
  return { recorded, stderr: String(stderr ?? '') }
}

const failures = []
const check = (ok, label, detail) => {
  say(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
const detect = r => isClaudeCodeAuxiliaryRequest(r.headers['x-claude-code-request-class'], r.body)

say(`\n=== Claude Code background progress-summary wire shape ===`)
say(`  client: ${version}   upstream: scripted stand-in (no model calls)`)

for (const hintHeaders of [false, true]) {
  say(`\n  --- gateway hint headers ${hintHeaders ? 'on' : 'off'} ---`)
  const { recorded, stderr } = await capture({ hintHeaders })
  for (const r of recorded) {
    const h = r.headers
    say(`    +${(r.at / 1000).toFixed(1).padStart(5)}s ${r.kind.padEnd(14)} agent=${(h['x-claude-code-agent-id'] ?? 'main').slice(0, 8).padEnd(8)}`
      + ` class=${(h['x-claude-code-request-class'] ?? '-').padEnd(9)} tools=${String(r.body.tools?.length ?? 0).padStart(2)}`
      + ` ${shape(r.body.messages ?? [])}`)
  }
  const forks = recorded.filter(r => r.kind === 'fork')
  const subagentTurns = recorded.filter(r => r.kind === 'subagent-turn' || r.kind === 'subagent-final')
  const realTurns = [...subagentTurns, ...recorded.filter(r => r.kind === 'main-turn')]
  say('')

  // 1. The fork actually happened. Without this the rest would pass on a run
  //    that never exercised it.
  check(forks.length > 0 && subagentTurns.length >= 2, 'a background subagent ran, and the CLI forked it for a progress summary',
    `${subagentTurns.length} subagent turns, ${forks.length} fork(s)` + (forks.length ? '' : ` stderr=${stderr.trim().slice(-200)}`))
  if (forks.length === 0) continue
  const fork = forks[0]
  const before = [...subagentTurns].reverse().find(r => r.at < fork.at)

  // 2. Why it collides: the subagent's own key, and the subagent's own history
  //    with one more block on its final user message.
  const agentIds = new Set(subagentTurns.map(r => r.headers['x-claude-code-agent-id']))
  check(agentIds.size === 1 && agentIds.has(fork.headers['x-claude-code-agent-id']), "the fork carries the subagent's own agent id",
    `fork=${fork.headers['x-claude-code-agent-id']}`)
  const forkTurn = finalTurn(fork.body.messages)
  const beforeTurn = before ? finalTurn(before.body.messages) : undefined
  check(Boolean(before) && fork.body.messages.length === before.body.messages.length && forkTurn?.role === 'user'
    && Array.isArray(forkTurn.content) && Array.isArray(beforeTurn?.content) && forkTurn.content.length === beforeTurn.content.length + 1,
  "the fork repeats the subagent's messages with one more block on its final user message",
  `turn [${blockTypes(beforeTurn)}] fork [${blockTypes(forkTurn)}]`)
  check(fork.body.stream === true && (fork.body.tools?.length ?? 0) > 0, 'the fork streams and keeps its tools, so the classifier shape cannot match it',
    `stream=${fork.body.stream} tools=${fork.body.tools?.length ?? 0}`)
  const appended = Array.isArray(forkTurn?.content) ? forkTurn.content.at(-1) : undefined
  say(`    appended block: ${appended?.type} ${JSON.stringify(String(appended?.text ?? '').slice(0, 88))}`)

  // 3. Which signal the client offers.
  const classes = forks.map(r => r.headers['x-claude-code-request-class'] ?? 'none')
  check(classes.every(value => value === (hintHeaders ? 'auxiliary' : 'none')),
    hintHeaders ? 'with hint headers the CLI classes the fork `auxiliary`' : 'without hint headers the fork carries no request class',
    classes.join(','))

  // 4. THE FIX: the adapter isolates the fork and nothing else.
  check(forks.every(detect), 'the adapter isolates every fork as an auxiliary request', `${forks.filter(detect).length} of ${forks.length}`)
  check(realTurns.length >= 4 && !realTurns.some(detect), 'the adapter leaves every main and subagent turn alone',
    `${realTurns.filter(detect).length} of ${realTurns.length} flagged`)

  // 5. What the isolated fork is answered from: the subagent's latest
  //    assistant turn and the message carrying the prompt, nothing before or
  //    after — and a turn is never cut down.
  const sent = fork.body.messages
  const promptAt = sent.findLastIndex(message => message?.role !== 'system')
  const latestAt = sent.findLastIndex((message, index) => index < promptAt && message?.role === 'assistant')
  const replay = agentSummaryReplayMessages(fork.body)
  const kept = JSON.stringify(replay?.slice(1))
  check(latestAt > 0 && kept === JSON.stringify(sent.slice(latestAt, promptAt + 1)),
    'the fork is answered from its latest step: the last assistant turn and the prompt',
    `${sent.length} messages sent, ${replay ? replay.length - 1 : 'all'} replayed (${JSON.stringify(sent).length} -> ${kept?.length ?? '-'} bytes), ${latestAt} left out`)
  check(kept?.includes('Describe your most recent action') === true && kept.includes('sleep 1'),
    'the replay still holds the prompt and the step it asks about', shape(replay?.slice(1) ?? []))
  check(!realTurns.some(r => agentSummaryReplayMessages(r.body) !== undefined), "no turn's history is cut down",
    `${realTurns.filter(r => agentSummaryReplayMessages(r.body) !== undefined).length} of ${realTurns.length} reduced`)
}

say(`\n=== verdict ===`)
if (failures.length) {
  say(`  FAIL: ${failures.length} check(s)`)
  for (const f of failures) say(`    - ${f}`)
} else {
  say("  PASS: the real client's progress-summary fork is isolated and answered from its latest step; its turns are untouched")
}
process.exit(failures.length ? 1 : 0)
