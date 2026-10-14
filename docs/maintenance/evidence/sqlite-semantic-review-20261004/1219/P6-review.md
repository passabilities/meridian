# #1219 P6: migration, export, barriers and recovery semantic review

Disposition: **defer P6 acceptance**. All 25 assigned files and all 25 new-file
hunks were read semantically, including their relevant callers and tests. One
bounded internal migration ordering defect was reproduced. This review does not
approve the new SQL operator or exported lifecycle contract, validate the whole
176-file stack, or establish real installed-client/platform acceptance.

## Source identity and review scope

- Source: `0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f`.
- Source/base: `f443faee0b135c5d4bfe1e6fe771c6a262ae5f33`.
- Current-main comparison supplied by root:
  `8e1c8bf738d7372ded01f28e99d6ec167acaf76f`.
- Index: `full-review/review-index.json`; immutable snapshot:
  `full-review/source-head`; patches: `full-review/diffs-github-base`.
- P6 contains 25 new files, 25 full-added hunks, **2,092 source lines**. Every
  extracted P6 blob was compared byte-for-byte with the exact Git source object.
  All 25 are absent from the supplied current-main tree. This is new SQL
  maintenance behavior; there is no existing current-main P6 implementation
  silently establishing these operator semantics.
- Read `AGENTS.md`, current and source architecture boundaries, API contract,
  review/evidence skills and incorporation/verification references, the bounded
  `1219-sqlite-scope-review.md`, source operator documentation, and applicable
  source `E2E.md` packaging limitations. Root remains the sole queue owner; no
  live GitHub mutation, source edit, package installation or model/auth operation
  was performed by this reviewer.

The initial assignment was read-only. Root then explicitly authorized one
bounded isolated synthetic probe on its exact-source, scripts-disabled locked
dependency tree. Only this probe was executed. No full suite, build, typecheck,
SDK call, account lookup, credential operation or application-global store was
used. The source CLI was interpreted by Bun; this is not a packaged Node or
independent-install result.

## Finding P6-F01: direct resumed migration archives before writer revalidation

**Moderate, reproduced; internal entry-point scope.**

At `src/proxy/session/bookkeeping/migration.ts:177`, a journaled migration
immediately calls `archiveResidues` before the PREPARED-source planning and
quiescence checks at `:180–182`. `prepareImport` performs the non-dead owner
refusal at `migrationImport.ts:49`, through `assertQuiescent` at `:23–42`.
`residueArchive.ts:98` can therefore retire a journaled gate's public name before
the resumed direct `migrateBookkeeping(..., { writersStopped: true })` call
rejects an observable current owner.

This is not a claim that the gate bytes are lost, that SDK inference occurred,
or that a documented CLI race was reproduced. The archived bytes remain intact.
The direct-call refusal is nevertheless mutating: the public gate disappears
while its associated newly present ledger owner is still non-dead. An operator
attestation should not supersede the explicit refusal for a positively live or
indeterminate ledger owner before that mutation.

The source CLI has a narrower safe control: `cli.ts:135–137` invokes
`preflightLegacyMigration` for PREPARED, and that function checks
`prepareImport`/quiescence at `maintenancePreflight.ts:26–28` before entering the
migrator. Its actual entry point preserved all files in this experiment.
Production caller inspection found the CLI as the direct migrator's production
caller; the crash fixtures also call the function directly. No public package
export of the migrator or actual CLI time-of-check/time-of-use exploitation is
claimed here. The ordering concern belongs in the maintenance primitive rather
than being inferred to expose every operator path.

Reproduction and controls:

1. Create a private owned directory with empty valid legacy documents and one
   synthetic `sdk-process-gates/<uuid>.go` file. Start the exact source migrator in
   a separate disposable process and actually SIGKILL it at `PREPARED`. Confirm
   the journal records the residue, the gate is still public, and no main
   database exists.
2. Add a valid active publication lease naming the currently running disposable
   probe process. Darwin's second-precision birth identity gives
   `indeterminate`, which must refuse; it is not converted into a death proof.
3. Run actual `bin/session-bookkeeping.ts migrate --writers-stopped --json` under
   Bun. It exits **3** for that owner. A recursive snapshot of every file's
   inode, device, mode, size and bytes is unchanged; the gate remains public.
4. Call `migrateBookkeeping` directly on the same directory. It rejects the same
   owner **after** moving the gate into its journaled cycle archive. The gate's
   bytes remain exact, the legacy ledger bytes remain exact, the journal stays
   PREPARED, and no database is created.
5. On a separate identically prepared directory without a non-dead lease, the
   actual CLI exits **0**, reaches READY and archives its sole gate. The
   fixture therefore distinguishes refusal from functioning migration.

Probe runtime: Bun **1.3.14**, macOS **arm64**, APFS type **26**; Bun reports Node
compatibility `v24.3.0` (not a standalone Node version result). Execution began
`2026-10-05T00:26:16.847Z`, ended `00:26:17.330Z`, exit **0**. Both SIGKILL children
and CLI children were terminal before cleanup; the owned synthetic root was
removed and no live child remained. SDK query count **0**.

Reproduce from this retained exact script:

```sh
bun /tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/P6-probe/probe.ts
```

Evidence: `P6-probe/probe.ts`, `P6-probe/result.json`, and source/runtime hashes
in `P6-probe/source-manifest.json`. These are review-controller temporary
artifacts, not durable repository acceptance evidence. Root must escrow any
accepted fix and its before/after control before incorporation.

Suggested correction boundary: repeat the relevant PREPARED source/quiescence
validation under maintenance ownership before resuming or beginning residue
retirement. Retain exact archived capabilities and recovery semantics. Add a
direct primitive regression that requires an observable-owner refusal to keep
the public gate, alongside the actual CLI and no-owner controls. A fix must be
reviewed separately; none was made here.

## File-by-file coverage

Each range below is the **entire** source file/new-file hunk at the exact source
SHA. Coverage does not imply execution or acceptance.

| File under `src/proxy/session/bookkeeping/` | Lines | Semantic checks |
| --- | ---: | --- |
| `abortMigration.ts` | 1–65 | BARRIERS-only start, exact empty PREPARED database proof, fence/history/provenance counts, orphan sidecars, ABORTING restart, captured identity retirement before barrier release, terminal journal update |
| `barrier.ts` | 1–59 | Own bytes/migration identity, durable release intent, private-name collision, fd/inode validation, capture restoration without public overwrite, retained capture on foreign public replacement, per-file release cut |
| `bootstrapRecovery.ts` | 1–21 | Mandatory stopped attestation plus independent exact dead-owner proof, same-process owner refusal, guard exclusivity before alias cleanup, no public main/guard unlink |
| `cli.ts` | 1–175 | All seven commands, flag restrictions, source preflight and phase admission, live/unknown residues, bootstrap handling, READY idempotency exception, corruption/unsafe exit classification and timing observer cleanup |
| `cycles.ts` | 1–105 | Terminal-cycle eligibility, source presence, identity matching, complete durable move intent, last-journal ordering, no-clobber hardlinks and inode checks, interrupted archive resume |
| `exportJournal.ts` | 1–90 | Owned private bytes, digest/size proof, all six phases, exact source names and archive shape, unique names/counts/UUIDs, existing-target inode equality, durable capture-based retirement |
| `exportJson.ts` | 1–136 | Exclusive maintenance guard, READY provenance, non-dead ledger refusal before new gate archival, coherent read snapshot, latest SQL export, free-space preflight, staged/install/checkpoint/archive transitions, final barrier release and idempotent EXPORTED behavior |
| `exportSnapshot.ts` | 1–79 | Current rows/fences/leases, store v1/v3 and priority data, mapping enumeration order, exact legacy entry preservation when projection unchanged, strict reparsing/count/digest controls |
| `guardRecovery.ts` | 1–64 | Original inode restoration only, conflicting identity refusal, foreign public/capture refusal, pending intent retention until original guard locked, aliases removed before native open to satisfy hardlink policy |
| `importValidation.ts` | 1–30 | Exact codecs/bindings/schema/triggers in rollback-only memory transaction, foreign keys, no commit hooks, eventual rollback and database close |
| `inspect.ts` | 1–124 | Read-only permissions/UID and SQLite URI, process-wide local-owner refusal, bootstrap diagnostic path, migration/export/cycle identity, WAL/SHM constraints, explicit end of reader snapshot, phase/count/barrier/residue output |
| `legacyExport.ts` | 1–34 | Resource row-version plus projection digest, mapping projection digest, raw bytes used only for matching imported projection, fresh runtime projection otherwise |
| `maintenance.ts` | 1–9 | Internal expected-phase exclusive opening, shared lower-level connection checks, no runtime-facade export |
| `maintenanceJournal.ts` | 1–162 | Atomic fsynced private file publication and directory flush, source identities/digests, strict phase/UUID/source/release/residue/abort identities, exact barrier format, explicit SIGKILL seam |
| `maintenancePreflight.ts` | 1–33 | Refuse unjournaled authority before bootstrap, readable/owned source bytes, non-dead owners, SQL representability and space without changing authority |
| `migration.ts` | 1–216 | Required attestation, exclusive guard, source observation/final protection, exact READY database identity, single import commit, no committed-source reimport, archive/close/READY ordering, legacy lifecycle/store lock substitution, F01 resumed residue ordering |
| `migrationImport.ts` | 1–123 | Actual incarnation refusal, canonical resource keys and locators, full source plan, scalar representability, lease hydration/version preservation, all fence namespaces, legacy CAS/raw history, priority rows and READY provenance |
| `offlineCheckpoint.ts` | 1–25 | Explicit idle offline TRUNCATE, bound and holder diagnostics, no automatic abandonment/authority transition while checkpoint is busy |
| `privateNames.ts` | 1–36 | UUID capabilities, long UTF-8 NAME_MAX fallback, private capture versus intent namespaces, validated recorded paths and explicit POSIX private-name concurrency assumption |
| `privateRetirement.ts` | 1–156 | Durable private intents, descriptor/inode checks and no-clobber restore, resume-before-new-delete, captured/public replacement refusal, bootstrap alias no-extra-fd path, permanent guard prohibition, directory-constrained short intent recovery |
| `recanonicalize.ts` | 1–78 | READY/no-export exclusive ownership, matching provenance, resource rekey refusal, page-only planning, pre-transaction filesystem observations, atomic mapping/pin update, preserved raw legacy history/generation/fences |
| `residueArchive.ts` | 1–101 | Live candidate/temporary refusal, unknown/dead archive intent, private archive directories, digest/inode/hardlink controls, path reuse refusal, incomplete-directory handling, pending gate retirement and F01 ordering |
| `residueDirectory.ts` | 1–66 | Empty owned candidate only, journaled private capture before rename, inode/nonempty mismatch evidence, retain foreign capture and public replacement, private manifest and no implicit destructive salvage |
| `residueInventory.ts` | 1–66 | Exact-incarnation candidate observations, live PID temporary refusal without invented death proof, gate unknown classification, bytes/digests and owned directories |
| `residueTypes.ts` | 1–39 | Source-relative allowed residue names, traversal refusal, temporary UUIDs, distinct incomplete candidate shape, unique paths, bounded identities/digests and archive capability validation |

## Relevant caller and test inspection

Read the complete source files:

- `src/__tests__/bookkeeping-migration.test.ts` (218 lines);
  `bookkeeping-export.test.ts` (270);
  `bookkeeping-recanonicalize.test.ts` (155);
  `bookkeeping-barrier.test.ts` (89);
  `bookkeeping-private-retirement.test.ts` (88);
  `bookkeeping-old-artifacts.test.ts` (199);
  `bookkeeping-cold-maintenance.test.ts` (266);
  `bookkeeping-cli.test.ts` (354);
  `bookkeeping-bootstrap-recovery.test.ts` (139);
  `bookkeeping-maintenance.test.ts` (248);
  `bookkeeping-crash-process.test.ts` (201).
- Fixtures `bookkeeping-transition.ts`, `bookkeeping-migrate.ts`,
  `bookkeeping-cold-guard.ts`, `bookkeeping-bootstrap-window.ts`,
  `bookkeeping-cli-cycles.ts`, `bookkeeping-export-oracle.ts`, and
  `bookkeeping-rich-fixture.ts`.
- Guard and bootstrap identity callers (`guard.ts`, `guardIdentity.ts`,
  `bootstrapOwner.ts`, `storagePaths.ts`, `jsonAuthority.ts`, `locator.ts`,
  `legacyExport.ts` and `mappingMetadata.ts`) were read; selected adjacent
  connection/open/close, mappings/pin validation, codec/lease validity,
  process-incarnation evaluation, transaction and legacy store/lifecycle lock
  acquisition/release code was traced. Source and current-main durable directory
  helpers propagate supported POSIX open/sync/close errors; Windows skips the
  unsupported directory fsync. This review does not claim a full P2/P3/P4 review.
- Selected adjacent codec/store/COMMIT tests were inspected for their relevant
  controls. They are not marked fully covered or executed by this P6 pass.

The tests have meaningful existing controls: legacy byte/CAS/fence and current
SQL exports; actual process SIGKILLs across migration, export, abort and cycle
phases; original guard/alias inode recovery; foreign file replacement; live
holders/readers; stale-TTL old-writer refusal; bounded names; corruption and
resource rekey refusal. Tests were inspected, **not run**. The one new causal
probe above is the only runtime evidence produced here.

## Falsification outcomes and remaining proof

- **Stopped/live/unknown writers:** attestation is explicit for migration;
  candidate and temporary live observations refuse, absent PID is not death
  proof, gates remain unknown, and the ledger requires actual dead incarnations.
  Export checks ledger owners before new gate archival. F01 disproves that this
  refusal is uniformly before mutation for a resumed direct PREPARED call. A
  real source-CLI race was not demonstrated; do not promote the direct-call
  result into that assertion.
- **Permanent old-writer barriers:** the bytes deliberately fail the legacy
  canonical pid/incarnation/token protocol, including after stale TTL. Release
  records a private inode capability; foreign public files are not deleted.
  The supplied old-package tests cover registry 1.78.0 and optional explicit
  compatibility artifacts, not every historical writer version. Their optional
  artifacts can be skipped and they borrow checkout dependencies; actual final
  installed baselines and selected supported older writer identities remain
  gates. A simulated Node subprocess behind the old gate is not a model turn.
- **Crash authority:** the database's import identity/final source digests and
  journal phases prevent replaying backups over READY state. Export installs
  both current documents before checkpoint/close/database archival, then marks
  EXPORTED before per-file barrier release. Abort proves an exactly empty
  PREPARED database and retires every observed sidecar before releasing barriers.
  The chosen SIGKILL tests do not establish power-loss ordering or all fsync,
  rename, checkpoint, commit and native-close error cuts. Actual filesystem and
  native package fault controls remain necessary.
- **Latest-state rollback:** snapshots read current SQL within one read scope;
  v1 metadata refuses silently dropping priority rows, explicit v3 includes its
  priority state, raw entries survive only through their documented preservation
  rules, and exported archived databases are digest/size-checked. Actual
  installed two-writer publication/restart/export/old-binary use and same-model
  resume/fork/tool/undo/compaction/cancellation remain unproved. External actors
  bypassing the permanent guard are not established safe by this read snapshot;
  the approved operator contract must define its supported writer boundary.
- **Recanonicalization:** resource keys/generations cannot be silently rekeyed;
  mappings with same resource key may repair project-path projections while raw
  legacy CAS bytes remain. Observations happen before one write transaction.
  Concurrent filesystem alias changes during the operation and final installed
  restart behavior remain untested; no concrete rekey bypass was found.
- **Private modes/ownership/corruption:** directories require preexisting uid
  ownership/0700, regular files are opened without following symlinks and with
  inode checks, authoritative bytes are private, and malformed/foreign or
  unjournaled authority refuses. Error recovery does not authorize deleting
  public guard identities or editing recorded dev/ino. Same-uid intentional
  tampering and arbitrary raw SQL writes are not a substitute for the operator's
  stopped-writer contract. No additional concrete identity bypass was found.
- **Recoverability:** PREPARED is resumed, while the abort command's start phase
  is BARRIERS (or ABORTING/ABORTED). A PREPARED source that disappears or becomes
  malformed can refuse resume and cannot take the normal abort start path.
  Existing tests preserve that refusal. This is an operator recovery limitation
  requiring explicit contract/documentation, not evidence of automatic salvage
  or a newly reproduced source-loss defect. Coherent backup restoration is an
  owner decision; manual barrier or public guard deletion is not authorized.

Owner approval and a tracked issue are still required for the SQL operator and
exported initialization/lifecycle contract. #1244's asynchronous cleanup
contract is already approved and must not be re-prompted. Its behavior is
outside this packet's acceptance and remains governed by the root's P4 lane.

Before P6 acceptance: causally fix or disposition F01 at its actual primitive
scope; specify the operator/writer/version/recovery contract; execute the
relevant isolated regressions and phase/fault controls; prove final
independently installed packages on supported Linux/macOS filesystems and
separate Windows behavior/policy; retain actual affected model/client/SDK and
history proof through migration/rollback; then run final local gates and required
exact-head CI. No merge or whole-stack acceptance is supported by this report.
