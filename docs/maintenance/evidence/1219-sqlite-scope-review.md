# #1219: complete extraction and bounded SQLite scope review

Disposition: **defer whole-stack acceptance; extraction gap resolved**.
The complete diff is available beyond GitHub's 20,000-line endpoint limit.
The original read-only review inspected selected architecture, startup,
publication, cleanup, migration, packaging and proof boundaries. It did not
semantically review all 176 files, execute tests/typecheck/build, or establish
behavior acceptance. This durable record preserves that bounded review.

## Exact source and recoverable extraction

| Fact | Recorded value |
| --- | --- |
| [Source PR #1219](https://github.com/rynfar/meridian/pull/1219) | Open, ready, not draft at the recorded check |
| Exact source | `0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f` |
| GitHub base / source merge base | `f443faee0b135c5d4bfe1e6fe771c6a262ae5f33` |
| Main at original extraction | `3afca1f5a0d51d74f8c7437b90f43d5686cf4163`; this is a dated snapshot, not current main |
| Parent #1214 | `1c8f17099ad62dbd2a511f69c12e5b4e15d9da7f`, an ancestor of source |
| Complete base diff | 176 files; +21,299 / −1,171; 25,412 lines; 1,297,610 bytes |
| Patch SHA-256 | `e886e1210b902d41ab119f49aebd0725efe9bf3d0c4fd90e8039f4566791c78c` |
| Inventory verification | Exact agreement with the complete paginated GitHub 176-file inventory; 176 unique paths/complete per-file patches |
| Source head recheck | Unchanged on 2026-10-04 at 22:31:12 UTC |

The raw capture is supplementary. Reconstruct the exact complete patch from
immutable Git objects, without depending on the temporary artifact directory:

```sh
git fetch --no-write-fetch-head origin 0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f
git fetch --no-write-fetch-head origin f443faee0b135c5d4bfe1e6fe771c6a262ae5f33
git diff --no-ext-diff --binary --full-index \
  f443faee0b135c5d4bfe1e6fe771c6a262ae5f33 \
  0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f > 1219-source.patch
shasum -a 256 1219-source.patch
git diff --numstat f443faee0b135c5d4bfe1e6fe771c6a262ae5f33 \
  0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f
```

The documentation checkpoint independently reconstructed this byte-identical
patch from the already available local objects. Recheck the live contributor
head before any future incorporation; fetching a moving PR ref does not change
the recorded source identity. Inspect a selected file with
`git show <exact-source>:<repository-relative-path>`; line numbers below belong
to that source, not current main.

The direct recorded-main/source tree difference is 288 files,
+21,531 / −16,550 and 43,065 lines. The parent/source delta is 225 files,
+24,219 / −1,224 and 29,307 lines. They include newer-main differences/merges
and are compatibility views, not clean SQLite packets or patches to apply
wholesale. Regular tracked snapshots contained 950/797/870/766 blobs for
source/base/recorded-main/parent; content hashes matched, with no omitted symlinks.
Ten PR commits include parent and merge commits; authored feature/cleanup/GC
correction patches were extracted separately.

## Selected architecture findings

Storage ports and SQL publication are plausible boundaries for shared-directory
bookkeeping. `session/lineage.ts` stays unchanged and pure; existing leaf modules
and adapters remain unchanged, and cache LRUs stay in `session/cache.ts`.
Type-only facade imports do not establish a runtime cycle. The original
TypeScript-AST audit found no literal relative runtime-import cycles in
source/base/recorded-main (257/182/190 production files). It cannot establish
callback discipline, computed-import safety, SQL correctness or product fit.
The 70-plus bookkeeping modules still need explicit ownership/module mapping.

Inspected transaction callbacks reject thenables and poison failed nested
writes; lifecycle publication composes mapping/pins and after-COMMIT cache hooks.
Uncertain COMMIT handling retains fences and prohibits replay. These mechanisms
were inspected, not proven crash safe.

Four material findings remain static and unresolved by this pass:

1. **Shutdown can fulfill while retaining SQL ownership.**
   `src/proxy/server.ts:10047–10062` waits two seconds after forced HTTP shutdown,
   releases the backend only if in-flight HTTP is zero, and resolves cached
   `closePromise` either way. No eventual handle release was evident in the
   inspected finalizer/close path (`:9721` releases the handle). Specify truthful
   completion and eventual joined release; a delayed-finalizer negative control
   must prevent early guard release. No runtime reproduction was performed.
2. **SQL cleanup differs from already-approved #1244.**
   `src/proxy/session/cache.ts:146–152` synchronously clears SQL before memory
   and silently returns on failure, retaining memory. JSON resets memory first
   and uses best-effort durable cleanup. SQL can be busy outside admission
   (`bookkeeping/runtime.ts:92–95`); the source still returns void.
   [#1244](https://github.com/rynfar/meridian/issues/1244) already approves
   `Promise<void>`, immediate memory reset, ordered durable completion and the
   existing best-effort error policy. Apply that contract and satisfy its existing
   implementation evidence; do not repeat the approval request. Contention was
   not executed in this review.
3. **Paging does not bound one synchronous GC transaction.**
   `src/proxy/session/bookkeeping/lifecycleDeletionSql.ts:45–67` loops over
   128-row pages until a candidate or exhaustion; `:153–157` loads every
   retired/deleting row and performs more pin/resource lookups in one read scope.
   Imported/reconciled backlogs need a large all-pinned/deferred control measuring
   event-loop delay, other writers and deadlines. Consider bounded continuation
   or indexed selection/counting. No latency was measured here.
4. **Packaged deletion smoke is not installed SQLite-GC proof.**
   `scripts/e2e-session-gc-packaged.mjs:40–66` borrows checkout `node_modules`,
   seeds JSON at `:116` and reads JSON at `:134`. It is useful within its stated
   packaging/deletion-smoke scope. Separate bookkeeping smoke exercises two HTTP
   processes and migration/export without live client turns; the libsql harness
   exercises loader relocation. Independently installed SQL GC under load and
   actual affected-client proof remain required at the final delivery head.

## Approval boundaries and split review

Saved issue searches found no dedicated SQL approval issue; source discussion
and reviews were empty. [#1073](https://github.com/rynfar/meridian/issues/1073)
covers Antigravity-owned APIs, not replacement Claude lifecycle bookkeeping.
[#1216](https://github.com/rynfar/meridian/issues/1216) observes HTTP activity;
zero HTTP activity does not attest that all writers/children are stopped.
#1244 approves only its specific asynchronous cleanup contract.

Under the [API contract](../../../.agents/references/api-contract.md), a tracked
owner decision remains necessary for the new exported
`initializeProxyBookkeeping(): Promise<BookkeepingHandle | undefined>` and
whether its handle exposes a path/raw SQL reader/close; database initialization
before `startProxyServer` listens; prior initialization and retained ownership
for synchronous `createProxyServer`; Claude JSON/SQL `closeBackend`; and truthful
`ProxyInstance.close()` completion/release. Specify failure/idempotency,
same-directory/multi-instance ownership, startup pruning/capacity and offline
import behavior. No `ProxyConfig` field or new profile/health/header response
field was identified in the authored bookkeeping changes; inherited #1214
transport remains a separate lane.

The operator contract also needs default JSON/opt-in SQL, filesystem/platform
policy, `MERIDIAN_BOOKKEEPING`, `BOOKKEEPING_ALLOW_UNVERIFIED_FS`, permanent
old-writer barriers, backup/rollback/recovery and stopped/live/unknown-writer
attestation decisions. It covers all seven CLI commands: `inspect`, `migrate`,
`export-json`, `recanonicalize`, `abort-migration`, `recover-guard-retirement`
and `recover-bootstrap`. This checkpoint opens no approval issue.

The complete index assigns every file once; counts are allocation, not
semantic-review or test-execution marks. Shared files need hunk splits and
associated tests must accompany the implementation packet.

| Packet | Files | Review boundary |
| --- | ---: | --- |
| P0 | 5 | Parent SSE transport; independent acceptance or independence from #1214 |
| P1 | 12 | Codec and JSON seams; preserve legacy bytes, ordering, generations and malformed records |
| P2 | 9 | Connection/schema/guard/transaction; native ownership, cancellation, unknown COMMIT and recovery |
| P3 | 23 | SQL row codecs/backends and atomic publication; JSON equivalence, CAS, pins, fences and cache hooks |
| P4 | 5 | Server/cache startup, embedding and joined shutdown; resolve findings 1–2 after approval |
| P5 | 4 | GC/deletion, reconciliation and budgets; large backlog, supported deletion and native Windows join |
| P6 | 25 | Offline migration/export/barrier/recovery authority; crash-cut and old-writer controls |
| P7 | 14 | Distribution and operator/API documentation; actual native package relocation/installation |
| P8 | 79 | Tests and fixtures allocated across the implementation packets |

P1's behavior-preserving JSON codec/type/error extraction can be prepared
independently if it activates no SQL and changes no exported cleanup/startup/
close contract. Keep the existing #1220/#1245/#1244 lane and canonical-prefix
evidence intact. Native-loader packaging or internal GC budget work can also be
assessed independently, preserving current-main behavior and supported SDK
operations. None was accepted or implemented by this static pass. Preserve
actual contributor authorship/source mappings; keep corrections separate.

## Remaining proof and limits

Whole-stack acceptance requires split semantic reviews and corrected findings;
independently installed baseline/candidate migration, two actual writer
processes, restart/publication/latest export/rollback and package identity;
all implicated E41/E42/client/model/SDK flows with resume/fork/undo/tools/
compaction/cancellation/history controls; native Linux/macOS filesystem and
Windows maintenance/crash/GC/process-join evidence; authority-boundary and
unknown-COMMIT fault controls; large pinned/deferred GC, WAL debt and resumed
writer progress; then full local gates and exact final-head required CI.
A read-only usage 200, POSIX-only fixtures, inventory, AST audit or supplied
smoke scripts cannot substitute for these proofs.

The original extraction review used GitHub reads/object fetches, source/diff
extraction, content hashing, AST analysis and diff validation only. It changed
no checkout or product; ran no tests/typecheck/build/model/browser calls; read
no credentials/private SDK files; and performed no PR/issue mutation, merge,
release, tag or push. This checkpoint commits the bounded record, not SQLite
acceptance. The extraction blocker is resolved; approval and evidence remain.
