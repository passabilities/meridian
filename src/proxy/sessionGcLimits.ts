/**
 * Default session GC limits, which follow from the session turn's hold.
 *
 * Leaf module: pure, no I/O, no imports from server.ts or session/.
 */

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
 * this bound over the grace caps how many the GC can retire a minute. A fixed
 * 256 over the default 11-minute grace let about 23 a minute through: above 16
 * deletions a minute, but under 64. Sized to hold three graces of deletions at
 * the full rate, so the deletion rate decides whatever the hold, and never
 * under the 256 it was. An interval of 0 (no periodic sweep) counts as one a
 * minute.
 */
export function defaultSessionGcMaxPending(retiredGraceMs: number, maxDeletesPerRun: number, intervalMs: number): number {
  const runsPerGrace = retiredGraceMs / (intervalMs > 0 ? intervalMs : 60_000)
  return Math.max(SESSION_GC_MAX_PENDING_FLOOR, Math.ceil(maxDeletesPerRun * runsPerGrace) * SESSION_GC_BACKLOG_GRACES)
}
