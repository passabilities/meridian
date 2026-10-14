import { describe, expect, test } from "bun:test"
import {
  FORWARDED_BATCH_STOP_REASON,
  PASSTHROUGH_DENY_REASON,
  isForwardedDenial,
  stopAfterForwardedBatch,
} from "../proxy/passthroughDenial"

function denialBlock(id: string) {
  return { type: "tool_result", tool_use_id: id, is_error: true, content: PASSTHROUGH_DENY_REASON }
}

describe("isForwardedDenial", () => {
  test("recognizes only the forwarding hook's synthetic denial", () => {
    expect(isForwardedDenial(denialBlock("x"))).toBe(true)
    expect(isForwardedDenial({
      type: "tool_result",
      tool_use_id: "x",
      is_error: true,
      content: [{ type: "text", text: PASSTHROUGH_DENY_REASON }],
    })).toBe(true)
    expect(isForwardedDenial({ type: "tool_result", tool_use_id: "x", is_error: true, content: "ENOENT" })).toBe(false)
    expect(isForwardedDenial({ type: "tool_result", tool_use_id: "x", content: PASSTHROUGH_DENY_REASON })).toBe(false)
    expect(isForwardedDenial({ type: "text", content: PASSTHROUGH_DENY_REASON })).toBe(false)
    expect(isForwardedDenial(undefined)).toBe(false)
  })
})

describe("stopAfterForwardedBatch", () => {
  const forwarded = new Set(["toolu_client"])
  const hook = stopAfterForwardedBatch((id) => forwarded.has(id))
  const call = (id: string, name = "mcp__oc__read") => ({ tool_name: name, tool_input: {}, tool_use_id: id })

  test("ends the query once a batch holds a call forwarded to the client", async () => {
    expect(await hook({ tool_calls: [call("toolu_client")] }))
      .toEqual({ continue: false, stopReason: FORWARDED_BATCH_STOP_REASON })
  })

  test("ends the query when the forwarded call shares the batch with an internal one", async () => {
    expect(await hook({ tool_calls: [call("toolu_search", "ToolSearch"), call("toolu_client")] }))
      .toEqual({ continue: false, stopReason: FORWARDED_BATCH_STOP_REASON })
  })

  test("lets a batch without a forwarded call continue to the next model turn", async () => {
    expect(await hook({ tool_calls: [call("toolu_search", "ToolSearch")] })).toEqual({})
    // A bare name the CLI refused, or a repeat the hook dropped, was never forwarded.
    expect(await hook({ tool_calls: [call("toolu_refused", "read")] })).toEqual({})
  })

  test("continues on input it cannot read", async () => {
    expect(await hook({})).toEqual({})
    expect(await hook({ tool_calls: "not-a-list" })).toEqual({})
    expect(await hook({ tool_calls: [null, { tool_use_id: 7 }] })).toEqual({})
  })
})
