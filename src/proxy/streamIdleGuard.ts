/**
 * Upstream-idle guard for proxied model streams.
 *
 * Wraps the provider SDK's streaming async iterable and enforces a maximum gap
 * between *real* upstream messages. If the source goes silent for longer than
 * `idleMs` — before the first chunk (slow TTFB) or mid-stream — the guard
 * aborts iteration and throws `UpstreamIdleError`. SDK `stream_event/ping`
 * messages are discarded: they prove transport liveness, not model progress.
 *
 * Why this is needed: the proxy emits downstream SSE heartbeats (`: ping`) on a
 * fixed interval, which resets the *client's* (pi's) byte-level idle timer. A
 * stalled upstream is therefore invisible to the client and would wedge the
 * turn forever. This guard is the authoritative upstream-liveness check.
 *
 * COORDINATION CONTRACT (Pylon Orchestrator): this guard owns *model-stream*
 * liveness. Pylon's runtime stall watchdog is only a BACKSTOP for the
 * model-wait gap with no tool in flight, and keeps its abort threshold above
 * this guard's idle limit so the two layers never race to abort the same hung
 * model. The limit is `MERIDIAN_UPSTREAM_IDLE_MS` (default 90s, set in
 * server.ts); Pylon warns at 120s and aborts at 180s. Any override must stay
 * BELOW Pylon's STALL_ABORT_MS; raising it past 180s requires changing Pylon
 * first.
 * Note `MERIDIAN_IDLE_TIMEOUT_SECONDS` is a different knob — the HTTP
 * keep-alive timeout — and has no bearing on this contract. See
 * pylon-orchestrator/docs/circuit/specs/stall-watchdog-tool-exempt.md.
 */
export class UpstreamIdleError extends Error {
  readonly idleMs: number
  readonly sinceLastMs: number
  constructor(idleMs: number, sinceLastMs: number) {
    super(`upstream idle for ${sinceLastMs}ms (limit ${idleMs}ms)`)
    this.name = "UpstreamIdleError"
    this.idleMs = idleMs
    this.sinceLastMs = sinceLastMs
  }
}

/**
 * The idle limit one request runs under.
 *
 * `idleMs` has to outlast the longest pause of a deep agentic turn. A side
 * call (`AgentAdapter.isAuxiliaryRequest`) has no such pause: it answers in
 * seconds or, when the model API holds the request, not at all, and the
 * conversation waits on it either way. So it gets `auxiliaryIdleMs` when that
 * is the shorter of the two. Zero or less means no separate limit. Taking the
 * shorter also keeps a guard that is off (`idleMs` of zero or less) off for
 * side calls.
 */
export function upstreamIdleLimitMs(auxiliary: boolean, idleMs: number, auxiliaryIdleMs: number): number {
  if (!auxiliary || auxiliaryIdleMs <= 0) return idleMs
  return Math.min(idleMs, auxiliaryIdleMs)
}

/** Opaque handle returned by a clock's timer scheduler. */
type IdleTimerHandle = ReturnType<typeof setTimeout> | number

/**
 * Time source the guard depends on. Injectable so tests can drive idle
 * detection deterministically instead of racing the real wall clock. Defaults
 * to the platform clock in production.
 */
export interface IdleGuardClock {
  now(): number
  setTimeout(fn: () => void, ms: number): IdleTimerHandle
  clearTimeout(handle: IdleTimerHandle): void
}

const realClock: IdleGuardClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
}

function isSdkStreamPing(value: unknown): boolean {
  return typeof value === "object" && value !== null
    && "type" in value && value.type === "stream_event"
    && "event" in value && typeof value.event === "object" && value.event !== null
    && "type" in value.event && value.event.type === "ping"
}

/**
 * How far past its deadline the idle timer may fire before the guard treats
 * the lateness as a blocked event loop rather than ordinary timer jitter.
 *
 * A late timer suggests delayed callbacks, for example from a synchronous
 * fsync or a long CPU burst on the main thread. While the loop is
 * blocked the upstream keeps sending, and its bytes wait in the socket or
 * pipe. When the loop resumes, expired timers run before the I/O poll that
 * would deliver those bytes, so without this check a live stream is rejected
 * as silent. The two-second threshold excludes ordinary short timer jitter;
 * it is not proof of a particular cause. Crossing it adds only a bounded I/O
 * opportunity, without extending the idle window or accepting transport pings.
 */
export const IDLE_DEADLINE_LATE_MS = 2_000

/** Reported when the idle timer fired more than IDLE_DEADLINE_LATE_MS late. */
export interface LateIdleDeadline {
  /** How long after its deadline the timer actually ran. */
  lateMs: number
  /** Time since the last upstream message, measured when the timer ran. */
  sinceLastMs: number
  /** True if model progress or completion turned up after yielding to I/O. */
  resumed: boolean
}

const IDLE = Symbol("idle")

// Give socket/pipe processing an opportunity on supported Node/Bun runtimes.
// A single immediate can resume before I/O under Bun; the independent-process
// socket probe exercises the two-immediate ordering on both runtimes.
function yieldToIo(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)))
}

/**
 * `waitingOnUpstreamSince`, when given, says when the source last began
 * waiting on upstream, or undefined while it waits on something else (an SDK
 * slot): that wait asks the model nothing, so no window runs through it, and
 * the window runs from when the source began waiting on upstream if that is
 * later than its last message.
 */
export async function* guardUpstreamIdle<T>(
  source: AsyncIterable<T>,
  idleMs: number,
  onStall?: (sinceLastMs: number) => void,
  clock: IdleGuardClock = realClock,
  onLateDeadline?: (late: LateIdleDeadline) => void,
  waitingOnUpstreamSince?: () => number | undefined,
): AsyncGenerator<T> {
  if (idleMs <= 0) {
    yield* source
    return
  }
  const it = source[Symbol.asyncIterator]()
  let lastAt = clock.now()
  /** Where the idle window starts; undefined while none runs. */
  const windowStart = (): number | undefined => {
    if (!waitingOnUpstreamSince) return lastAt
    const since = waitingOnUpstreamSince()
    return since === undefined ? undefined : Math.max(lastAt, since)
  }
  try {
    while (true) {
      // Start the next pull and swallow any late rejection if we abandon it
      // via the idle deadline (prevents an unhandled-rejection on teardown).
      const nextP = it.next()
      nextP.catch(() => {})

      let deadlineAt = 0
      let res: IteratorResult<T> | typeof IDLE
      while (true) {
        let timer: IdleTimerHandle | undefined
        const idle = new Promise<typeof IDLE>((resolve) => {
          const remaining = Math.max(0, idleMs - (clock.now() - (windowStart() ?? clock.now())))
          deadlineAt = clock.now() + remaining
          timer = clock.setTimeout(() => resolve(IDLE), remaining)
        })
        try {
          res = await Promise.race([nextP, idle])
        } finally {
          if (timer !== undefined) clock.clearTimeout(timer)
        }
        if (res !== IDLE || !waitingOnUpstreamSince) break
        // The window moved while this timer ran: the source was waiting on
        // something else, or began waiting on upstream since it was set.
        const start = windowStart()
        if (start !== undefined && clock.now() - start >= idleMs) break
      }
      if (res === IDLE) {
        const sinceLastMs = clock.now() - (windowStart() ?? lastAt)
        const lateMs = clock.now() - deadlineAt
        if (lateMs > IDLE_DEADLINE_LATE_MS) {
          // The loop was blocked, so upstream data may be waiting behind this
          // timer. Poll I/O once, then check the stream again.
          await yieldToIo()
          res = await Promise.race([nextP, Promise.resolve(IDLE)])
          try {
            onLateDeadline?.({ lateMs, sinceLastMs, resumed: res !== IDLE && (res.done || !isSdkStreamPing(res.value)) })
          } catch {
            // Observer errors must not change the guard's verdict.
          }
        }
        if (res === IDLE) {
          try {
            onStall?.(sinceLastMs)
          } catch {
            // Observer errors must not prevent rejecting the guarded iterator.
          }
          throw new UpstreamIdleError(idleMs, sinceLastMs)
        }
      }
      if (res.done) return
      if (isSdkStreamPing(res.value)) continue
      lastAt = clock.now()
      yield res.value
    }
  } finally {
    // Runs on normal completion, stall throw, AND consumer break — ask the
    // upstream iterator to tear down without hanging on a stalled pull.
    const returnP = it.return?.(undefined as never)
    returnP?.catch(() => {})
  }
}
