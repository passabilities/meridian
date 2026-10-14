# #1219 semantic round 1: P1 codecs/JSON and P2 engine/guard

Disposition: **needs corrections; defer P1/P2 incorporation as submitted**.
Every assigned changed hunk was semantically reviewed: P1 12 files, P2 9 files,
21 files / 51 hunks total. This is not semantic acceptance of all 176 PR files.
The public SQL startup/lifecycle/operator contract remains **UNAPPROVED**.
Issue #1244 already approves its bounded asynchronous cleanup contract; this
review does not request that approval again, merge, or publish anything.

## Immutable scope and method

- Source: `0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f`.
- Source base: `f443faee0b135c5d4bfe1e6fe771c6a262ae5f33`.
- Fresh main comparison: `8e1c8bf738d7372ded01f28e99d6ec167acaf76f`.
- The complete extraction/index is the previously recorded 176-file patch;
  SHA-256 `e886e1210b902d41ab119f49aebd0725efe9bf3d0c4fd90e8039f4566791c78c`.
- All 21 source snapshots and probe-source copies were byte-checked against
  immutable Git blobs. Per-file identities, patch digests and hunk counts are in
  [the machine-readable review](P1-P2-review.json).
- AGENTS, ARCHITECTURE, API contract, contributor incorporation/evidence skills
  and the prior bounded SQL evidence were read. Every assigned hunk and relevant
  caller/test boundary was inspected. Main's `sessionStore.ts`,
  `sessionLifecycle.ts` and `processIncarnation.ts` are unchanged from the source
  base, verified by an empty immutable Git diff. This anchors the legacy behavior
  comparison; it does not make the entire PR current-main compatible.
- Initially read-only. Root subsequently authorized isolated synthetic probes
  using its exact-source `probe-source` dependency fixture after its reported
  `npm ci --ignore-scripts` success. No source changes, installs by this reviewer,
  test suite, application build, account/SDK inference, credential reads, browser,
  GitHub mutation or subagent delegation occurred. Only review/probe artifacts
  under this `/tmp` scope were written.

## Material findings

### F1 — medium: numeric mapping keys break the metadata-first legacy wire order

`src/proxy/session/bookkeeping/legacyCodec.ts:35–38` promises metadata-first,
compact legacy bytes, but `JSON.stringify({ [STORE_META_KEY]: meta, ...sessions })`
enumerates integer-index mapping keys before that metadata property. The unchanged
JSON writer explicitly emits metadata first at `src/proxy/sessionStore.ts:775–788`.
Therefore a valid mapping key such as `"7"` produces different bytes through the
new codec/export path. Mapping payloads and their generations are not changed by
this probe; the defect is the claimed exact wire-order contract.

Executed `codec-order`: the real JSON writer starts with metadata; codec output
starts with `"7"`; byte equality is false, parsed semantic key equality true.
Node exits 0 because assertions reproduce the defect. The corpus oracle in
`src/__tests__/bookkeeping-codec-differential.test.ts:19–21` constructs an object
the same way and would mask this case. Existing integer-order SQL mapping tests
do not establish metadata-first store bytes.

Correction: serialize metadata plus mapping entries explicitly in the historical
order, with numeric/non-numeric keys and payload ordering/generation negative
controls checked against the current-main writer. This is independently workable
internal codec work; it must not activate SQL or change startup/cleanup contracts.

### F2 — high: SQL profile-copy pruning falls back to permanently fenced JSON

`src/proxy/sessionStore.ts:1731–1739` and `:1750–1757` do not dispatch their
profile-copy selection/pruning operations through SQL. The supposedly complete
port at `src/proxy/session/bookkeeping/storeBackend.ts:12–38` omits both methods.
`releaseSupersededProfileCopies` at `src/proxy/sessionLifecycle.ts:761–798` also
lacks backend dispatch; the complete lifecycle port at
`src/proxy/session/bookkeeping/lifecycleBackend.ts:5–27` omits it. Server sweeps
call this path when `SESSION_PROFILE_COPY_PRUNE` is enabled
(`src/proxy/server.ts:817–843`). Migration permanently fences both JSON locks.

Executed `profile-prune`: a synthetic old work-profile copy is a JSON candidate
before migration. After real migration and production SQL-port installation, the
facade reports no candidates and prunes zero. The lifecycle operation expires on
the permanent `session-gc.json.lock` barrier. Both SQL mappings and both durable
pins remain. No supported SDK deletion or generation was requested.

Correction: provide SQL selection/removal with the existing activity/turn fences,
priority and rollback protection, generation advancement and bounded retirement
budget. Add port coverage and SQL-vs-JSON behavioral tests. Never remove the old
writer barriers to make this path work. This is a P1 port omission with P5
lifecycle/GC implications; coordinate the split rather than duplicating fixes.

### F3 — high: a provenance-read failure abandons an open native handle after guard release

At `src/proxy/session/bookkeeping/connection.ts:375–388`, `openDatabase` returns an
owned native handle, then the provenance SELECT runs before the handle enters the
registry. A thrown `prepare`/`get` bypasses the explicit identity-mismatch close
branch. The outer catch at `:404–413` releases the guard reference and owned guard,
but cannot close the block-scoped `db` variable. Its ownership is therefore lost.

Executed `failed-open`: inject exactly one native wrapper `prepare` error for
`SELECT migration_id,source_digests_json FROM schema_meta`, after successful
schema/data validation. Initialization rejects; the captured native database is
still usable; exclusive maintenance can be acquired while it is still open.
The probe restores the native method, closes the captured database, and exits 0.
This is a synthetic I/O-fault control, not a naturally occurring filesystem fault
or a demonstration of subsequent data corruption.

Correction: hold the post-open database in an unwind-owned variable until registry
transfer; close it on every failure before releasing the guard. If close is
uncertain, retain/terminally fence ownership as the existing poisoned-connection
path does. Add injected prepare/get and close-failure controls at this late-open
boundary. Existing invalid-schema and close-fault tests cover other boundaries.

### F4 — medium: the runtime facade exposes “offline” TRUNCATE without exclusive ownership

`src/proxy/session/bookkeeping/transaction.ts:319–324` checks only one local main
handle for TRUNCATE. `:382–384` does not require a maintenance connection or an
exclusive guard, and `src/proxy/session/bookkeeping/database.ts:12–19` re-exports
the operation from the runtime facade. A second process or another shared runtime
guard is not ruled out by `refs === 1`.

Executed `runtime-truncate`: an ordinary main handle plus a second shared guard
blocks exclusive maintenance, yet `checkpointBookkeepingOffline(...,"TRUNCATE")`
returns `{busy:0,log:0,checkpointed:0}`. Existing
`src/__tests__/bookkeeping-transactions.test.ts:491–517` positively exercises that
same shared-runtime privilege. The first new probe failed during harness cleanup
because it closed the borrowed extra guard before its main handle. That failure
is retained. Only harness cleanup order changed; a fresh isolated rerun exits 0.

SQLite still applies its native locks: no corruption or client interruption was
demonstrated. The concrete defect is that “offline” does not enforce the promised
owner boundary. Current production migration/export callers normally hold an
exclusive guard, which reduces present reach but does not protect the re-export.
Correction: require the exclusive maintenance capability at the primitive and
remove it from the runtime facade, or explicitly redefine the operator contract
before accepting that privilege. Prefer a negative control with a separate live
runtime process as well as a positive exclusive-maintenance control.

## File-by-file complete assigned coverage

All lines below refer to the exact source, not main. “No additional finding” is a
bounded semantic result, not acceptance, proof of all callers or permission to
activate SQL. All added files were read in full; all 31 `sessionStore.ts` hunks
were read with relevant unchanged callers and serialization/locking neighbors.

| Packet / file | Inspected behavior | Disposition |
| --- | --- | --- |
| P1 `legacyCodec.ts` (696 lines) | Store/sidecar validation, malformed/unknown fields, v1 upgrade, priority/rollback validation, property order, generations and maintenance own-key checks | F1 correction; internal extraction candidate after discriminating writer tests |
| P1 `lifecycleBackend.ts` (71) | Complete/partial installation, exact missing-method lists, fail-closed stubs, identity restriction and type-only facade edge | F2 missing prune port; other inspected installation guards have no additional finding |
| P1 `locator.ts` (85) | Legacy key bytes, validation, realpath/ENOENT fallback, caller-owned cache and immutable persisted/canonical locators | No additional finding; realpath work kept outside transactions in inspected callers; platform/drift proof remains |
| P1 `mappingMetadata.ts` (23) | Key-bound legacy/present generation, old denial marker and ECMAScript index/tie ordering | No additional finding; retain pure generation/order controls |
| P1 `runtimeIdentity.ts` (26) | Same-directory runtime refs and idempotent release | No additional finding; startup/close owner contract still unapproved |
| P1 `storeBackend.ts` (55) | Complete typed port, installation/identity guard, no environment activation and JSON fallback prohibition | F2 missing prune methods; SQL port activation deferred |
| P1 `storeIdentity.ts` (23) | Global synchronous-scope accounting, identity-change restriction and legacy-access rejection | No additional finding; guarded legacy access tests are meaningful |
| P1 `storeTypes.ts` (90) | Lookup status/error distinction, publication/attempt/rollback sentinels and forwarded optional arguments | No additional finding; existing argument/return semantics preserved by extraction |
| P1 `types.ts` (101) | Resource/lease/mapping ownership metadata, nullable/optional distinction, branded canonical locators, reader/write capabilities | No additional finding in declarations; new SQL contracts remain deferred |
| P1 `uuid.ts` (9) | Exact lowercase UUIDv4/variant predicate, no permissive fallback | No additional finding; pure extraction candidate |
| P1 `storeErrors.ts` (2) | Typed lock-admission timeout remains an Error; no admitted mutation implied | No additional finding; pure extraction candidate |
| P1 `sessionStore.ts` (1,837; all 31 changed hunks) | All dispatch argument lists/result types, moved decoder/types, directory identity, lock budgets/maintenance substitution, pin copies, JSON writer/cache/immutability and prune callers | F2 correction; F1 writer oracle retained. Do not wholesale apply SQL dispatch while its contract is unapproved |
| P2 `bootstrapOwner.ts` (149) | Owner-before-inode durability, exact incarnation classification, temporary/alias provenance, nlink checks and no SQLite-inode fd opens during alias retirement | No additional finding; recovery/native crash-cut proof still required |
| P2 `connection.ts` (497) | FULL/WAL/zero busy timeout, path checks, initialization/ref transfer, provenance, poison/recovery, terminal close failure, raw readers, pending/final close and bounded async startup retries | F3 correction; public handle/reader/close and startup policy unapproved |
| P2 `database.ts` (19) | Runtime-vs-maintenance export surface and test seam types | F4 remove/enforce offline privilege; exported SQL contract deferred |
| P2 `freshBootstrap.ts` (42) | Empty-input preconditions, durable phases, hard-link no-replace old-writer barriers and final source recheck | No additional finding; permanent barrier/operator authority requires decision and crash-cut proof |
| P2 `guard.ts` (388) | Real shared/exclusive native transactions, immutable guard inode, epoch handoff, borrower/ref retention, terminal native-close failure, inspection isolation and readonly URI | No additional material finding; cross-process/late-close/platform proof remains. Handoff rejects object thenables; callable thenables are a narrow untested gap, with no production caller found |
| P2 `guardIdentity.ts` (21) | Published guard cannot retire; legacy retirement intents block replacement/open | No additional finding; recovery must retain original inode |
| P2 `schema.ts` (219) | Strict numeric/JSON/state/null/FK constraints, exact DDL fingerprint, bounded counters/triggers/indexes, version/phase/integrity validation | No additional finding; SQL row semantic equivalence and schema/platform contract are not accepted by this packet |
| P2 `storagePaths.ts` (73) | UID/private directory, nofollow/nonblock fd/inode/link checks, file permission repair and explicit filesystem allowlist override | No additional finding; Windows/non-allowlisted transports not established by the macOS probe |
| P2 `transaction.ts` (385) | Begin-before-callback, capability expiry, read/row SQL filtering, permitted nesting poison, COMMIT ambiguity/no replay, hook isolation, queue admission/deadlines/cancellation and checkpoint ownership | F4 correction; remaining mechanisms have meaningful tests but are not crash/client acceptance |

## Test strengths and limits

The associated test sources were inspected, not run as a suite. Important direct
controls include:

- `bookkeeping-codec.test.ts`, `bookkeeping-codec-differential.test.ts`: v1/v2/v3,
  NULL/false, unknown nested fields, exact payload generation and malformed-record
  refusal; 70-corpus runner/17 accepted/53 refusals is an authored assertion,
  **not a test total executed by this review**. Maintenance intentionally rejects
  `__proto__` key loss and inherited rollback authority while the request decoder
  retains its legacy behavior. Its wire oracle misses F1.
- `bookkeeping-store-seam.test.ts`, `bookkeeping-store-contract.test.ts`,
  `bookkeeping-runtime.test.ts`: JSON default, copied locators, typed CAS/fallback,
  no JSON within SQL scopes, immutable directory identity, raw/copy ownership,
  NUL scalar vs JSON payload handling and production asynchronous admission.
  None exercises SQL profile-copy pruning. The GC checkpoint harness explicitly
  supplies pruning-disabled behavior (`bookkeeping-gc-checkpoint.test.ts:29–33`).
- `bookkeeping-transactions.test.ts`: shared nested capability, nested false and
  swallowed callback throw poisoning, thenable rejection and expired async
  continuation capability, real deferred-FK COMMIT fault, COMMIT-before/after
  injected uncertainty, no hook/replay, read snapshot, canceled/expired queued
  admissions, final-owner accounting, 150 deadlines and three competing writers.
  These are test designs, not executions here. Forbidden nesting/cross-database
  preflight errors are thrown before `rollbackOnly` is set; catching those errors
  in the outer callback is not covered, unlike permitted nested callback errors.
  No actual production caller relying on swallowed forbidden nesting was found.
- `bookkeeping-schema.test.ts`, `bookkeeping-review.test.ts`: schema fingerprint,
  counters, safe integers, NULL/false, history/generation ownership, wrong pins,
  real WAL DMS lock probe, automatic rollback poison, typed COMMIT busy and unknown
  outcome, failed rollback/close, FIFO/nonregular path rejection and realpath drift.
  Existing late-startup failures do not inject the post-open provenance read (F3).
- `bookkeeping-maintenance.test.ts`, `bookkeeping-bootstrap-recovery.test.ts`,
  `bookkeeping-checkpoint-queue.test.ts`: same/cross-process guard exclusion,
  exclusive-to-shared epoch race, final owner/poison retention, native bootstrap
  SIGKILL/alias recovery, readonly inspection and bounded PASSIVE checkpoint debt.
  Existing TRUNCATE test encodes the F4 privilege gap instead of rejecting it.

Raw reader rows contain only scalar projection data in the inspected consumers;
hydration/copy tests prevent returned session/locator mutation from changing SQL.
Transaction capabilities expire at callback completion. Permitted nested store
callback failure/false poisons the outer transaction, and uncertain COMMIT closes
the native connection without hook publication or callback replay while retaining
the guard. Filesystem/identity discovery is avoided in inspected hot SQL scopes;
realpath validation is explicitly performed outside the startup read snapshot.
These mechanisms do not prove actual filesystem durability, SDK history integrity,
client E41/E42 behavior, cancellation recovery or Windows ownership.

## Executed probe evidence and replay

Runtime: macOS/darwin arm64; Node `v22.22.3`, committed libsql `0.5.29`.
Bun `1.3.14` transpiled only the standalone harness. Config/state/XDG/Claude/TMPDIR
were fresh 0700 paths, processes had an allowlisted environment, and every input
was synthetic. Four final probe modes exited 0 with assertions of the defects;
no product behavior was accepted. The initial cleanup-only TRUNCATE failure
remains in [the results manifest](P1-P2-probe-results.json).

The exact runnable [harness](P1-P2-probes.ts) and package/source/bundle hashes are
escrowed here. Rebuild it from the exact source fixture:

```sh
bun build P1-P2-probes.ts --target=node --external libsql \
  --outfile probe-source/.review-p1-p2/probes.mjs
# Run each mode in a separate Node process with fresh private state/config/XDG:
# codec-order, profile-prune, runtime-truncate, failed-open
node probe-source/.review-p1-p2/probes.mjs <mode> <fresh-private-state-directory>
```

Use the environment/isolation recipe in `P1-P2-review.json` rather than an account
or existing store. Final observations:

- [Codec ordering](P1-P2-codec-order.stdout.json), exit 0, no stderr.
- [SQL pruning](P1-P2-profile-prune.stdout.json), exit 0, no stderr.
- [TRUNCATE corrected cleanup](P1-P2-runtime-truncate-corrected.stdout.json),
  exit 0, no stderr; initial cleanup failure kept in
  `P1-P2-runtime-truncate.stderr.log`.
- [Failed-open ownership](P1-P2-failed-open.stdout.json), exit 0, no stderr.

Root should move concise findings plus the runnable fault controls into a durable
repository/PR evidence record if this packet advances; `/tmp` alone is not a
landing handoff. Exact source/head/base must be refreshed before incorporation.
Apply contributor commits with Author/AuthorDate preserved and corrections
separate. Whole SQL operator/API approval, the remaining packets, material fixes,
full local/final-head CI and actual implicated client/model/platform proof remain
open. P1 pure codec/type/error extraction may proceed independently after F1 and
its direct regression controls, with no SQL activation or cleanup/startup changes.
