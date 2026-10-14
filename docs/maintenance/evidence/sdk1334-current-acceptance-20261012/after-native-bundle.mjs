#!/usr/bin/env bun
// @bun

// scripts/e2e-sdk-process-join.mjs
import assert from "assert/strict";
import { ChildProcess, spawnSync as spawnSync3 } from "child_process";
import { createHash as createHash2 } from "crypto";
import { mkdtempSync, mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync as rmSync2, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join as join2 } from "path";
import { fileURLToPath } from "url";

// src/proxy/session/sdkProcessGate.ts
import { spawn, spawnSync as spawnSync2 } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync
} from "node:fs";
import { open as open2, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

// src/proxy/session/durableFileSystem.ts
import { lstat, open } from "node:fs/promises";
async function syncDirectoryDurably(path) {
  if (process.platform === "win32")
    return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
var DIRECTORY_CONFLICT_CODES = new Set(["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"]);
var WINDOWS_DIRECTORY_CONFLICT_CODES = new Set(["EPERM", "EACCES"]);

// src/proxy/session/processIncarnation.ts
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readlinkSync } from "node:fs";
var PROCESS_INCARNATION_VERSION = 1;
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var LINUX_START_PATTERN = /^[1-9][0-9]{0,31}$/;
var WINDOWS_START_PATTERN = /^[1-9][0-9]{0,31}$/;
var DARWIN_START_PATTERN = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ 0-3][0-9] [0-2][0-9]:[0-5][0-9]:[0-6][0-9] [0-9]{4}$/;
var PROBE_TIMEOUT_MS = 2000;
var WINDOWS_PROBE_TIMEOUT_MS = 1e4;
var cachedLocalBootIdentity;
var cachedCurrentProcessIncarnation;
function hashIdentity(value) {
  return createHash("sha256").update(value).digest("hex");
}
function isPositivePid(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function normalizeUuid(raw) {
  const value = raw.trim().toLowerCase();
  return UUID_PATTERN.test(value) ? value : undefined;
}
function readFirst(paths) {
  for (const path of paths) {
    try {
      const value = readFileSync(path, "utf8").trim();
      if (value)
        return value;
    } catch {}
  }
  return;
}
function linuxLocalBootIdentity() {
  const machineId = readFirst(["/etc/machine-id", "/var/lib/dbus/machine-id"]);
  const bootId = normalizeUuid(readFileSync("/proc/sys/kernel/random/boot_id", "utf8"));
  const pidNamespace = readlinkSync("/proc/self/ns/pid");
  if (!machineId || !/^[0-9a-fA-F]{32}$/.test(machineId) || !bootId || !/^pid:\[[0-9]+\]$/.test(pidNamespace)) {
    return;
  }
  return {
    hostId: hashIdentity(`linux:${machineId.toLowerCase()}:${pidNamespace}`),
    bootId
  };
}
function runDarwin(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC0" },
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string")
    return;
  return result.stdout;
}
function darwinLocalBootIdentity() {
  const ioreg = runDarwin("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
  const boot = runDarwin("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"]);
  const machineMatch = ioreg?.match(/"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]+)"/);
  const machineId = machineMatch?.[1] ? normalizeUuid(machineMatch[1]) : undefined;
  const bootId = boot ? normalizeUuid(boot) : undefined;
  if (!machineId || !bootId)
    return;
  return {
    hostId: hashIdentity(`darwin:${machineId}`),
    bootId
  };
}
function uuidFromIdentity(value) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function runWindowsPowerShell(script) {
  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    encoding: "utf8",
    windowsHide: true,
    timeout: WINDOWS_PROBE_TIMEOUT_MS,
    maxBuffer: 1024 * 1024
  });
  return {
    status: result.error ? null : result.status,
    ...typeof result.stdout === "string" ? { stdout: result.stdout } : {}
  };
}
function windowsLocalBootIdentity() {
  const result = runWindowsPowerShell(String.raw`
$ErrorActionPreference = 'Stop'
$machine = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
try { $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime }
catch { $boot = (Get-WmiObject Win32_OperatingSystem).ConvertToDateTime((Get-WmiObject Win32_OperatingSystem).LastBootUpTime) }
Write-Output $machine
Write-Output $boot.ToUniversalTime().Ticks
`);
  if (result.status !== 0 || !result.stdout)
    return;
  const [machine, bootTicks] = result.stdout.trim().split(/\r?\n/).map((part) => part.trim());
  if (!machine || !bootTicks || !WINDOWS_START_PATTERN.test(bootTicks))
    return;
  return {
    hostId: hashIdentity(`windows:${machine.toLowerCase()}`),
    bootId: uuidFromIdentity(`windows-boot:${machine.toLowerCase()}:${bootTicks}`)
  };
}
function pinnedHostIdFor(pin) {
  const trimmed = pin?.trim();
  return trimmed ? hashIdentity(`pinned:${trimmed}`) : undefined;
}
function pinnedHostId() {
  return pinnedHostIdFor(process.env.MERIDIAN_HOST_ID);
}
function getLocalBootIdentity() {
  if (cachedLocalBootIdentity)
    return cachedLocalBootIdentity;
  try {
    const identity = process.platform === "linux" ? linuxLocalBootIdentity() : process.platform === "darwin" ? darwinLocalBootIdentity() : process.platform === "win32" ? windowsLocalBootIdentity() : undefined;
    const pinned = pinnedHostId();
    const resolved = identity && pinned ? { ...identity, hostId: pinned } : identity;
    if (resolved)
      cachedLocalBootIdentity = resolved;
    return resolved;
  } catch {
    return;
  }
}
function pidPresence(pid) {
  try {
    process.kill(pid, 0);
    return "present";
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    return code === "ESRCH" ? "missing" : "indeterminate";
  }
}
function parseLinuxProcStatStartId(raw, expectedPid) {
  const prefix = `${expectedPid} (`;
  if (!raw.startsWith(prefix))
    return;
  const commEnd = raw.lastIndexOf(")");
  if (commEnd < prefix.length || raw[commEnd + 1] !== " ")
    return;
  const fieldsFromState = raw.slice(commEnd + 2).trim().split(/\s+/);
  const startId = fieldsFromState[19];
  return startId && LINUX_START_PATTERN.test(startId) ? startId : undefined;
}
function linuxProcessStart(pid) {
  let raw;
  try {
    raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "ESRCH")
      return { status: "missing" };
    return { status: "indeterminate" };
  }
  const startId = parseLinuxProcStatStartId(raw, pid);
  if (startId)
    return { status: "found", startId, startIdKind: "linux-proc-start-ticks" };
  return pidPresence(pid) === "missing" ? { status: "missing" } : { status: "indeterminate" };
}
function darwinProcessStart(pid) {
  const output = runDarwin("/bin/ps", ["-p", String(pid), "-o", "lstart="]);
  if (output !== undefined) {
    const startId = output.trimEnd().trimStart();
    if (DARWIN_START_PATTERN.test(startId)) {
      return { status: "found", startId, startIdKind: "darwin-ps-lstart" };
    }
  }
  return pidPresence(pid) === "missing" ? { status: "missing" } : { status: "indeterminate" };
}
function windowsProcessStart(pid) {
  const result = runWindowsPowerShell(String.raw`
$ErrorActionPreference = 'Stop'
try {
  $process = Get-Process -Id ${pid} -ErrorAction Stop
  Write-Output $process.StartTime.ToUniversalTime().Ticks
} catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
  exit 3
} catch {
  exit 4
}
`);
  const startId = result.stdout?.trim();
  if (result.status === 0 && startId && WINDOWS_START_PATTERN.test(startId)) {
    return { status: "found", startId, startIdKind: "windows-start-ticks" };
  }
  if (result.status === 3)
    return { status: "missing" };
  return pidPresence(pid) === "missing" ? { status: "missing" } : { status: "indeterminate" };
}
function observeProcessStart(pid) {
  if (pid === process.pid && cachedCurrentProcessIncarnation) {
    return {
      status: "found",
      startId: cachedCurrentProcessIncarnation.startId,
      startIdKind: cachedCurrentProcessIncarnation.startIdKind
    };
  }
  if (process.platform === "linux")
    return linuxProcessStart(pid);
  if (process.platform === "darwin")
    return darwinProcessStart(pid);
  if (process.platform === "win32")
    return windowsProcessStart(pid);
  return { status: "indeterminate" };
}
function captureProcessIncarnation(pid = process.pid) {
  if (!isPositivePid(pid))
    return;
  if (pid === process.pid && cachedCurrentProcessIncarnation) {
    return { ...cachedCurrentProcessIncarnation };
  }
  const localBoot = getLocalBootIdentity();
  if (!localBoot)
    return;
  const start = observeProcessStart(pid);
  if (start.status !== "found")
    return;
  const identity = {
    version: PROCESS_INCARNATION_VERSION,
    pid,
    ...localBoot,
    startId: start.startId,
    startIdKind: start.startIdKind
  };
  if (pid === process.pid)
    cachedCurrentProcessIncarnation = identity;
  return { ...identity };
}

// src/proxy/session/sdkProcessGate.ts
var sdkGateNodeExecutable;
function getSdkGateNodeExecutable() {
  if (typeof process.versions.bun !== "string")
    return process.execPath;
  if (sdkGateNodeExecutable)
    return sdkGateNodeExecutable;
  const probe = spawnSync2("node", ["-p", "process.execPath"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 16 * 1024,
    windowsHide: true
  });
  const executable = probe.stdout?.trim();
  if (probe.error || probe.status !== 0 || !executable || !isAbsolute(executable)) {
    throw new Error("cannot resolve Node executable for SDK process gate");
  }
  sdkGateNodeExecutable = realpathSync(executable);
  return sdkGateNodeExecutable;
}
function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
function posixGateScript(options) {
  const environment = Object.entries(options.env).filter((entry) => entry[1] !== undefined).map(([key, value]) => shellQuote(`${key}=${value}`));
  const command = [options.command, ...options.args].map(shellQuote);
  return [
    options.cwd ? `cd -- ${shellQuote(options.cwd)} || exit 72` : undefined,
    `exec /usr/bin/env -i ${environment.join(" ")} ${command.join(" ")}`,
    ""
  ].filter((line) => line !== undefined).join(`
`);
}
function gateContents(options) {
  if (process.platform !== "win32")
    return posixGateScript(options);
  return JSON.stringify({
    command: options.command,
    args: options.args,
    cwd: options.cwd,
    env: Object.fromEntries(Object.entries(options.env).filter((entry) => entry[1] !== undefined))
  });
}
async function publishGate(path, contents) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let handle;
  try {
    handle = await open2(temporary, "wx", 384);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectoryDurably(dirname(path));
  } finally {
    if (handle)
      await handle.close();
    await rm(temporary, { force: true });
  }
}
function asSpawnedProcess(child, killOwned) {
  if (!child.stdin || !child.stdout)
    throw new Error("SDK gate process is missing stdio");
  if (process.platform !== "win32")
    return child;
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    get killed() {
      return child.killed;
    },
    get exitCode() {
      return child.exitCode;
    },
    kill(signal) {
      killOwned(signal);
      return true;
    },
    on: child.on.bind(child),
    once: child.once.bind(child),
    off: child.off.bind(child)
  };
}
function spawnGateWrapper(gatePath, cancelPath) {
  if (process.platform !== "win32") {
    const wrapper2 = String.raw`
gate=$1
remaining=6000
while [ ! -r "$gate" ]; do
  [ "$remaining" -le 0 ] && exit 75
  remaining=$((remaining - 1))
  sleep 0.01
done
. "$gate"
exit $?
`;
    return spawn("/bin/sh", ["-c", wrapper2, "meridian-sdk-gate", gatePath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
  }
  const wrapper = String.raw`
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
const gate = process.env.MERIDIAN_SDK_GATE_PATH;
const cancel = process.env.MERIDIAN_SDK_CANCEL_PATH;
const gateDeadline = Date.now() + 60_000;
while (!existsSync(gate)) {
  if (existsSync(cancel)) process.exit(0);
  if (Date.now() >= gateDeadline) process.exit(75);
  await wait(10);
}
if (existsSync(cancel)) process.exit(0);
const job = JSON.parse(readFileSync(gate, "utf8"));
const child = spawn(job.command, job.args, {
  cwd: job.cwd || undefined,
  env: job.env,
  stdio: "inherit",
  windowsHide: true,
});
let escalated = false;
const cancellation = setInterval(() => {
  if (!existsSync(cancel)) return;
  child.kill(escalated ? "SIGKILL" : "SIGTERM");
  escalated = true;
}, 50);
cancellation.unref?.();
const status = await new Promise((resolve) => {
  child.once("close", (code, signal) => resolve({ code, signal }));
  child.once("error", (error) => resolve({ code: 70, signal: String(error) }));
});
clearInterval(cancellation);
process.exit(status.code ?? (status.signal ? 1 : 0));
`;
  return spawn(getSdkGateNodeExecutable(), ["--input-type=module", "--eval", wrapper], {
    env: {
      ...process.env,
      MERIDIAN_SDK_GATE_PATH: gatePath,
      MERIDIAN_SDK_CANCEL_PATH: cancelPath
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
}
async function waitForExit(exited, timeoutMs) {
  let timer;
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(false), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([exited.then(() => true), timeout]);
  } finally {
    if (timer)
      clearTimeout(timer);
  }
}
async function createSdkProcessGate(root, attachExecutor, onStderr) {
  mkdirSync(root, { recursive: true, mode: 448 });
  const token = `${process.pid}-${randomUUID()}`;
  const gatePath = join(root, `${token}.gate`);
  const cancelPath = join(root, `${token}.cancel`);
  const child = spawnGateWrapper(gatePath, cancelPath);
  const recoverableAfterCrash = process.platform !== "win32";
  const killOwned = (signal) => {
    if (process.platform === "win32") {
      try {
        const fd = openSync(cancelPath, "wx", 384);
        closeSync(fd);
      } catch (error) {
        if (!(error instanceof Error && ("code" in error) && error.code === "EEXIST"))
          throw error;
      }
      return;
    }
    if (child.exitCode === null)
      child.kill(signal);
  };
  child.stderr?.on("data", (chunk) => {
    const data = chunk.toString();
    if (!onStderr)
      return;
    try {
      onStderr(data);
    } catch (error) {
      console.error("[sdkProcessGate] stderr callback failed:", error);
    }
  });
  let hasClosed = false;
  const exited = new Promise((resolveExit) => {
    child.once("close", () => {
      hasClosed = true;
      resolveExit();
    });
  });
  let attached = false;
  let spawned = false;
  let publication = Promise.resolve();
  try {
    if (!child.pid)
      throw new Error("SDK gate process has no PID");
    const executor = captureProcessIncarnation(child.pid);
    if (!executor)
      throw new Error("cannot capture SDK writer process incarnation");
    await attachExecutor(executor, recoverableAfterCrash);
    attached = true;
    const spawnClaudeCodeProcess = (options) => {
      if (spawned)
        throw new Error("SDK process gate may be opened only once");
      spawned = true;
      const abortError = () => Object.assign(new Error("SDK process spawn was aborted"), {
        name: "AbortError"
      });
      if (options.signal.aborted) {
        killOwned("SIGTERM");
        throw abortError();
      }
      const onAbort = () => {
        killOwned("SIGTERM");
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      exited.then(() => options.signal.removeEventListener("abort", onAbort));
      if (options.signal.aborted) {
        onAbort();
        throw abortError();
      }
      publication = publishGate(gatePath, gateContents(options)).catch((error) => {
        console.error("[sdkProcessGate] gate publication failed:", error);
        killOwned("SIGKILL");
      });
      return asSpawnedProcess(child, killOwned);
    };
    return {
      executor,
      recoverableAfterCrash,
      spawnClaudeCodeProcess,
      async closeAndJoin(timeoutMs = 7000) {
        const deadline = performance.now() + Math.max(0, timeoutMs);
        const remaining = () => Math.max(0, deadline - performance.now());
        let joined = hasClosed;
        if (!joined)
          joined = await waitForExit(exited, Math.min(250, remaining() / 4));
        if (!joined) {
          killOwned("SIGTERM");
          joined = await waitForExit(exited, process.platform === "win32" ? remaining() : Math.min(2000, remaining() / 2));
        }
        if (!joined && process.platform !== "win32") {
          killOwned("SIGKILL");
          joined = await waitForExit(exited, remaining());
        }
        const publicationSettled = joined && await waitForExit(publication, remaining());
        const cleanup = () => {
          rmSync(gatePath, { force: true });
          rmSync(cancelPath, { force: true });
        };
        if (publicationSettled) {
          cleanup();
        } else {
          Promise.all([exited, publication]).then(cleanup).catch((error) => {
            console.error("[sdkProcessGate] deferred gate cleanup failed:", error);
          });
        }
        return publicationSettled;
      }
    };
  } catch (error) {
    if (!attached || child.exitCode === null)
      killOwned("SIGKILL");
    await waitForExit(exited, 2000);
    rmSync(gatePath, { force: true });
    rmSync(cancelPath, { force: true });
    throw error;
  }
}

// scripts/e2e-sdk-process-join.mjs
assert.notEqual(process.platform, "win32", "These inherited-pipe and TERM-resistance controls are POSIX-specific; Windows has a separate wrapper contract");
var node = getSdkGateNodeExecutable();
var nodeVersion = spawnSync3(node, ["--version"], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
assert.equal(nodeVersion.status, 0);
assert.equal(nodeVersion.error, undefined);
var root = mkdtempSync(join2(tmpdir(), "sdk-close-join-proof-"));
var facts = [];
var failure;
var cleanupKnown = true;
async function within(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
try {
  for (const mode of ["ordinary-exit", "delayed-pipes", "resists-term"]) {
    const dir = join2(root, mode);
    mkdirSync2(dir);
    let ignoredTerm = false;
    cleanupKnown = false;
    const gate = await createSdkProcessGate(dir, async () => {
      return;
    }, (text) => {
      ignoredTerm ||= text.includes("ignored");
    });
    const releasePath = join2(dir, "release-owned-pipe-holder");
    const pipeHolder = `const {existsSync}=require('node:fs');console.log('ready');setInterval(()=>{if(existsSync(${JSON.stringify(releasePath)}))process.exit(0)},10);setTimeout(()=>process.exit(75),10000)`;
    const program = mode === "delayed-pipes" ? `const {spawn}=require('node:child_process');const helper=spawn(process.execPath,['-e',${JSON.stringify(pipeHolder)}],{stdio:['ignore','inherit','inherit']});helper.unref();process.exit(0)` : mode === "resists-term" ? `process.on('SIGTERM',()=>console.error('ignored'));console.log('ready');setInterval(()=>{},1000)` : `console.log('ready')`;
    const child = gate.spawnClaudeCodeProcess({ command: node, args: ["-e", program], env: { PATH: process.env.PATH }, signal: new AbortController().signal });
    let stdout = "", closed = false, exited = false;
    const close = new Promise((resolve) => child.once("close", () => {
      closed = true;
      resolve();
    }));
    const exit = new Promise((resolve) => child.once("exit", () => {
      exited = true;
      resolve();
    }));
    let readyResolve;
    const ready = new Promise((resolve) => {
      readyResolve = resolve;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes("ready"))
        readyResolve();
    });
    let fact;
    try {
      assert(child instanceof ChildProcess, "POSIX gate must return the original native child handle");
      await within(ready, 5000, "owned child readiness missing");
      if (mode === "delayed-pipes")
        await within(exit, 2000, "original parent did not exit");
      const budgetMs = mode === "delayed-pipes" ? 100 : 1000;
      const start = performance.now();
      const joined = await gate.closeAndJoin(budgetMs);
      fact = {
        mode,
        budgetMs,
        joined,
        closeAtVerdict: closed,
        exitAtVerdict: exited,
        ignoredTerm,
        exitCodeAtVerdict: child.exitCode,
        signalAtVerdict: child.signalCode,
        elapsedMs: Math.round(performance.now() - start)
      };
      facts.push(fact);
    } finally {
      if (mode === "delayed-pipes")
        writeFileSync(releasePath, `release
`);
      const cleanupVerdict = await gate.closeAndJoin(4000);
      await within(close, 2000, "original child/pipes close missing during cleanup");
      const finalJoin = await gate.closeAndJoin(1000);
      if (fact)
        Object.assign(fact, { cleanupVerdict, finalJoin, originalCloseJoined: closed });
      assert.equal(finalJoin, true, "publication and original process must join before fixture removal");
      cleanupKnown = true;
    }
  }
} catch (error) {
  failure = error;
} finally {
  if (cleanupKnown)
    rmSync2(root, { recursive: true, force: true });
}
var summary = {
  result: failure ? "FAIL" : "observed",
  error: failure?.message,
  scope: "production SDK process gate with controlled actual Node children; no SDK query/model/Claude CLI",
  platform: process.platform,
  arch: process.arch,
  driver: process.version,
  bun: process.versions.bun ?? null,
  nodeChild: nodeVersion.stdout.trim(),
  artifactSha256: createHash2("sha256").update(readFileSync2(fileURLToPath(import.meta.url))).digest("hex"),
  fixtureRemoved: cleanupKnown,
  fixtureRetained: cleanupKnown ? undefined : root,
  facts
};
try {
  if (failure)
    throw failure;
  assert.equal(facts.length, 3);
  const ordinary = facts.find((f) => f.mode === "ordinary-exit");
  const delayed = facts.find((f) => f.mode === "delayed-pipes");
  const resistant = facts.find((f) => f.mode === "resists-term");
  assert.equal(ordinary.joined, true);
  assert.equal(ordinary.closeAtVerdict, true);
  assert.equal(delayed.exitAtVerdict, true, "held-pipe arm must have an exited parent");
  assert.equal(delayed.closeAtVerdict, false, "held-pipe arm must retain the original pipe lifetime");
  assert.equal(delayed.joined, false, "exit without owned pipe-close must not authorize join");
  assert.equal(resistant.ignoredTerm, true, "resistant child did not arm its TERM handler");
  assert.equal(resistant.joined, true, "SIGKILL must retain an original-close observation phase");
  assert.equal(resistant.closeAtVerdict, true);
  assert.equal(resistant.signalAtVerdict, "SIGKILL", "join must follow the actual owned escalation signal");
  assert(facts.every((f) => f.originalCloseJoined && f.finalJoin), "all original actors and gate publications must be joined");
  summary.result = "PASS";
} catch (error) {
  summary.result = "FAIL";
  summary.error = error.message;
  process.exitCode = 1;
}
console.log(JSON.stringify(summary));
