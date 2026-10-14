#!/usr/bin/env bun
// Offline failed-before/passed-after proof. No proxy, SDK, credentials or model.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseAssistantResponse, replayAssistantBlocks } from './lib/e41-assistant-response.ts'

const baseline = '3afca1f5a0d51d74f8c7437b90f43d5686cf4163'
const root = resolve(import.meta.dirname, '..')
const harness = execFileSync('git', ['show', `${baseline}:scripts/e2e-passthrough-turns.mjs`], { cwd: root, encoding: 'utf8' })
const start = harness.indexOf('async function assistantBlocks(res)')
const end = harness.indexOf('/** One line of prompt-cache accounting')
assert(start >= 0 && end > start, 'Recorded baseline parser is unavailable')
const parser = harness.slice(start, end)
const replayLine = harness.split('\n').find(line => line.includes('messages.push({ role: "assistant"'))
const replayExpression = replayLine?.match(/content: (.+) \}\)/)?.[1]
assert(replayExpression, 'Recorded baseline replay projection is unavailable')
// Execute only the reviewed pure parser/projection from the immutable baseline.
// Both current paths use the shared helper imported above.
const originalParse = stream => new Function('STREAM', `${parser}; return assistantBlocks;`)(stream)
const originalReplay = new Function('blocks', `return ${replayExpression};`)

const thinking = { type: 'thinking', thinking: 'Owned synthetic reasoning α', signature: 'opaque-owned-synthetic-signature' }
const redacted = { type: 'redacted_thinking', data: 'opaque-owned-synthetic-redacted-data' }
const text = { type: 'text', text: 'Owned synthetic answer' }
const tool = { type: 'tool_use', id: 'owned-read-call', name: 'read', input: { file_path: '/owned/a.txt' } }
const usage = { cache_read_input_tokens: 3132, cache_creation_input_tokens: 200, output_tokens: 41 }
const json = content => JSON.stringify({ content, usage })
const stream = [
  { type: 'message_start', message: { usage } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: thinking.thinking } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: thinking.signature } },
  { type: 'content_block_start', index: 1, content_block: redacted },
  { type: 'content_block_start', index: 2, content_block: text },
  { type: 'content_block_start', index: 3, content_block: { ...tool, input: {} } },
  { type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) } },
].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
const cases = [
  { name: 'JSON signed thinking replay', text: json([thinking, tool]), stream: false, expected: [thinking, tool] },
  { name: 'JSON redacted thinking replay', text: json([redacted, text]), stream: false, expected: [redacted, text] },
  { name: 'streaming thinking/signature and redacted replay', text: stream, stream: true, expected: [thinking, redacted, text, tool] },
]
const failures = []
for (const test of cases) {
  const before = await originalParse(test.stream)({ text: async () => test.text })
  try { assert.deepEqual(originalReplay(before.blocks), test.expected) }
  catch (error) { failures.push({ assertion: test.name, error: error.name }) }
  const after = parseAssistantResponse(test.text, test.stream)
  assert.deepEqual(replayAssistantBlocks(after.blocks), test.expected, test.name)
  assert.deepEqual(after.usage, usage, 'The cache accounting assertion must stay unchanged')
}
assert.equal(failures.length, cases.length, 'The baseline must fail each same fidelity assertion')
const ordinary = json([text, tool])
const ordinaryBefore = await originalParse(false)({ text: async () => ordinary })
assert.deepEqual(originalReplay(ordinaryBefore.blocks), [text, tool])
assert.deepEqual(replayAssistantBlocks(parseAssistantResponse(ordinary, false).blocks), [text, tool])
console.info(JSON.stringify({ result: 'PASS', baseline, failedBefore: failures, passedAfter: cases.length,
  ordinaryTextToolControl: 'PASS', cacheAccounting: 'unchanged', modelQueries: 0, networkRequests: 0,
  original200TokenResidual: 'unexplained; this fidelity correction does not close #1245/#1220' }))
