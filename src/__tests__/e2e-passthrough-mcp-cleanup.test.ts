import { afterEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OwnedFixtureProcesses, within, withFixtureEnvironment, scanMcpFailureLogs, removeJoinedSandbox, closeFixtureQuery, consumeFixtureQuery, assertFixtureQueryOutcomes, freezeFixtureCatalog, assertCapturedFixtureCatalog } from "../../scripts/lib-passthrough-mcp-fixture.mjs"

describe("passthrough SDK fixture cleanup custody", () => {
  const roots: string[] = []
  const owned: OwnedFixtureProcesses[] = []
  afterEach(async () => {
    for (const processes of owned.splice(0)) expect(await processes.closeAndJoin(100, 3_000)).toBe(true)
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  })
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "meridian fixture cleanup "))
    roots.push(root)
    const processes = new OwnedFixtureProcesses()
    owned.push(processes)
    return { root, processes }
  }
  function start(processes: OwnedFixtureProcesses, root: string, program: string, signal = new AbortController().signal) {
    return processes.spawnClaudeCodeProcess({ command: process.execPath, args: ["-e", program], cwd: root, env: { PATH: process.env.PATH }, signal })
  }
  async function ready(child: ReturnType<typeof start>) {
    const seen = new Promise<void>(resolve => child.stdout?.once("data", () => resolve()))
    expect((await within(seen, 3_000)).completed).toBe(true)
  }
  function queryState(sdkQuery: AsyncIterable<{ type: string; subtype: string }> & { close(): void }) {
    const state: {
      turn: string; sdkQuery: typeof sdkQuery; init: unknown; result: string | null; error: string | null;
      closeError: string | null; intentionalCancellation: boolean; settled: boolean; abortController: AbortController;
    } = { turn: "first", sdkQuery, init: null, result: null, error: null, closeError: null, intentionalCancellation: false, settled: false, abortController: new AbortController() }
    return state
  }

  it("joins normal exit and seals admission before removing a sandbox with spaces", async () => {
    const { root, processes } = await fixture()
    start(processes, root, "process.stdout.write('done')")
    expect((await within(processes.children[0]!.done, 3_000)).completed).toBe(true)
    expect(await processes.closeAndJoin()).toBe(true)
    expect(processes.summary()[0]!.exitCode).toBe(0)
    expect(() => start(processes, root, "process.exit(0)")).toThrow("admission is closed")
    expect(await removeJoinedSandbox(root, { childrenJoined: true, iteratorsJoined: true, listenerClosed: true })).toBe(true)
    expect(existsSync(root)).toBe(false)
  })

  it("joins a spawn error before any model request", async () => {
    const { root, processes } = await fixture()
    processes.spawnClaudeCodeProcess({ command: join(root, "absent native CLI"), args: [], cwd: root, env: {}, signal: new AbortController().signal })
    expect(await processes.closeAndJoin(100, 3_000)).toBe(true)
    expect(processes.summary()[0]!.closed).toBe(true)
    expect(processes.summary()[0]!.spawnError).toBe("ENOENT")
  })

  it("joins a stalled initialization before allowing deletion", async () => {
    const { root, processes } = await fixture()
    const child = start(processes, root, "process.stdout.write('ready');process.stdin.resume();setInterval(()=>{},1000)")
    await ready(child)
    expect(await processes.closeAndJoin(100, 3_000)).toBe(true)
    expect(processes.summary()[0]!.closed).toBe(true)
  })

  it("owns explicit cancellation and does not treat a sent signal as exit", async () => {
    const { root, processes } = await fixture()
    const controller = new AbortController()
    const child = start(processes, root, "process.stdout.write('ready');process.stdin.resume();setInterval(()=>{},1000)", controller.signal)
    await ready(child)
    controller.abort()
    expect(processes.summary()[0]!.signals).toContain("SIGTERM")
    expect(await processes.closeAndJoin(100, 3_000)).toBe(true)
    expect(processes.summary()[0]!.closed).toBe(true)
  })

  it("escalates an uncooperative writer and observes close before deletion", async () => {
    const { root, processes } = await fixture()
    const child = start(processes, root, "const fs=require('node:fs');process.on('SIGTERM',()=>{});process.stdin.resume();process.stdout.write('ready');setInterval(()=>fs.appendFileSync('heartbeat','x'),10)")
    await ready(child)
    await Bun.sleep(40)
    expect((await readFile(join(root, "heartbeat"), "utf8")).length).toBeGreaterThan(0)
    expect(await processes.closeAndJoin(100, 3_000)).toBe(true)
    expect(processes.summary()[0]!.signals).toContain("SIGKILL")
    expect(processes.summary()[0]!.closed).toBe(true)
    expect(await removeJoinedSandbox(root, { childrenJoined: true, iteratorsJoined: true, listenerClosed: true })).toBe(true)
    await Bun.sleep(40)
    expect(existsSync(root)).toBe(false)
  })

  it("retains the sandbox for any unjoined resource", async () => {
    const { root } = await fixture()
    for (const missing of ["childrenJoined", "iteratorsJoined", "listenerClosed"] as const) {
      const status = { childrenJoined: true, iteratorsJoined: true, listenerClosed: true, [missing]: false }
      expect(await removeJoinedSandbox(root, status)).toBe(false)
      expect(existsSync(root)).toBe(true)
    }
  })

  it("restores the whole parent environment even when cleanup throws", async () => {
    const before = { ...process.env }
    await expect(withFixtureEnvironment({ FIXTURE_ONLY: "isolated" }, async () => {
      expect(process.env).toEqual({ FIXTURE_ONLY: "isolated" })
      throw new Error("cleanup failure")
    })).rejects.toThrow("cleanup failure")
    expect(process.env).toEqual(before)
  })

  it("distinguishes missing logs, verified zero, failures and incomplete diagnostics", async () => {
    const { root } = await fixture()
    expect((await scanMcpFailureLogs(root)).status).toBe("unavailable")
    const log = join(root, ".cache/mcp-logs-fixture/log.jsonl")
    await mkdir(join(root, ".cache/mcp-logs-fixture"), { recursive: true })
    await writeFile(log, '{"event":"connected"}\n')
    expect(await scanMcpFailureLogs(root)).toEqual({ status: "available", discovered: 1, read: 1, failures: 0, unreadable: 0, malformed: 0 })
    await writeFile(log, '{"error":"Failed to connect SDK MCP server"}\ninvalid\n')
    const result = await scanMcpFailureLogs(root)
    expect(result.status).toBe("incomplete")
    expect(result.failures).toBe(1)
    expect(result.malformed).toBe(1)
  })

  for (const fault of ["iterator", "close", "cleanup-close"] as const) {
    it(`rejects a successful result followed by ${fault} failure and still joins/removes resources`, async () => {
      const { root, processes } = await fixture()
      const child = start(processes, root, "process.stdout.write('ready');process.stdin.resume();setInterval(()=>{},1000)")
      await ready(child)
      const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("fixture") })
      try {
        let closes = 0
        const sdkQuery = Object.assign((async function* () {
          yield { type: "result", subtype: "success" }
          if (fault === "iterator") throw new TypeError("private iterator diagnostic must not escape")
        })(), { close() {
          closes++
          if (fault === "close" || (fault === "cleanup-close" && closes === 2)) throw new RangeError("private close diagnostic must not escape")
        } })
        const state = queryState(sdkQuery)
        const done = consumeFixtureQuery(state)
        expect((await within(done, 3_000)).completed).toBe(true)
        expect(state.result).toBe("success")
        if (fault === "cleanup-close") expect(() => assertFixtureQueryOutcomes([state])).not.toThrow()
        state.abortController.abort()
        closeFixtureQuery(state)
        const childrenJoined = await processes.closeAndJoin(100, 3_000)
        const iteratorsJoined = (await within(done, 3_000)).completed
        await listener.stop(true)
        const cleanup = { childrenJoined, iteratorsJoined, listenerClosed: true }
        expect(processes.summary().every(entry => entry.closed)).toBe(true)
        expect(() => assertFixtureQueryOutcomes([state])).toThrow(fault === "iterator" ? "query iterator failed" : "query close failed")
        expect(state.error).toBe(fault === "iterator" ? "TypeError" : null)
        expect(state.closeError).toBe(fault === "iterator" ? null : "RangeError")
        expect(await removeJoinedSandbox(root, cleanup)).toBe(true)
        expect(existsSync(root)).toBe(false)
      } finally { await listener.stop(true) }
    })
  }

  it("keeps intentional held-query cancellation distinct from success and still rejects close faults", async () => {
    const abortController = new AbortController()
    abortController.abort()
    const state = { turn: "first", result: null, error: "AbortError", closeError: null, settled: true, intentionalCancellation: true, abortController }
    expect(() => assertFixtureQueryOutcomes([state])).not.toThrow()
    expect(() => assertFixtureQueryOutcomes([{ ...state, intentionalCancellation: false }])).toThrow("first failed")
    expect(() => assertFixtureQueryOutcomes([{ ...state, result: "success" }])).toThrow("cancellation received a result")
    expect(() => assertFixtureQueryOutcomes([{ ...state, closeError: "RangeError" }])).toThrow("query close failed")
    expect(() => assertFixtureQueryOutcomes([{ ...state, abortController: new AbortController() }])).toThrow("cancellation was not requested")
  })

  it("rejects a changed tagged catalog admitted during final drain after sealing and removing resources", async () => {
    const { root, processes } = await fixture()
    const child = start(processes, root, "process.stdout.write('ready');process.stdin.resume();setInterval(()=>{},1000)")
    await ready(child)
    const tools = [{ name: "mcp__oc__bash", description: "fixture shell", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }]
    const requests: { turn: string; tools: unknown[] }[] = []
    const expected = freezeFixtureCatalog(tools, ["mcp__oc__bash"])
    expect(Object.isFrozen(expected.definitions[0].input_schema)).toBe(true)
    const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const body: unknown = await request.json()
      if (!body || typeof body !== "object" || !("turn" in body) || typeof body.turn !== "string" || !("tools" in body) || !Array.isArray(body.tools)) throw new Error("invalid controlled request")
      requests.push({ turn: body.turn, tools: body.tools })
      return Response.json({ ok: true })
    } })
    const send = (turn: string, definitions: typeof tools) => fetch(`http://127.0.0.1:${listener.port}/v1/messages`, { method: "POST", body: JSON.stringify({ turn, tools: definitions }) })
    try {
      await send("first", tools)
      expect(() => assertCapturedFixtureCatalog(requests, expected, ["first"])).not.toThrow()
      let lateRequest: Promise<Response> | undefined
      let closes = 0
      const sdkQuery = Object.assign((async function* () { yield { type: "result", subtype: "success" } })(), { close() {
        if (++closes === 2) lateRequest = send("first", [{ ...tools[0]!, description: "changed during final drain" }])
      } })
      const state = queryState(sdkQuery)
      const done = consumeFixtureQuery(state)
      expect((await within(done, 3_000)).completed).toBe(true)
      state.abortController.abort()
      closeFixtureQuery(state) // A cleanup-time admission after the earlier passing assertion.
      expect(lateRequest).toBeDefined()
      await lateRequest
      const childrenJoined = await processes.closeAndJoin(100, 3_000)
      const iteratorsJoined = (await within(done, 3_000)).completed
      await listener.stop(true)
      expect(requests).toHaveLength(2)
      expect(() => assertFixtureQueryOutcomes([state])).not.toThrow()
      expect(() => assertCapturedFixtureCatalog(requests, expected, ["first"])).toThrow("changed tool definitions")
      expect(await removeJoinedSandbox(root, { childrenJoined, iteratorsJoined, listenerClosed: true })).toBe(true)
      expect(existsSync(root)).toBe(false)
    } finally { await listener.stop(true) }
  })

  it("freezes complete expected definitions and leaves untagged traffic separately visible", () => {
    const tools = [{ name: "mcp__oc__bash", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } }]
    const expected = freezeFixtureCatalog(tools, ["mcp__oc__bash"])
    const requests = [{ turn: "first", tools: structuredClone(tools) }, { turn: "untagged", tools: [] }]
    expect(() => assertCapturedFixtureCatalog(requests, expected, ["first"])).not.toThrow()
    expect(requests.filter(request => request.turn === "untagged")).toHaveLength(1)
    tools[0]!.input_schema.required.length = 0
    expect(expected.definitions[0].input_schema.required).toEqual(["command"])
    expect(() => assertCapturedFixtureCatalog([{ turn: "first", tools }], expected, ["first"])).toThrow("changed tool definitions")
    expect(() => assertCapturedFixtureCatalog(requests, expected, ["first", "second"])).toThrow("second sent no tagged")
    expect(() => assertCapturedFixtureCatalog([...requests, { turn: "second", tools }], expected, ["first"])).toThrow("unexpected tagged")
  })
})
