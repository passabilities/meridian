# SQLite semantic review and owner decision — 2026-10-04

**Defer both submitted SQLite heads.** The complete semantic review is now
recorded: #1219 has 176 unique changed files across all nine packets; #1243 has
38 files / 194 changed SQL hunks above its separately inspected async JSON
prerequisite. Extraction and semantic review are complete for those immutable
scopes. Product acceptance, correction delivery and live proof remain open.

The owner approved the contract on **2026-10-04** in
[#1277](https://github.com/rynfar/meridian/issues/1277): opt-in SQLite with JSON
remaining default, an opaque embedding owner handle, truthful joined shutdown
and explicit guarded offline migration/latest-state export/rollback. Approval
authorizes correction implementation; both submitted heads remain held for
material corrections, native engine/platform compatibility and actual-flow
evidence. The automatic/default migration in #1243 is held. No public interface
or authoritative storage state was changed by this review. #1244's
asynchronous cleanup approval already exists and remains valid.

## Review delivery and prior-head CI

[Review delivery #1278](https://github.com/rynfar/meridian/pull/1278) was ready
at exact former head `4477a61245c146e4231d4d9ade510cc93fef476c`. Its six
executed checks passed: [test and windows-smoke](https://github.com/rynfar/meridian/actions/runs/37249439495),
[Docker smoke and build-push](https://github.com/rynfar/meridian/actions/runs/37249439485),
and [desktop-build on ubuntu-latest and macos-latest](https://github.com/rynfar/meridian/actions/runs/37249439619).
The `changelog-duplication` check had the expected skip. These statuses were
rechecked against that exact GitHub head; they do not establish SQLite product
acceptance or validate a later commit. This documentation status correction
requires new final-head CI and independent review before merge. Historical
reports and probe bytes retain their original decision-time context.

## Immutable scope and coverage

| Scope | Exact source | Base/comparison | Coverage |
| --- | --- | --- | --- |
| [#1219](https://github.com/rynfar/meridian/pull/1219) | `0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f` | GitHub base `f443faee0b135c5d4bfe1e6fe771c6a262ae5f33`; main `8e1c8bf738d7372ded01f28e99d6ec167acaf76f` | [176-path coverage](1219/complete-coverage.json): every source SHA-256 rechecked against Git, complete patch SHA-256 retained |
| [#1243](https://github.com/rynfar/meridian/pull/1243) | `6558c209f8bddf8e59b554d16c9834381c7817c2` | SQL delta above `c159bf9befc49c823a94f48c8d554236115e827e`; same current main | [38-path coverage](1243/file-coverage.json), [per-file semantics](1243/file-coverage.md), three authored commits inspected |

For #1219, P0 reuses the complete #1214 parent review and inspects the exact
source delta: four of its five files are byte-identical; the new 39-line idle
negative control was reviewed here. P1/P2 covers 21 files / 51 hunks, P3/P5
27 / 60, P6 all 25 files, P8 all 79 tests/fixtures, and root P0/P4/P7 all 24
files. The path sets are disjoint and total 176. This coverage is semantic review,
not a claim that every tested product behavior passes.

Full packet reports: [P0/P4/P7](1219/P0-P4-P7-review.md),
[P1/P2](1219/P1-P2-review.md), [P3/P5](1219/P3-P5-review.md),
[P6](1219/P6-review.md), [P8](1219/P8-review.md), and
[#1243](1243/review-report.md). Their JSON companions retain exact locations,
per-file reasoning, proposed controls, executed controls and explicit limits.
Earlier temporary paths in raw reports identify the original execution; their
corresponding scripts/results are escrowed here. The earlier
[extraction-only record](../1219-sqlite-scope-review.md) remains historical.

## Findings that hold incorporation

| Path | Finding and evidence | Required correction |
| --- | --- | --- |
| #1219 codecs | Integer mapping keys move ahead of metadata; parsed payload is unchanged but claimed exact wire order fails. [Node control](1219/P1-P2-codec-order.stdout.json). | Preserve current-main metadata-first serialization and use the real writer as oracle. |
| #1219 pruning | After real synthetic migration, profile-copy selection/pruning reads fenced JSON: zero SQL candidates, two mappings/pins retained; lifecycle prune hits the permanent barrier. [Result](1219/P1-P2-profile-prune.stdout.json). | Complete both backend ports with activity, turn, priority, generation and retirement protections. |
| #1219 native ownership | Injected provenance SELECT failure leaves the actual native DB usable while exclusive maintenance can acquire. [Result](1219/P1-P2-failed-open.stdout.json). | Close every post-open failure before guard release; uncertain close retains/fences ownership. |
| #1219 checkpoint | “Offline” TRUNCATE succeeds under shared runtime ownership. Native SQLite locks are still respected; corruption was not shown. [Corrected control](1219/P1-P2-runtime-truncate-corrected.stdout.json). | Require an exclusive maintenance capability. |
| #1219 shutdown | Actual proxy close fulfills at about 2.5 s while a deliberately paused actual finalizer retains SQL ownership. After unchanged SQL lease release and 1000 ms, repeated cached close still leaves the native connection/backend/guard held. [Result](1219/P4-shutdown-probe/result.json), [controller](1219/P4-shutdown-probe/controller.json). | Join eventual backend release and report truthful completion/failure. Keep other owners and unresolved publication protected. |
| #1219 GC | A 128-row SELECT page does not bound the enclosing writer callback. 4096/16384 future rows hold claim transactions about 77.5/270 ms; competing 25 ms writers expire. 4096 pinned rows take about 263 ms overall despite zero deferred count. Deleter calls are zero. [Future-row results](1219/gc-backlog-probe-result.json), [pinned results](1219/gc-pinned-backlog-probe-result.json). | Bound work/rows per transaction, yield fairly, retain claim predicates/progress, and replace unbounded JS accounting hydration. |
| #1219 cleanup | SQL clear performs durable work before memory reset and retains memory after failure, conflicting with approved #1244. Existing tests affirm that wrong reset policy. | Apply the approved immediate reset and ordered best-effort asynchronous completion. |
| #1219 recovery | Direct internal PREPARED resume archives a synthetic gate before refusing a non-dead owner. Actual CLI refuses with every file unchanged; archive bytes remain exact. [Qualified control](1219/P6-probe/result.json). | Put quiescence validation before any resumed archival at the entry point. No exposed CLI race was demonstrated. |
| #1219 tests | Routine npm/CI leaves historical SQLite fixture switches off; candidate loses current-main executor start/release control; duration/lag assertions miss their claims; terminal settlement lacks a SQL process race. [Static findings](1219/P8-review.md). | Preserve main controls, add isolated SQLite stages and discriminating controls. Proposed negative controls were not executed. |
| #1243 authority | Mutable cached priority metadata lets an older blocked trusted turn win. Async JSON control rejects mutation and preserves the fence. | Restore immutable or detached priority authority, including post-commit cache. |
| #1243 migration | An old-writer publication between digest check and rename archives newer JSON never imported into SQL. Bytes survive in archive, absent from active authority. | Enforce a stopped-writer barrier or a complete supported writer protocol across import and retirement. |
| #1243 lifecycle | Legacy merge removes a live publication lease; ordinary GC with a synthetic deleter selects that protected target. Target deletion count is one; no SDK transcript is deleted. | Preserve generation/tombstone/live fenced authority or refuse competing legacy writers. |
| #1243 tests | The retained FileHandle eviction hold is never entered by SQL, so eviction settles before release. Async JSON enters and remains pending. | Gate and assert the actual native mapping write used by the request path. |

The last four rows are reproduced by the exact
[#1243 harness](1243/sqlite-safety-probes.mjs), with
[SQL results](1243/probe-sql.stdout.json) and
[async JSON controls](1243/probe-async-json.stdout.json).

## Native engine and evidence limits

The actual installed macOS arm64 native package is libsql 0.5.29; it reports
SQLite 3.45.1. The [provenance record](1243/libsql-provenance/provenance-report.md)
traces matching published native bytes through inspected registry SLSA
statements, pinned FFI crate checksum and its bundled checkpoint source. That
source lacks the upstream live-header salt guard in the
[official SQLite repair](https://github.com/sqlite/sqlite/commit/fe57e14b49f9189b56da8233ab3415ce5ff6b1ff).
Statements were inspected rather than independently signature-validated. This
is source corroboration, not a version-only vulnerability assertion. No
corruption reproducer or Meridian corruption event was observed. Resolve the
actual shipped engine/backport and supported topology before incorporation;
do not infer safety from an unexplained green stress rerun or blindly upgrade.
[SQLite's primary WAL guidance](https://sqlite.org/wal.html#walreset) documents
the rare reset race and same-host/local-filesystem requirement.

P1/P2 probes execute actual Node v22.22.3/libsql on macOS arm64. GC, P6, #1243
and shutdown probes execute Bun 1.3.14; their reported Node v24.3.0 is Bun's
compatibility identifier. Each scope uses disposable synthetic private state.
The shutdown path uses mocked SDK/auth/CLI boundaries and one **mock** query;
all probes consume zero real generations and perform zero real credential reads
or SDK transcript deletions. These controls establish their scoped failures,
not actual model/client/platform acceptance. Neither full npm suite nor
application build was run for this review-only delivery.

First failures remain available: [TRUNCATE cleanup-order failure](1219/P1-P2-runtime-truncate.stderr.log.gz),
[shutdown canonical-path failure](1219/P4-shutdown-probe/initial-identity-failure/result.json),
its [fixture correction](1219/P4-shutdown-probe/fixture-correction.json), and
[#1243 first setup/aggregate record](1243/probe-sql.initial.stdout.json).
Corrections change harness setup/observability only; product source stays fixed.
The successful shutdown controller joins all owned children, removes private
state and verifies maintenance is available after process exit.

Final independently installed package/native-platform, actual old-version
compatibility, guarded migration/export/restart/rollback, publication and
cancellation under load, uncertain COMMIT/native fault handling and actual
affected client/model/SDK/platform E2E remain mandatory. OpenCode proof uses the
Meridian OpenCode plugin. The optional old-artifact tests, injected wrapper
faults, SIGKILL cuts and native process probes each have useful distinct scope;
none establishes disk power-loss or native Windows acceptance. No release is
authorized.

## Reproduction and integrity

The [artifact manifest](artifact-manifest.json) hashes every escrowed file.
[Raw artifact archives](raw-artifact-archives.json) preserve log streams and
upstream whitespace exactly in deterministic gzip; both original and archive
hashes are recorded. Use `gzip -dc` to recover the original named bytes.
The [omitted dependency blobs](1243/libsql-provenance/archive-omissions.json)
record large published tarball/crate/source hashes; retrieve them through the
official URLs/locked source in the provenance report rather than committing
vendor binaries. Complete source identities are recorded in each coverage file.

For a new rehearsal, create an isolated workspace, archive each immutable Git
source into its own `probe-source` directory, and install its lock with
`npm ci --ignore-scripts --no-audit --no-fund`. Retain the SQL and async JSON
sources separately. Never use an owner's live session/configuration directory.
Copied harnesses must replace the historical absolute `.../semantic-round1`
prefix with that isolated workspace; preserve the original scripts and record
the mechanical path change. No production source or assertion change is needed.

- P1/P2: preserve its relative `./probe-source` layout, bundle with
  `bun build P1-P2-probes.ts --target=node --external libsql --outfile probe-source/.review-p1-p2/probes.mjs`,
  then execute with Node and one fresh mode-0700 state root per `codec-order`,
  `profile-prune`, `failed-open`, or `runtime-truncate`. Use the exact allowlisted
  environment in [the report](1219/P1-P2-review.json).
- GC: run the relocated `gc-backlog-probe.ts` and `gc-pinned-backlog-probe.ts`
  with Bun. They own their synthetic rows, writer child and cleanup. Timing is
  host dependent; assert the same causal controls rather than these exact ms.
- Shutdown: run relocated `P4-shutdown-probe/run.py`; it bounds the mock-only
  proxy child to 20 s, records first results, joins, then checks post-exit guard
  availability and removes its private directory.
- P6: run relocated `P6-probe/probe.ts` with Bun. It supplies the actual CLI
  refusal and no-owner positive control alongside the direct-call observation.
- #1243: `bun run sqlite-safety-probes.mjs <isolated-source> sql`, followed by
  a separate process with `<isolated-async-json-source> async-json`. Use isolated
  configuration/XDG/Claude roots and no credential environment. Source-level
  FAIL results are intentional reproduced invariants, not accepted behavior.

Do not blindly replay the historical first failures; they are preserved to make
the setup corrections reviewable. Any correction implementation needs durable
before/after controls, final local gates, independent adversarial review and
final-head CI before landing.
