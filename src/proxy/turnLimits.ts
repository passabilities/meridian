/**
 * Default limits on how long one turn may run, kept together because each
 * must sit above the one before it.
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
