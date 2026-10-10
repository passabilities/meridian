import { describe, expect, it } from "bun:test"
import { DEFAULT_SESSION_GC_MAX_DELETES, defaultSessionGcMaxPending } from "../proxy/sessionGcLimits"

describe("session GC limits", () => {
  it("deletes up to 64 transcripts a run", () => {
    expect(DEFAULT_SESSION_GC_MAX_DELETES).toBe(64)
  })

  it("sizes the deletion backlog to three graces of deletions at the full rate", () => {
    // The default grace is the 10-minute turn hold and a minute: 64 a minute
    // for 11 minutes, three times over.
    expect(defaultSessionGcMaxPending(660_000, 64, 60_000)).toBe(2_112)
    // Runs twice as often delete twice as fast.
    expect(defaultSessionGcMaxPending(660_000, 64, 30_000)).toBe(4_224)
  })

  it("follows the grace, so a longer turn hold cannot slow cleanup", () => {
    expect(defaultSessionGcMaxPending(360_000, 64, 60_000)).toBe(1_152)
    expect(defaultSessionGcMaxPending(1_860_000, 64, 60_000)).toBe(5_952)
  })

  it("never goes under the 256 it was, and reads a disabled sweep as once a minute", () => {
    expect(defaultSessionGcMaxPending(0, 64, 60_000)).toBe(256)
    expect(defaultSessionGcMaxPending(660_000, 64, 0)).toBe(2_112)
  })
})
