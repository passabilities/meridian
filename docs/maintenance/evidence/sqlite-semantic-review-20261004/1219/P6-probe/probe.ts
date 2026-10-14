import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statfsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { migrateBookkeeping } from "/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/probe-source/src/proxy/session/bookkeeping/migration.ts"
import { readJournal } from "/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/probe-source/src/proxy/session/bookkeeping/maintenanceJournal.ts"
import { captureProcessIncarnation, probeProcessIncarnation } from "/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/probe-source/src/proxy/session/processIncarnation.ts"
import { resourceKey } from "/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/probe-source/src/proxy/session/bookkeeping/locator.ts"

const source = "/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/probe-source"
const script = fileURLToPath(import.meta.url)
const output = dirname(script)
const [action, childDirectory] = process.argv.slice(2)
if (action === "prepare") {
  assert(childDirectory)
  await migrateBookkeeping(childDirectory, { writersStopped: true })
  throw new Error("PREPARED crash did not occur")
}

const started = new Date().toISOString()
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-p6-resume-probe-")))
const rows: Record<string, unknown> = {}
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex")
function snapshot(directory: string, prefix = ""): Array<Record<string, unknown>> {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name), stat = lstatSync(path), relative = join(prefix, name)
    assert(!stat.isSymbolicLink(), "probe owns no symlinks")
    return [{ path: relative, dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777,
      ...(stat.isFile() ? { bytes: stat.size, sha256: sha(readFileSync(path)) } : {}) },
      ...(stat.isDirectory() ? snapshot(path, relative) : [])]
  })
}
function prepared(name: string) {
  const directory = join(root, name)
  mkdirSync(directory, { mode: 0o700 })
  writeFileSync(join(directory, "sessions.json"), "{}", { mode: 0o600 })
  writeFileSync(join(directory, "session-gc.json"), JSON.stringify({ version: 2, meta: { fenceSlots: {} }, resources: {} }), { mode: 0o600 })
  mkdirSync(join(directory, "sdk-process-gates"), { mode: 0o700 })
  const gateName = `${randomUUID()}.go`, gate = join(directory, "sdk-process-gates", gateName)
  writeFileSync(gate, "synthetic gate; no SDK or model\n", { mode: 0o600 })
  const killed = spawnSync(process.execPath, [script, "prepare", directory], { cwd: source,
    encoding: "utf8", timeout: 15000, env: { ...process.env, MERIDIAN_BOOKKEEPING_TEST_CRASH: "PREPARED" } })
  assert.equal(killed.error, undefined)
  assert.equal(killed.signal, "SIGKILL", killed.stdout + killed.stderr)
  assert.equal(killed.status, null)
  const journal = readJournal(directory)
  assert(journal)
  assert.equal(journal.phase, "PREPARED")
  assert.equal(journal.residues?.length, 1)
  assert.equal(journal.residues?.[0]?.path, `sdk-process-gates/${gateName}`)
  assert(existsSync(gate), "crash must precede residue movement")
  assert(!existsSync(join(directory, "session-bookkeeping.sqlite")))
  return { directory, gate, gateName, id: journal.id }
}
function cli(directory: string) {
  return spawnSync(process.execPath, [join(source, "bin/session-bookkeeping.ts"), "migrate", "--session-dir", directory,
    "--writers-stopped", "--json"], { cwd: source, encoding: "utf8", timeout: 15000,
    env: { ...process.env, MERIDIAN_BOOKKEEPING_TEST_CRASH: "" } })
}

let success = false
try {
  const negative = prepared("observable-owner")
  const owner = captureProcessIncarnation()
  assert(owner)
  const verdict = probeProcessIncarnation(owner)
  assert.notEqual(verdict, "dead")
  const locator = { configDir: negative.directory, sessionId: "synthetic-live-transcript" }
  const key = resourceKey(locator), leaseToken = randomUUID()
  const resource = { key, locator, generation: `r:${key}:1`, state: "live", createdAt: 1, updatedAt: 2, attempts: 0,
    activeLeases: { [leaseToken]: { token: leaseToken, purpose: "publication", owner, createdAt: 1 } } }
  writeFileSync(join(negative.directory, "session-gc.json"), JSON.stringify({ version: 2,
    meta: { fenceSlots: { [key.slice(0, 4)]: 1 } }, resources: { [key]: resource } }), { mode: 0o600 })
  const beforeCli = snapshot(negative.directory)
  const refused = cli(negative.directory)
  assert.equal(refused.error, undefined)
  assert.equal(refused.status, 3, refused.stdout + refused.stderr)
  const cliJson = JSON.parse(refused.stdout)
  assert.match(cliJson.error, /(?:live|indeterminate) process at/)
  assert(existsSync(negative.gate))
  assert.deepEqual(snapshot(negative.directory), beforeCli, "actual CLI refusal must preserve every file/inode/mode/byte")
  rows.cliControl = { status: refused.status, signal: refused.signal, error: cliJson.error,
    gateRetained: true, allFilesUnchanged: true, phase: readJournal(negative.directory)?.phase }

  const gateBytes = readFileSync(negative.gate), sourceHash = sha(readFileSync(join(negative.directory, "session-gc.json")))
  let failure: unknown
  try { await migrateBookkeeping(negative.directory, { writersStopped: true }) } catch (error) { failure = error }
  assert(failure instanceof Error)
  assert.match(failure.message, /(?:live|indeterminate) process at/)
  const archived = join(negative.directory, "bookkeeping-cycles", negative.id, "residue", "sdk-process-gates", negative.gateName)
  assert(!existsSync(negative.gate), "direct call archived gate before refusing observable ledger owner")
  assert.deepEqual(readFileSync(archived), gateBytes, "gate bytes remain in durable archive")
  assert.equal(sha(readFileSync(join(negative.directory, "session-gc.json"))), sourceHash)
  assert.equal(readJournal(negative.directory)?.phase, "PREPARED")
  assert(!existsSync(join(negative.directory, "session-bookkeeping.sqlite")))
  rows.directCall = { errorClass: failure.constructor.name, error: failure.message, gateRetained: false,
    archiveRetainsExactBytes: true, ledgerBytesUnchanged: true, phase: "PREPARED", databaseCreated: false }
  rows.owner = { probeVerdict: verdict, pid: owner.pid, startIdKind: owner.startIdKind,
    meaning: "Disposable probe process; Darwin equality is indeterminate, never death proof" }

  const positive = prepared("no-observable-owner")
  const accepted = cli(positive.directory)
  assert.equal(accepted.error, undefined)
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
  const positiveJson = JSON.parse(accepted.stdout)
  assert.equal(positiveJson.phase, "ready")
  assert(!existsSync(positive.gate))
  assert.equal(positiveJson.result.residues.length, 1)
  assert(existsSync(join(positive.directory, "bookkeeping-cycles", positive.id, "residue", "sdk-process-gates", positive.gateName)))
  rows.positiveControl = { status: 0, phase: "ready", gateArchived: true, resources: positiveJson.result.resources,
    mappings: positiveJson.result.mappings, archivedResidues: positiveJson.result.residues.length }
  rows.runtime = { execPath: process.execPath, bun: Bun.version, nodeCompatibility: process.version,
    platform: process.platform, arch: process.arch, filesystemType: Number(statfsSync(root).type),
    sourceSha: "0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f", sdkQueries: 0,
    actualCli: "bin/session-bookkeeping.ts under Bun; no compiled or independently installed package claim" }
  success = true
} catch (error) {
  rows.failure = { name: error instanceof Error ? error.constructor.name : typeof error,
    message: error instanceof Error ? error.message : String(error) }
} finally {
  rmSync(root, { recursive: true, force: true })
  rows.cleanup = { syntheticRootRemoved: !existsSync(root), liveOwnedChildren: 0,
    ownership: "Synchronous child invocations are terminal before cleanup; no long-lived children started" }
  rows.started = started
  rows.finished = new Date().toISOString()
  rows.result = success ? "PASS causal characterization; direct call mutation reproduced, CLI preflight protected" : "FAIL harness/probe"
  writeFileSync(join(output, "result.json"), JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 })
}
console.log(JSON.stringify(rows, null, 2))
if (!success) process.exitCode = 1
