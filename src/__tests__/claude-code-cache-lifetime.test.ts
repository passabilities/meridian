/**
 * How long a Claude Code request's prompt cache entries should live.
 *
 * On a subscription the CLI writes a main conversation's cache for an hour and
 * an Agent-tool subagent's for five minutes (read from this machine's own
 * transcripts, 2026-10-05: a session's 2.4M main-thread cache tokens were all
 * `ephemeral_1h`, its subagents' 1.3M all `ephemeral_5m`). Through the proxy
 * each conversation is an SDK query, which the CLI counts as a main
 * conversation, so a subagent's cache was written for an hour as well: 2x
 * input a token against 1.25x.
 */
import { describe, it, expect } from "bun:test"
import { claudeCodePromptCacheLifetime } from "../proxy/adapters/claudecode"

const turn = { model: "claude-fable-5-1", stream: true, tools: [{ name: "Read" }], messages: [{ role: "user", content: "go" }] }
// The auto-mode permission check, as `hasClassifierShape` knows it.
const classifier = { model: "claude-sonnet-5-5", stream: false, stop_sequences: ["</block>"], messages: [{ role: "user", content: "transcript" }] }

describe("claudeCodePromptCacheLifetime", () => {
  it("gives an Agent-tool subagent's request the five minutes the CLI gives it", () => {
    expect(claudeCodePromptCacheLifetime("a65ce96ceed9428a7", turn)).toBe("5m")
  })

  it("leaves the main conversation to the SDK child", () => {
    expect(claudeCodePromptCacheLifetime(undefined, turn)).toBeUndefined()
  })

  it("does not act on an agent id it would not key a session by", () => {
    expect(claudeCodePromptCacheLifetime("", turn)).toBeUndefined()
    expect(claudeCodePromptCacheLifetime("not an id", turn)).toBeUndefined()
  })

  it("leaves the permission check alone, whose cache the CLI keeps for an hour itself", () => {
    expect(claudeCodePromptCacheLifetime("a65ce96ceed9428a7", classifier)).toBeUndefined()
  })

  it("leaves a permission check sent without a stop sequence alone too (CLI 2.1.294, fast mode)", () => {
    const fast = { model: "claude-sonnet-5-5", stream: false, max_tokens: 256, messages: [
      { role: "user", content: [{ type: "text", text: "<transcript>\n" }, { type: "text", text: "</transcript>\n" }, { type: "text", text: "Respond with <block>yes</block> or <block>no</block>." }] },
    ] }
    expect(claudeCodePromptCacheLifetime("a65ce96ceed9428a7", fast)).toBeUndefined()
  })
})
