import { describe, expect, it } from "bun:test"
import { ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSdkProcessGate, getSdkGateNodeExecutable } from "../proxy/session/sdkProcessGate"

async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms)
    })])
  } finally { if (timer) clearTimeout(timer) }
}

async function fixture(kind: "held-pipes" | "resistant") {
  const root = mkdtempSync(join(tmpdir(), "meridian-sdk-close-test-"))
  const releasePath = join(root, "release")
  let ignoredTerm = false
  const gate = await createSdkProcessGate(root, async () => undefined, data => { ignoredTerm ||= data.includes("ignored") })
  const node = getSdkGateNodeExecutable()
  const helper = `const {existsSync}=require('node:fs');console.log('ready');setInterval(()=>{if(existsSync(${JSON.stringify(releasePath)}))process.exit(0)},10);setTimeout(()=>process.exit(75),10000)`
  const program = kind === "held-pipes"
    ? `const {spawn}=require('node:child_process');const helper=spawn(process.execPath,['-e',${JSON.stringify(helper)}],{stdio:['ignore','inherit','inherit']});helper.unref();process.exit(0)`
    : `process.on('SIGTERM',()=>console.error('ignored'));console.log('ready');setInterval(()=>{},1000)`
  const child = gate.spawnClaudeCodeProcess({ command: node, args: ["-e", program], env: { PATH: process.env.PATH }, signal: new AbortController().signal })
  if (!(child instanceof ChildProcess)) {
    writeFileSync(releasePath, "release\n")
    await gate.closeAndJoin(4000)
    throw new Error(`POSIX gate did not return its original ChildProcess; fixture retained at ${root}`)
  }
  let closed = false, output = ""
  const close = new Promise<void>(resolve => child.once("close", () => { closed = true; resolve() }))
  const exit = new Promise<void>(resolve => child.once("exit", () => resolve()))
  let readyResolve!: () => void
  const ready = new Promise<void>(resolve => { readyResolve = resolve })
  child.stdout.on("data", chunk => { output += chunk.toString(); if (output.includes("ready")) readyResolve() })
  return {
    gate, child, ready, exit, isClosed: () => closed, ignoredTerm: () => ignoredTerm,
    async cleanup() {
      // Keep the owned state if original close/publication is unknown. Never
      // destroy pipes or release a writer merely to satisfy the test.
      writeFileSync(releasePath, "release\n")
      await gate.closeAndJoin(4000)
      await within(close, 2000, "original child/pipes did not close")
      expect(await gate.closeAndJoin(1000)).toBe(true)
      rmSync(root, { recursive: true, force: true })
    },
  }
}

// Windows owns a forwarding wrapper and a different cancellation contract.
// Do not present POSIX inherited pipes or ignored SIGTERM as Windows proof.
describe.skipIf(process.platform === "win32")("SDK process gate close witnesses", () => {
  it("does not authorize join from exitCode while original pipes remain open", async () => {
    const owned = await fixture("held-pipes")
    try {
      await within(owned.ready, 5000, "owned pipe-holder not ready")
      await within(owned.exit, 2000, "original leader did not exit")
      expect(owned.child.exitCode).toBe(0)
      expect(owned.isClosed()).toBe(false)
      expect(await owned.gate.closeAndJoin(100)).toBe(false)
      expect(owned.isClosed()).toBe(false)
    } finally { await owned.cleanup() }
  }, 30000)

  it("caps default POSIX TERM patience at two seconds rather than consuming the KILL reserve", async () => {
    const owned = await fixture("resistant")
    try {
      await within(owned.ready, 5000, "owned resistant child not ready")
      const started = performance.now()
      expect(await owned.gate.closeAndJoin()).toBe(true)
      // Old reserve-only scheduling takes about five seconds. The requested
      // min(2000, remaining/2) TERM phase takes about 2250 ms before close.
      expect(performance.now() - started).toBeLessThan(4000)
      expect(owned.ignoredTerm()).toBe(true)
      expect(owned.isClosed()).toBe(true)
      expect(owned.child.signalCode).toBe("SIGKILL")
    } finally { await owned.cleanup() }
  }, 30000)

  it("reserves close-observation time after killing a TERM-resistant child", async () => {
    const owned = await fixture("resistant")
    try {
      await within(owned.ready, 5000, "owned resistant child not ready")
      expect(await owned.gate.closeAndJoin(1000)).toBe(true)
      expect(owned.ignoredTerm()).toBe(true)
      expect(owned.isClosed()).toBe(true)
      expect(owned.child.signalCode).toBe("SIGKILL")
    } finally { await owned.cleanup() }
  }, 30000)
})
