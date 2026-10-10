import { describe, expect, it } from "bun:test"
import {
  DEFAULT_SESSION_GC_MAX_DELETES,
  DEFAULT_UPSTREAM_TOOL_INPUT_IDLE_MS,
  defaultSessionGcMaxPending,
  defaultSessionTurnMaxHoldMs,
  resolveSessionTurnMaxHoldMs,
} from "../proxy/turnLimits"

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

describe("session GC limits", () => {
  it("deletes up to 64 transcripts a run", () => {
    expect(DEFAULT_SESSION_GC_MAX_DELETES).toBe(64)
  })

  it("sizes the deletion backlog to three graces of deletions at the full rate", () => {
    // The default grace is the 20-minute turn hold and a minute: 64 a minute
    // for 21 minutes, three times over.
    expect(defaultSessionGcMaxPending(1_260_000, 64, 60_000)).toBe(4_032)
    // Runs twice as often delete twice as fast.
    expect(defaultSessionGcMaxPending(1_260_000, 64, 30_000)).toBe(8_064)
  })

  it("follows the grace, so a longer turn hold cannot slow cleanup", () => {
    expect(defaultSessionGcMaxPending(660_000, 64, 60_000)).toBe(2_112)
    expect(defaultSessionGcMaxPending(1_860_000, 64, 60_000)).toBe(5_952)
  })

  it("never goes under the 256 it was, and reads a disabled sweep as once a minute", () => {
    expect(defaultSessionGcMaxPending(0, 64, 60_000)).toBe(256)
    expect(defaultSessionGcMaxPending(1_260_000, 64, 0)).toBe(4_032)
  })
})
