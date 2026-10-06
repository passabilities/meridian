/**
 * Tool deferral in passthrough mode: when it is on, how the model is told
 * what it can load, what ends the tool turn, and what carries a ToolSearch
 * result across a turn handed to the client.
 */

import { afterEach, describe, expect, it } from "bun:test"
import {
  TOOL_SEARCH_TURN_BUDGET,
  cliIgnoresStop,
  createInternalToolResults,
  createStopWatch,
  deferredToolsNote,
  endTurnAtDeny,
  internalToolResultsAt,
  noteCliIgnoredStop,
  noteInternalToolMessage,
  noteStopAsked,
  recallInternalToolResults,
  rememberInternalToolResults,
  resetToolSearchState,
  resolveToolSearch,
  stopWasIgnored,
  toolSearchUpstream,
  type InternalToolResultBlock,
} from "../proxy/passthroughToolSearch"

const CLI = "/opt/claude/bin/claude"

function decide(overrides: Partial<Parameters<typeof resolveToolSearch>[0]> = {}) {
  return resolveToolSearch({
    hasDeferredTools: true,
    disabled: false,
    customUpstream: false,
    upstreamVouchedFor: false,
    experimentalBetasOff: false,
    stopsAtToolBoundary: true,
    model: "opus[1m]",
    clientToolNames: ["Read", "mcp__jira__get_issue"],
    claudeExecutable: CLI,
    ...overrides,
  })
}

afterEach(() => resetToolSearchState())

describe("resolveToolSearch", () => {
  it("is on for a session with deferred tools", () => {
    expect(decide()).toEqual({ active: true })
  })

  it("is off without deferred tools", () => {
    expect(decide({ hasDeferredTools: false })).toEqual({ active: false, reason: "no_deferred_tools" })
  })

  it("is off when the operator disabled it", () => {
    expect(decide({ disabled: true })).toEqual({ active: false, reason: "disabled" })
  })

  it("is off when the SDK has to run past the tool boundary (advisor, structured output, early stop off)", () => {
    expect(decide({ stopsAtToolBoundary: false })).toEqual({ active: false, reason: "multi_turn_session" })
  })

  it("is off when the operator pinned the turn budget to one: a ToolSearch round would end the turn", () => {
    expect(decide({ pinnedTurnBudget: 1 })).toEqual({ active: false, reason: "single_turn_pinned" })
  })

  it("stays on under a pinned budget that leaves room for a ToolSearch round", () => {
    expect(decide({ pinnedTurnBudget: 2 })).toEqual({ active: true })
  })

  // The CLI keeps tool search from a model whose name holds one of a list it
  // reads from a feature flag: by default the Claude 3 Haikus, and as the flag
  // stood for a subscription on 2026-10-05, every Claude 3 model. Haiku 4.5,
  // which is what the CLI's `haiku` is, has it; the 2.1.290 client connected
  // directly deferred its own tools on it.
  it("is on for Haiku 4.5, which is what the CLI's `haiku` is", () => {
    expect(decide({ model: "haiku" })).toEqual({ active: true })
    expect(decide({ model: "claude-haiku-4-5-20251001" })).toEqual({ active: true })
  })

  it("is off for a Claude 3 model, which the CLI gives no tool search", () => {
    for (const model of ["claude-3-5-haiku-20241022", "claude-3-haiku-20240307", "claude-3-opus-20240229",
      "claude-3-sonnet-20240229", "claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219", "CLAUDE-3-5-HAIKU-latest"]) {
      expect(decide({ model })).toEqual({ active: false, reason: "model" })
    }
  })

  it("is off when the client brings a ToolSearch of its own", () => {
    expect(decide({ clientToolNames: ["Read", "ToolSearch"] })).toEqual({ active: false, reason: "client_tool_search" })
  })

  it("is off for a CLI seen to run on after a hook asked it to stop", () => {
    noteCliIgnoredStop(CLI)
    expect(decide()).toEqual({ active: false, reason: "cli_ignores_stop" })
    expect(decide({ claudeExecutable: "/other/claude" })).toEqual({ active: true })
  })

  it("is off for an upstream that is not Anthropic's own, where the CLI leaves its tool search off too", () => {
    expect(decide({ customUpstream: true })).toEqual({ active: false, reason: "custom_upstream" })
  })

  it("is on for such an upstream once the operator vouches for it", () => {
    expect(decide({ customUpstream: true, upstreamVouchedFor: true })).toEqual({ active: true })
  })

  it("is off when the CLI is told to send no experimental betas, vouched for or not", () => {
    expect(decide({ experimentalBetasOff: true })).toEqual({ active: false, reason: "experimental_betas_off" })
    expect(decide({ experimentalBetasOff: true, upstreamVouchedFor: true }))
      .toEqual({ active: false, reason: "experimental_betas_off" })
  })

  it("lets the kill switch speak before anything about the upstream", () => {
    expect(decide({ disabled: true, customUpstream: true })).toEqual({ active: false, reason: "disabled" })
  })
})

describe("what the SDK child's environment says about its upstream", () => {
  it("takes no base URL for Anthropic's own API", () => {
    expect(toolSearchUpstream({})).toEqual({ customUpstream: false, experimentalBetasOff: false })
    expect(toolSearchUpstream({ ANTHROPIC_BASE_URL: "" })).toEqual({ customUpstream: false, experimentalBetasOff: false })
  })

  it("takes api.anthropic.com for Anthropic's own API, whatever the path", () => {
    expect(toolSearchUpstream({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" }).customUpstream).toBe(false)
    expect(toolSearchUpstream({ ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1/" }).customUpstream).toBe(false)
  })

  it("takes any other host for a custom upstream, and so a value that is no URL", () => {
    expect(toolSearchUpstream({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4000" }).customUpstream).toBe(true)
    expect(toolSearchUpstream({ ANTHROPIC_BASE_URL: "https://gateway.example.com/anthropic" }).customUpstream).toBe(true)
    expect(toolSearchUpstream({ ANTHROPIC_BASE_URL: "https://api.anthropic.com.example.net" }).customUpstream).toBe(true)
    expect(toolSearchUpstream({ ANTHROPIC_BASE_URL: "api.anthropic.com" }).customUpstream).toBe(true)
  })

  it("reads CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS as the CLI reads a flag", () => {
    for (const on of ["1", "true", "TRUE", "yes", "on", " true "]) {
      expect(toolSearchUpstream({ CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: on }).experimentalBetasOff).toBe(true)
    }
    for (const off of ["", "0", "false", "no", "off"]) {
      expect(toolSearchUpstream({ CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: off }).experimentalBetasOff).toBe(false)
    }
  })
})

describe("the CLI stop capability", () => {
  it("reports a CLI as ignoring the stop only once it has been seen to", () => {
    expect(cliIgnoresStop(CLI)).toBe(false)
    expect(noteCliIgnoredStop(CLI)).toBe(true)
    expect(cliIgnoresStop(CLI)).toBe(true)
  })

  it("says whether a sighting is the first, so it is logged once", () => {
    expect(noteCliIgnoredStop(CLI)).toBe(true)
    expect(noteCliIgnoredStop(CLI)).toBe(false)
  })
})

const streamEvent = (event: Record<string, unknown>) => ({ type: "stream_event", event })
const turnStart = (apiId: string) => streamEvent({ type: "message_start", message: { id: apiId } })
const callStart = (id: string, name = "mcp__oc__read") => streamEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name } })
const init = { type: "system", subtype: "init" }
const result = { type: "result", subtype: "success" }
/** Feed the messages in order; which of them were taken for an ignored stop. */
function sightings(watch: ReturnType<typeof createStopWatch>, messages: unknown[]): boolean[] {
  return messages.map(message => stopWasIgnored(watch, message))
}

describe("watching for a CLI that ignores the stop", () => {
  it("is a model turn that starts after a message whose call was answered with the stop", () => {
    const watch = createStopWatch()
    expect(sightings(watch, [init, turnStart("msg_1"), callStart("c1")])).toEqual([false, false, false])
    noteStopAsked(watch, "c1")
    expect(stopWasIgnored(watch, turnStart("msg_2"))).toBe(true)
  })

  it("is not the turn the call belongs to, though its start is read after the hook has answered", () => {
    // The hook runs as the CLI's line is read; the iterator's consumer can
    // still be behind it, with the same turn's message_start yet to come.
    const watch = createStopWatch()
    noteStopAsked(watch, "c1")
    expect(sightings(watch, [init, turnStart("msg_1"), callStart("c1"), result])).toEqual([false, false, false, false])
  })

  it("is not the turn after a call no hook answered", () => {
    const watch = createStopWatch()
    expect(sightings(watch, [init, turnStart("msg_1"), callStart("bare", "read"), turnStart("msg_2"), callStart("c2")]))
      .toEqual([false, false, false, false, false])
    noteStopAsked(watch, "c2")
    expect(stopWasIgnored(watch, result)).toBe(false)
  })

  it("is not the turn after a ToolSearch round, which no hook stops", () => {
    const watch = createStopWatch()
    expect(sightings(watch, [init, turnStart("msg_1"), callStart("ts1", "ToolSearch"), turnStart("msg_2")]))
      .toEqual([false, false, false, false])
  })

  it("is reported once for the turn that gives it away", () => {
    const watch = createStopWatch()
    sightings(watch, [init, turnStart("msg_1"), callStart("c1")])
    noteStopAsked(watch, "c1")
    expect(sightings(watch, [turnStart("msg_2"), turnStart("msg_2"), turnStart("msg_3")])).toEqual([true, false, false])
  })

  it("starts clean with every query: a retry's first turn follows nothing", () => {
    const viaInit = createStopWatch()
    sightings(viaInit, [init, turnStart("msg_1"), callStart("c1")])
    noteStopAsked(viaInit, "c1")
    expect(sightings(viaInit, [init, turnStart("msg_2")])).toEqual([false, false])

    const viaResult = createStopWatch()
    sightings(viaResult, [turnStart("msg_1"), callStart("c1")])
    noteStopAsked(viaResult, "c1")
    expect(sightings(viaResult, [result, turnStart("msg_2")])).toEqual([false, false])
  })

  it("reads the same from assistant messages when no stream events arrive", () => {
    const watch = createStopWatch()
    expect(stopWasIgnored(watch, assistant("u1", "msg_1", [{ type: "tool_use", id: "c1", name: "mcp__oc__read", input: {} }]))).toBe(false)
    noteStopAsked(watch, "c1")
    // A second fragment of the same API message is not a new turn.
    expect(stopWasIgnored(watch, assistant("u2", "msg_1", [{ type: "tool_use", id: "c2", name: "mcp__oc__lint", input: {} }]))).toBe(false)
    expect(stopWasIgnored(watch, assistant("u3", "msg_2", [{ type: "text", text: "digest" }]))).toBe(true)
  })

  it("takes a message_start without an id for a new turn", () => {
    const watch = createStopWatch()
    sightings(watch, [streamEvent({ type: "message_start" }), callStart("c1")])
    noteStopAsked(watch, "c1")
    expect(stopWasIgnored(watch, streamEvent({ type: "message_start" }))).toBe(true)
  })

  it("ignores a stop asked for no call", () => {
    const watch = createStopWatch()
    noteStopAsked(watch, undefined)
    expect(sightings(watch, [turnStart("msg_1"), callStart("c1"), turnStart("msg_2")])).toEqual([false, false, false])
  })
})

describe("endTurnAtDeny", () => {
  it("asks the CLI to end the query beside the deny, leaving the deny as it was", () => {
    const deny = { decision: "block" as const, reason: "forwarded" }
    const out = endTurnAtDeny(deny)
    expect(out.decision).toBe("block")
    expect(out.reason).toBe("forwarded")
    expect(out.continue).toBe(false)
    expect(typeof out.stopReason).toBe("string")
    expect(deny).toEqual({ decision: "block", reason: "forwarded" })
  })
})

describe("deferredToolsNote", () => {
  it("names every deferred tool and how to load one", () => {
    const note = deferredToolsNote(["mcp__oc__mcp__jira__get_issue", "mcp__oc__mcp__jira__search"])
    expect(note).toContain("mcp__oc__mcp__jira__get_issue\nmcp__oc__mcp__jira__search")
    expect(note).toContain("ToolSearch")
    expect(note).toContain('"select:<name>[,<name>...]"')
  })

  it("is empty when nothing is deferred", () => {
    expect(deferredToolsNote([])).toBe("")
  })

  it("is the same text for the same tools, whatever order they arrive in", () => {
    expect(deferredToolsNote(["b", "a"])).toBe(deferredToolsNote(["a", "b"]))
  })
})

describe("the budget", () => {
  it("leaves room for ToolSearch rounds ahead of the tool call", () => {
    expect(TOOL_SEARCH_TURN_BUDGET).toBeGreaterThan(2)
  })
})

function assistant(uuid: string, apiId: string, content: unknown[]) {
  return { type: "assistant", uuid, message: { id: apiId, role: "assistant", content } }
}
function user(content: unknown[]) {
  return { type: "user", message: { role: "user", content } }
}
const reference = (name: string) => [{ type: "tool_reference", tool_name: name }]

describe("internal tool results", () => {
  it("finds the ToolSearch result of the message a client tool call was forwarded from", () => {
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, assistant("u1", "msg_1", [{ type: "tool_use", id: "ts1", name: "ToolSearch", input: {} }]))
    noteInternalToolMessage(seen, assistant("u2", "msg_1", [{ type: "tool_use", id: "c1", name: "mcp__oc__read", input: {} }]))
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") }]))
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "c1", content: "forwarded" }]))

    expect(internalToolResultsAt(seen, "u2")).toEqual([
      { type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") },
    ])
  })

  it("leaves out a ToolSearch from an earlier message: that result is already in the transcript", () => {
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, assistant("u1", "msg_1", [{ type: "tool_use", id: "ts1", name: "ToolSearch", input: {} }]))
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") }]))
    noteInternalToolMessage(seen, assistant("u2", "msg_2", [{ type: "tool_use", id: "c1", name: "mcp__oc__lint", input: {} }]))

    expect(internalToolResultsAt(seen, "u2")).toEqual([])
  })

  it("leaves out a ToolSearch called after the forwarded call: the resume point cuts its call off, and a result alone has nothing to answer", () => {
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, assistant("u1", "msg_1", [{ type: "tool_use", id: "c1", name: "mcp__oc__read", input: {} }]))
    noteInternalToolMessage(seen, assistant("u2", "msg_1", [{ type: "tool_use", id: "ts1", name: "ToolSearch", input: {} }]))
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "c1", content: "forwarded" }]))
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") }]))

    expect(internalToolResultsAt(seen, "u1")).toEqual([])
  })

  it("keeps a ToolSearch between two forwarded calls: the resume point is the last of them", () => {
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, assistant("u1", "msg_1", [{ type: "tool_use", id: "c1", name: "mcp__oc__read", input: {} }]))
    noteInternalToolMessage(seen, assistant("u2", "msg_1", [{ type: "tool_use", id: "ts1", name: "ToolSearch", input: {} }]))
    noteInternalToolMessage(seen, assistant("u3", "msg_1", [{ type: "tool_use", id: "c2", name: "mcp__oc__read", input: {} }]))
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") }]))

    expect(internalToolResultsAt(seen, "u3")).toEqual([
      { type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") },
    ])
  })

  it("keeps a ToolSearch that shares its fragment with the forwarded call", () => {
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, assistant("u1", "msg_1", [
      { type: "tool_use", id: "c1", name: "mcp__oc__read", input: {} },
      { type: "tool_use", id: "ts1", name: "ToolSearch", input: {} },
    ]))
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") }]))

    expect(internalToolResultsAt(seen, "u1")).toEqual([
      { type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") },
    ])
  })

  it("keeps a result that reaches the iterator ahead of the fragment carrying its call", () => {
    // The CLI can answer a call while later blocks of its message are still
    // streaming, and it hands on one assistant message per block.
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") }]))
    noteInternalToolMessage(seen, assistant("u1", "msg_1", [{ type: "tool_use", id: "ts1", name: "ToolSearch", input: {} }]))
    noteInternalToolMessage(seen, assistant("u2", "msg_1", [{ type: "tool_use", id: "c1", name: "mcp__oc__read", input: {} }]))

    expect(internalToolResultsAt(seen, "u2")).toEqual([
      { type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") },
    ])
  })

  it("has nothing for a ToolSearch whose result never arrived", () => {
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, assistant("u1", "msg_1", [
      { type: "tool_use", id: "ts1", name: "ToolSearch", input: {} },
      { type: "tool_use", id: "c1", name: "mcp__oc__read", input: {} },
    ]))
    expect(internalToolResultsAt(seen, "u1")).toEqual([])
  })

  it("has nothing without the message's API id, which is what ties the fragments together", () => {
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, { type: "assistant", uuid: "u1", message: { content: [
      { type: "tool_use", id: "ts1", name: "ToolSearch", input: {} },
    ] } })
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "ts1", content: reference("x") }]))
    expect(internalToolResultsAt(seen, "u1")).toEqual([])
    expect(internalToolResultsAt(seen, undefined)).toEqual([])
  })

  it("keeps an error result an error", () => {
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, assistant("u1", "msg_1", [{ type: "tool_use", id: "ts1", name: "ToolSearch", input: {} }]))
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "ts1", content: "no match", is_error: true, extra: 1 }]))
    expect(internalToolResultsAt(seen, "u1")).toEqual([
      { type: "tool_result", tool_use_id: "ts1", content: "no match", is_error: true },
    ])
  })

  it("ignores a client tool's result", () => {
    const seen = createInternalToolResults()
    noteInternalToolMessage(seen, assistant("u1", "msg_1", [{ type: "tool_use", id: "c1", name: "mcp__oc__read", input: {} }]))
    noteInternalToolMessage(seen, user([{ type: "tool_result", tool_use_id: "c1", content: "forwarded" }]))
    expect(internalToolResultsAt(seen, "u1")).toEqual([])
  })
})

describe("carried internal tool results", () => {
  it("returns what was remembered for a checkpoint, more than once", () => {
    const blocks: InternalToolResultBlock[] = [{ type: "tool_result", tool_use_id: "ts1", content: reference("mcp__oc__lint") }]
    rememberInternalToolResults("u2", blocks)
    expect(recallInternalToolResults("u2")).toEqual(blocks)
    expect(recallInternalToolResults("u2")).toEqual(blocks)
  })

  it("has nothing for a checkpoint it was never given", () => {
    expect(recallInternalToolResults("unknown")).toEqual([])
    expect(recallInternalToolResults(undefined)).toEqual([])
  })

  it("does not record a checkpoint without results", () => {
    rememberInternalToolResults("u3", [])
    expect(recallInternalToolResults("u3")).toEqual([])
  })

  it("forgets the oldest checkpoints rather than growing without bound", () => {
    const block: InternalToolResultBlock[] = [{ type: "tool_result", tool_use_id: "ts", content: "x" }]
    rememberInternalToolResults("first", block)
    for (let i = 0; i < 600; i++) rememberInternalToolResults(`later-${i}`, block)
    expect(recallInternalToolResults("first")).toEqual([])
    expect(recallInternalToolResults("later-599")).toEqual(block)
  })
})
