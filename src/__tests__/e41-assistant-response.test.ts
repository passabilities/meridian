import { describe, expect, it } from "bun:test"
import { parseAssistantResponse, replayAssistantBlocks } from "../../scripts/lib/e41-assistant-response"

const thinking = {
  type: "thinking",
  thinking: "Owned synthetic reasoning α",
  signature: "opaque-owned-synthetic-signature",
}
const redacted = { type: "redacted_thinking", data: "opaque-owned-synthetic-redacted-data" }
const text = { type: "text", text: "Owned synthetic answer", citations: [{ type: "char_location", start_char_index: 0 }] }
const tool = { type: "tool_use", id: "owned-read-call", name: "read", input: { file_path: "/owned/a.txt", options: { nested: true } } }
const usage = { cache_read_input_tokens: 3132, cache_creation_input_tokens: 200, input_tokens: 7, output_tokens: 41 }
const sse = (events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")

describe("E41 assistant response fidelity", () => {
  it("replays signed JSON thinking with the original opaque signature", () => {
    const parsed = parseAssistantResponse(JSON.stringify({ content: [thinking, tool], usage }), false)
    expect(replayAssistantBlocks(parsed.blocks)).toEqual([thinking, tool])
    expect(parsed.usage).toEqual(usage)
  })

  it("replays redacted JSON thinking with its original opaque data", () => {
    const parsed = parseAssistantResponse(JSON.stringify({ content: [redacted, text], usage }), false)
    expect(replayAssistantBlocks(parsed.blocks)).toEqual([redacted, text])
  })

  it("assembles fragmented streaming thinking and signature deltas exactly", () => {
    const parsed = parseAssistantResponse(sse([
      { type: "message_start", message: { usage } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "Owned " } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "synthetic reasoning " } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "α" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "opaque-owned-" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "synthetic-signature" } },
      { type: "content_block_stop", index: 0 },
    ]), true)
    expect(replayAssistantBlocks(parsed.blocks)).toEqual([thinking])
    expect(parsed.usage).toEqual(usage)
  })

  it("preserves streaming redacted data beside thinking, text and tool calls", () => {
    const parsed = parseAssistantResponse(sse([
      { type: "content_block_start", index: 0, content_block: thinking },
      { type: "content_block_start", index: 1, content_block: redacted },
      { type: "content_block_start", index: 2, content_block: { ...text, text: "Owned " } },
      { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "synthetic answer" } },
      { type: "content_block_start", index: 3, content_block: { ...tool, input: {} } },
      { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"file_path":"/owned/a.txt",' } },
      { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '"options":{"nested":true}}' } },
    ]), true)
    expect(replayAssistantBlocks(parsed.blocks)).toEqual([thinking, redacted, text, tool])
    expect(parsed.blocks[3]).not.toHaveProperty("_json")
  })

  it("keeps ordinary JSON text, citations, tool IDs and nested tool input intact", () => {
    const parsed = parseAssistantResponse(JSON.stringify({ content: [text, tool], usage }), false)
    expect(replayAssistantBlocks(parsed.blocks)).toEqual([text, tool])
  })

  it("copies replay content deeply without inventing or modifying thinking fields", () => {
    const incompleteThinking = { type: "thinking", thinking: "Only the fields received" }
    const original = [thinking, redacted, tool, incompleteThinking]
    const replay = replayAssistantBlocks(original)
    expect(replay).toEqual(original)
    expect(replay).not.toBe(original)
    expect(replay[0]).not.toBe(original[0])
    const replayInput = replay[2]?.input
    expect(replayInput).not.toBe(tool.input)
    expect(replay[3]).not.toHaveProperty("signature")
    replay[0]!.signature = "changed by caller"
    expect(original[0]).toEqual(thinking)
  })

  it("preserves cache accounting when merging streaming usage", () => {
    const parsed = parseAssistantResponse(sse([
      { type: "message_start", message: { usage: { ...usage, output_tokens: 0 } } },
      { type: "message_delta", usage: { output_tokens: usage.output_tokens } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: tool.id, name: tool.name, input: tool.input } },
    ]), true)
    expect(parsed.usage).toEqual(usage)
    expect(parsed.blocks).toEqual([tool])
  })

  it("does not add thinking fields to unrelated text or tool blocks", () => {
    const parsed = parseAssistantResponse(sse([
      { type: "content_block_start", index: 0, content_block: text },
      { type: "content_block_start", index: 1, content_block: tool },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "wrong block" } },
      { type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "wrong block" } },
    ]), true)
    expect(parsed.blocks).toEqual([text, tool])
  })

  it("still rejects malformed streamed tool input rather than fabricating a call", () => {
    expect(() => parseAssistantResponse(sse([
      { type: "content_block_start", index: 0, content_block: { ...tool, input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{" } },
    ]), true)).toThrow()
  })
})
