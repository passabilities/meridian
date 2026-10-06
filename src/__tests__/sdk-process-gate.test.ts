import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as childProcess from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { open, type FileHandle } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join } from "node:path"
import { createSdkProcessGate, getSdkGateNodeExecutable } from "../proxy/session/sdkProcessGate"
import { captureProcessIncarnation, type ProcessIncarnation } from "../proxy/session/processIncarnation"

describe("SDK process gate", () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it("resolves the actual Node executable under an embedded Bun host", () => {
    const executable = getSdkGateNodeExecutable()
    expect(isAbsolute(executable)).toBe(true)
    if (typeof process.versions.bun === "string") {
      expect(basename(executable).toLowerCase()).toMatch(/^node(?:\.exe)?$/)
    }
  })

  it("persists the exact wrapper incarnation before opening the child command", async () => {
    const root = mkdtempSync(join(tmpdir(), "meridian-sdk-gate-"))
    roots.push(root)
    let attached: ProcessIncarnation | undefined
    const gate = await createSdkProcessGate(root, async (executor) => { attached = executor })
    expect(attached).toEqual(gate.executor)

    const child = gate.spawnClaudeCodeProcess({
      command: process.execPath,
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      env: { ...process.env },
      signal: new AbortController().signal,
    })
    const output = new Promise<string>((resolve) => {
      child.stdout.once("data", (chunk) => resolve(chunk.toString()))
    })
    child.stdin.write("gated-writer\n")
    expect(await output).toBe("gated-writer\n")
    child.stdin.end()
    expect(await gate.closeAndJoin()).toBe(true)
  })

  // Every request opens a gate. A synchronous probe of the wrapper held every
  // other request while it ran, and gave up after 2 s: on a host loaded near
  // 40, a request failed before any call with "cannot capture SDK writer
  // process incarnation" (E84).
  it("captures the wrapper's incarnation without holding the event loop", async () => {
    const root = mkdtempSync(join(tmpdir(), "meridian-sdk-gate-"))
    roots.push(root)
    // What a running proxy captured of its host at start.
    expect(captureProcessIncarnation()).toBeDefined()
    const synchronous = spyOn(childProcess, "spawnSync")
    let gate: Awaited<ReturnType<typeof createSdkProcessGate>> | undefined
    try {
      gate = await createSdkProcessGate(root, async () => undefined)
      expect(synchronous).not.toHaveBeenCalled()
    } finally {
      synchronous.mockRestore()
    }
    expect(gate.executor.pid).toBeGreaterThan(0)
    expect(await gate.closeAndJoin()).toBe(true)
  })

  it("drains large stderr output and forwards it without stalling stdout", async () => {
    const root = mkdtempSync(join(tmpdir(), "meridian-sdk-gate-"))
    roots.push(root)
    let stderrBytes = 0
    const gate = await createSdkProcessGate(root, async () => undefined, (data) => {
      stderrBytes += Buffer.byteLength(data)
    })
    const child = gate.spawnClaudeCodeProcess({
      command: process.execPath,
      args: ["-e", 'process.stderr.write("x".repeat(2 * 1024 * 1024)); process.stdout.write("done")'],
      env: { ...process.env },
      signal: new AbortController().signal,
    })
    let output = ""
    child.stdout.on("data", (chunk) => { output += chunk.toString() })
    await Promise.race([
      new Promise<void>((resolveExit, rejectExit) => {
        child.once("exit", () => resolveExit())
        child.once("error", rejectExit)
      }),
      Bun.sleep(5_000).then(() => { throw new Error("gated child stdout timed out") }),
    ])
    expect(output).toBe("done")
    expect(stderrBytes).toBe(2 * 1024 * 1024)
    expect(await gate.closeAndJoin()).toBe(true)
  })

  it("never opens the command for an already-aborted SpawnOptions signal", async () => {
    const root = mkdtempSync(join(tmpdir(), "meridian-sdk-gate-"))
    roots.push(root)
    const gate = await createSdkProcessGate(root, async () => undefined)
    const controller = new AbortController()
    controller.abort()
    expect(() => gate.spawnClaudeCodeProcess({
      command: process.execPath,
      args: ["-e", 'process.stdout.write("must-not-run")'],
      env: { ...process.env },
      signal: controller.signal,
    })).toThrow("aborted")
    expect(await gate.closeAndJoin()).toBe(true)
  })

  it("keeps serving the event loop while the gate waits for the disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "meridian-sdk-gate-"))
    roots.push(root)
    const gate = await createSdkProcessGate(root, async () => undefined)
    const disk = holdDisk()
    const restore = await replaceFileHandleSync(root, async (sync) => {
      await disk.held
      return sync()
    })
    let ticks = 0
    const heartbeat = setInterval(() => { ticks++ }, 5)
    let output = ""
    try {
      const child = gate.spawnClaudeCodeProcess({
        command: process.execPath,
        args: ["-e", 'process.stdout.write("gated")'],
        env: { ...process.env },
        signal: new AbortController().signal,
      })
      const drained = new Promise<void>((resolve) => child.stdout.once("end", () => resolve()))
      child.stdout.on("data", (chunk) => { output += chunk.toString() })
      await Bun.sleep(100)
      expect(ticks).toBeGreaterThanOrEqual(5)
      expect(output).toBe("")
      disk.release()
      await drained
    } finally {
      clearInterval(heartbeat)
      disk.release()
      restore()
    }
    expect(output).toBe("gated")
    expect(await gate.closeAndJoin()).toBe(true)
  })

  it("leaves no gate behind when an abort lands while the gate is being written", async () => {
    const root = mkdtempSync(join(tmpdir(), "meridian-sdk-gate-"))
    roots.push(root)
    const marker = join(root, "command-ran")
    const gate = await createSdkProcessGate(root, async () => undefined)
    const disk = holdDisk()
    const restore = await replaceFileHandleSync(root, async (sync) => {
      await disk.held
      return sync()
    })
    try {
      const controller = new AbortController()
      const child = gate.spawnClaudeCodeProcess({
        command: process.execPath,
        args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
        env: { ...process.env },
        signal: controller.signal,
      })
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
      controller.abort()
      await exited
      const joining = gate.closeAndJoin()
      await Bun.sleep(50)
      disk.release()
      expect(await joining).toBe(true)
    } finally {
      disk.release()
      restore()
    }
    expect(existsSync(marker)).toBe(false)
    expect(readdirSync(root).filter((name) => name.includes(".gate"))).toEqual([])
  })

  it("bounds join while publication is stuck and removes its late sensitive gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "meridian-sdk-gate-"))
    roots.push(root)
    const marker = join(root, "must-not-run")
    const gate = await createSdkProcessGate(root, async () => undefined)
    const disk = holdDisk()
    const restore = await replaceFileHandleSync(root, async (sync) => {
      await disk.held
      return sync()
    })
    let joining: Promise<boolean> | undefined
    try {
      const controller = new AbortController()
      const child = gate.spawnClaudeCodeProcess({
        command: process.execPath,
        args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
        env: { ...process.env }, signal: controller.signal,
      })
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()))
      controller.abort()
      await exited
      joining = gate.closeAndJoin(30)
      expect(await Promise.race([joining, Bun.sleep(300).then(() => "unbounded")])).toBe(false)
      disk.release()
      const deadline = Date.now() + 2000
      while (readdirSync(root).some(name => name.includes(".gate")) && Date.now() < deadline) await Bun.sleep(10)
      expect(readdirSync(root).filter(name => name.includes(".gate"))).toEqual([])
      expect(existsSync(marker)).toBe(false)
      expect(await gate.closeAndJoin()).toBe(true)
    } finally {
      disk.release()
      restore()
      await joining
      await gate.closeAndJoin()
    }
  })

  it("stops the wrapper instead of opening the command when the gate cannot be published", async () => {
    const root = mkdtempSync(join(tmpdir(), "meridian-sdk-gate-"))
    roots.push(root)
    const marker = join(root, "command-ran")
    const gate = await createSdkProcessGate(root, async () => undefined)
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})
    const restore = await replaceFileHandleSync(root, async () => {
      throw new Error("injected sync failure")
    })
    try {
      const child = gate.spawnClaudeCodeProcess({
        command: process.execPath,
        args: ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`],
        env: { ...process.env },
        signal: new AbortController().signal,
      })
      await new Promise<void>((resolve) => child.once("exit", () => resolve()))
      expect(errorSpy).toHaveBeenCalledWith("[sdkProcessGate] gate publication failed:", expect.any(Error))
    } finally {
      restore()
      errorSpy.mockRestore()
    }
    expect(await gate.closeAndJoin()).toBe(true)
    expect(existsSync(marker)).toBe(false)
    expect(readdirSync(root).filter((name) => name.includes(".gate"))).toEqual([])
  })
})

function holdDisk(): { held: Promise<void>; release: () => void } {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  return { held, release }
}

async function replaceFileHandleSync(
  dir: string,
  replacement: (sync: () => Promise<void>) => Promise<void>,
): Promise<() => void> {
  const probe = await open(join(dir, "sync-probe"), "w")
  const prototype = Object.getPrototypeOf(probe) as FileHandle
  await probe.close()
  rmSync(join(dir, "sync-probe"), { force: true })
  const sync = prototype.sync
  prototype.sync = function (this: FileHandle) {
    return replacement(() => sync.call(this))
  }
  return () => { prototype.sync = sync }
}
