# SQL delta file coverage — PR #1243

Base `c159bf9befc49c823a94f48c8d554236115e827e` → head `6558c209f8bddf8e59b554d16c9834381c7817c2`. Current main `8e1c8bf738d7372ded01f28e99d6ec167acaf76f`.

All 38 paths and 194 changed hunks reviewed. Source blobs, exact hunk headers and per-file diff digests are in [file-coverage.json](file-coverage.json). Read coverage is semantic inspection, not a claim that tests were executed.

| Path | Hunks | SQL-head lines | Review focus |
|---|---:|---:|---|
| `ARCHITECTURE.md` | 2 | 565 | Database module placement and updated persistence/publication wording; architectural boundaries and inherited async contract. |
| `E2E.md` | 7 | 7123 | Every changed fixture/diagnostic path switched to SQL snapshot readers; affected real-client evidence remains missing. |
| `docs/agents.md` | 1 | 873 | Session path documentation update and client verification implications. |
| `docs/configuration.md` | 3 | 1126 | Default SQL migration/shared-directory claims and crash/cancellation limitations; R5 operator decision. |
| `docs/development.md` | 1 | 108 | Storage description updated; consistency with actual row authority. |
| `scripts/e2e-capped-turns.mjs` | 3 | 267 | Fixture database writes, awaited settlement, journal snapshots; no live execution in this review. |
| `scripts/e2e-profile-copy-prune-client.mjs` | 2 | 138 | Aging SQL rows and keeping sequences consistent; affected profile/prune live gate. |
| `scripts/e2e-publication-lifetime.mjs` | 2 | 106 | Diagnostic snapshot substitution; publication lifetime semantics retained. |
| `scripts/e2e-retirement-admission.mjs` | 3 | 114 | Database authority/settlement fixture adaptations; admission behavior. |
| `scripts/e2e-retirement-concurrent-admission.mjs` | 3 | 163 | Concurrent fixture writes and awaited cleanup; admission/fence behavior. |
| `scripts/e2e-session-store-cost.mjs` | 3 | 69 | Synthetic SQL seeding and awaited mutations; representative benchmarking limits. |
| `src/__tests__/durable-file-system.test.ts` | 3 | 36 | Removal of obsolete JSON entry-existence helper test; retained directory-sync durability. |
| `src/__tests__/errors.test.ts` | 1 | 1203 | Store lock timeout classification test; leaf module boundary. |
| `src/__tests__/lifecycle-lock-admission.test.ts` | 6 | 144 | SQL journal fixture and admission timeout/read behavior. |
| `src/__tests__/lifecycle-lock-deadline.test.ts` | 2 | 68 | SQL diagnostic snapshot and lifecycle deadline preservation. |
| `src/__tests__/passthrough-early-stop-integration.test.ts` | 9 | 3655 | Database journal reads in early-stop cases; publication and abandonment assertions. |
| `src/__tests__/priority-session-store.test.ts` | 29 | 1380 | All 29 changed hunks: row fixtures, migration, malformed authority, legacy protected routes; R1 missing immutability case and required-CI omission. |
| `src/__tests__/profile-copy-prune.test.ts` | 3 | 358 | SQL diagnostic/fixture reads and prune-budget behavior. |
| `src/__tests__/proxy-cross-process-coordination.test.ts` | 2 | 502 | Shared mapping setup through SQL and multi-process ownership assertion. |
| `src/__tests__/proxy-extra-usage-fallback.test.ts` | 2 | 496 | SQL journal snapshots and fallback transcript lifecycle. |
| `src/__tests__/proxy-request-cancellation.test.ts` | 1 | 348 | Inherited pending-eviction hold reviewed with unchanged helper; R4 hook is vacuous under SQL. |
| `src/__tests__/proxy-retirement-admission.test.ts` | 5 | 189 | Fixture mappings committed to SQL and transaction settlement, preserving actual admission test authority. |
| `src/__tests__/proxy-session-store-locking.test.ts` | 5 | 294 | CAS race, genuine native lock contention/event-loop and killed transaction controls; removed obsolete JSON lock tests. |
| `src/__tests__/proxy-session-store.test.ts` | 9 | 682 | Migration, interrupted commit/retirement/restart, corruption and newer legacy rows; R1/R2 missing interleavings. |
| `src/__tests__/session-gc-contention.test.ts` | 2 | 107 | Read-only SQL snapshot diagnostics while checking bounded GC contention. |
| `src/__tests__/session-lifecycle-process.test.ts` | 2 | 386 | Native SQL snapshot substitution for real-process lifecycle assertions. |
| `src/__tests__/session-lifecycle-windows-gc.test.ts` | 4 | 260 | Release cached handles before cleanup and SQL snapshots; actual Windows retained smoke path. |
| `src/__tests__/session-lifecycle.test.ts` | 8 | 1233 | All added migration/cache/fence tests; R3 unconditional merge encoded without live lease/tombstone conflicts. |
| `src/__tests__/store-mutation-loop-lag.test.ts` | 9 | 270 | Large SQL fixture, copy-on-write ownership and per-row mutation cost assertions; cold/native/package limits. |
| `src/__tests__/storeDatabaseHelpers.ts` | 1 | 194 | Entire 194-line new helper: SQL fixture authority, seq/row updates, holds, shutdown; transact versus transactNow caveat for R4. |
| `src/__tests__/windows-durable-storage.test.ts` | 2 | 109 | Release helper and obsolete JSON-store stale lock removal; lifecycle/turn lock smoke retention. |
| `src/proxy/errors.ts` | 1 | 961 | One-line SQLITE_BUSY store timeout match and test; no new upward import. |
| `src/proxy/server.ts` | 1 | 9892 | Awaited orphan eviction in shutdown/orchestration; inherited async cleanup contract. |
| `src/proxy/session/crossProcessTurnCoordinator.ts` | 1 | 638 | Owner diagnostic handling remains within process coordinator; no SQL write authority change. |
| `src/proxy/session/durableFileSystem.ts` | 3 | 52 | Removed obsolete JSON store helper; migrated archive/lifecycle directory sync preserved. |
| `src/proxy/session/storeDatabase.ts` | 1 | 495 | Entire new 495-line module: schema, native reader/writer, thread waits/FIFO, COMMIT outcome, identity/close, digest retirement; R2/R5 and engine gates. |
| `src/proxy/sessionLifecycle.ts` | 35 | 2408 | All 35 changed hunks and substantive cache/commit/import paths: fences, leases, GC, lock preservation, validation; R3. |
| `src/proxy/sessionStore.ts` | 17 | 2214 | Entire 2,214-line SQL-head file and removed JSON paths: codec, incremental cache, CAS/priority, migration/queue/copy ownership; R1/R2. |
