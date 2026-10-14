# PR #1231 — immutable source-scope ledger (read-only)

Snapshot: 2026-10-11 08:04 UTC (GitHub refreshed again after the initial read). Research only; parent is sole queue owner and independently reviewing #1214. No implementation, checkout/branch change, tests, harness execution, installation, SDK/provider/model calls, other agents, GitHub mutation, source closure or release. The clean worktree remains on `codex/sdk-close-join`, HEAD `10f4132ad55d65ae98c46f6a528ec222955656cf`; dirty `/Users/rynfar/repos/meridian` was not accessed or mutated. Only permitted Git object fetching and owned `/tmp` research files were used. Parent preserves this as a durable **source-scope record, not behavior acceptance**. Parent independently rechecked the live head/base, all60 exact SHA/parent/Author/AuthorDate entries, merge-base and aggregate file statistics. No implementation, runtime/private-transcript access, or affected-flow acceptance follows from this ledger.

## 1. Exact scope and graph

- PR https://github.com/rynfar/meridian/pull/1231: **OPEN, nondraft, conflicting** (`mergeable=false`, `mergeable_state=dirty`). Last source update: `2026-10-10T11:50:14Z`.
- Head, fork `passabilities/meridian`, branch `fix/claude-code-subagent-session-isolation`: **`3617ecacebeb39ded1da24d8764ef81a7a1d43f1`**; tree `a2b2c14da7de646912fc783654de78c3a3ef8443`.
- GitHub PR `base.sha` record and verified Git merge-base: **`f299fe06e72411b786380b5212edea79cd13966a`**; tree `3f08e09995adcdacf38b2eac09c9bfddcfb8e607`. Target ref remains `rynfar:main`, not #1211's fork branch.
- Separately refreshed current target main: **`109cf9e45ca26f63e8d247e5356f64c9feca4558`**; tree `b0e81839c29a8c30ab38cdc144012efb8fec73e5`. `git rev-list --left-right --count main...head` = **29 / 60** (28 nonmerge main commits plus one merge commit). Do not mistake the PR base record for current main.
- GitHub reports **60 commits / 112 files / +20,873 −459**; Git verifies those 60 form a single linear chain, with no merges. First commit's parent is the merge-base above. Every ledger entry below records its exact parent.
- Entries **01–05** are the unchanged #1211 parent through **`22566e8ac0b9e079bb0d28c0eb4aa05207c56070`**. Entries **06–10** are the former five-child scope through **`50d4a59d0ca5e55e625ec801fa2a9eb187d508ed`** (tree `8da540c1d0a3eb37d3ff0ba7d6769f632ce9d0ab`).
- Entries **11–60 are 50 newly appended commits**, not a rebase of that former five-child scope. Their aggregate delta from `50d4a59d` is **106 files / +19,583 −461**. Source has **55 commits after the #1211 boundary**, not five.
- GitHub PR body still says “review only the 5 commits after 22566e8 (28974dc..50d4a59)”; its 5,373-test/E72/old review claims do **not** describe today's complete stack.

### Authorship is not the PR owner's identity

Git commit objects and GitHub commit API agree:

- Entries 01–10: **Noah Passalacqua <noah@passabilities.dev>**, GitHub author `passabilities`; API signature verification true for all ten.
- Entries 11–60: **=DEX <eamonbachari@gmail.com>**, GitHub author **`eamonster27`**, not `passabilities`; API signature verification false for all fifty (unsigned is not itself rejection).
- AuthorDate is recorded below in exact Git ISO-8601 offset form, separately from CommitDate. Noah's authored dates are September 30/October 1 local, October 1 UTC; later commit dates reflect the October 4 rebase. Do not use CommitDate as authorship date or give all sixty commits to the fork owner.

## 2. Behavior/dependency partitions — source facts, not approvals

| Partition | Entries | Actual behavior / dependency boundary |
|---|---|---|
| P0: held classifier parent | 01–05 | Auxiliary cause/hook; skip main mapping/turn lease; E71 source script and historical claims. Recover existing corrected #1211 delivery; do not duplicate/reintroduce unchanged parent. |
| P1: original subagent/root identity | 06–10 | Root account-routing key, validated per-agent resumable key, E72 and typed tests; backgrounded main first-turn replay remains documented. Depends on safe P0, routing/cancel/limit invariants; **foreground E72 is not native background overlap proof**. |
| P2: auxiliary expansion & prompt cache | 11–16, 22, 50, 54 | Detect background progress labels, recap and suggestions; reduce/clamp their replay payloads; classifier growing-prompt cache chunks/breakpoints; 30s auxiliary idle default; refuse-layout retry/fallback; git-instruction/cache env changes; subagent 5m TTL; stopless classifier detection. Includes mixed commits 11/14 with accidental symlinks and 14 with idle changes. Depends on corrected P0, actual classifier/main separation and cache behavior, not merely syntactic detector tests. |
| P3: passthrough tool deferral & client parity | 17, 20, 23–27, 29–30 | First removes deferred-tool exemption from single-turn cap; then makes SDK ToolSearch real with six-round budget, deny `continue:false`, executable stop-observation fallback and internal ToolSearch result carry. Changes defer count/pin, Claude-specific tool roster/default threshold, long descriptions, tool announcements in turns, default preset/scratchpad/identity/CWD notes. 17 is partly superseded by 20, not an independent final policy. 25/27/29 refine 20; 26/30 contain scripts/docs, not new production behavior. Affects clients beyond native Claude Code too. |
| P4: transient system-turn lineage | 18–19, 49 | Remove post-cache-breakpoint system tail/known batching reminder from lineage; later omit trailing reminder-only turns and align assistant UUID position to canonical history length. Depends on P3 tool rounds and current raw-client versus execution-history proof. Client-provided cache hints are not automatically safe ancestry authority. |
| P5: model-scoped refusal & fallback routing | 21, 28, 38, 43, 45–47, 56, 59 | Credit/model-limit banner recognition; request-fresh evidence; separate model benches, pool-wide Retry-After; active+priority default room ranking (weekly-reset preference), usage GETs, bounded initial-read wait and previous-account affinity; disk-restored usage; look past SSE comment pings for refusal (default 120s). 28→38→46 is an evolving routing policy, not just session-key repair. Depends on root routing P1, P6 account copies, quota identity and real refusal evidence. 43/45/47/59 are claimed receipts or harness changes. |
| P6: account session carry | 31, 34–35, 39–40; source harness/claims 32–33, 37, 42 | Choose another profile's history-holding copy; **read private SDK JSONL, parse UUIDs, rewrite `sessionId`, write copied transcript**; publish mapping and carry tool pins/announcements. Later private modes, pending-last-turn poll, abort cleanup, fingerprint carry, compacted/nonmatching copy and lost-reply guards. Depends on lifecycle publication, cross-profile ownership and P3/P5; cannot be treated as a supported native-SDK fix. |
| P7: cancellation/process custody | 36, 41, 48; claims/control changes 32, 37, 45 | Preserve ownership of shared priority abort link; Bun pre-first-byte disconnect warning; async Darwin/Windows incarnation probes in SDK process gate (Linux keeps file probe). Warning is not a Bun fix. Async probe is distinct from held #1334 process-close-join correction and needs its own ownership/platform analysis. |
| P8: stream admission, tool-input and recovery limits | 44, 51–53, 55, 57–58 | Don't charge SDK slot wait as upstream idle; track open tool input; 5m then **15m** idle default; derive turn lease default **20m**; deny wait and SDK watchdog hierarchy; eager-tool-input env for first-party/non-other-provider path; synthesize SSE from SDK unstreamed replies at capped/error paths. P3 ToolSearch changes which rounds may be exposed; P5 ping sniff changes header/first-byte behavior. Existing landed #1296 safe-recovery controls must remain. |
| P9: GC capacity | 60 | Default max deletes **16→64**; backlog default derived from grace×delete rate×3, floor256 (default 21m grace/60s interval gives **4,032**, not256). Depends explicitly on P8's longer lease/grace and lifecycle fencing; throughput tuning does not prove safe pin/deletion ownership. |
| Hygiene only | 13, 15 | Delete identical accidental `node_modules` symlink added by 11 and again by14; no node_modules path exists in final base→head delta. No package dependency/lockfile change in this source delta. |

Dependencies above are behavioral/source coupling, **not advice to cherry-pick**. Exact historical parent linkage is in the ledger. Mixed commits must be tracked as mixed; a partition name does not erase the other changes inside a source commit.

## 3. Patch/tree equivalence and reconciliation

### Already-landed comparison, bounded and verified

Compared all60 stable whole-commit patch IDs and individual-file patch IDs against all28 nonmerge commits on current main after `f299fe06`. **Zero exact whole-commit or per-file patch matches.** Compared every112 changed head blob against current main's corresponding blob: **zero exact file-tree matches**. This establishes no exact landed duplicate in this bounded set; it does **not** establish semantic novelty or authorize replay of all60.

Important **partial behavior overlap**, identified from actual diffs, not matching titles:

1. Source58 `c9c86cb1ebb8fdf98e389bb9ccd8272a2238b5bb` substantially overlaps landed **#1296**, `133bb918e02c7cf3a3a2ed4fb212df47a1c6895b`, in extracting an unstreamed-envelope helper and opening SSE for captured calls when SDK emitted no stream events. Not patch/tree equivalent. Main's catch-path opening additionally requires `sdkTerm.reason === "max_turns"`, `lastAttemptMaxTurns === 1`, durable writes not revoked and request not aborted; checkpoint freeze requires canonical result/settled call-set proof. Source58's opening condition is broader (`capturedCallsRecoverable`, no envelope, stream open, some unstreamed assistant). Main also has once-only terminal events and handler-error publication fencing absent from the source patch. **Do not replace main's correction with the broader source helper or claim source58 fully already-covered without residual analysis.**
2. Source31/35/39/40 and49 touch store publication/lineage proof where landed **#1324**, `cd55dd9c94d39bea0dc009c8d011e6e352f42d3b`, now distinguishes raw client lineage from transformed execution and empty SDK-prefix proof. Source head still builds its transform context with raw `body.messages` and has no `inspectExecutionHistory` correction; direct `storeSharedSession` carry call does not carry that new client's proof field. This is **integration collision**, not equivalence. Preserve main's plugin-message execution, UUID and SDK-prefix controls; source's lineage mask alone supplies no execution proof.
3. Source60 and31's lifecycle publication work intersects landed **#1298**, `097530c824c7c2096c82b89de85fd6550479b603`, but source60 only changes capacity numbers/formula. Main's pretransaction lifecycle-lock deferral, unchanged-generation eviction/replay fallback, queued ownership and atomic priority publication are different behavior. No GC-throughput title or numeric change supersedes those controls.
4. Source23/24/29 and48 must reconcile with current main's executable selection **#1321** `0d86379b42cf6ad26979d146c755eb858553d1f0`, auth/probe ownership **#1300** `30c738d77d5e7839577ebc5d144b74da4590e319` and startup recovery **#1287** `ca6a5c0a4eddb87da52d83993f8f9e105712f0f6`. These are separate source/settings/custody mechanisms; no exact patch equivalence was found.
5. The thinking-display fix mentioned by the old PR body was already in source merge-base and is **not a new #1231 commit**. Later landed E41 signed-thinking fidelity `d3be0c628ee164d6bb41882c6fa0f9fe97b74a1e` also remains a reconciliation gate, not a source title waiver.

### Parent source mapping already exists (NOT landed)

Verified stable patch equality **and exact Author/AuthorDate equality** for all five source commits against the rebased authored commits retained under corrected #1211 checkpoint `e731a2dfae4931d0c7718e99098cc4ab4a3355a2`:

| Source | Existing authored counterpart |
|---|---|
| `b06c0aab235ee01e9b2c17715deeabbd08c22a81` | `8f77580fc32c9e9f9bc3ffdf68ec4ed33f730884` |
| `b8d2bbeeeb37fa1d797981c0da17efc1d871014d` | `aea593ecbd2bcbcb23b7651ccd226bd78854a596` |
| `cdb7dce8299c137f0adc677d012f99e8db412f95` | `cb6c92c4a6c388c61f9e412f9809250210c0a5e7` |
| `76d72bac5a0482dbd4e797a7ff670fb30cde6c56` | `734f543f42c5e253048c5d56cea697d897b30479` |
| `22566e8ac0b9e079bb0d28c0eb4aa05207c56070` | `af0fad6318011520d54460dc2f11075e402a1009` |

These map authored contribution only, not maintainer correction `f11e60e5b2480bd76a6d5921b8386f58ae53856c` or later evidence. Source12 does fix checkpoint/MCP sharing guards, but is not equivalent to the retained parent's complete corrections (private auxiliary cancellation leaf, no durable key, main affinity/failover protection, narrow official classifier envelope and separate idle/recovery authority). Source54 recognizes any user `<transcript>` text block under a tool-less nonstream body, rather than that retained official-system-prefix/envelope detector. Reconciliation still required; no reimplementation approved here.

### Future attribution/mapping requirements

Any later authorized bounded integration must identify exact source SHA/parent and Author/AuthorDate for **both** verified identities; record source→authored incorporation SHA for every included commit, with maintainer corrections separate. If a mixed commit is only partly incorporated, record exact retained/omitted paths/hunks and reason; do not call it a whole authored cherry-pick. For already-covered or superseded parts retain exact landed SHA plus patch/blob/residual evidence, not title similarity. Verify both people's credit on any eventual squash that contains their work. No incorporation SHA exists for entries06–60 in this task, and none is invented.

## 4. Unresolved gates and bounded next reviews

**Disposition: defer whole-stack acceptance; first perform source partitions. No whole-stack approval, cherry-pick recommendation, source closure or speculative native-SDK fix.**

Concrete static objections / source-review priorities:

- Expanded source size and second author invalidate the former five-child description.
- P6 directly reads/rewrites SDK transcript files using their private on-disk format rather than a supported public session-copy API. Parent inspected the public contributed `sessionCarry.ts` source, not any user's actual transcript. This creates a separate API-format/product/ownership validation concern; it is not acceptance under the original session-key fix. Its file-mode and last-UUID guards do not resolve that boundary, source writer/pin lifetime, crash/fsync, SDK-format/platform portability, or atomic priority publication questions. Review separately as a product/ownership decision; do not silently port it into session-key repair.
- P2 introduces summary history truncation and broad prompt/payload detectors; P4 accepts post-breakpoint omission on arbitrary system content. Need ordinary XML, main/history-edit, tools/stream, malformed classifier, real fork/classifier and permissions negative controls; source labels are not native identity evidence.
- P5 changes a configured-order policy into default quota-room ranking, adds background usage reads and disk persistence, and suppresses early pings while deciding failover. Need account/model evidence freshness, cross-process lost-write/staleness and shutdown/abort ownership, routing stickiness, bounded headers/TTFB, pool waits and already-visible-content negative controls.
- P8's source58 is not equivalent to the more narrowly corrected landed #1296. Recovery after cap/stall/abort, hidden later rounds, canonical result and publication/terminal-envelope authority remain specific regression gates.
- P7's async external probe is a new custody path. Do not infer complete original process/pipe close observation from `execFile` callback or combine it with the held #1334 scope without independent analysis and acceptance.
- P9 expands backlog/delete throughput; it does not establish source/destination pins, cross-process admission fencing or Windows descendant cleanup. Preserve all existing lifecycle ownership holds.

Bounded read-only next partitions, in order, when parent selects them:

1. **P1 only**: exact original five-child delta, against corrected P0; inventory native main/subagent/classifier keys, root routing, model bench and cancellation contracts. No P6 carry or P3/P5 policy bundled in this decision.
2. **P2 + P4**: detector/canonical lineage/auxiliary prompt-cache partition, with explicit no-truncation/no-false-auxiliary controls and retained #1211 correction comparison. Split cache layout and timeout policy from identity if needed.
3. **P3**: real tool deferral/cap/pin/ToolSearch behavior across actual system and SDK-bundled CLI generations; then Claude-specific parity defaults. Review source scripts statically for ownership and actual client configuration before any future run.
4. **P5**: model-limit/pool wait first, then default fallback selection/persisted usage, then ping-aware sniff; preserve exact requested and served models.
5. **P7/P8**: independent cancellation/probe custody and separately narrowed unstreamed/tool-input recovery comparison against main/#1296; timer changes are separate product decisions.
6. **P6** remains separate boundary review, not necessary authorization for P1; **P9** separately assesses throughput and pin safety against current lifecycle semantics and P8's grace change.

Actual-native gates remain open: original affected Claude Code/Linux x64/model/SDK/CLI tuple and separate main/classifier requested-versus-served identities; native background parent/subagent overlap (not foreground E72 or mocked parallel tests); sticky/priority/active+priority routing and account switch; per-model versus account refusal/limit and `[1m]` bench isolation; tool call/result correlation in all four E41 stream/nonstream × sequential/parallel modes and E55 parity; cancellation before/after first byte, recovery/cap/abort/no-residue with original close/pipe custody; cache/session/compaction/restart and current-main/package preservation; real implicated platforms, not substituted POSIX fixtures. If OpenCode is involved, generation-matching Meridian plugin plus configuration/load/route witnesses is mandatory. Source claims and green mocks do not satisfy these gates. Any later authorized code delivery also needs fresh current-main reconciliation, full `npm test` (including pretest/typecheck and process isolation), standalone typecheck/build, adversarial review and required final-head CI including `test`; none was run or waived by this source-only task.

Live read-only holds refresh: #1211 OPEN nondraft at `22566e8ac0b9e079bb0d28c0eb4aa05207c56070`; #1322 OPEN draft at `0101f6ab1a1161f5deef81c4fc3f1bf47bacc9d6`; #1334 OPEN draft at clean-worktree HEAD `10f4132ad55d65ae98c46f6a528ec222955656cf`. #1011 owner contract hold remains untouched. This task changes none of their dispositions. Claude quota remains exhausted until **2026-10-11T16:59Z** per parent brief: no retry, paid usage, account switch or new generation attempted.

## 5. Method and supporting scratch receipts

Read repository AGENTS, upstream/backlog/evidence skills and applicable incorporation/verification/API/architecture guidance; current handoff's October11/oldest-first sections and retained corrected #1211 evidence. Queried GitHub GET PR1231/commits/files, main, held PR1211/1322/1334 and issue1011. Fetched head/main Git objects with `--no-write-fetch-head`, without checkout. Inspected all60 commit metadata/files and complete production diffs; scripts/tests inventoried by changed path and supplied claim, **not executed or independently semantically certified in full**. `git diff --check base...head` returned no whitespace errors; this is not a build/test or acceptance claim.

Owned scratch directory `1231-readonly/` contains raw JSON snapshots, all60 full patches, production-diff batches, author/parent/tree ledger JSON, patch-match checks, per-file blob comparison, retained parent mapping verification and inspected main diffs. No secrets/customer transcripts/native proprietary source were retrieved. Full paths/SHA metadata below are the portable ledger; parent should not rely on ephemeral scratch availability.

## 6. Complete commit ledger

Every entry uses exact Git commit identity and its full first-parent SHA. Changed paths include tests/docs/scripts (claims only) and incidental artifact paths, not just production. P0 = parent; P1 = former five-child scope; subsequent entries are the expanded50. Dependency numbers below refer to this ledger, not implied implementation approval.

### 01 — P0

**SHA:** `b06c0aab235ee01e9b2c17715deeabbd08c22a81`

**Parent:** `f299fe06e72411b786380b5212edea79cd13966a`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-09-30T19:13:30-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:30:43-05:00`

**Subject (label only):** fix(session): add an auxiliary-request independence cause

**Behavior:** Add auxiliary-request independence cause and server placeholder; does not yet detect auxiliaries.

**Dependencies / boundaries:** Base f299fe06; consumed by02–03.

**Changed paths** (Git status):

- `M` `src/__tests__/lineage-divergence-reason.test.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/session/lineage.ts`

**Whole patch ID:** `7dac07befe46266be31b7795bb8e1627e4b81457`; no exact post-base main patch match.

### 02 — P0

**SHA:** `b8d2bbeeeb37fa1d797981c0da17efc1d871014d`

**Parent:** `b06c0aab235ee01e9b2c17715deeabbd08c22a81`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-09-30T19:16:40-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:30:43-05:00`

**Subject (label only):** fix(claude-code): detect auto-mode classifier side requests

**Behavior:** Add internal isAuxiliaryRequest hook; explicit request-class auxiliary or tool-less nonstream classifier closing-stop heuristic.

**Dependencies / boundaries:** 01; used by03. Existing corrected parent has narrower official envelope detection.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `src/__tests__/claude-code-adapter.test.ts`
- `M` `src/proxy/adapter.ts`
- `M` `src/proxy/adapters/claudecode.ts`

**Whole patch ID:** `039c87fa5498bca4c5cdcb681cdad7415d36ed96`; no exact post-base main patch match.

### 03 — P0

**SHA:** `cdb7dce8299c137f0adc677d012f99e8db412f95`

**Parent:** `b8d2bbeeeb37fa1d797981c0da17efc1d871014d`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-09-30T19:20:53-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:30:43-05:00`

**Subject (label only):** fix(session): keep Claude Code classifier requests off the session mapping and lease

**Behavior:** Classify auxiliary once; skip turn lease/lineage publication and recovery grant; preserve tree registration and skip lost-race check.

**Dependencies / boundaries:** 01–02; unchanged parent is incomplete compared with retained f11e60e5 corrections.

**Changed paths** (Git status):

- `M` `src/__tests__/proxy-concurrency-coordination.test.ts`
- `M` `src/__tests__/proxy-divergence-reason-log.test.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `06d0814a61b9bbcbf87b2fe2820421fb485dfda1`; no exact post-base main patch match.

### 04 — P0

**SHA:** `76d72bac5a0482dbd4e797a7ff670fb30cde6c56`

**Parent:** `cdb7dce8299c137f0adc677d012f99e8db412f95`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-09-30T19:37:55-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:31:15-05:00`

**Subject (label only):** test: live gate for Claude Code auto-mode session isolation

**Behavior:** Add native E71 auto-mode script and instructions; historical source evidence, not a run in this review.

**Dependencies / boundaries:** 01–03; native main/classifier identity and custody gate remains.

**Changed paths** (Git status):

- `M` `E2E.md`
- `A` `scripts/e2e-claude-code-auto-mode.mjs`

**Whole patch ID:** `7dd4bc5e3e24191d85d679d06b4e47bd9886ab45`; no exact post-base main patch match.

### 05 — P0

**SHA:** `22566e8ac0b9e079bb0d28c0eb4aa05207c56070`

**Parent:** `76d72bac5a0482dbd4e797a7ff670fb30cde6c56`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-09-30T21:11:01-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:31:16-05:00`

**Subject (label only):** docs: record live acceptance and correct the auxiliary hook contract

**Behavior:** Correct internal auxiliary-hook documentation and append historical E71 acceptance claims.

**Dependencies / boundaries:** 01–04; exact #1211 boundary, not landed.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `src/proxy/adapter.ts`

**Whole patch ID:** `35b7c80abcc48228920ca3608a8ba0843f9e30e6`; no exact post-base main patch match.

### 06 — P1

**SHA:** `28974dca1d7d2aa1f3bf0067fd97b4120938fbeb`

**Parent:** `22566e8ac0b9e079bb0d28c0eb4aa05207c56070`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-10-01T15:18:19-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:31:58-05:00`

**Subject (label only):** refactor(routing): route accounts by the conversation's root session key

**Behavior:** Add internal getRootSessionId/rootSessionIdOf; priority process-local assignment and sticky routing use root while mapping/durable route/limit bench stay own-key.

**Dependencies / boundaries:** P0 parent05; pairs with07 and later routing partitions.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `A` `src/__tests__/root-session-id.test.ts`
- `M` `src/proxy/adapter.ts`
- `M` `src/proxy/adapters/claudecode.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `8de041170e4e709991aecf0e4d9aaae8e0604f56`; no exact post-base main patch match.

### 07 — P1

**SHA:** `91f70e64aca345da4e7e3c51efa382a11d57749a`

**Parent:** `28974dca1d7d2aa1f3bf0067fd97b4120938fbeb`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-10-01T15:31:47-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:31:59-05:00`

**Subject (label only):** fix(claude-code): key each Agent-tool subagent apart from its parent session

**Behavior:** Validate x-claude-code-agent-id with 1–128 alnum/underscore/hyphen; derive sid:agent:id only with metadata sid; keep raw parent identity and test separate resumes/routing.

**Dependencies / boundaries:** 06 plus corrected P0; real background overlap/cancellation/limits remain.

**Changed paths** (Git status):

- `M` `src/__tests__/claude-code-adapter.test.ts`
- `M` `src/__tests__/priority-routing-integration.test.ts`
- `M` `src/__tests__/proxy-concurrency-coordination.test.ts`
- `M` `src/__tests__/sticky-routing-integration.test.ts`
- `M` `src/proxy/adapters/claudecode.ts`

**Whole patch ID:** `2fae8c5ec5fe07247c7b02fc11eae56cdd4b100c`; no exact post-base main patch match.

### 08 — P1

**SHA:** `78b40833d20b86204cfa0fdd4e15cd43f8c63a97`

**Parent:** `91f70e64aca345da4e7e3c51efa382a11d57749a`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-10-01T15:34:24-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:32:25-05:00`

**Subject (label only):** test: live gate for Claude Code subagent session isolation

**Behavior:** Add foreground native subagent E72 script and source before/after claims.

**Dependencies / boundaries:** 06–07; does not prove run_in_background native parent overlap.

**Changed paths** (Git status):

- `M` `E2E.md`
- `A` `scripts/e2e-claude-code-subagent-session.mjs`

**Whole patch ID:** `fbdf82deef01a7bbb97412195c37fa0ac2b79d91`; no exact post-base main patch match.

### 09 — P1

**SHA:** `cb8d1a59a103e006359e048a9d0275cf814351ee`

**Parent:** `78b40833d20b86204cfa0fdd4e15cd43f8c63a97`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-10-01T15:51:19-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:32:25-05:00`

**Subject (label only):** test: type the Claude Code subagent key test context

**Behavior:** Replace unsafe test-context casts with typed Hono Context helper; no production change.

**Dependencies / boundaries:** 07 adapter tests.

**Changed paths** (Git status):

- `M` `src/__tests__/claude-code-adapter.test.ts`

**Whole patch ID:** `c5e0e39129b51bc24a0997178b91925658562ef9`; no exact post-base main patch match.

### 10 — P1

**SHA:** `50d4a59d0ca5e55e625ec801fa2a9eb187d508ed`

**Parent:** `cb8d1a59a103e006359e048a9d0275cf814351ee`

**Author:** Noah Passalacqua <noah@passabilities.dev>

**AuthorDate:** `2026-10-01T15:56:41-05:00`

**Committer / CommitDate:** Noah Passalacqua <noah@passabilities.dev> / `2026-10-04T09:32:25-05:00`

**Subject (label only):** docs: note the backgrounded Claude Code session replay limitation

**Behavior:** Document one-full-history replay for newly backgrounded main/fork-of-main agent key; later turns resume.

**Dependencies / boundaries:** 07; old five-child boundary50d4a59d. No root-session seed implemented.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `src/proxy/adapters/claudecode.ts`

**Whole patch ID:** `55f7c6adcb3067792115b416af90392a5942cd29`; no exact post-base main patch match.

### 11 — P2 + hygiene

**SHA:** `32e8f198fac1c496cba7978dd6b06d7a7efd5da3`

**Parent:** `50d4a59d0ca5e55e625ec801fa2a9eb187d508ed`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-04T23:27:01-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-04T23:27:01-05:00`

**Subject (label only):** cache fix

**Behavior:** Detect agent-summary fork by final-user prompt; replay latest assistant step only with recursively clipped strings (2,000 chars); hook feeds reduced replay. Adds accidental node_modules symlink and source summary harness.

**Dependencies / boundaries:** P0/P1; later12 prevents checkpoint/MCP sharing;13 removes artifact;50 expands fork families.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `A` `node_modules`
- `A` `scripts/e2e-claude-code-agent-summary.mjs`
- `M` `src/__tests__/claude-code-adapter.test.ts`
- `M` `src/__tests__/proxy-concurrency-coordination.test.ts`
- `M` `src/proxy/adapter.ts`
- `M` `src/proxy/adapters/claudecode.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `1197c2c912c480cda77a0a14a35958cfed16d66c`; no exact post-base main patch match.

### 12 — P2

**SHA:** `a879e8b223bf59d07c7e0b71ca0dc32b027adc36`

**Parent:** `32e8f198fac1c496cba7978dd6b06d7a7efd5da3`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T00:11:41-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T00:11:41-05:00`

**Subject (label only):** fix(claude-code): stop a progress summary colliding with the turn it forks

**Behavior:** Prevent auxiliary from rebinding complete durable tool checkpoint or sharing/deciding cached MCP server/defer pin; retain session pin lookup.

**Dependencies / boundaries:** 11/P0; overlaps one retained parent correction but not complete parent authority fixes.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `src/__tests__/passthrough-early-stop-integration.test.ts`
- `M` `src/proxy/adapter.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `39199085860ed0695a4175a93ea74ce315c10770`; no exact post-base main patch match.

### 13 — Hygiene

**SHA:** `88cdd4db08f6d036efeb566c6299403614c88f55`

**Parent:** `a879e8b223bf59d07c7e0b71ca0dc32b027adc36`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T00:11:44-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T00:11:44-05:00`

**Subject (label only):** chore: untrack the worktree's node_modules symlink

**Behavior:** Remove exact accidental node_modules symlink added by11, no product delta.

**Dependencies / boundaries:** 11; identical symlink is later reintroduced by14 and removed15.

**Changed paths** (Git status):

- `D` `node_modules`

**Whole patch ID:** `b693918c490a9bfc6f765a70828f2f667103250c`; no exact post-base main patch match.

### 14 — P2 + P8 + hygiene

**SHA:** `407f115614e8a5379151be276b8b5000588e29ed`

**Parent:** `88cdd4db08f6d036efeb566c6299403614c88f55`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T01:59:25-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T01:59:25-05:00`

**Subject (label only):** draft of both fixes

**Behavior:** Add classifier prompt-growth hook, stable 16,384-char chunks/2,048-char tail cache layout and optional 1h cache points; disable child caching; request-specific auxiliary idle default30s; detect cache_control refusal, retry plain and disable layout for process. Reintroduce symlink.

**Dependencies / boundaries:** 11–12/P0; changes query/messages/error/idle behavior together;15 deletes artifact,16 disables git prefix snapshot;51 later extends tool idle.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/configuration.md`
- `A` `node_modules`
- `A` `scripts/e2e-claude-code-permission-check-cache.mjs`
- `M` `src/__tests__/claude-code-adapter.test.ts`
- `M` `src/__tests__/errors.test.ts`
- `M` `src/__tests__/idle-stall-ceiling.test.ts`
- `M` `src/__tests__/messages.test.ts`
- `A` `src/__tests__/prompt-cache-layout.test.ts`
- `M` `src/__tests__/proxy-concurrency-coordination.test.ts`
- `M` `src/__tests__/query.test.ts`
- `M` `src/__tests__/stream-idle-guard.test.ts`
- `M` `src/proxy/adapter.ts`
- `M` `src/proxy/adapters/claudecode.ts`
- `M` `src/proxy/errors.ts`
- `M` `src/proxy/idleStallCeiling.ts`
- `M` `src/proxy/messages.ts`
- `A` `src/proxy/promptCacheLayout.ts`
- `M` `src/proxy/query.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/streamIdleGuard.ts`

**Whole patch ID:** `5977ccffbe6d4f7d0ee908bf1bce2a2f4e64cf96`; no exact post-base main patch match.

### 15 — Hygiene

**SHA:** `0615b1a1e1eb5630d173ff06f1572164cb1bf382`

**Parent:** `407f115614e8a5379151be276b8b5000588e29ed`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T02:00:45-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T02:00:45-05:00`

**Subject (label only):** removed node modules

**Behavior:** Remove identical accidental symlink from14, net final node_modules delta empty.

**Dependencies / boundaries:** 14; no dependency installation or lockfile change.

**Changed paths** (Git status):

- `D` `node_modules`

**Whole patch ID:** `b693918c490a9bfc6f765a70828f2f667103250c`; no exact post-base main patch match.

### 16 — P2

**SHA:** `9b15f19f7e0bdb929437210a7a268c2c858ab6f4`

**Parent:** `0615b1a1e1eb5630d173ff06f1572164cb1bf382`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T03:38:45-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T03:38:45-05:00`

**Subject (label only):** last fixes

**Behavior:** For owned cache layout also disable CLI git instructions; broaden refusal fallback rationale to TTL rejection; update cache script/claims.

**Dependencies / boundaries:** 14; actual cache-read benefit and API breakpoint/TTL acceptance remain unverified.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/configuration.md`
- `M` `scripts/e2e-claude-code-permission-check-cache.mjs`
- `M` `src/__tests__/proxy-concurrency-coordination.test.ts`
- `M` `src/__tests__/query.test.ts`
- `M` `src/proxy/query.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `a96009bf77eb4add2948adca3f39b78dd967a3e6`; no exact post-base main patch match.

### 17 — P3

**SHA:** `2a5d97266fb71ca6775a128071b3c80475ed4fee`

**Parent:** `9b15f19f7e0bdb929437210a7a268c2c858ab6f4`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T12:14:46-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T12:45:30-05:00`

**Subject (label only):** fix: hold deferred-tool passthrough sessions to the single-turn cap

**Behavior:** Keep deferred-marked passthrough under single-turn cap when SDK ToolSearch stripped; alter early-stop comments and query eligibility; add real-CLI/scripted-API CI gate and source live scripts.

**Dependencies / boundaries:** Existing passthrough cap;20 changes final policy again by enabling ToolSearch for real.

**Changed paths** (Git status):

- `M` `.github/workflows/ci.yml`
- `M` `E2E.md`
- `M` `docs/configuration.md`
- `M` `docs/maintenance/evidence/1192-deferred-tool-recovery.md`
- `M` `scripts/e2e-capped-turns.mjs`
- `M` `scripts/e2e-defer-pin.mjs`
- `A` `scripts/e2e-deferred-tool-turn-live.mjs`
- `A` `scripts/e2e-deferred-tool-turn.mjs`
- `M` `scripts/e2e-opencode-deferred-refusal.mjs`
- `A` `scripts/probe-passthrough-tool-search.mjs`
- `M` `src/__tests__/defer-pin.test.ts`
- `M` `src/__tests__/deferred-tool-loading.test.ts`
- `M` `src/__tests__/passthrough-early-stop-integration.test.ts`
- `M` `src/__tests__/query.test.ts`
- `M` `src/proxy/passthroughEarlyStop.ts`
- `M` `src/proxy/passthroughTools.ts`
- `M` `src/proxy/query.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `3cb67f2146852df17a247a55a768c3f95dc0a8de`; no exact post-base main patch match.

### 18 — P4

**SHA:** `762f0955420b95a5552cc80d52ac021074e5331f`

**Parent:** `2a5d97266fb71ca6775a128071b3c80475ed4fee`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T15:06:59-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T15:06:59-05:00`

**Subject (label only):** fix: resume Claude Code tool rounds after a one-request system reminder

**Behavior:** Canonicalize Claude system-turn ancestry by dropping blocks after last cache breakpoint, plus exact trailing batching reminder when another block remains; actual execution keeps request.

**Dependencies / boundaries:** P1/P3 tool rounds;49 handles reminder-only trailing turns. Arbitrary cache hint ancestry authority needs review.

**Changed paths** (Git status):

- `M` `E2E.md`
- `A` `scripts/e2e-claude-code-system-turns.mjs`
- `A` `src/__tests__/claude-code-system-turn-lineage.test.ts`
- `M` `src/__tests__/passthrough-early-stop-integration.test.ts`
- `M` `src/proxy/adapters/claudecode.ts`

**Whole patch ID:** `7246f9b7f0c45b72e15bccdd7517c4ff2bd61daf`; no exact post-base main patch match.

### 19 — P4

**SHA:** `849ea02700a7854d25adfcd3b35a9c6df7a57060`

**Parent:** `762f0955420b95a5552cc80d52ac021074e5331f`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T15:45:15-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T15:45:15-05:00`

**Subject (label only):** docs: describe the Claude Code system-turn lineage rule

**Behavior:** Describe post-breakpoint system-tail lineage rule in architecture; no production delta.

**Dependencies / boundaries:** 18.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`

**Whole patch ID:** `49e511bf1978f8e74a8281df1aa862cf96305843`; no exact post-base main patch match.

### 20 — P3

**SHA:** `c0f59adcfe22338260abd174704c1f21f257194d`

**Parent:** `849ea02700a7854d25adfcd3b35a9c6df7a57060`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T17:16:07-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T17:16:07-05:00`

**Subject (label only):** fix: defer tools for real in passthrough sessions

**Behavior:** Enable real SDK ToolSearch in passthrough; six-turn search bound and PreToolUse continue:false deny; mark executable that continues as deferral-ineligible; restrict custom upstreams; retain/reinsert same-message internal ToolSearch results at resume UUID. Count actual deferrable tools, pin auto-defer separately, add MCP prefix scope and two CLI CI arms.

**Dependencies / boundaries:** 17/P0;25 changes unsupported-model and defer defaults;27 changes announcements;affects generic passthrough not just Claude.

**Changed paths** (Git status):

- `M` `.github/workflows/ci.yml`
- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/configuration.md`
- `M` `docs/maintenance/evidence/1192-deferred-tool-recovery.md`
- `M` `scripts/e2e-claude-code-system-turns.mjs`
- `M` `scripts/e2e-defer-pin.mjs`
- `M` `scripts/e2e-deferred-tool-turn-live.mjs`
- `M` `scripts/e2e-deferred-tool-turn.mjs`
- `A` `scripts/e2e-opencode-deferral-live.mjs`
- `M` `scripts/e2e-opencode-deferred-refusal.mjs`
- `M` `scripts/probe-passthrough-tool-search.mjs`
- `M` `src/__tests__/defer-pin.test.ts`
- `M` `src/__tests__/deferred-tool-loading.test.ts`
- `M` `src/__tests__/passthrough-early-stop-integration.test.ts`
- `A` `src/__tests__/passthrough-tool-search-integration.test.ts`
- `A` `src/__tests__/passthrough-tool-search.test.ts`
- `M` `src/__tests__/passthrough-tool-sort.test.ts`
- `M` `src/__tests__/query.test.ts`
- `M` `src/__tests__/silent-turn-recovery.test.ts`
- `M` `src/__tests__/transform-parity.test.ts`
- `A` `src/proxy/passthroughToolSearch.ts`
- `M` `src/proxy/passthroughTools.ts`
- `M` `src/proxy/query.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/transform.ts`
- `M` `src/proxy/transforms/claudecode.ts`

**Whole patch ID:** `a128e7562cef9081a21be385938ab72fef3a2122`; no exact post-base main patch match.

### 21 — P5

**SHA:** `9cc451c435cea66ffaf3d2ee30bc77a69a23b4bf`

**Parent:** `c0f59adcfe22338260abd174704c1f21f257194d`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T19:42:37-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T19:42:37-05:00`

**Subject (label only):** fix: fail over a model whose allowance is spent, and only that model

**Behavior:** Recognize credits-era limit banners; ignore overage-paid rejection evidence; scope fresh reported allowance refusal to requested model; add model benches and reset refinement; propagate whole-pool earliest Retry-After in JSON/SSE; expose exhaustedModels telemetry.

**Dependencies / boundaries:** Existing priority routing/P1;later28/38 selection,56 stream sniff. Distinguish requested/mapped/served model and stale evidence.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `docs/profiles.md`
- `A` `scripts/e2e-model-allowance-failover-live.mjs`
- `M` `src/__tests__/active-priority-integration.test.ts`
- `M` `src/__tests__/errors.test.ts`
- `M` `src/__tests__/limit-detection.test.ts`
- `M` `src/__tests__/retry-after-unit.test.ts`
- `M` `src/__tests__/routing.test.ts`
- `M` `src/proxy/errors.ts`
- `M` `src/proxy/limitDetection.ts`
- `M` `src/proxy/retryAfter.ts`
- `M` `src/proxy/routing.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `aed7aa4268c6086655c7c402ffa945cadd0deb10`; no exact post-base main patch match.

### 22 — P2

**SHA:** `913c7b1c2dc9ed1c83bd4f525a27899e40c8d10b`

**Parent:** `9cc451c435cea66ffaf3d2ee30bc77a69a23b4bf`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T20:02:01-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T20:02:01-05:00`

**Subject (label only):** fix: write a Claude Code subagent's prompt cache for five minutes

**Behavior:** Add promptCacheLifetime hook; valid-agent flows write5m via child env, classifier stays child's default; wire all retry/replay SDK option paths.

**Dependencies / boundaries:** P1 agent id and14 classifier shape;54 expands classifier-shape exclusion.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/configuration.md`
- `M` `scripts/e2e-claude-code-system-turns.mjs`
- `A` `src/__tests__/claude-code-cache-lifetime-integration.test.ts`
- `A` `src/__tests__/claude-code-cache-lifetime.test.ts`
- `M` `src/__tests__/query.test.ts`
- `M` `src/proxy/adapter.ts`
- `M` `src/proxy/adapters/claudecode.ts`
- `M` `src/proxy/query.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `4626f5f429ed8abc73e2e49db047145f97c06067`; no exact post-base main patch match.

### 23 — P3

**SHA:** `46f4936051052b0c8c8f99fcefa6d10de553bdda`

**Parent:** `913c7b1c2dc9ed1c83bd4f525a27899e40c8d10b`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T22:58:56-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T22:58:56-05:00`

**Subject (label only):** fix: leave the Claude Code preset off for a Claude Code client

**Behavior:** Set Claude adapter feature default codeSystemPrompt=false so supplied client system is not prefixed with duplicate Claude preset.

**Dependencies / boundaries:** Existing feature overrides;29 later removes repeated identity and extra notes.

**Changed paths** (Git status):

- `M` `scripts/e2e-claude-code-permission-check-cache.mjs`
- `A` `src/__tests__/claude-code-system-prompt.test.ts`
- `M` `src/proxy/sdkFeatures.ts`

**Whole patch ID:** `03131afe90083ae90fdacccc8891bef96bdacdc2`; no exact post-base main patch match.

### 24 — P3

**SHA:** `03f025a5a68a543dc25812b1a1e065b70ada8431`

**Parent:** `46f4936051052b0c8c8f99fcefa6d10de553bdda`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T22:59:05-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T22:59:05-05:00`

**Subject (label only):** fix: run a Claude Code client's SDK child where the client works

**Behavior:** Read Claude CWD from system prompt or client-framed message Environment/system-reminder block, including2.1.290; add exact captured-shape fixtures/tests.

**Dependencies / boundaries:** Existing cwd resolver remains filesystem/location boundary;29 local-loopback environment note logic.

**Changed paths** (Git status):

- `M` `src/__tests__/claude-code-adapter.test.ts`
- `M` `src/__tests__/claude-code-cwd-note.test.ts`
- `A` `src/__tests__/fixtures/claude-code-request-2.1.290-system-turn.json`
- `A` `src/__tests__/fixtures/claude-code-request-2.1.290-user-reminder.json`
- `M` `src/__tests__/proxy-tool-blocking.test.ts`
- `M` `src/proxy/adapters/claudecode.ts`

**Whole patch ID:** `4fd85a03750cedaac31d9c36467705608315416b`; no exact post-base main patch match.

### 25 — P3

**SHA:** `69115f6814dd745ac42e5e1b7f9ba8936a1eabbe`

**Parent:** `03f025a5a68a543dc25812b1a1e065b70ada8431`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T22:59:14-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T22:59:14-05:00`

**Subject (label only):** fix: send a Claude Code client's tools as it would send them itself

**Behavior:** Replace blanket Haiku ToolSearch exclusion with recorded unsupported-model list; add exact deferrable names/MCP-prefix union, client threshold0 versus operator0-off; increase description cap to1,000,000 for whole client descriptions; add Claude deferred-tool roster and wire retry options.

**Dependencies / boundaries:** 20;23/24 client parity;27 names roster in turns. CLI feature-flag roster is pinned assumption not observed every runtime.

**Changed paths** (Git status):

- `M` `scripts/e2e-deferred-tool-turn-live.mjs`
- `M` `scripts/e2e-deferred-tool-turn.mjs`
- `A` `src/__tests__/claude-code-tool-descriptions-integration.test.ts`
- `M` `src/__tests__/defer-pin.test.ts`
- `M` `src/__tests__/passthrough-tool-search-integration.test.ts`
- `M` `src/__tests__/passthrough-tool-search.test.ts`
- `M` `src/__tests__/passthrough-tool-sort.test.ts`
- `M` `src/__tests__/query.test.ts`
- `M` `src/__tests__/transform-parity.test.ts`
- `M` `src/proxy/passthroughToolSearch.ts`
- `M` `src/proxy/passthroughTools.ts`
- `M` `src/proxy/query.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/transform.ts`
- `M` `src/proxy/transforms/claudecode.ts`

**Whole patch ID:** `50299f22c2cc8a1355a596b3a5fd4b8976681a86`; no exact post-base main patch match.

### 26 — P3/P5 evidence

**SHA:** `4d03504c30a1d9bb57c72008f4f49167681e1bff`

**Parent:** `69115f6814dd745ac42e5e1b7f9ba8936a1eabbe`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-05T22:59:23-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-05T22:59:23-05:00`

**Subject (label only):** test: hold what a Claude Code request carries, through an account switch

**Behavior:** Add actual-account-switch script and source system/CWD/tool/TTL parity claims/docs; no production file changes.

**Dependencies / boundaries:** 22–25; evidence submitted, not reproduced here.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/agents.md`
- `M` `docs/configuration.md`
- `A` `scripts/e2e-claude-code-account-switch-live.mjs`
- `M` `scripts/e2e-claude-code-system-turns.mjs`

**Whole patch ID:** `863e8dcdc5726712d9cfde5f8d8873d7c9af3ffb`; no exact post-base main patch match.

### 27 — P3

**SHA:** `9045f2941f2752ec7893cb464556cb1d88a6ee47`

**Parent:** `4d03504c30a1d9bb57c72008f4f49167681e1bff`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T01:26:30-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T01:26:30-05:00`

**Subject (label only):** fix: name a Claude Code client's deferred tools in its turns

**Behavior:** Announce added/removed deferred tools at final user turn instead of frozen system snapshot; track announced names per SDK session in process-local LRU, reset on fresh/rollback; add delta/append helper and Claude opt-in.

**Dependencies / boundaries:** 20/25;31 carries announcements;current main execution-history behavior must remain.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `docs/configuration.md`
- `A` `scripts/e2e-claude-code-deferred-tools-in-turns.mjs`
- `M` `src/__tests__/passthrough-tool-search-integration.test.ts`
- `M` `src/__tests__/passthrough-tool-search.test.ts`
- `M` `src/__tests__/query.test.ts`
- `M` `src/__tests__/transform-parity.test.ts`
- `M` `src/proxy/passthroughToolSearch.ts`
- `M` `src/proxy/query.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/transform.ts`
- `M` `src/proxy/transforms/claudecode.ts`

**Whole patch ID:** `1272c0d2f39a6ba1d708e7d7fa13d498521bdffa`; no exact post-base main patch match.

### 28 — P5

**SHA:** `fbedb1426736ce26c3fdd379149a4449993ac637`

**Parent:** `9045f2941f2752ec7893cb464556cb1d88a6ee47`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T01:45:48-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T01:45:48-05:00`

**Subject (label only):** feat: send an active+priority failover to the fallback with the most room

**Behavior:** Default active+priority fallback ordering by available room, prefer weekly reset<24h then room/unknown/near-cap; configured env opt-out; merge OAuth/SDK-window observations; background quota GETs when move near/refusal; update settings UI.

**Dependencies / boundaries:** 21/P1;38 adds previous-account/bounded-read wait;46 persists readings. Default operator-policy change.

**Changed paths** (Git status):

- `M` `docs/configuration.md`
- `M` `docs/profiles.md`
- `M` `src/__tests__/active-priority-integration.test.ts`
- `M` `src/__tests__/routing.test.ts`
- `M` `src/proxy/routing.ts`
- `M` `src/proxy/server.ts`
- `M` `src/telemetry/settingsPage.ts`

**Whole patch ID:** `015076d53cb7cd12fe24057da1a5f983ad763f24`; no exact post-base main patch match.

### 29 — P3

**SHA:** `8ffd056a543327e3676e2d3aaf4513a20c9fb613`

**Parent:** `fbedb1426736ce26c3fdd379149a4449993ac637`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T02:02:03-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T02:02:03-05:00`

**Subject (label only):** fix: add only the replay note to a Claude Code client's system prompt

**Behavior:** Opt Claude into loopback/same-CWD shared child environment, omit separating note there; suppress scratchpad counter-instruction by client default; deduplicate SDK identity first line; preserve explicit operator settings.

**Dependencies / boundaries:** 23–25/27;current main executable and loopback-origin boundary need reconciliation.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `docs/configuration.md`
- `M` `scripts/e2e-claude-code-system-turns.mjs`
- `M` `src/__tests__/claude-code-adapter.test.ts`
- `M` `src/__tests__/query.test.ts`
- `M` `src/__tests__/transform-parity.test.ts`
- `M` `src/proxy/adapter.ts`
- `M` `src/proxy/adapters/claudecode.ts`
- `M` `src/proxy/query.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/transform.ts`
- `M` `src/proxy/transforms/claudecode.ts`

**Whole patch ID:** `5e9d37ddff082a22db1add701b8f9ca89124ebc1`; no exact post-base main patch match.

### 30 — P3/P5 evidence

**SHA:** `73fb28d57018b4d32b08a528f8e3865f4b935ea3`

**Parent:** `8ffd056a543327e3676e2d3aaf4513a20c9fb613`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T02:14:11-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T02:14:11-05:00`

**Subject (label only):** test: record the parity follow-ups against real accounts

**Behavior:** Add deferred-tool-in-turns live and fallback-order live scripts plus source parity/ranking claims; no production changes.

**Dependencies / boundaries:** 27–29.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `docs/configuration.md`
- `A` `scripts/e2e-claude-code-deferred-tools-in-turns-live.mjs`
- `A` `scripts/e2e-fallback-order-live.mjs`

**Whole patch ID:** `906b6590adb8e15e4dc364551ac94c1826904af5`; no exact post-base main patch match.

### 31 — P6

**SHA:** `835cbf192cd6dc742ef29241724d2e2c988f8239`

**Parent:** `73fb28d57018b4d32b08a528f8e3865f4b935ea3`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T03:23:02-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T03:23:02-05:00`

**Subject (label only):** fix: take a moved conversation's session with it

**Behavior:** Choose newest valid mapped account copy; divert older own copy; introduce sessionCarry private JSONL discovery/parse/sessionId rewrite/copy, publication mapping and defer/announcement carry. Add account-return/session-copy tests and scripts; delete duplicate announcement call.

**Dependencies / boundaries:** P1/P3/P5, lifecycle prepared target/CAS;34–35/39–40 refine;unsupported private transcript boundary remains.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `docs/configuration.md`
- `M` `docs/profiles.md`
- `A` `scripts/e2e-session-carry-cli.mjs`
- `A` `scripts/e2e-session-carry-live.mjs`
- `A` `src/__tests__/account-return-trip.test.ts`
- `A` `src/__tests__/session-carry.test.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/session/cache.ts`
- `M` `src/proxy/session/lineage.ts`
- `A` `src/proxy/sessionCarry.ts`
- `M` `src/proxy/sessionStore.ts`

**Whole patch ID:** `7421a124e69d17bdc2022929351cabd5ce254e37`; no exact post-base main patch match.

### 32 — P6/P7 evidence

**SHA:** `af6b82b50bbdac6508453d33eaa2aad420c53c65`

**Parent:** `835cbf192cd6dc742ef29241724d2e2c988f8239`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T03:23:13-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T03:23:13-05:00`

**Subject (label only):** test: hold parallel subagents and a restart through the proxy

**Behavior:** Add parallel-subagent and proxy-restart scripts; no production delta.

**Dependencies / boundaries:** P1 and31; native client tuple/route/custody assertions need review, not source filename acceptance.

**Changed paths** (Git status):

- `A` `scripts/e2e-claude-code-parallel-subagents.mjs`
- `A` `scripts/e2e-claude-code-proxy-restart.mjs`

**Whole patch ID:** `264f50c4c8e8d38993c0ebbfb01bbb2a75f859d1`; no exact post-base main patch match.

### 33 — P6 evidence

**SHA:** `2b6448baf0bac5088a477d8eb437fb0e67cbe5bd`

**Parent:** `af6b82b50bbdac6508453d33eaa2aad420c53c65`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T03:23:24-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T03:23:24-05:00`

**Subject (label only):** test: record moves, parallel subagents and a restart against real clients

**Behavior:** Append source claims for account moves, parallel subagents and restart in E2E docs.

**Dependencies / boundaries:** 31–32; historical source claims only.

**Changed paths** (Git status):

- `M` `E2E.md`

**Whole patch ID:** `bf233183601b80e0a579d00f066da594b27f4de4`; no exact post-base main patch match.

### 34 — P6

**SHA:** `48e63e385bdeb21f27800db974bc06a3c3b920cf`

**Parent:** `2b6448baf0bac5088a477d8eb437fb0e67cbe5bd`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T03:36:45-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T03:36:45-05:00`

**Subject (label only):** fix: keep a carried transcript private to its owner

**Behavior:** Set carried target directory0700 and file0600 instead of inherited creation defaults.

**Dependencies / boundaries:** 31; permission control not private SDK compatibility or writer-join proof.

**Changed paths** (Git status):

- `M` `src/__tests__/session-carry.test.ts`
- `M` `src/proxy/sessionCarry.ts`

**Whole patch ID:** `3ab6356f653bbfd432763be76d882e27adf307cf`; no exact post-base main patch match.

### 35 — P6

**SHA:** `48f782521901867b7dcd8a82a1d84efceadf2ecc`

**Parent:** `48e63e385bdeb21f27800db974bc06a3c3b920cf`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T04:14:50-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T04:14:50-05:00`

**Subject (label only):** fix: carry a conversation only from a copy that holds more of it

**Behavior:** Rank copies by messagesHeld rather than latest-use alone; favor continuation; poll private UUID records for last turn with abortable wait; in-place exclusive file write replaces temp rename; assert durable write authority and cleanup target outside canceled admission signal.

**Dependencies / boundaries:** 31/34;39 fingerprint keys and40 unmatched-copy/lost-reply constraints. Source writer ownership not resolved by UUID presence alone.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `docs/configuration.md`
- `M` `docs/profiles.md`
- `M` `src/__tests__/account-return-trip.test.ts`
- `M` `src/__tests__/session-carry.test.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/session/cache.ts`
- `M` `src/proxy/sessionCarry.ts`

**Whole patch ID:** `f20ac88aaedd946394c0a01da098eda2c8989b9f`; no exact post-base main patch match.

### 36 — P7

**SHA:** `e836030083bb1e62f630cdb953fe391a4b067ffb`

**Parent:** `48f782521901867b7dcd8a82a1d84efceadf2ecc`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T04:43:55-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T04:43:55-05:00`

**Subject (label only):** fix: stop the model when a client cancels a priority-routed request

**Behavior:** Only detach abort link created by handler; priority attempts adopting outer request link keep cancellation attached across dispatch/attempt sequence. Add cancellation controls/script.

**Dependencies / boundaries:** Existing priority path/P5;pre-first-byte actual runtime proof distinct from mocked signal.

**Changed paths** (Git status):

- `M` `scripts/e2e-claude-code-parallel-subagents.mjs`
- `A` `scripts/e2e-claude-code-priority-cancel.mjs`
- `M` `src/__tests__/account-return-trip.test.ts`
- `A` `src/__tests__/priority-client-cancel.test.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `8a2aa958e9f1e3c14833a1c78b2159f3f7cf5129`; no exact post-base main patch match.

### 37 — P6/P7 evidence

**SHA:** `ca46feb25daf7d6331201cf0a62959fc51f4e783`

**Parent:** `e836030083bb1e62f630cdb953fe391a4b067ffb`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T04:45:41-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T04:45:41-05:00`

**Subject (label only):** test: record the carry review and a cancelled priority request

**Behavior:** Record source carry review and canceled-priority-request claims in E2E docs.

**Dependencies / boundaries:** 34–36.

**Changed paths** (Git status):

- `M` `E2E.md`

**Whole patch ID:** `d6e4fe1f57fb9cf04c5a7bcd9935c9c4b1973133`; no exact post-base main patch match.

### 38 — P5/P6

**SHA:** `1d628183cd6e8b6acbcd4a3e854d93966df94d64`

**Parent:** `ca46feb25daf7d6331201cf0a62959fc51f4e783`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T05:49:17-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T05:49:17-05:00`

**Subject (label only):** fix: place a failover by usage read and where the conversation was

**Behavior:** Preserve previous fallback after active re-refuses; refresh/await unknown quota readings up to3s; reorder remaining candidates after refusal; infer previous account from durable copy last use within1h, keyed by agent/root.

**Dependencies / boundaries:** 28/P1 and31–35 account cache;46 persists reading. Check wait/abort/ownership and model TTL assumptions.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `docs/profiles.md`
- `M` `scripts/e2e-fallback-order-live.mjs`
- `M` `src/__tests__/active-priority-integration.test.ts`
- `M` `src/__tests__/routing.test.ts`
- `M` `src/proxy/routing.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/session/cache.ts`

**Whole patch ID:** `0b7be706586faa67e58341add24273ef35b8237f`; no exact post-base main patch match.

### 39 — P6

**SHA:** `0b9c8c4004bbdeb3bd456ed501847e90fa1218a3`

**Parent:** `1d628183cd6e8b6acbcd4a3e854d93966df94d64`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T05:53:20-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T05:53:20-05:00`

**Subject (label only):** fix: carry a conversation keyed by its fingerprint as one keyed by a session

**Behavior:** Find/carry account copies by profile-scoped conversation fingerprint as well as explicit session id; publish through durableMappingKey.

**Dependencies / boundaries:** 31/35;headerless-independent flows must not collide.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `src/__tests__/account-return-trip.test.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `2cd238d14263257e6b72a85a7673d445641b9cc1`; no exact post-base main patch match.

### 40 — P6

**SHA:** `8f6ec0f700a07ec1440843a999a8e9189cb16ca3`

**Parent:** `0b9c8c4004bbdeb3bd456ed501847e90fa1218a3`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T06:04:46-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T06:04:46-05:00`

**Subject (label only):** fix: carry a session over a copy that no longer matches, never past a lost reply

**Behavior:** Look for history-holding copy when own mapping diverges except missing-session-header; refuse resume if would drop supplied assistant replies after held prefix; add resumeDropsReplies helper.

**Dependencies / boundaries:** 35/39, compaction and rewind semantics;does not establish supported transcript cloning.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/profiles.md`
- `M` `src/__tests__/account-return-trip.test.ts`
- `A` `src/__tests__/session-copy-held.test.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/session/cache.ts`

**Whole patch ID:** `942ba4de7edc13c4db32adaa1c059d8d7fa3dbfa`; no exact post-base main patch match.

### 41 — P7

**SHA:** `38d43c0d6a836006a7090378b28bc44a25582b19`

**Parent:** `8f6ec0f700a07ec1440843a999a8e9189cb16ca3`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T06:07:38-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T06:07:38-05:00`

**Subject (label only):** fix: say at startup that a proxy under Bun cannot stop a cancelled request

**Behavior:** Emit startup Bun warning about pre-first-byte disconnect not aborting node:http request; recommend built Node server.

**Dependencies / boundaries:** 36;diagnostic only, no Bun cancellation implementation fix.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `A` `src/__tests__/runtime-cancel-warning.test.ts`
- `A` `src/proxy/runtimeCancelWarning.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `1345ec61dcdecb38254ff0346cf9ad77e0719a94`; no exact post-base main patch match.

### 42 — P6 evidence

**SHA:** `401e69058df71a1b17bb8c72d903a0d874762c1e`

**Parent:** `38d43c0d6a836006a7090378b28bc44a25582b19`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T06:40:46-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T06:40:46-05:00`

**Subject (label only):** test: carry a keyless and a compacted conversation through the real proxy, SDK and CLI

**Behavior:** Add real-proxy keyless/compacted conversation carry script and source E2E claims.

**Dependencies / boundaries:** 39–40;submitted script not executed here.

**Changed paths** (Git status):

- `M` `E2E.md`
- `A` `scripts/e2e-session-carry-proxy.mjs`

**Whole patch ID:** `913d490365d8ae979fad3ccc74180369ab16012f`; no exact post-base main patch match.

### 43 — P5 evidence

**SHA:** `9564ff0b7a76e74f26fa2076d596b10dc961178f`

**Parent:** `401e69058df71a1b17bb8c72d903a0d874762c1e`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T07:45:55-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T07:45:55-05:00`

**Subject (label only):** test: record where a failover goes before anything is read, and keep the parallel gate's routing

**Behavior:** Record initial-read fallback ordering claim and preserve parallel harness routing configuration.

**Dependencies / boundaries:** 38 and32;no production delta.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `scripts/e2e-claude-code-parallel-subagents.mjs`

**Whole patch ID:** `fcad32f0ea8dd8ecc6f3e3aa862337cacc1e932b`; no exact post-base main patch match.

### 44 — P8

**SHA:** `efe30d633ca9d49da667ca3a58ab19f529f74bc9`

**Parent:** `9564ff0b7a76e74f26fa2076d596b10dc961178f`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T07:46:52-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T07:46:52-05:00`

**Subject (label only):** fix: start a stream's idle limit once its request has an SDK slot

**Behavior:** Record SDK semaphore-wait state; upstream stream idle guard pauses/restarts window while waiting for SDK slot and measures from attempt start; add idle/admission tests and source script.

**Dependencies / boundaries:** Existing request/SDK admission;51 extends dynamic tool-input limit.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/configuration.md`
- `A` `scripts/e2e-slot-wait-idle.mjs`
- `M` `src/__tests__/proxy-concurrency-coordination.test.ts`
- `M` `src/__tests__/stream-idle-guard.test.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/streamIdleGuard.ts`

**Whole patch ID:** `beccd7f210134a271aa079df7864519f5155e564`; no exact post-base main patch match.

### 45 — P5/P7 evidence

**SHA:** `9e506b5b96edfbd0f88f28208bfcee924d775098`

**Parent:** `efe30d633ca9d49da667ca3a58ab19f529f74bc9`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T09:25:54-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T09:25:54-05:00`

**Subject (label only):** test: record parallel subagents under active+priority and what a failed request was answered

**Behavior:** Update parallel client script/source claims for active+priority and failed-response reporting.

**Dependencies / boundaries:** 32/36/38;no production change.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `scripts/e2e-claude-code-parallel-subagents.mjs`

**Whole patch ID:** `2442da3f8b26300e0cb364399ab6a26288831eff`; no exact post-base main patch match.

### 46 — P5

**SHA:** `50ff9e325885126ca5dd7159437c4d189d295588`

**Parent:** `9e506b5b96edfbd0f88f28208bfcee924d775098`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T10:00:26-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T10:00:26-05:00`

**Subject (label only):** fix: place the first move after a restart by what the run before it read

**Behavior:** Persist last-good OAuth usage windows/extraUsage in usage.json with restored flag and rename publication; load newer readings at startup, use/read restored snapshot in fallback placement; stop persistence during shutdown.

**Dependencies / boundaries:** 28/38 andshared usage cache;read-modify-write/instance-global storage lifecycle and stale credential/account identity need review.

**Changed paths** (Git status):

- `M` `docs/configuration.md`
- `M` `docs/profiles.md`
- `M` `scripts/e2e-fallback-order-live.mjs`
- `M` `src/__tests__/active-priority-integration.test.ts`
- `M` `src/__tests__/oauth-usage.test.ts`
- `A` `src/__tests__/proxy-usage-kept.test.ts`
- `M` `src/proxy/oauthUsage.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `01e2a6f7d27be2d646fb0683be12b42ed6112584`; no exact post-base main patch match.

### 47 — P5 evidence

**SHA:** `4a662faaa46852f006c77f19adab448d5784eb8f`

**Parent:** `50ff9e325885126ca5dd7159437c4d189d295588`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T16:14:57-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T16:14:57-05:00`

**Subject (label only):** test: check a restarted proxy's first move while the endpoint refuses its reads

**Behavior:** Extend fallback-order live script to first move after restart while usage endpoint refuses reads; add source claims.

**Dependencies / boundaries:** 46;no production delta.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `scripts/e2e-fallback-order-live.mjs`

**Whole patch ID:** `189ffb6eaf4317c3a4798440c92c61460ff9d385`; no exact post-base main patch match.

### 48 — P7

**SHA:** `5afedf10450f4d0f4d31faf0b7d5d9a72b74884e`

**Parent:** `4a662faaa46852f006c77f19adab448d5784eb8f`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-06T17:18:34-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-06T17:18:34-05:00`

**Subject (label only):** fix: probe each request's SDK wrapper without holding the event loop

**Behavior:** Capture other-process incarnation asynchronously via execFile ps/PowerShell, same parsers,10s probe bound; SDK process gate awaits capture; Linux retains file-based probe.

**Dependencies / boundaries:** Existing gate/process-incarnation custody;not held1334 close-join fix;actual probe lifecycle/platform proof remains.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `src/__tests__/process-incarnation.test.ts`
- `M` `src/__tests__/sdk-process-gate.test.ts`
- `M` `src/proxy/session/processIncarnation.ts`
- `M` `src/proxy/session/sdkProcessGate.ts`

**Whole patch ID:** `0915832550a04f043cd835f1cf42e6f1b618d727`; no exact post-base main patch match.

### 49 — P4

**SHA:** `0e092fe8a4ce5258d9bc4badd1ecb2a76d641669`

**Parent:** `5afedf10450f4d0f4d31faf0b7d5d9a72b74884e`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-08T07:43:28-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-08T07:43:28-05:00`

**Subject (label only):** fix: resume Fable rounds after a system turn that is the reminder alone

**Behavior:** Omit exact batching-reminder-only trailing system turns from canonical lineage; record assistant SDK UUID at lineageMessages length rather than raw allMessages length across JSON/SSE/retry/recovery publication.

**Dependencies / boundaries:** 18;current main execution/raw-prefix separation and tool checkpoint indices must remain.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `src/__tests__/claude-code-system-turn-lineage.test.ts`
- `M` `src/__tests__/passthrough-early-stop-integration.test.ts`
- `M` `src/proxy/adapters/claudecode.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `5a5c020af18e4984732633bb3a7ba319ab564e28`; no exact post-base main patch match.

### 50 — P2

**SHA:** `94cd0b17a8f9ed0861727fa70737f0fd6a4495f0`

**Parent:** `0e092fe8a4ce5258d9bc4badd1ecb2a76d641669`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-08T07:53:44-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-08T07:53:44-05:00`

**Subject (label only):** fix: keep Claude Code's recap and next-prompt suggestion off the conversation

**Behavior:** Detect away-summary and prompt-suggestion final-user forks as auxiliaries; reduce to opening user, latest typed user and latest assistant step+prompt, clip strings; preserve old progress-label reduction.

**Dependencies / boundaries:** 11/P0/P4;not native permission/aux identity proof;truncation is separate product behavior.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `src/__tests__/claude-code-adapter.test.ts`
- `M` `src/__tests__/passthrough-early-stop-integration.test.ts`
- `M` `src/proxy/adapters/claudecode.ts`

**Whole patch ID:** `3a7bb84c174754ea2f12093f87ad727a2f6a2b06`; no exact post-base main patch match.

### 51 — P8

**SHA:** `9e6ca4e64e9774f7b143073460b664dfc3f49650`

**Parent:** `94cd0b17a8f9ed0861727fa70737f0fd6a4495f0`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-08T08:16:59-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-08T08:16:59-05:00`

**Subject (label only):** fix: give a tool call being written longer than a turn's idle limit

**Behavior:** Track open tool-input block indices in upstream idle guard; default5m tool-input idle for nonaux turns, adapt deny hold and stalled-setting name; isolate new test process in package test script.

**Dependencies / boundaries:** 14/44;52 raises to15m andderives lease,55 SDK watchdog,60 GC consequences.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/configuration.md`
- `M` `package.json`
- `A` `scripts/e2e-tool-input-idle.mjs`
- `A` `src/__tests__/proxy-tool-input-idle.test.ts`
- `M` `src/__tests__/stream-idle-guard.test.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/streamIdleGuard.ts`

**Whole patch ID:** `90c3cb74c5da09ae2aff3ca136bb3a07a5d44049`; no exact post-base main patch match.

### 52 — P8

**SHA:** `f9fc51d71d223e67bfe9688523908db3ff44066c`

**Parent:** `9e6ca4e64e9774f7b143073460b664dfc3f49650`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-09T07:13:42-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-09T07:13:42-05:00`

**Subject (label only):** fix: give a tool call being written fifteen minutes, and the turn room for it

**Behavior:** Introduce pure turnLimits: default tool-input idle900,000ms and session hold max600,000/tool-window+300,000; default lease becomes20m; explicit operator lease remains override.

**Dependencies / boundaries:** 51;55 uses derived hold for child watchdog;60 backlog uses derived grace. Source-owner preference is not owner approval here.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/configuration.md`
- `M` `scripts/e2e-tool-input-idle.mjs`
- `A` `src/__tests__/turn-limits.test.ts`
- `M` `src/proxy/server.ts`
- `A` `src/proxy/turnLimits.ts`

**Whole patch ID:** `d5d4ad3831b902ee7276057588bb8224503b92ce`; no exact post-base main patch match.

### 53 — P8/P3

**SHA:** `2c45f814e749ad14a6fc599ce7ba8474fdbc357e`

**Parent:** `f9fc51d71d223e67bfe9688523908db3ff44066c`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-09T07:18:32-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-09T07:18:32-05:00`

**Subject (label only):** fix: ask the SDK child to stream a tool call's input as it is written

**Behavior:** Set fine-grained/eager tool-input child env by default only first-party Anthropic base with no enumerated alternate-provider switches; preserve inherited override; reuse exported upstream helpers; add script.

**Dependencies / boundaries:** 20 upstream helper and51–52;flag/API/CLI/model validity and gateway negative controls remain.

**Changed paths** (Git status):

- `M` `ARCHITECTURE.md`
- `M` `E2E.md`
- `M` `docs/configuration.md`
- `A` `scripts/e2e-eager-tool-input.mjs`
- `M` `src/__tests__/query.test.ts`
- `M` `src/proxy/passthroughToolSearch.ts`
- `M` `src/proxy/query.ts`

**Whole patch ID:** `5709bd78b4e805d76deadd3a5e5ea2ac89743bdf`; no exact post-base main patch match.

### 54 — P2

**SHA:** `4a72b66f6fab78565e60675ffc6c0aae28f1584d`

**Parent:** `2c45f814e749ad14a6fc599ce7ba8474fdbc357e`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-09T07:20:44-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-09T07:20:44-05:00`

**Subject (label only):** fix: recognise Claude Code's permission check sent without a stop sequence

**Behavior:** Allow classifier-shape fallback without closing stop: no-tools/nonstream body containing a standalone user text block<transcript>; same helper also controls growing prompt and classifier TTL exemption.

**Dependencies / boundaries:** P0/14/22;compare retained narrower1211 official system/envelope detector;ordinary transcript XML must not be auxiliary.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `src/__tests__/claude-code-adapter.test.ts`
- `M` `src/__tests__/claude-code-cache-lifetime.test.ts`
- `M` `src/__tests__/proxy-concurrency-coordination.test.ts`
- `M` `src/proxy/adapters/claudecode.ts`

**Whole patch ID:** `342a3ac5211affd4236c0db27dd831e22150a895`; no exact post-base main patch match.

### 55 — P8

**SHA:** `ca854c09a4b81882528fb0f64403306a1ab886ef`

**Parent:** `4a72b66f6fab78565e60675ffc6c0aae28f1584d`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-09T07:31:50-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-09T07:31:50-05:00`

**Subject (label only):** fix: keep the SDK child's stream watchdog above the tool-input window

**Behavior:** Set child CLAUDE_STREAM_IDLE_TIMEOUT_MS to derived session turn hold ahead of inherited override so SDK watchdog sits above input window; update limit docs.

**Dependencies / boundaries:** 52–53;not evidence that long tool input, client timeout andcancellation all work.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `docs/configuration.md`
- `M` `src/__tests__/query.test.ts`
- `M` `src/proxy/query.ts`
- `M` `src/proxy/turnLimits.ts`

**Whole patch ID:** `b919ead05ab3c565badf1a39fae16dbb9aa1f06e`; no exact post-base main patch match.

### 56 — P5/P8

**SHA:** `41ffc35ea83658759560a1352e9c7492ca19b121`

**Parent:** `ca854c09a4b81882528fb0f64403306a1ab886ef`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-09T08:19:35-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-09T08:19:35-05:00`

**Subject (label only):** fix: fail a stream over when the refusal comes after a keep-alive ping

**Behavior:** Make heartbeat interval configurable; first-frame priority SSE sniff skips comment-only keepalives until default120s account refusal wait; then decides on first noncomment/expired-wait frame. Add late-refusal script/tests.

**Dependencies / boundaries:** 21/P5 andSDK-slot/heartbeat timing44;bounded client headers/TTFB, buffer andalready-visible-response gates remain.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `docs/configuration.md`
- `M` `docs/profiles.md`
- `A` `scripts/e2e-refusal-after-ping.mjs`
- `M` `src/__tests__/priority-routing-integration.test.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `f9bc3245aba802eb4d6f73773eb64cf18c23beeb`; no exact post-base main patch match.

### 57 — P8 evidence

**SHA:** `864fd7b5c52bf31ae907db7f639b1d2598c44997`

**Parent:** `41ffc35ea83658759560a1352e9c7492ca19b121`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-09T08:19:35-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-09T08:19:35-05:00`

**Subject (label only):** docs: record the live check of eager tool-input streaming

**Behavior:** Append eager tool-input live check claims in E2E docs.

**Dependencies / boundaries:** 53/55;no production delta.

**Changed paths** (Git status):

- `M` `E2E.md`

**Whole patch ID:** `607288b3f8e10175e31c99084183671a4f5738c8`; no exact post-base main patch match.

### 58 — P8

**SHA:** `c9c86cb1ebb8fdf98e389bb9ccd8272a2238b5bb`

**Parent:** `864fd7b5c52bf31ae907db7f639b1d2598c44997`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-09T12:03:15-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-09T12:03:15-05:00`

**Subject (label only):** fix: hand over a capped tool turn the CLI answered without streaming

**Behavior:** Extract unstreamed visible-turn SSE synthesis; let nonstreamed captured calls satisfy coverage from tracker alone; open envelope at recoverable cap/error catch before emitting tools. Add source capped-turn script/tests.

**Dependencies / boundaries:** P3/P8;partially overlaps landed1296 but omits its narrow maxTurns1/cancel/durable-authority opening guards;residual review required.

**Changed paths** (Git status):

- `M` `E2E.md`
- `A` `scripts/e2e-unstreamed-capped-turn.mjs`
- `M` `src/__tests__/passthrough-early-stop-integration.test.ts`
- `M` `src/proxy/server.ts`

**Whole patch ID:** `a459ee1039de2da0297ab8a39c3c62a104766be0`; no exact post-base main patch match.

### 59 — P5 evidence

**SHA:** `a134177d9bb9ee2346031e218f5360d346723b30`

**Parent:** `c9c86cb1ebb8fdf98e389bb9ccd8272a2238b5bb`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-09T12:03:15-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-09T12:03:15-05:00`

**Subject (label only):** docs: record the live check of failover after a keep-alive ping

**Behavior:** Append source live failover-after-ping claims in E2E docs.

**Dependencies / boundaries:** 56;no production delta.

**Changed paths** (Git status):

- `M` `E2E.md`

**Whole patch ID:** `ece260f949a98cb10f82f798c7784993c7d1855a`; no exact post-base main patch match.

### 60 — P9

**SHA:** `3617ecacebeb39ded1da24d8764ef81a7a1d43f1`

**Parent:** `a134177d9bb9ee2346031e218f5360d346723b30`

**Author:** =DEX <eamonbachari@gmail.com>

**AuthorDate:** `2026-10-10T01:15:38-05:00`

**Committer / CommitDate:** =DEX <eamonbachari@gmail.com> / `2026-10-10T01:15:38-05:00`

**Subject (label only):** fix: let the session GC keep up with the transcripts turns leave

**Behavior:** Raise default session GC deletes16→64 and derive pending bound from grace×deletion throughput×3 (floor256); share grace variable; add capacity/throughput script andtests plus preload change.

**Dependencies / boundaries:** 52 longer turn hold/default grace;current lifecycle pins/admission/atomic publication semantics stay gates. Exact current sourcehead.

**Changed paths** (Git status):

- `M` `E2E.md`
- `M` `docs/configuration.md`
- `A` `scripts/e2e-session-gc-throughput.mjs`
- `M` `src/__tests__/preload.ts`
- `A` `src/__tests__/proxy-session-gc-capacity.test.ts`
- `M` `src/__tests__/turn-limits.test.ts`
- `M` `src/proxy/server.ts`
- `M` `src/proxy/turnLimits.ts`

**Whole patch ID:** `5a96262e7cdb624a25e8cca39d5eb95a2573b707`; no exact post-base main patch match.

## 7. Reproducibility and final invariance

Read-only graph/mapping comparison commands (no source execution):

```sh
git show -s --format='%H%n%P%n%an <%ae>%n%aI%n%cn <%ce>%n%cI%n%T' <source-sha>
git diff-tree --no-commit-id --name-status -r <source-sha>
git show --format=fuller --stat --patch <source-sha>
git show --pretty=format: <source-sha> | git patch-id --stable
git merge-base 109cf9e45ca26f63e8d247e5356f64c9feca4558 3617ecacebeb39ded1da24d8764ef81a7a1d43f1
git rev-list --left-right --count 109cf9e45ca26f63e8d247e5356f64c9feca4558...3617ecacebeb39ded1da24d8764ef81a7a1d43f1
git diff --check f299fe06e72411b786380b5212edea79cd13966a...3617ecacebeb39ded1da24d8764ef81a7a1d43f1
```

Final worktree `git status --short` empty; HEAD and branch unchanged. No claim of root-cleanliness is made: root was intentionally untouched rather than tested or cleaned.
