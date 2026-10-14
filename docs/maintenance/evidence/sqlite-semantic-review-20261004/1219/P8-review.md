# #1219 P8 full semantic review — round 1

Exact source `0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f`; GitHub base `f443faee0b135c5d4bfe1e6fe771c6a262ae5f33`; comparison main `8e1c8bf738d7372ded01f28e99d6ec167acaf76f`. All 79 assigned test/fixture files and every assigned changed hunk were read. Existing-file changes were also compared against current main; the orphan executor regression below is specific to that comparison. New files were read completely; unchanged existing-file context was inspected as needed to understand the changed assertions. Relevant transaction/connection, SQL store/publication/settlement, lifecycle/GC, runtime/cache, migration/export/codec/guard and private-retirement seams were inspected. This is P8 test semantics review, not a replacement for the independently assigned production packets.

None: read-only review only; no tests, probes, installs, models, auth or GitHub changes. Negative controls are proposed static falsifiers, not executed results.

Not acceptance. Public SQL contract remains unapproved. #1244 JSON cleanup remains separately approved. Prior bounded review is not promoted to full acceptance. Production packets and root startup/package/docs review remain separate.

## Findings

### P8-F1 (P1) — Normal npm/CI never selects the adapted historical SQLite suites

Location: `package.json:29; src/__tests__/fixtures/bookkeeping-store-backend.ts:6; src/__tests__/fixtures/bookkeeping-lifecycle-install.ts:7`.

npm test executes the standard and isolated files with neither BOOKKEEPING_TEST_BACKEND=sqlite nor BOOKKEEPING_TEST_STORE_BACKEND=sqlite. Both installers immediately return in that state. CI and release workflows run npm test without the switch. Individual observer/fixture child tests select SQLite only for themselves. Consequently priority-session-store, proxy-session-store, pruning, cache-coherence, lifecycle, process, Windows-GC, publication-lease and large contention historical assertions run as JSON under the claimed normal gate, despite substantial new direct SQL suites.

A green required test job cannot substantiate preservation of all adapted store/lifecycle invariants under the opt-in backend. New backend-only regressions in these historical cases can escape the routine gate. This is not evidence that those cases currently fail.

Correction: Add explicit process-isolated SQLite invocations for the adapted suites, retaining JSON invocations and visible legacy-only skip reasons. Do not globally turn the whole standard batch SQLite; isolated process-global backend/mock discipline matters. Typecheck must remain pretest.

Concrete unexecuted negative control: In a throwaway probe, make setupStoreBackend/setupLifecycleBackend throw only when the SQLite switch is selected. Normal required test should reach/fail that control. Then restore and run each adapted suite in isolated SQLite mode; currently static runner inspection proves the control is never reached.

### P8-F2 (P2) — Candidate discards the current-main actual executor startup/release handshake

Location: `src/__tests__/session-lifecycle-process.test.ts:54; src/__tests__/session-lifecycle-process.test.ts:159; src/__tests__/session-lifecycle-process.test.ts:329`.

Compared with exact current main 8e1c8bf, candidate removes the executor-started marker loop before ready, EXECUTOR_STARTED_FILE and EXECUTOR_RELEASE_FILE env fields, and parent explicit release after proving the dead-owner fence. It substitutes await Bun.sleep(1500) in an asynchronously started SDK-gate child and emits ready immediately after spawn. The comment acknowledges ready does not start the physical child lifetime.

SIGKILL can target an unopened gate rather than a running orphaned executor. A delayed host can also expire the guessed child lifetime before the fencing assertions. This loses the causal invariant already present in current main; waiting for wrapper exit afterwards does not restore proof the SDK child had started before owner death.

Correction: Preserve current-main startup marker and explicit release handshake while adding backend installation; assert exact running executor remains alive while owner is killed and fencing is checked, then release and join it.

Concrete unexecuted negative control: Delay asynchronous SDK-gate publication past owner ready; the candidate can report ready with no physical executor-start marker. The maintained main fixture must wait for marker and never kill owner before it. Also delay parent fencing assertions past1500ms; explicit release keeps child alive without guessing.

### P8-F3 (P2) — Hanging-child budget case does not prove the full execution timeout

Location: `src/__tests__/session-lifecycle-gc-budgets.test.ts:387; src/__tests__/session-lifecycle-gc-budgets.test.ts:398; src/__tests__/session-lifecycle-gc-budgets.test.ts:400`.

The case uses runTimeoutMs300 and deletionTimeoutMs2500, but asserts only failed/retired/timeout text, cleared executor, an SDK marker and removed gate. It records/asserts no monotonic elapsed time from gate/SDK start. A child killed300ms after actual SDK start has the same state/error/marker/cleanup facts. The earlier delayed-claim30ms-success test does discriminate charging exhausted run remainder before invocation; it does not make this execution-duration assertion discriminating.

The named hanging-execution control remains green if an already-started deletion is truncated to the short run budget. Current implementation passes the full timeout argument, so this finding is about missing regression discrimination, not a detected timeout bug.

Correction: Record a monotonic start marker after the gate actually opens or have a finite SDK delay greater than300ms and below2500ms that must succeed; retain the hung child kill/join case with elapsed lower bound tied to execution start and a bounded upper bound.

Concrete unexecuted negative control: For this one case, shorten only the post-gate execution timeout to300ms while retaining handshake and SDK start. Existing verdict/marker assertions still match; repaired control must fail.

### P8-F4 (P2) — Successful Node contention ignores its measured stall metrics

Location: `src/__tests__/bookkeeping-transactions.test.ts:329; src/__tests__/bookkeeping-transactions.test.ts:354; src/__tests__/bookkeeping-transactions.test.ts:367; src/__tests__/fixtures/bookkeeping-contention.ts:54`.

The actual250ms held-lock fixture measures maxLag and event-loop-delay histogram and reports elapsed/ticks. Parent asserts Node>=22, callback once, committed row1 and ticks>0 only. A200ms synchronous pause during the2000ms admission budget can leave some ticks before/after and preserve all assertions.

The test title claims no long synchronous event-loop stall, but its success criteria do not enforce that claim. Other expiry/three-process heartbeat controls have useful25ms gap assertions and a blocking negative control; this finding is scoped to successful wait admission.

Correction: Use the maintained heartbeat helper or assert a tolerated max-gap/tick-density bound including endpoints throughout the successful wait, and keep exact row/callback checks.

Concrete unexecuted negative control: Insert a bounded blocking Atomics wait during the successful contention interval while keeping final admission below2000ms. The current parent accepts positive ticks; a repaired success-path lag assertion must reject it.

### P8-F5 (P2) — Real finalize-versus-rollback winner invariant is treated as JSON-only

Location: `src/__tests__/priority-session-store.test.ts:1111; src/__tests__/priority-session-store.test.ts:1157; src/__tests__/bookkeeping-store-multiprocess.test.ts:13`.

The original two-process terminal settlement race is wrapped in legacyStoreOnly. Its child functions race finalizeSharedSessionAndPriorityAssignment against rollbackSharedSessionAndPriorityAssignment for identical mapping/assignment generations and assert exactly one winner plus coherent route/mapping. The new20-barrier SQL race covers storeSharedSessionAndPriorityAssignment publication, not terminal settlement; sequential SQL settlement tests do not race processes.

Terminal single-winner is a backend semantic invariant independent of JSON bytes. It has no actual multi-process SQL counterpart even after fixing F1. No current production violation was observed; SQL implementation uses one write transaction and is structurally serialized.

Correction: Provide initialized-SQL child settlement fixture and retain the same exactly-one terminal winner, loser/no-partial-state, coherent-generation and attempt-authority assertions for both finalize and rollback winning schedules.

Concrete unexecuted negative control: A settlement mutant that checks generations/rollback authority before BEGIN then applies stale observations after admission can preserve sequential behavior but permit two terminal winners. Synchronize two initialized SQL children before admission and force both schedules; repaired test must reject the mutant.

## Evidence boundaries and missing gates

### P8-G1 — Historical artifact coverage is optional and compatibility identity is not enforced

Location: `src/__tests__/bookkeeping-old-artifacts.test.ts:18; src/__tests__/bookkeeping-old-artifacts.test.ts:23; src/__tests__/bookkeeping-old-artifacts.test.ts:28; E2E.md:7179`.

The npm1.78.0 artifact has a useful positive real writer/SDK-child control and exposes actual lexical implementations rather than substituting new source. Network/tool/cache failure explicitly skips it; missing compatibility package also explicitly skips. Arbitrary existing BOOKKEEPING_COMPAT_TARBALL is accepted without expected package version/source digest. Full npm green may therefore contain zero historical-writer executions, and an arbitrary artifact cannot be accepted as a named older variant without external identity evidence. Documentation properly calls optional unavailability missing rather than pass.

Proposed control: Use unavailable registry/cache with no compat tarball and inspect explicit skips; required acceptance must remain missing. Supply a candidate/current tarball as compat and require package version/source/archive digest validation to reject a mislabeled baseline. Preserve actual published1.78.0 positive control and per-file release behavior.

### P8-G2 — Durability proof boundaries must stay explicit

Location: `src/__tests__/bookkeeping-cache-publication.test.ts; src/__tests__/bookkeeping-lifecycle-injection.test.ts; src/__tests__/bookkeeping-crash-process.test.ts; src/__tests__/fixtures/bookkeeping-safety.ts:44`.

Most IOERR/COMMIT/close errors are injected JS transaction/close wrapper seams. After-IOERR really executes native COMMIT before throwing; deferred-FK test produces an actual failed native COMMIT; SIGKILL exercises actual process death at named durable cuts. These are meaningful distinct proofs, but none establishes arbitrary filesystem power-loss, real driver-close failure, torn disk writes or fsync IOERR behavior. Rich snapshots use counts plus production export codecs; independent per-entry source digests and explicit70-case bytes strengthen but do not independently hash every internal SQL row.

Proposed control: Keep wrapper-before/after commit controls distinct; any future fsync/driver fault claim needs an actual layer fault and reopen/readback proof. Do not label every error-matrix iteration a native disk failure or SIGKILL power-loss.

### P8-G3 — Native client/platform and public SQL acceptance remain open

Location: `src/proxy/session/bookkeeping/storagePaths.ts:13; src/__tests__/bookkeeping-review.test.ts; src/__tests__/session-lifecycle-process.test.ts:297; src/__tests__/session-lifecycle-windows-gc.test.ts:220; E2E.md:7173`.

Node fixtures are real local processes and native libsql; several are Bun child processes. Filesystem allowlist parameter injection proves policy logic, not actual native Linux/Windows runtime. SQLite filesystem allowlist permits darwin/linux only unless operator opts into unverified FS, so adapted Windows-GC SQL run is not default-supported Windows acceptance. Existing Windows-only recovery is explicitly gated and some POSIX cases return silently on win32. Fake SDK Hono app.fetch and marker children are not actual affected model/client E2E. Packaged smoke explicitly disclaims model turns and requires final independently installed package on Linux. New opt-in environment/public initialization/lifecycle contract cannot gain owner approval from these tests; approval remains absent per root scope.

### P8-G4 — AST inventories are local guards, not exhaustive semantic proof

Location: `src/__tests__/bookkeeping-server-admission.test.ts; src/__tests__/bookkeeping-deletion-invariant.test.ts`.

Deletion AST test documents local syntactic limits and has useful alias/computed negative cases. Server admission AST uses hardcoded direct mutation identifiers and expected parent-call patterns; alias/property/interprocedural paths are not covered. No uncovered production call was proved here. A green AST inventory cannot replace runtime whole-server mutation/cancellation evidence or production packet review.

### P8-G5 — Large payload timings are mostly artifacts rather than resource-bound assertions

Location: `src/__tests__/bookkeeping-migration.test.ts; src/__tests__/bookkeeping-export.test.ts; src/__tests__/bookkeeping-reconcile.test.ts; src/__tests__/session-gc-contention.test.ts`.

Large migration/export fixtures validate38MB content/counts, and reconcile benchmarks report128/2000 counts/timings; they do not bound peak memory/event-loop delay. The1400-resource24-registration test asserts zero timeout and hash-count bound but adapted SQL invocation is missing from npm. JSON warm-mutation lag does have a measured median<75% actual-lock/fsync baseline and serialization controls. Distinguish that accepted JSON optimization evidence from a full SQL scalability claim.

## Per-file coverage (79/79)

The JSON companion records exact file SHA256, line count and every changed-new-line hunk range. “Complete” means read-only semantic review of the assigned changes; it does not mean the tests passed or supplied contract approval.

### 1. `src/__tests__/bookkeeping-admission-seam.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 71 lines.

One-time admission-wait seam has an explicit blocking Atomics negative control, actual external Node BEGIN holder, timer-starvation assertion, and typed expiry; cleanup restores seam and joins child. This is meaningful heartbeat discrimination, unlike the successful-wait case in F4.

### 2. `src/__tests__/bookkeeping-barrier.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 89 lines.

Barrier tests preserve source/private inode and bytes through before/after rename hooks, occupied destinations, substitutions, and resumed intents. Hooks model deterministic race windows; no machine power-loss claim follows.

### 3. `src/__tests__/bookkeeping-bootstrap-recovery.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 139 lines.

Actual SIGKILL bootstrap/migration children cover main/guard hardlink publication and private retirement, with readonly byte inspection and same-inode recovery. Actual external exclusive probes support retained OS exclusion. UNIX FIFO/symlink and NAME_MAX cases do not establish native Windows behavior.

### 4. `src/__tests__/bookkeeping-cache-publication.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 258 lines.

Durable/cache publication tests inspect read-own-writes and after-COMMIT authority, rollback on false/throw, missing/evicted/cleared entries, priority finalize/rollback, and before/after native COMMIT wrapper errors. Degraded-read observation is deliberate; injected IOERR is not an actual disk failure.

### 5. `src/__tests__/bookkeeping-checkpoint-queue.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 154 lines.

Checkpoint FIFO, deadline/cancellation, pending count, external Node writer, and live reader WAL debt assertions are substantive. PASSIVE partial progress is distinguished from offline TRUNCATE and after-release success.

### 6. `src/__tests__/bookkeeping-cli.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 354 lines.

Built Node CLI executes 50 cycles, real external reader/holder refusal, SIGKILL recovery, byte/inode preservation, candidate incarnation and foreign SQLite preflight controls. Builds local dist, not independently installed registry acceptance; synthetic residue inventories remain qualified.

### 7. `src/__tests__/bookkeeping-codec-differential.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 147 lines.

Independent accepted/refused corpus and expected wire bytes are compared across Bun and bundled Node codec execution, then migration/export. Production source codec is also used as oracle, so this is strengthened by explicit expected byte/error cases rather than being wholly independent of the codec.

### 8. `src/__tests__/bookkeeping-codec.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 203 lines.

Version/fence allocation, unknown payload ordering, explicit false executor fields, nullable SDK UUIDs, priority metadata, corrupted-vs-absent input and unrepresentable own-map keys have direct assertions. Maintenance refusal is separated from tolerant historical request decoding.

### 9. `src/__tests__/bookkeeping-cold-maintenance.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 266 lines.

Cold guard identity, fresh provenance, no implicit SQL adoption/fallback, read-only inspection, exact owned bootstrap recovery and stopped residue archival have real child controls. Current-build legacy writer is a protocol control; only the optional artifact suite provides historical bundle coverage.

### 10. `src/__tests__/bookkeeping-crash-process.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 201 lines.

Rich migration/export/cycle fixtures run actual process SIGKILL at named durable phase cuts and compare row counts/export digests plus source JSON entry digests. This establishes process-crash recovery at those cuts, not power-loss durability or arbitrary driver/fsync failure.

### 11. `src/__tests__/bookkeeping-deletion-invariant.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 164 lines.

AST deletion invariant examines the full authored source inventory and a meaningful alias/computed-call negative corpus. It explicitly scopes itself to local syntax, not whole-program taint or hostile filesystem actor proof.

### 12. `src/__tests__/bookkeeping-export.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 270 lines.

Export preserves current state over imported backups, invalidates legacy payload after row-version ABA, refuses live/foreign ownership, v1 loss of priority rows and wrong digests. Archived SQLite readonly mutation is real. Large 38MB fixture checks content/counts but records rather than bounds time/memory.

### 13. `src/__tests__/bookkeeping-gc-checkpoint.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 94 lines.

Test extracts actual server GC closure via TypeScript AST and invokes it with explicit dependencies. It covers post-GC checkpoint debt, native BUSY deadline, injected fatal error, next-sweep retry, and no checkpoint after failed GC. This is not whole-server startup/wiring acceptance.

### 14. `src/__tests__/bookkeeping-handshake-cancellation.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 78 lines.

After real claim COMMIT a child acquires actual native write lock; deadline/clear/cancel modes inspect executor COMMIT counts, SDK marker absence/presence, pending cleanup and later admission. Captured marker proves a stand-in SDK ran, not actual model/SDK deletion.

### 15. `src/__tests__/bookkeeping-lifecycle-deletion.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 466 lines.

Deletion tests cover exact/null/foreign pins, pages, budgets, outside-SQL incarnation capture, owner/token CAS, COMMIT faults, bounded tombstones, custom hung deleter permanent fencing, real child gate attach/kill/join and orphan owner. Custom-deleter timeout and SDK child controls are distinct.

### 16. `src/__tests__/bookkeeping-lifecycle-differential.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 133 lines.

Step-by-step JSON/SQL operation differential normalizes only internal rowVersion, fixes UUID/clock/incarnation, and compares resource/fence/pin/result/error ledgers after transitions including publication, lease death, retry, and bounded GC. Simulated death remains policy evidence, complemented by real-process tests elsewhere.

### 17. `src/__tests__/bookkeeping-lifecycle-fixture.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 57 lines.

Fresh child fixture exercises real initialized SQLite lifecycle/store ports and durable pin protection with no JSON document, then teardown and reopen. It validates fixture installation twice, not backend execution of every adapted historical suite.

### 18. `src/__tests__/bookkeeping-lifecycle-injection.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 160 lines.

COMMIT fault matrix targets 21 operations, ordinals 1–4, BUSY/before-IOERR/after-IOERR. Independent expected committed-prefix effects and all-table snapshots check callback counts, no hooks, lease/generation authority and retry. Wrapper errors model uncertain outcomes; no actual IOERR injection at filesystem layer.

### 19. `src/__tests__/bookkeeping-lifecycle-observer.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 63 lines.

Cross-backend observer child confirms real rows/leases/fences/counts/pins and no document rewrites. SQL observer uses production row hydration in one snapshot; it is a test adapter, not a public lifecycle API.

### 20. `src/__tests__/bookkeeping-lifecycle-prepare.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 253 lines.

Preparation asserts one transaction/fence/publication owner, rollback, five-state guards, exact generations, collision/NUL, capacity, safe-integer fences and retirement headroom. Failed capacity and invalid clocks preserve rows/leases rather than partially promoting.

### 21. `src/__tests__/bookkeeping-lifecycle-publication.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 383 lines.

Publication table matrix checks state, all joined tables, stale dual CAS, false/throw/thenable rollback, locator restoration, COMMIT uncertainty, leases and post-commit hooks. Canonicalization happens before lock; actual Node publication race has one winner with no partial row/pin.

### 22. `src/__tests__/bookkeeping-lifecycle-transitions.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 299 lines.

Transition and lease suite rejects unavailable backend ports, missing/stale generations, recursive/cross-database scopes and unsafe owner observations. Full owner/token/version predicates are tested against replaced leases; real writer BUSY/deferred-release heartbeat complements simulated death/boot controls.

### 23. `src/__tests__/bookkeeping-maintenance.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 248 lines.

Maintenance tests hold actual shared/exclusive guards, probe two processes and same-process aliases, retain guard through poisoned main reopen, refuse foreign/zero/wrong-format guards and validate epoch handoff gaps. Closing one shared borrower must not release physical exclusion.

### 24. `src/__tests__/bookkeeping-migration.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 218 lines.

Migration asserts exact legacy resources/history/fence/priority import and barrier/backups, explicit stopped-writer attestation, preflight refusal before publication, resumable SIGKILL cuts and no reimport after COMMIT. ENOSPC uses an availableBytes seam. Large fixture is count/content evidence with recorded metrics, not latency/memory acceptance.

### 25. `src/__tests__/bookkeeping-old-artifacts.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 199 lines.

Old npm bundle lexical bindings are exposed without rewriting implementations, with positive real writer/gated-child marker controls and READY/export-cut refusal. Registry unavailability and unset optional compatibility tarball skip tests explicitly. Supplied compatibility artifact version/content digest are not enforced or escrowed by this suite (G1).

References: P8-G1.

### 26. `src/__tests__/bookkeeping-private-retirement.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 88 lines.

Private retirement tests check identity-preserving capture/restoration, interruption/resume, occupied public names and preserved foreign/new-public bytes. It validates protocol race hooks and manifest refusal, not arbitrary concurrent tampering after private ownership.

### 27. `src/__tests__/bookkeeping-recanonicalize.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 155 lines.

Recanonicalization tests preserve raw history/CAS/fences/resources while repairing only projection/pins, reject resource-key drift and structural corruption, and demand exclusive READY ownership. UID/realpath behavior is POSIX-oriented; native Windows is not established.

### 28. `src/__tests__/bookkeeping-reconcile.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 297 lines.

Reconcile pages 257 resources with generation/version rechecks, concurrent pins/new upper-bound rows, rescue-before-retire ordering, leases and exact deleting-owner recovery. POSIX surviving process-group control is real; boot/foreign-host policies are simulated. Timing benchmarks only record measurements.

### 29. `src/__tests__/bookkeeping-review.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 460 lines.

Adversarial review tests include real WAL DMS fcntl lock, actual RAISE(ROLLBACK), read capability rejection, full corruption audits, alias/no-open child controls, two real initializers, poison reopen and schema/index checks. Filesystem policy parameter injection proves allowlist logic, not actual Linux filesystem or Windows support.

### 30. `src/__tests__/bookkeeping-runtime.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 241 lines.

Runtime default/opt-in/initialization/ref ownership, no implicit migration, atomic rollback pins, canonical identity and prelisten paged prune are checked. Real external Node writer and >=20 timer ticks exercise async admission. Mocked createProxy does not establish authenticated client/model acceptance or owner approval.

### 31. `src/__tests__/bookkeeping-schema.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 426 lines.

Real SQLite DDL/CHECK/FK/triggers/counts/index plans/private pragmas and path integrity are asserted; legacy history/pins/fence/projection corruption refuses initialization. Query plans and bounded LIMIT shape are not measured production performance. FULL/WAL configuration alone is not power-loss proof.

### 32. `src/__tests__/bookkeeping-server-admission.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 83 lines.

Server admission AST inventory checks direct hardcoded mutation-root identifiers under expected admit/publish scopes and selected publication flags. It is a useful local guard, but alias/member-call/interprocedural bypass is not tracked; no whole-server behavior or exhaustive dataflow claim is established.

References: P8-G4.

### 33. `src/__tests__/bookkeeping-server.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 138 lines.

Actual Hono app.fetch Messages paths use fake SDK and real SQLite ports: stream/nonstream success and publication COMMIT before/BUSY/after failure. Nonstream asserts 503 overloaded_error; stream asserts error text/type but not exact wire/event order. No actual client/model/platform gate.

### 34. `src/__tests__/bookkeeping-store-contract.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 145 lines.

Scalar NUL fails before SQL and fence effects; NUL inside encoded history/payload is preserved, locators copied, own-write reads roll back, and incompatible schema refuses. Export CLI invokes local dist, so its execution assumes a prior build stage; standalone file run is not self-contained packaging proof.

### 35. `src/__tests__/bookkeeping-store-differential.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 141 lines.

Store JSON/SQL differential fixes UUID/clock and compares results across ordinary CAS, attempts, dual publication, settlement, pins, caps and snapshots. This is policy equivalence against JSON façade, not concurrent-process settlement proof.

### 36. `src/__tests__/bookkeeping-store-multiprocess.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 97 lines.

Twenty actual Bun child barriers assert exactly one identical dual-generation publication winner, real BUSY or CAS loser, and coherent mappings/history/route. This covers publication, not finalize-vs-rollback terminal settlement (F5), and is Bun rather than Node fixture execution.

### 37. `src/__tests__/bookkeeping-store-mutations.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 598 lines.

Complete SQL mutation API suite directly checks CAS/absence fences, priority claims/publication/finalize/rollback, caps/rollback protection, imports, own-write joins/hook order and external native BUSY with no Atomics sleep. Sequential settlement assertions do not replace the missing concurrent terminal race.

### 38. `src/__tests__/bookkeeping-store-reads.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 221 lines.

SQL reads are compared with pre-migration JSON façade including ties/numeric object order, legacy denial, exact history/null SDK entries and pins. Addressed winner hydrates only addressed history; generation/pin metadata avoids history fetch. Query-plan spies are shape controls, not throughput benchmarks.

### 39. `src/__tests__/bookkeeping-store-seam.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 189 lines.

Internal backend seam keeps JSON default, rejects identity/cross-database changes, joins scopes/hooks, forbids accidental JSON access in SQL scope and preserves signatures/CAS lineage. Real external writer and Atomics spy test immediate BUSY. Test seam installation is not public approval.

### 40. `src/__tests__/bookkeeping-transactions.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 630 lines.

Engine tests cover real deferred-FK failed COMMIT, false/throw rollback, uncertain wrapper errors, expired tx capabilities, FIFO/cancellation/pending, actual multi-SELECT snapshot, WAL checkpoint and Node/three-process admission. Successful 250ms contention only asserts ticks>0 despite measuring lag (F4).

References: P8-F4.

### 41. `src/__tests__/bookkeeping-uuid.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 119 lines.

UUID type/runtime rejection corpus exercises migration/export/cycles/retirement/CLI and unchanged inode/byte snapshots. Type assertions require npm pretest; targeted Bun alone does not establish TypeScript branding.

### 42. `src/__tests__/fixtures/bookkeeping-admission-deadline.ts`

Complete; complete new file and relevant implementation seams. Head file: 62 lines.

Bundled Node child runs 150 native-lock admissions with 80ms deadlines and elapsed bounds. Parent owns actual holder and cleanup; this fixture intentionally calls deadline-only assertion, with separate heartbeat fixture/three-process tests proving timer responsiveness.

### 43. `src/__tests__/fixtures/bookkeeping-bootstrap-window.ts`

Complete; complete new file and relevant implementation seams. Head file: 16 lines.

Bootstrap phase observer kills real process at authored bootstrap/migration/retirement checkpoints. This is an actual process crash cut; crashPoint selection and output do not simulate machine power-loss.

### 44. `src/__tests__/fixtures/bookkeeping-bootstrap.ts`

Complete; complete new file and relevant implementation seams. Head file: 9 lines.

Async initialization fixture performs real schema initialization after IPC release, reports one schema version and closes. It supports simultaneous-initializer test, not independent packaged install.

### 45. `src/__tests__/fixtures/bookkeeping-cli-cycles.ts`

Complete; complete new file and relevant implementation seams. Head file: 9 lines.

CLI cycle fixture executes actual CLI command function 50 migrate/export rounds in one Node process and requires every exit code zero. It tests registry/guard lifetime reuse inside that process.

### 46. `src/__tests__/fixtures/bookkeeping-cold-guard.ts`

Complete; complete new file and relevant implementation seams. Head file: 36 lines.

Cold guard fixture probes real guard, actual current-build legacy writer and synthetic durable retirement provenance. Its generic probe refusal exit73 alone is not typed lock causality, but parent tests pair it with held/free positive control and stronger typed guard fixture.

### 47. `src/__tests__/fixtures/bookkeeping-contention.ts`

Complete; complete new file and relevant implementation seams. Head file: 95 lines.

Successful-lock fixture runs real external Node BEGIN holder for 250ms, measures ticks/maxLag/histogram and committed row; parent only asserts ticks>0 (F4). Cleanup joins native child. It needs a success-path stall discriminator.

References: P8-F4.

### 48. `src/__tests__/fixtures/bookkeeping-export-oracle.ts`

Complete; complete new file and relevant implementation seams. Head file: 24 lines.

Export oracle derives expected source entries through production legacy decoder and compares full decoded before/after plus exact per-entry JSON digest. It catches exported loss of supported fields; decoder-shared normalization is not a fully independent raw-byte oracle.

### 49. `src/__tests__/fixtures/bookkeeping-guard.ts`

Complete; complete new file and relevant implementation seams. Head file: 39 lines.

Guard fixture uses real shared/exclusive SQLite and maps only typed busy to refusal73, with runtime IPC close and durable dead bootstrap alias support. This strengthens raw OS exclusion over generic fixture refusals.

### 50. `src/__tests__/fixtures/bookkeeping-heartbeat.ts`

Complete; complete new file and relevant implementation seams. Head file: 33 lines.

Heartbeat helper includes interval endpoints, minimum tick density and maximum25ms gap; deadline bounds are explicit. Blocking Atomics seam is a negative control showing this assertion fails on starved timers.

### 51. `src/__tests__/fixtures/bookkeeping-lifecycle-backend.ts`

Complete; complete new file and relevant implementation seams. Head file: 11 lines.

Env-gated legacy-only adapter visibly skips JSON protocol tests only for SQLite and reexports fixture installer. Normal npm does not set the env switch (F1); adaptation itself does not prove historical SQL suites ran.

References: P8-F1.

### 52. `src/__tests__/fixtures/bookkeeping-lifecycle-injection-effects.ts`

Complete; complete new file and relevant implementation seams. Head file: 147 lines.

Expected COMMIT-prefix effects clone prior state and explicitly model resources/fences/leases/pins/counts/locator mutation. Random tokens are UUID-shape checked, not fully independently regenerated; assertions use after only for generated identity, with nonrandom effects independently specified.

### 53. `src/__tests__/fixtures/bookkeeping-lifecycle-injection.ts`

Complete; complete new file and relevant implementation seams. Head file: 53 lines.

Fault injector arms exact write-COMMIT ordinal, executes actual COMMIT only in after-IOERR mode and verifies hit count. Deleting-resource fixture writes synthetic persisted crash state; it is not a dead-process observation by itself.

### 54. `src/__tests__/fixtures/bookkeeping-lifecycle-install.ts`

Complete; complete new file and relevant implementation seams. Head file: 28 lines.

Fixture installer activates actual SQLite store/lifecycle ports only when BOOKKEEPING_TEST_BACKEND=sqlite, supports multiple child/derived directories and restores ports/store on teardown. Parent/child env inheritance is essential; missing npm invocations are F1.

References: P8-F1.

### 55. `src/__tests__/fixtures/bookkeeping-lifecycle-observer.ts`

Complete; complete new file and relevant implementation seams. Head file: 51 lines.

Observer reads real SQL resources/lease projections, fence slots/counts and pins in one read scope, or raw JSON sidecar. Production readResource/readResourceLease are used; this is not a schema-independent serialization oracle.

### 56. `src/__tests__/fixtures/bookkeeping-migrate.ts`

Complete; complete new file and relevant implementation seams. Head file: 6 lines.

Node migration fixture calls actual migrateBookkeeping with explicit writersStopped attestation and serializes result. It is synthetic offline fixture authority, not authorization to migrate owner data.

### 57. `src/__tests__/fixtures/bookkeeping-nested-codec-corpus.ts`

Complete; complete new file and relevant implementation seams. Head file: 70 lines.

Nested corpus supplies accepted/rejected sidecar/store owner/fence/generation/priority cases, duplicate JSON keys and own-map-key edges. Expected cases are portable fixture policy, combined with explicit error/byte differential assertions.

### 58. `src/__tests__/fixtures/bookkeeping-publication-process.ts`

Complete; complete new file and relevant implementation seams. Head file: 28 lines.

Actual Node publication fixture installs SQL façade, pauses at IPC barrier, runs async publish plus exact store CAS, distinguishes typed BUSY, and closes. It supports one-winner publication race, not terminal settlement.

### 59. `src/__tests__/fixtures/bookkeeping-residue-inventory.ts`

Complete; complete new file and relevant implementation seams. Head file: 25 lines.

Residue inventory deliberately generates dead-boot candidate/gate identities, foreign/live/unknown residues and untouched turn-lock directories. These are fixture classification records, not actual historical process ancestry.

### 60. `src/__tests__/fixtures/bookkeeping-rich-fixture.ts`

Complete; complete new file and relevant implementation seams. Head file: 112 lines.

Rich fixture includes explicit false executorRecoverable, unknown payload ordering, null UUIDs, generations/fences and v3 attempts/rollbacks. Uninterrupted control uses cloned original inputs. Snapshots combine all-table counts with production export digests; not every internal SQL row is hashed independently.

### 61. `src/__tests__/fixtures/bookkeeping-safety.ts`

Complete; complete new file and relevant implementation seams. Head file: 86 lines.

Safety fixture instruments auxiliary opens on lock-bearing inodes and runs actual cleanup, plus FIFO refusal. closeDatabase failures are wrapper functions that throw without native close, validating fail-closed authority logic rather than demonstrating actual driver-close failure behavior.

### 62. `src/__tests__/fixtures/bookkeeping-store-backend.ts`

Complete; complete new file and relevant implementation seams. Head file: 27 lines.

Env-gated store fixture initializes actual fresh schema and SQL backend, visibly skips JSON file-protocol cases, then closes/resets. Both accepted switches are absent from npm test stages (F1).

References: P8-F1.

### 63. `src/__tests__/fixtures/bookkeeping-store-racer.ts`

Complete; complete new file and relevant implementation seams. Head file: 27 lines.

Actual Bun child direct SQL publication racer waits on IPC and reports won/CAS/typed BUSY, closes connection and disconnects. Valid publication race control; a Node-platform claim would be inaccurate.

### 64. `src/__tests__/fixtures/bookkeeping-support.ts`

Complete; complete new file and relevant implementation seams. Head file: 20 lines.

Support bundles authored fixture for Node with external libsql and links current checkout node_modules; optional bench output goes to acceptance directory. Thus actual Node executes native code, but not independently installed tarball dependencies.

### 65. `src/__tests__/fixtures/bookkeeping-three-process.ts`

Complete; complete new file and relevant implementation seams. Head file: 179 lines.

Three actual Node workers have an initial held-lock80ms expiry/heartbeat discriminator, then250 contended admissions per worker with bounded budget, counts/row checks and actual IPC. Phase2 does not demand any BUSY loser; phase1 ensures true contention and timer control.

### 66. `src/__tests__/fixtures/bookkeeping-transition.ts`

Complete; complete new file and relevant implementation seams. Head file: 10 lines.

Transition fixture invokes actual migration/export/abort with stopped-writer attestation. SIGKILL phase environment is inherited and parent validates terminal/crash results.

### 67. `src/__tests__/fixtures/full-document-store-rewrite.ts`

Complete; complete new file and relevant implementation seams. Head file: 36 lines.

Full-document baseline uses actual historical lock, fsync-temp, rename and directory flush protocol instead of a parse/write-only synthetic baseline. Unknown errors are retained/cleanup logged; best-effort directory flush matches legacy semantics.

### 68. `src/__tests__/priority-session-store.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 1354 lines.

All changed store contract/API assertions preserve separate JSON byte invariants. File-protocol/old-writer/cross-process suites become visibly legacy-only. Real finalize-vs-rollback single-winner is incorrectly categorized with JSON protocol despite being a backend semantic invariant (F5).

References: P8-F1, P8-F5.

### 69. `src/__tests__/proxy-session-store.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 452 lines.

Backend installation adapts unchanged public store behavior; raw identity cache/foreign file replacement/deletion/JSON upgrade/corruption cases remain JSON-only. New SQL locator/history/denial equivalents exist elsewhere. Compared current-main delta: no newly removed current-main assertion.

References: P8-F1.

### 70. `src/__tests__/session-cache-coherence.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 87 lines.

Historic cache-coherence cases simulate a foreign store mutation in the same process, then assert local cache refresh/eviction/generation scoping. Added installer permits SQL variants but npm leaves it off (F1). Actual SQL process publication has separate coverage; this file alone is not a cross-process test.

References: P8-F1.

### 71. `src/__tests__/session-gc-contention.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 125 lines.

Large1400/800-pin sidecar fixture adapts to real SQL rows, concurrent24 registrations plus optional GC assert zero timeouts, correct durable rows and bounded hash count. Timings are recorded. SQL mode only runs under unconfigured env (F1).

References: P8-F1.

### 72. `src/__tests__/session-lifecycle-gc-budgets.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 418 lines.

Four JSON durable-sync/gate budget cases use real default Node child with stand-in SDK; first claim-delay and late-attach controls are discriminating. Fourth hanging-child execution test has no2500ms elapsed/start-gate assertion and passes with a truncated execution budget (F3). No SQL installer in this file.

References: P8-F3.

### 73. `src/__tests__/session-lifecycle-process.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 392 lines.

Real armed/unarmed/orphaned child leases and SDK absent/error classification are preserved under backend adapter. Current-main executor-started/release handshake is reverted to asynchronous-ready plus guessed1500ms lifetime (F2). Three POSIX cases silently return on win32; no native Windows claim.

References: P8-F1, P8-F2, P8-G3.

### 74. `src/__tests__/session-lifecycle-windows-gc.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 253 lines.

Default SDK stand-in child deletion/backlog/kill/incarnation-budget cases run on host platform; Windows-only reused-PID recovery is correctly describe.if gated. Added SQL installer remains off in npm; native win32 storage itself is refused without unverified-filesystem override.

References: P8-F1, P8-G3.

### 75. `src/__tests__/session-lifecycle.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 1043 lines.

Existing lifecycle state/leases/capacity/pin/publication/GC invariants adapt through real SQL observer/injector. JSON lock/corruption/recovery file tests remain visibly legacy-only; direct new SQL variants address most equivalents. Normal npm leaves installer off (F1).

References: P8-F1.

### 76. `src/__tests__/session-publication-lease.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 141 lines.

Publication ownership tests retain pre/post-SDK/prepublication protection, CAS/throw retained ownership, writer exclusivity and dead-owner recovery. Actual child now installs env-selected SQL ports, but normal npm never selects that mode (F1).

References: P8-F1.

### 77. `src/__tests__/session-store-pruning.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 118 lines.

Existing count/clock-backward/LRU/no-read-pruning invariants gain SQL fixture. The old no-TTL case still only reads a newly created session and does not manufacture an aged timestamp; that weak assertion was not introduced here. Normal npm misses SQL variant (F1).

References: P8-F1.

### 78. `src/__tests__/store-mutation-baseline.test.ts`

Complete; complete new file and relevant implementation seams. Head file: 91 lines.

Durability baseline traces real lock/temp/inode publish and three sync operations, exact Unicode/unknown field byte preservation, lock contention, rename-error cleanup and legacy best-effort dirflush. Appropriate #1244 JSON cleanup evidence, not SQL contract acceptance.

### 79. `src/__tests__/store-mutation-loop-lag.test.ts`

Complete; complete changed hunks, relevant retained assertions and implementation seams. Head file: 252 lines.

Loop-lag comparison now measures a real full-document locked/fsynced rewrite, while warm mutation asserts median<75% baseline and no reparsing/unchanged serialization, plus copy-on-write/foreign-writer controls. This concerns existing JSON optimization, not SQL latency evidence.

## Required next gates

1. Preserve main’s executor marker/release control and correct the nondiscriminating assertions before using their claimed results.
2. Run adapted historical suites as separate SQLite processes in the supported final npm pipeline, retaining the JSON gates and process-global mock isolation.
3. Supply actual SQL terminal settlement race and provenance-identified historical package compatibility results, with explicit unavailable/skip outcomes kept open.
4. Obtain the outstanding owner SQL contract decision before public initialization/config/lifecycle interface incorporation.
#1244 JSON cleanup can remain separately scoped. Any accepted SQL product change still requires actual implicated client/model/SDK/platform affected-flow proof plus final installed-package/native-platform and CI gates; no P8 assertion replaces those.
