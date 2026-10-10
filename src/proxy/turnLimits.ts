/**
 * Default limits on how long one turn may run, kept together because each
 * must sit above the one before it, and the session GC limits that follow
 * from them.
 *
 * Leaf module: no I/O, no imports from server.ts or session/.
 */

/**
 * How long a turn may go on receiving nothing but pings while a tool call's
 * input is being written (`MERIDIAN_UPSTREAM_TOOL_INPUT_IDLE_MS`).
 *
 * The model API can send nothing else for the whole of one long parameter: a
 * file for Write, a subagent's report. Live, 2026-10-08/09: at five minutes,
 * five Fable subagents had the same Write cut off at 300 s again and again,
 * about 43 times over three and a half hours, each attempt a replayed
 * conversation. Fifteen minutes is the owner's setting.
 */
export const DEFAULT_UPSTREAM_TOOL_INPUT_IDLE_MS = 900_000

/** The session turn hold before the tool-input window outgrew it. */
const SESSION_TURN_HOLD_FLOOR_MS = 600_000

/** What a turn may spend before its tool call opens: thinking, text, other calls. */
const REST_OF_TURN_MS = 300_000

/**
 * Default ceiling on how long one turn may hold its session lease
 * (`MERIDIAN_SESSION_TURN_MAX_HOLD_MS`).
 *
 * The turn watchdog aborts a turn at this ceiling. Below the tool-input window
 * it would cut the call the window lets run; so it stays above the window by
 * the rest of a turn, and never below the ten minutes it was before.
 */
export function defaultSessionTurnMaxHoldMs(toolInputIdleMs: number): number {
  return Math.max(SESSION_TURN_HOLD_FLOOR_MS, toolInputIdleMs + REST_OF_TURN_MS)
}

/**
 * The session turn's hold as configured: its own setting, else derived from
 * the tool-input window's. `setting` reads one by its name after `MERIDIAN_`
 * (`envInt`). The SDK child's stream watchdog is given the same.
 */
export function resolveSessionTurnMaxHoldMs(setting: (name: string, fallback: number) => number): number {
  return setting("SESSION_TURN_MAX_HOLD_MS",
    defaultSessionTurnMaxHoldMs(setting("UPSTREAM_TOOL_INPUT_IDLE_MS", DEFAULT_UPSTREAM_TOOL_INPUT_IDLE_MS)))
}

/**
 * How many transcripts one session GC run may delete
 * (`MERIDIAN_SESSION_GC_MAX_DELETES`).
 *
 * Every turn runs on a fork of its conversation's SDK session, so every turn
 * leaves a transcript for the GC to delete. Live, 2026-10-09, parallel runs
 * left 1,100-1,700 an hour; at 16 a run, once a minute, the GC could delete
 * 960.
 */
export const DEFAULT_SESSION_GC_MAX_DELETES = 64

/** The deletion backlog's bound before it followed the grace. */
const SESSION_GC_MAX_PENDING_FLOOR = 256

/** Graces of deletions the backlog holds; the rest of one is room for a burst. */
const SESSION_GC_BACKLOG_GRACES = 3

/**
 * Default bound on transcripts retired and waiting to be deleted
 * (`MERIDIAN_SESSION_GC_MAX_PENDING`).
 *
 * A retired transcript waits out the grace (`MERIDIAN_SESSION_GC_GRACE_MS`, by
 * default the session turn's hold and a minute) before it can be deleted, so
 * this bound over the grace caps how many the GC can retire a minute. At 256
 * and a 21-minute grace that was about 12 a minute, under the deletion rate and
 * far under what parallel runs left: orphaned transcripts stayed live until
 * they filled the ownership ceiling, and every request that needed a new one
 * was refused (2026-10-09 from 21:00). Sized to hold three graces of deletions
 * at the full rate, so the deletion rate decides whatever the hold, and never
 * under the 256 it was. An interval of 0 (no periodic sweep) counts as one a
 * minute.
 */
export function defaultSessionGcMaxPending(retiredGraceMs: number, maxDeletesPerRun: number, intervalMs: number): number {
  const runsPerGrace = retiredGraceMs / (intervalMs > 0 ? intervalMs : 60_000)
  return Math.max(SESSION_GC_MAX_PENDING_FLOOR, Math.ceil(maxDeletesPerRun * runsPerGrace) * SESSION_GC_BACKLOG_GRACES)
}
