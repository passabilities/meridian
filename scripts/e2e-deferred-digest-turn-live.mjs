#!/usr/bin/env bun
// Live: with a passthrough turn budget above one turn, does a hand-off to the
// client still pay for a second model request? (#1367, #1370)
//
// `e2e-deferred-digest-turn.mjs` proves the CLI's turn accounting against a
// local fixture. This is the same hand-off against the real subscription and a
// real model. Each model response the SDK reports carries its own message id,
// so the ids seen during one hand-off count the model requests it cost.
//
// Per transport (stream and not), on separate conversations:
//   control   one ordinary tool; the one-turn cap applies. One model request
//             on any build, which shows the count itself is sound.
//   deferred  the same tool plus one `defer_loading` tool, which lifts the cap.
//             One model request with the fix; two or more without it.
// The deferred hand-off is then answered with a tool result holding a fresh
// nonce. The follow-up must resume the same SDK session at the checkpoint and
// the nonce must come back, so the model read the client's result.
//
// Assertions are on request counts, stop reasons, session ids and the nonce,
// never on the model's wording. Costs a few cents of real tokens and needs a
// logged-in Claude subscription.
//
//   bun scripts/e2e-deferred-digest-turn-live.mjs [--expect-digest]
//
// `--expect-digest` inverts the deferred count check, for a build without the
// fix: it passes only when the digest request is there.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spyOn } from 'bun:test'
import * as sdk from '@anthropic-ai/claude-agent-sdk'

const expectDigest = process.argv.includes('--expect-digest')
const root = realpathSync(mkdtempSync(join(tmpdir(), 'meridian-digest-live-')))
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MERIDIAN_') || key.startsWith('CLAUDE_PROXY_')) delete process.env[key]
}
Object.assign(process.env, { MERIDIAN_CONFIG_DIR: join(root, 'config'), MERIDIAN_SESSION_DIR: join(root, 'sessions'),
  MERIDIAN_WORKDIR: root, MERIDIAN_TELEMETRY_PERSIST: '0', MERIDIAN_PASSTHROUGH: '1' })

// One entry per SDK query: its options and what the SDK reported back.
const queries = []
const realQuery = sdk.query
const observer = spyOn(sdk, 'query').mockImplementation(input => {
  const seen = { maxTurns: input.options?.maxTurns, sessionId: input.options?.sessionId, resume: input.options?.resume,
    resumeSessionAt: input.options?.resumeSessionAt, modelMessageIds: new Set(), result: null }
  queries.push(seen)
  const inner = realQuery(input)
  const note = message => {
    if (message?.type === 'assistant' && message.parent_tool_use_id == null && message.message?.id) seen.modelMessageIds.add(message.message.id)
    if (message?.type === 'result') seen.result = { subtype: message.subtype, numTurns: message.num_turns }
  }
  return new Proxy(inner, { get(target, property) {
    if (property === 'next') return async (...args) => { const step = await target.next(...args); note(step.value); return step }
    if (property === Symbol.asyncIterator) return function () { return this }
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
})

const { startProxyServer } = await import('../src/proxy/server.ts')
const { telemetryStore } = await import('../src/telemetry/index.ts')
const instance = await startProxyServer({ port: 0, host: '127.0.0.1', silent: true })
const address = instance.server.address()
assert(address && typeof address === 'object')
const model = process.env.E2E_MODEL ?? 'claude-opus-5-5'
const tool = { name: 'read_fixture', description: 'Return the fixture receipt. Takes no arguments and has no side effects.',
  input_schema: { type: 'object', properties: {} } }
const deferredTool = { name: 'aux_fixture', description: 'Unused auxiliary fixture tool.',
  input_schema: { type: 'object', properties: {} }, defer_loading: true }
const opening = { role: 'user', content: 'Call the read_fixture tool once, with no arguments. When its result arrives, reply with the result text exactly and nothing else.' }

async function post(session, stream, tools, messages) {
  const before = queries.length
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-opencode-session': session },
    body: JSON.stringify({ model, stream, max_tokens: 1024, tools, messages }), signal: AbortSignal.timeout(180_000),
  })
  const raw = await response.text()
  const metric = telemetryStore.getRecent({ limit: 1 })[0]
  let content = []
  let stop
  let usage = {}
  if (response.status === 200 && !stream) {
    const body = JSON.parse(raw)
    content = body.content ?? []
    stop = body.stop_reason
    usage = body.usage ?? {}
  } else if (response.status === 200) {
    const events = raw.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)))
    const blocks = []
    for (const event of events) {
      if (event.type === 'content_block_start') blocks[event.index] = { ...event.content_block }
      if (event.delta?.type === 'text_delta') blocks[event.index].text += event.delta.text
    }
    content = blocks.filter(Boolean)
    stop = events.findLast(event => event.type === 'message_delta')?.delta.stop_reason
    usage = { ...events.find(event => event.type === 'message_start')?.message.usage, ...events.findLast(event => event.type === 'message_delta')?.usage }
  }
  const ran = queries.slice(before)
  return { status: response.status, raw, content, stop, ran,
    modelRequests: ran.reduce((sum, query) => sum + query.modelMessageIds.size, 0),
    promptTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    telemetryPromptTokens: (metric?.inputTokens ?? 0) + (metric?.cacheReadInputTokens ?? 0) + (metric?.cacheCreationInputTokens ?? 0),
    resumed: metric?.isResume === true }
}

const report = { result: 'RUNNING', model, expectDigest, platform: `${process.platform}/${process.arch}`, arms: {}, checks: [] }
const check = (ok, label, detail) => {
  report.checks.push({ ok: Boolean(ok), label, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}
const toolUses = reply => reply.content.filter(block => block.type === 'tool_use')
const summary = reply => ({ status: reply.status, stop: reply.stop, toolUses: toolUses(reply).map(block => block.name),
  queries: reply.ran.length, maxTurns: reply.ran.map(query => query.maxTurns), results: reply.ran.map(query => query.result),
  modelRequests: reply.modelRequests, promptTokens: reply.promptTokens, telemetryPromptTokens: reply.telemetryPromptTokens })

try {
  for (const stream of [false, true]) {
    const transport = stream ? 'stream' : 'non-stream'
    const control = await post(`digest-live-control-${randomUUID()}`, stream, [tool], [opening])
    assert.equal(control.status, 200, control.raw)
    const session = `digest-live-deferred-${randomUUID()}`
    const handoff = await post(session, stream, [tool, deferredTool], [opening])
    assert.equal(handoff.status, 200, handoff.raw)
    const call = toolUses(handoff)[0]
    assert(call, `Fixture precondition: the model must call the tool (${transport}): ${handoff.raw.slice(0, 400)}`)
    const receipt = `RECEIPT-${randomUUID()}`
    const followup = await post(session, stream, [tool, deferredTool], [opening,
      { role: 'assistant', content: handoff.content.map(block => block.type === 'tool_use'
        ? { type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} } : block) },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: receipt }] }])
    report.arms[transport] = { control: summary(control), handoff: summary(handoff),
      followup: { ...summary(followup), resumed: followup.resumed, resume: followup.ran.at(-1)?.resume,
        handoffSessionId: handoff.ran[0]?.sessionId, resumeSessionAt: Boolean(followup.ran.at(-1)?.resumeSessionAt),
        receiptReturned: followup.content.some(block => block.type === 'text' && block.text.includes(receipt)) } }
  }
  console.log(`\n=== digest turn on a lifted budget (model=${model}, ${report.platform}, expectDigest=${expectDigest}) ===`)
  for (const [transport, arm] of Object.entries(report.arms)) {
    check(arm.control.maxTurns[0] === 1 && arm.control.modelRequests === 1 && arm.control.stop === 'tool_use',
      `${transport} control: the one-turn cap makes one model request`, JSON.stringify(arm.control))
    check(arm.handoff.maxTurns[0] > 1, `${transport}: the deferred tool lifts the turn budget`, `maxTurns=${arm.handoff.maxTurns[0]}`)
    check(arm.handoff.stop === 'tool_use' && arm.handoff.toolUses.length === 1 && arm.handoff.toolUses[0] === tool.name,
      `${transport}: the client receives exactly the forwarded tool call`, JSON.stringify(arm.handoff.toolUses))
    check(expectDigest ? arm.handoff.modelRequests > 1 : arm.handoff.modelRequests === 1,
      expectDigest ? `${transport}: the hand-off pays for a digest request (unfixed build)` : `${transport}: the hand-off makes one model request`,
      JSON.stringify(arm.handoff))
    check(arm.followup.status === 200 && arm.followup.resumed && arm.followup.resume === arm.followup.handoffSessionId && arm.followup.resumeSessionAt,
      `${transport}: the follow-up resumes the hand-off session at its checkpoint`, JSON.stringify(arm.followup))
    check(arm.followup.receiptReturned, `${transport}: the model read the client's tool result`)
  }
  report.result = report.checks.every(row => row.ok) ? 'PASS' : 'FAIL'
} catch (error) {
  report.result = 'FAIL'
  report.failure = String(error?.stack ?? error)
} finally {
  await instance.close()
  observer.mockRestore()
  console.log(JSON.stringify(report))
  process.exitCode = report.result === 'PASS' ? 0 : 1
}
