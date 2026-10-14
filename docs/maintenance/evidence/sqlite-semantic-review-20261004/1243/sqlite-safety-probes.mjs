import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spyOn } from 'bun:test'

// Synthetic Meridian-owned records only. No SDK, client or auth imports/calls.
const source = resolve(process.argv[2])
const variant = process.argv[3]
assert(['sql', 'async-json'].includes(variant))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const moduleUrl = relative => pathToFileURL(join(source, relative)).href
const store = await import(moduleUrl('src/proxy/sessionStore.ts'))
const roots = []
function fixture(label) {
  const dir = mkdtempSync(join(tmpdir(), `meridian-1243-synthetic-${label}-`))
  chmodSync(dir, 0o700)
  roots.push(dir)
  return dir
}
const findings = []
const requireFromSource = createRequire(join(source, 'package.json'))
const Database = requireFromSource('libsql')
function sqlRecord(dir, table, routeKey) {
  const db = new Database(join(dir, 'sessions.db'))
  try { return JSON.parse(db.prepare(`SELECT record FROM ${table} WHERE route_key = ?`).get(routeKey).record) }
  finally { db.close() }
}
function persistedPriority(dir, field, routeKey) {
  if (variant === 'sql') return sqlRecord(dir, field === 'priorityAssignments' ? 'priority_assignments' : 'priority_attempts', routeKey)
  return JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8'))['\u0000meridian-session-store'][field][routeKey]
}
try {
  const dir = fixture('priority')
  store.setSessionStoreDir(dir)
  const mapping = store.lookupSharedSessionResult('work:route')
  const route = store.lookupPriorityAssignmentResult('route')
  assert(mapping.status === 'missing' && route.status === 'missing')
  const publication = await store.storeSharedSessionAndPriorityAssignment({
    key: 'work:route', claudeSessionId: 'synthetic-session', messageCount: 1,
    lineageHash: 'synthetic', messageHashes: [], messageBlockHashes: [],
    expectedMappingGeneration: mapping.generation,
    priority: { routeKey: 'route', profileId: 'work', lastHumanTurnDigest: 'A'.repeat(43),
      lastHumanTurnIssuedAt: 100, expectedAssignmentGeneration: route.generation },
  })
  assert(publication !== false)
  const lookup = store.lookupPriorityAssignmentResult('route')
  assert(lookup.status === 'found')
  let assignmentMutationAccepted = false
  try { lookup.assignment.profileId = 'mutated-in-memory'; assignmentMutationAccepted = true }
  catch (error) { assert(error instanceof TypeError) }
  const reread = store.lookupPriorityAssignmentResult('route')
  assert(reread.status === 'found')
  const diskAssignment = persistedPriority(dir, 'priorityAssignments', 'route')
  const initialAttemptRoute = store.lookupPriorityAssignmentResult('attempt-only')
  assert(initialAttemptRoute.status === 'missing')
  const claim = await store.claimPriorityAttempt({ routeKey: 'attempt-only',
    expectedAssignmentGeneration: initialAttemptRoute.generation,
    turn: { turnId: 'B'.repeat(43), issuedAt: 200 } })
  assert(claim !== false)
  assert.equal(await store.blockPriorityAttempt('attempt-only', claim.ownerToken), true)
  const blocked = store.lookupPriorityAssignmentResult('attempt-only')
  assert(blocked.status === 'missing' && blocked.attempt?.blocked)
  const staleInput = { routeKey: 'attempt-only', expectedAssignmentGeneration: blocked.generation,
    turn: { turnId: 'C'.repeat(43), issuedAt: 100 } }
  assert.equal(await store.claimPriorityAttempt(staleInput), false)
  let attemptMutationAccepted = false
  try { blocked.attempt.blockedTurnIssuedAt = 0; attemptMutationAccepted = true }
  catch (error) { assert(error instanceof TypeError) }
  const rawBeforeSecondClaim = persistedPriority(dir, 'priorityAttempts', 'attempt-only')
  const staleClaimAfterMutation = await store.claimPriorityAttempt(staleInput)
  findings.push({ case: 'immutable-priority-authority', variant,
    assignmentFrozen: Object.isFrozen(lookup.assignment), assignmentMutationAccepted,
    cachedProfileAfterMutation: reread.assignment.profileId, persistedProfile: diskAssignment.profileId,
    attemptFrozen: Object.isFrozen(blocked.attempt), attemptMutationAccepted,
    persistedBlockedIssueTimeBeforeSecondClaim: rawBeforeSecondClaim.blockedTurnIssuedAt,
    olderTrustedTurnAcceptedAfterCacheMutation: staleClaimAfterMutation !== false,
    safetyAssertion: assignmentMutationAccepted || attemptMutationAccepted || staleClaimAfterMutation !== false ? 'FAIL' : 'PASS' })

  // This is the exact retained JSON-file hold mechanism with entry counters
  // added to observe whether an SQL mutation actually crosses its gate.
  const heldDir = fixture('retained-json-hold')
  store.setSessionStoreDir(heldDir)
  await store.storeSharedSession('held', 'synthetic-held')
  const probe = await fsPromises.open(join(heldDir, 'sync-probe'), 'w')
  const prototype = Object.getPrototypeOf(probe)
  await probe.close()
  rmSync(join(heldDir, 'sync-probe'), { force: true })
  const { writeFile, sync } = prototype
  const storeFiles = new WeakSet()
  let release
  const released = new Promise(resolve => { release = resolve })
  let gateEntries = 0, evictionSettledBeforeRelease = false
  prototype.writeFile = function (...args) {
    const [data] = args
    const head = typeof data === 'string' ? data.slice(0, 64)
      : Buffer.isBuffer(data) ? data.subarray(0, 64).toString('utf8') : ''
    if (head.includes('meridian-session-store')) storeFiles.add(this)
    return writeFile.apply(this, args)
  }
  prototype.sync = async function () {
    if (storeFiles.has(this)) { gateEntries++; await released }
    return sync.call(this)
  }
  try {
    const eviction = store.evictSharedSession('held').then(value => {
      evictionSettledBeforeRelease = true
      return value
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    const observed = { gateEntries, evictionSettledBeforeRelease }
    release()
    assert.equal(await eviction, true)
    findings.push({ case: 'retained-arrival-eviction-hold', variant, ...observed,
      safetyAssertion: observed.gateEntries > 0 && !observed.evictionSettledBeforeRelease ? 'PASS' : 'FAIL' })
  } finally {
    release()
    prototype.writeFile = writeFile
    prototype.sync = sync
  }

  if (variant === 'sql') {
    const databaseModule = await import(moduleUrl('src/proxy/session/storeDatabase.ts'))
    const retirementDir = fixture('retirement-race')
    const legacyPath = join(retirementDir, 'sessions.json')
    const importedBytes = JSON.stringify({ imported: 'synthetic-A' })
    const laterBytes = JSON.stringify({ imported: 'synthetic-A', later: 'synthetic-B' })
    writeFileSync(legacyPath, importedBytes, { mode: 0o600 })
    const rename = fsPromises.rename
    let interceptedRenames = 0
    const renameSpy = spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
      if (String(from) === legacyPath) {
        interceptedRenames++
        // An old writer uses its sessions.json.lock. The SQL importer does
        // not acquire that lock, so a valid publication can land here.
        const lock = legacyPath + '.lock'
        writeFileSync(lock, 'synthetic-older-writer', { mode: 0o600 })
        const replacement = legacyPath + '.new'
        const handle = await fsPromises.open(replacement, 'wx', 0o600)
        try { await handle.writeFile(laterBytes); await handle.sync() }
        finally { await handle.close() }
        await rename(replacement, legacyPath)
        rmSync(lock)
      }
      return rename(from, to)
    })
    try {
      const archived = await databaseModule.retireImportedFile(legacyPath, sha(importedBytes))
      assert(archived)
      const archivedBytes = readFileSync(archived, 'utf8')
      findings.push({ case: 'retirement-digest-rename-race', variant,
        interceptedRenames, canonicalFileStillPresent: existsSync(legacyPath),
        importedDigest: sha(importedBytes), archivedDigest: sha(archivedBytes),
        unimportedUpdateArchived: archivedBytes === laterBytes,
        safetyAssertion: sha(archivedBytes) === sha(importedBytes) ? 'PASS' : 'FAIL' })
    } finally { renameSpy.mockRestore() }

    const lifecycle = await import(moduleUrl('src/proxy/sessionLifecycle.ts'))
    const lifecycleDir = fixture('legacy-ownership')
    const options = { storeDir: lifecycleDir, now: () => 10000,
      preparedGraceMs: 0, retiredGraceMs: 0, lockWaitMs: 2000, lockRetryMs: 1 }
    const target = { sessionId: 'synthetic-publication-target', configDir: lifecycleDir }
    const exact = await lifecycle.prepareForkForPublication(target, options)
    const key = lifecycle.getTranscriptResourceKey(exact)
    const before = lifecycle.readSessionGcSnapshot(lifecycleDir)
    const publicationLeasesBefore = Object.values(before.resources[key].activeLeases ?? {})
      .filter(lease => lease.purpose === 'publication').length
    assert(publicationLeasesBefore > 0)
    let syntheticDeletions = 0, targetDeletions = 0
    const deleteSession = async locator => {
      syntheticDeletions++
      if (locator.sessionId === exact.sessionId) targetDeletions++
    }
    await lifecycle.runGc([], { ...options, deleter: deleteSession })
    assert.equal(syntheticDeletions, 0, 'positive control must retain live-owner publication')
    const legacy = structuredClone(before)
    const legacyResource = legacy.resources[key]
    delete legacyResource.activeLeases
    legacyResource.state = 'retired'
    legacyResource.nextAttemptAt = 0
    writeFileSync(join(lifecycleDir, 'session-gc.json'), JSON.stringify(legacy), { mode: 0o600 })
    await lifecycle.registerLiveTranscript({ sessionId: 'synthetic-unrelated', configDir: lifecycleDir }, options)
    const afterMerge = lifecycle.readSessionGcSnapshot(lifecycleDir)
    const publicationLeasesAfter = Object.values(afterMerge.resources[key].activeLeases ?? {})
      .filter(lease => lease.purpose === 'publication').length
    const stateAfterMerge = afterMerge.resources[key].state
    await lifecycle.runGc([], { ...options, deleter: deleteSession })
    const final = lifecycle.readSessionGcSnapshot(lifecycleDir)
    findings.push({ case: 'legacy-journal-preserves-publication-owner', variant,
      publicationLeasesBefore, publicationLeasesAfter, stateAfterMerge,
      syntheticDeletions, targetDeletions, finalTargetState: final.resources[key]?.state,
      safetyAssertion: publicationLeasesAfter > 0 && syntheticDeletions === 0 ? 'PASS' : 'FAIL' })
  }
  const db = new Database(':memory:')
  let sqlite
  try { sqlite = db.prepare('SELECT sqlite_version() AS version, sqlite_source_id() AS sourceId').get() }
  finally { db.close() }
  console.log(JSON.stringify({ mode: 'synthetic-read-only-review', variant,
    sourceHead: variant === 'sql' ? '6558c209f8bddf8e59b554d16c9834381c7817c2' : 'c159bf9befc49c823a94f48c8d554236115e827e',
    sourceStoreSha256: sha(readFileSync(join(source, 'src/proxy/sessionStore.ts'))),
    runtime: { platform: process.platform, arch: process.arch, nodeCompat: process.version, bun: Bun.version },
    libsqlVersion: JSON.parse(readFileSync(join(dirname(requireFromSource.resolve('libsql')), 'package.json'), 'utf8')).version,
    sqlite, modelCalls: 0, credentialReads: 0, findings }, null, 2))
} finally {
  await store.sessionStoreWritesSettled()
  if (variant === 'sql') {
    const database = await import(moduleUrl('src/proxy/session/storeDatabase.ts'))
    for (const dir of roots) await database.closeStoreDatabase(dir)
    Bun.gc(true)
    await new Promise(resolve => setImmediate(resolve))
  }
  store.setSessionStoreDir(null)
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
}
