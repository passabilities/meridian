import { describe, expect, it } from "bun:test"
import { DEFAULT_UPSTREAM_TOOL_INPUT_IDLE_MS, defaultSessionTurnMaxHoldMs, resolveSessionTurnMaxHoldMs } from "../proxy/turnLimits"

describe("turn limits", () => {
  it("gives a tool call being written fifteen minutes of a stream with nothing but pings", () => {
    expect(DEFAULT_UPSTREAM_TOOL_INPUT_IDLE_MS).toBe(900_000)
  })

  it("holds the session turn past the tool-input window, with five minutes for the rest of the turn", () => {
    expect(defaultSessionTurnMaxHoldMs(DEFAULT_UPSTREAM_TOOL_INPUT_IDLE_MS)).toBe(1_200_000)
  })

  it("keeps the ten-minute hold for a window that fits inside it", () => {
    expect(defaultSessionTurnMaxHoldMs(300_000)).toBe(600_000)
    expect(defaultSessionTurnMaxHoldMs(0)).toBe(600_000)
  })

  it("resolves the hold from the settings: its own first, else derived from the window's", () => {
    const settings = (values: Record<string, number>) => (name: string, fallback: number) => values[name] ?? fallback
    expect(resolveSessionTurnMaxHoldMs(settings({}))).toBe(1_200_000)
    expect(resolveSessionTurnMaxHoldMs(settings({ UPSTREAM_TOOL_INPUT_IDLE_MS: 1_200_000 }))).toBe(1_500_000)
    expect(resolveSessionTurnMaxHoldMs(settings({ SESSION_TURN_MAX_HOLD_MS: 2_000, UPSTREAM_TOOL_INPUT_IDLE_MS: 1_200_000 }))).toBe(2_000)
  })
})
