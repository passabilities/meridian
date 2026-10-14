import { describe, expect, it } from "bun:test"
import { haikuThinkingCompatibilityError } from "../proxy/haikuCompatibility"

describe("Haiku 5.5 native thinking compatibility", () => {
  it("refuses explicit off rather than silently using provider-default adaptive thinking", () => {
    expect(haikuThinkingCompatibilityError("claude-haiku-5-5", { type: "disabled" })).toContain("thinking: disabled")
  })
  it("refuses an unqualified omitted display rather than silently changing its semantics", () => {
    expect(haikuThinkingCompatibilityError("claude-haiku-5-5", { type: "adaptive", display: "omitted" })).toContain("thinking.display: omitted")
  })
  it("keeps ordinary adaptive/manual-budget inputs and the default usable", () => {
    for (const thinking of [undefined, { type: "adaptive" }, { type: "enabled" }, { type: "adaptive", display: "summarized" }]) {
      expect(haikuThinkingCompatibilityError("claude-haiku-5-5", thinking)).toBeUndefined()
    }
  })
  it("does not apply a new-model restriction to legacy pins or unrelated models", () => {
    for (const model of [undefined, "claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-5-5", "claude-haiku-future"]) {
      expect(haikuThinkingCompatibilityError(model, { type: "disabled" })).toBeUndefined()
      expect(haikuThinkingCompatibilityError(model, { type: "adaptive", display: "omitted" })).toBeUndefined()
    }
  })
})
