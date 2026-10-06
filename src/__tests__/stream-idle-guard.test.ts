import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"

const { guardUpstreamIdle, UpstreamIdleError, IDLE_DEADLINE_LATE_MS, upstreamIdleLimitMs } = await import("../proxy/streamIdleGuard")
import type { IdleGuardClock, LateIdleDeadline } from "../proxy/streamIdleGuard"

type IdleTimerHandle = ReturnType<typeof setTimeout> | number

// A fully controllable clock for the guard: timers never fire on their own, so
// real upstream chunks always win their race against the idle deadline. The
// test fires the idle timer explicitly via advance(), making stall detection
// deterministic instead of racing the wall clock.
function makeFakeClock() {
  let current = 0
  let nextId = 1
  let scheduledTotal = 0
  const pending = new Map<IdleTimerHandle, { fireAt: number; fn: () => void }>()
  const waiters: Array<{ n: number; resolve: () => void }> = []

  const clock: IdleGuardClock = {
    now: () => current,
    setTimeout(fn, ms) {
      const id = nextId++
      pending.set(id, { fireAt: current + ms, fn })
      scheduledTotal++
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (scheduledTotal >= waiters[i]!.n) { waiters[i]!.resolve(); waiters.splice(i, 1) }
      }
      return id
    },
    clearTimeout(handle) { pending.delete(handle) },
  }

  return {
    clock,
    /** Resolves once at least `n` timers have been scheduled in total. */
    waitForScheduled(n: number): Promise<void> {
      if (scheduledTotal >= n) return Promise.resolve()
      return new Promise<void>((resolve) => { waiters.push({ n, resolve }) })
    },
    /** Advance time by `ms`, firing every timer whose deadline has passed. */
    advance(ms: number) {
      current += ms
      for (const [id, t] of [...pending]) {
        if (t.fireAt <= current) { pending.delete(id); t.fn() }
      }
    },
  }
}

// A controllable async iterable: push() emits a value, stall() just waits.
function makeSource<T>() {
  const queue: T[] = []
  let resolveNext: (() => void) | null = null
  let done = false
  const wake = () => { if (resolveNext) { const r = resolveNext; resolveNext = null; r() } }
  return {
    push(v: T) { queue.push(v); wake() },
    finish() { done = true; wake() },
    iterable: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          if (queue.length) { yield queue.shift() as T; continue }
          if (done) return
          await new Promise<void>((r) => { resolveNext = r })
        }
      },
    } as AsyncIterable<T>,
  }
}

describe("guardUpstreamIdle", () => {
  it("passes through messages while the source is active", async () => {
    const src = makeSource<number>()
    const out: number[] = []
    const p = (async () => { for await (const v of guardUpstreamIdle(src.iterable, 500)) out.push(v) })()
    src.push(1); await new Promise((r) => setTimeout(r, 5))
    src.push(2); await new Promise((r) => setTimeout(r, 5))
    src.finish()
    await p
    expect(out).toEqual([1, 2])
  })

  it("throws UpstreamIdleError when the source goes silent even if onStall throws", async () => {
    const src = makeSource<number>()
    const stalls: number[] = []
    const clock = makeFakeClock()
    const p = (async () => { for await (const _ of guardUpstreamIdle(src.iterable, 30, (ms) => { stalls.push(ms); throw new Error("observer failed") }, clock.clock)) { /* drain */ } })()
    src.push(1) // one real chunk, then silence
    // Chunk 1 is delivered (its idle timer is cleared) and a fresh idle timer
    // is armed for the silent gap — the second scheduled timer. Fire it.
    await clock.waitForScheduled(2)
    clock.advance(30)
    let err: unknown
    try { await p } catch (e) { err = e }
    expect(err).toBeInstanceOf(UpstreamIdleError)
    expect(stalls.length).toBe(1)
    expect((err as InstanceType<typeof UpstreamIdleError>).sinceLastMs).toBeGreaterThanOrEqual(30)
  })

  it("trips even before the first chunk (slow TTFB)", async () => {
    const src = makeSource<number>() // never push
    let err: unknown
    try { for await (const _ of guardUpstreamIdle(src.iterable, 20)) { /* none */ } } catch (e) { err = e }
    expect(err).toBeInstanceOf(UpstreamIdleError)
  })

  it("calls return on the source iterator after an idle stall", async () => {
    let returned = false
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<number>>(() => {}),
          return: () => {
            returned = true
            return Promise.resolve({ done: true, value: undefined })
          },
        }
      },
    }

    let err: unknown
    try { for await (const _ of guardUpstreamIdle(source, 20)) { /* none */ } } catch (e) { err = e }
    expect(err).toBeInstanceOf(UpstreamIdleError)
    expect(returned).toBe(true)
  })

  it("does not let SDK stream pings extend the idle deadline", async () => {
    const src = makeSource<{ type: string; event?: { type: string } }>()
    const clock = makeFakeClock()
    const stalls: number[] = []
    const output: unknown[] = []
    let error: unknown
    const pending = (async () => {
      for await (const message of guardUpstreamIdle(src.iterable, 90, ms => stalls.push(ms), clock.clock)) output.push(message)
    })().catch(caught => { error = caught })
    try {
      await clock.waitForScheduled(1)
      for (let i = 0; i < 2; i++) {
        clock.advance(30)
        src.push({ type: "stream_event", event: { type: "ping" } })
        await clock.waitForScheduled(i + 2)
      }
      clock.advance(30)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(error).toBeInstanceOf(UpstreamIdleError)
      expect(stalls).toEqual([90])
      expect(output).toEqual([])
    } finally {
      src.finish()
      await pending
    }
  })

  it("runs no limit while the source waits for something other than upstream, and the whole limit from when it starts", async () => {
    const src = makeSource<number>()
    const clock = makeFakeClock()
    // Undefined while the source waits for a slot; then when it began waiting on upstream.
    let waitingOnUpstreamSince: number | undefined
    const stalls: number[] = []
    let error: unknown
    const pending = (async () => {
      for await (const _ of guardUpstreamIdle(src.iterable, 90, ms => stalls.push(ms), clock.clock, undefined, () => waitingOnUpstreamSince)) { /* drain */ }
    })().catch(caught => { error = caught })
    try {
      for (let timers = 1; timers <= 3; timers++) {
        await clock.waitForScheduled(timers)
        clock.advance(90)
      }
      await clock.waitForScheduled(4)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(error).toBeUndefined()

      waitingOnUpstreamSince = clock.clock.now()
      clock.advance(60)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(error).toBeUndefined()
      clock.advance(30)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(error).toBeInstanceOf(UpstreamIdleError)
      expect(stalls).toEqual([90])
    } finally {
      src.finish()
      await pending
    }
  })

  it("resets the deadline for model progress between pings", async () => {
    const src = makeSource<{ type: string; event: { type: string } }>()
    const clock = makeFakeClock()
    const content = { type: "stream_event", event: { type: "content_block_delta" } }
    const output: unknown[] = []
    let error: unknown
    const pending = (async () => {
      for await (const message of guardUpstreamIdle(src.iterable, 90, undefined, clock.clock)) output.push(message)
    })().catch(caught => { error = caught })
    try {
      await clock.waitForScheduled(1)
      clock.advance(60)
      src.push(content)
      await clock.waitForScheduled(2)
      clock.advance(60)
      src.push({ type: "stream_event", event: { type: "ping" } })
      await clock.waitForScheduled(3)
      expect(error).toBeUndefined()
      clock.advance(30)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(error).toBeInstanceOf(UpstreamIdleError)
      expect(output).toEqual([content])
    } finally {
      src.finish()
      await pending
    }
  })

  it("passes nested pings through when disabled and preserves other event shapes", async () => {
    const ping = { type: "stream_event", event: { type: "ping" } }
    const ordinary = [null, { type: "ping" }, { type: "keep_alive" },
      { type: "stream_event", event: null }, { type: "stream_event", event: { type: "message_start" } }]
    async function* source(values: unknown[]) { yield* values }
    const disabled: unknown[] = []
    for await (const event of guardUpstreamIdle(source([ping, ...ordinary]), 0)) disabled.push(event)
    expect(disabled).toEqual([ping, ...ordinary])
    const enabled: unknown[] = []
    for await (const event of guardUpstreamIdle(source([ping, ...ordinary]), 500)) enabled.push(event)
    expect(enabled).toEqual(ordinary)
  })

  // A blocked event loop (a synchronous fsync, say) makes the idle timer fire
  // late. The upstream kept sending meanwhile, but when the loop resumes the
  // expired timer runs before the I/O poll that delivers the waiting bytes.
  // setImmediate(push) models those bytes: they are delivered on the next
  // event-loop turn, after the timer callback.
  function runGuarded(idleMs: number, clock: ReturnType<typeof makeFakeClock>, src: ReturnType<typeof makeSource<number>>) {
    const out: number[] = []
    const stalls: number[] = []
    const lates: LateIdleDeadline[] = []
    const done = (async () => {
      for await (const v of guardUpstreamIdle(src.iterable, idleMs, (ms) => stalls.push(ms), clock.clock, (late) => lates.push(late))) out.push(v)
    })()
    return { out, stalls, lates, done }
  }

  it("a late deadline with upstream data waiting behind it does not stall", async () => {
    const src = makeSource<number>()
    const clock = makeFakeClock()
    const run = runGuarded(90_000, clock, src)
    await clock.waitForScheduled(1)
    setImmediate(() => src.push(1))
    clock.advance(105_131)
    // Chunk 1 reached the consumer and a fresh deadline was armed for the next.
    await clock.waitForScheduled(2)
    src.finish()
    await run.done
    expect(run.out).toEqual([1])
    expect(run.stalls).toEqual([])
    expect(run.lates).toEqual([{ lateMs: 15_131, sinceLastMs: 105_131, resumed: true }])
  })

  it("a late deadline on a silent stream still stalls", async () => {
    const src = makeSource<number>()
    const clock = makeFakeClock()
    const run = runGuarded(90_000, clock, src)
    await clock.waitForScheduled(1)
    clock.advance(105_131)
    let err: unknown
    try { await run.done } catch (e) { err = e }
    expect(err).toBeInstanceOf(UpstreamIdleError)
    expect((err as InstanceType<typeof UpstreamIdleError>).sinceLastMs).toBe(105_131)
    expect(run.stalls).toEqual([105_131])
    expect(run.lates).toEqual([{ lateMs: 15_131, sinceLastMs: 105_131, resumed: false }])
  })

  it("a late deadline permits queued completion even when its observer throws", async () => {
    const src = makeSource<number>()
    const clock = makeFakeClock()
    const stalls: number[] = []
    let observed = false
    const done = (async () => {
      for await (const _ of guardUpstreamIdle(src.iterable, 90_000, ms => stalls.push(ms), clock.clock, late => {
        observed = late.resumed
        throw new Error("late observer failed")
      })) { throw new Error("completion must not produce a value") }
    })()
    await clock.waitForScheduled(1)
    setImmediate(() => src.finish())
    clock.advance(105_131)
    await done
    expect(observed).toBe(true)
    expect(stalls).toEqual([])
  })

  it("an on-time deadline stalls at once, without yielding for queued data", async () => {
    const src = makeSource<number>()
    const clock = makeFakeClock()
    const run = runGuarded(90_000, clock, src)
    await clock.waitForScheduled(1)
    setImmediate(() => src.push(1))
    clock.advance(90_000 + IDLE_DEADLINE_LATE_MS)
    let err: unknown
    try { await run.done } catch (e) { err = e }
    expect(err).toBeInstanceOf(UpstreamIdleError)
    expect((err as InstanceType<typeof UpstreamIdleError>).sinceLastMs).toBe(90_000 + IDLE_DEADLINE_LATE_MS)
    expect(run.out).toEqual([])
    expect(run.stalls).toEqual([90_000 + IDLE_DEADLINE_LATE_MS])
    expect(run.lates).toEqual([])
  })

  it("independent upstream progress survives a frozen consumer on real sockets", async () => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../scripts/e2e-late-idle-sockets.mjs")], {
      cwd: resolve(import.meta.dir, "../.."),
      env: { ...process.env, E2E_IDLE_GUARD_MODULE: resolve(import.meta.dir, "../proxy/streamIdleGuard.ts") },
      stdout: "pipe", stderr: "pipe",
    })
    const timeout = setTimeout(() => child.kill(), 20_000)
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ])
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
      const rows = stdout.trim().split("\n").map(line => JSON.parse(line))
      expect(rows.at(-1).result).toBe("PASS")
      expect(rows.at(-1).independentUpstream).toBe(true)
      expect(rows[0].count).toBe(12)
      expect(rows[0].late[0].resumed).toBe(true)
      expect(rows[2].mode).toBe("ping")
      expect(rows[2].errorName).toBe("UpstreamIdleError")
      expect(rows[2].late[0].resumed).toBe(false)
    } finally { clearTimeout(timeout) }
  }, 25_000)

  it("idleMs<=0 disables the guard (pure pass-through)", async () => {
    const src = makeSource<number>()
    const out: number[] = []
    const p = (async () => { for await (const v of guardUpstreamIdle(src.iterable, 0)) out.push(v) })()
    src.push(7); src.finish()
    await p
    expect(out).toEqual([7])
  })
})

describe("upstreamIdleLimitMs", () => {
  it("leaves a turn the full limit", () => {
    expect(upstreamIdleLimitMs(false, 90_000, 30_000)).toBe(90_000)
  })

  it("gives a side call the shorter one", () => {
    expect(upstreamIdleLimitMs(true, 90_000, 30_000)).toBe(30_000)
  })

  it("never lets a side call wait longer than a turn would", () => {
    expect(upstreamIdleLimitMs(true, 20_000, 30_000)).toBe(20_000)
  })

  it("has no separate side-call limit at 0", () => {
    expect(upstreamIdleLimitMs(true, 90_000, 0)).toBe(90_000)
    expect(upstreamIdleLimitMs(true, 90_000, -1)).toBe(90_000)
  })

  it("stays off for side calls too when the guard itself is off", () => {
    expect(upstreamIdleLimitMs(true, 0, 30_000)).toBe(0)
    expect(upstreamIdleLimitMs(false, 0, 30_000)).toBe(0)
  })
})
