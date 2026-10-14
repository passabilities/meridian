import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs"
import { join } from "node:path"
import Database from "libsql"
import * as store from "./probe-source/src/proxy/sessionStore"
import { parseStoreDocument, serializeLegacyStore } from "./probe-source/src/proxy/session/bookkeeping/legacyCodec"
import { initializeSessionBookkeeping } from "./probe-source/src/proxy/session/bookkeeping/connection"
import { checkpointBookkeepingOffline } from "./probe-source/src/proxy/session/bookkeeping/transaction"
import { acquireMaintenanceGuard, acquireRuntimeGuard } from "./probe-source/src/proxy/session/bookkeeping/guard"
import { initializeProxyBookkeeping } from "./probe-source/src/proxy/session/bookkeeping/runtime"
import { migrateBookkeeping } from "./probe-source/src/proxy/session/bookkeeping/migration"
import { registerLiveTranscript, releaseSupersededProfileCopies } from "./probe-source/src/proxy/sessionLifecycle"

const [mode, input] = process.argv.slice(2)
assert(input)
mkdirSync(input, { recursive: true, mode: 0o700 })
const directory = realpathSync(input)
store.setSessionStoreDir(directory)
const facts: Record<string, unknown> = { mode, source: "0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f", node: process.version, platform: process.platform, arch: process.arch }
const errorFact = (error: unknown) => ({ name: error instanceof Error ? error.constructor.name : typeof error, message: String(error) })

if (mode === "codec-order") {
  assert.notEqual(store.storeSharedSession("7", "synthetic-codec"), false)
  const writerBytes = readFileSync(join(directory, "sessions.json"), "utf8")
  const codecBytes = serializeLegacyStore(parseStoreDocument(writerBytes))
  facts.writerStartsWithMetadata = writerBytes.startsWith('{"\\u0000meridian-session-store":')
  facts.codecStartsWithNumericMapping = codecBytes.startsWith('{"7":')
  facts.bytesEqual = writerBytes === codecBytes
  facts.semanticKeysEqual = Object.keys(JSON.parse(writerBytes)).join() === Object.keys(JSON.parse(codecBytes)).join()
  assert.equal(facts.writerStartsWithMetadata, true)
  assert.equal(facts.codecStartsWithNumericMapping, true)
  assert.equal(facts.bytesEqual, false)
} else if (mode === "profile-prune") {
  for (const [key, id] of [["work:conversation", "synthetic-old"], ["conversation", "synthetic-new"]]) {
    const locator = await registerLiveTranscript({ configDir: directory, sessionId: id! }, { storeDir: directory })
    assert.notEqual(store.storeSharedSession(key!, id!, 0, undefined, undefined, undefined, undefined, undefined, undefined, undefined, locator), false)
  }
  const path = join(directory, "sessions.json")
  const document = JSON.parse(readFileSync(path, "utf8"))
  document["work:conversation"].lastUsedAt = 1
  document.conversation.lastUsedAt = Date.now()
  writeFileSync(path, JSON.stringify(document), { mode: 0o600 })
  const selection = { profileIds: ["work"], graceMs: 0, maxUnpinnedTranscripts: 100, isConversationActive: () => false }
  facts.jsonCandidatesBeforeMigration = store.listSupersededProfileConversations(selection)
  assert.deepEqual(facts.jsonCandidatesBeforeMigration, ["conversation"])
  await migrateBookkeeping(directory, { writersStopped: true })
  process.env.MERIDIAN_BOOKKEEPING = "sqlite"
  const handle = await initializeProxyBookkeeping()
  assert(handle)
  try {
    facts.sqlMappingsBefore = handle.reader.all("SELECT key FROM mappings ORDER BY key").map(row => row.key)
    facts.sqlFacadeCandidates = store.listSupersededProfileConversations(selection)
    facts.sqlFacadePruned = store.pruneSupersededProfileCopies(selection)
    try {
      await releaseSupersededProfileCopies({ profileIds: ["work"], graceMs: 0, isConversationActive: () => false },
        { storeDir: directory, lockWaitMs: 40, lockRetryMs: 5, pinProvider: () => [] })
      facts.sqlLifecyclePrune = "unexpected fulfillment"
    } catch (error) { facts.sqlLifecyclePruneError = errorFact(error) }
    facts.sqlMappingsAfter = handle.reader.all("SELECT key FROM mappings ORDER BY key").map(row => row.key)
    facts.sqlPinsRetained = handle.reader.get("SELECT count(*) AS n FROM mapping_pins")?.n
    assert.deepEqual(facts.sqlMappingsBefore, ["conversation", "work:conversation"])
    assert.deepEqual(facts.sqlFacadeCandidates, [])
    assert.equal(facts.sqlFacadePruned, 0)
    assert(facts.sqlLifecyclePruneError)
    assert.deepEqual(facts.sqlMappingsAfter, facts.sqlMappingsBefore)
    assert.equal(facts.sqlPinsRetained, 2)
  } finally { handle.close() }
} else if (mode === "runtime-truncate") {
  const handle = initializeSessionBookkeeping(directory)
  const extraShared = acquireRuntimeGuard(directory)
  try {
    facts.guardMode = extraShared.mode
    try { acquireMaintenanceGuard(directory).close(); facts.exclusiveBlocked = false }
    catch { facts.exclusiveBlocked = true }
    facts.truncate = checkpointBookkeepingOffline(directory, "TRUNCATE")
    assert.equal(facts.guardMode, "shared")
    assert.equal(facts.exclusiveBlocked, true)
    assert.equal((facts.truncate as { busy: number }).busy, 0)
  } finally { handle.close(); extraShared.close() }
} else if (mode === "failed-open") {
  initializeSessionBookkeeping(directory).close()
  const original = Database.prototype.prepare
  let leaked: Database.Database | undefined
  Database.prototype.prepare = function(sql: string) {
    if (sql === "SELECT migration_id,source_digests_json FROM schema_meta") {
      leaked = this
      throw Object.assign(new Error("synthetic provenance read I/O fault"), { code: "SQLITE_IOERR" })
    }
    return original.call(this, sql)
  }
  try {
    try { initializeSessionBookkeeping(directory).close(); facts.openRejected = false }
    catch (error) { facts.openRejected = true; facts.openError = errorFact(error) }
  } finally { Database.prototype.prepare = original }
  try {
    assert(leaked)
    facts.nativeHandleStillUsable = Boolean(leaked.prepare("SELECT 1 AS n").get())
    const exclusive = acquireMaintenanceGuard(directory)
    facts.exclusiveAcquiredWhileNativeHandleOpen = exclusive.mode === "exclusive"
    exclusive.close()
    assert.equal(facts.openRejected, true)
    assert.equal(facts.nativeHandleStillUsable, true)
    assert.equal(facts.exclusiveAcquiredWhileNativeHandleOpen, true)
  } finally { leaked?.close() }
} else { throw new Error("unknown isolated probe mode") }
store.setSessionStoreDir(null)
facts.assertions = "PASS (defect reproduced; not product acceptance)"
console.log(JSON.stringify(facts, null, 2))
