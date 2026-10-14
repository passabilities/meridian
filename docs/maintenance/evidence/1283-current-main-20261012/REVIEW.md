# MCP tool-loss fix: current-main incorporation

Disposition: accept with maintainer harness corrections; actual V1 client and all four plugin-qualified E41 modes pass. Full local gate passes; final-head CI and remaining adjacent-flow review are pending.
Source #1283 remains `571a671676d6b8604cde932199d77c34bc6a46f3`, authored by
Nowaker <spam@nowaker.net>, 2026-10-04T05:57:11Z. Actual authored cherry-pick
`158e6c18d` preserves Author/AuthorDate on main `ab615ca70`. No contributor
comments/reviews or later commits were present at refresh.

Each SDK query needs a fresh single-connection MCP server. The cache must retain
tool definitions, ordering, names, schemas and therefore prompt-cache inputs,
without sharing the transport-bearing server. The three product files implement
exactly that. Inspected current callers, cache-key invalidation, custom namespace,
deferred tools, query options, retries and isolation. No public plugin interface
changes or broader session/store corrections are included.

The historical preparation had 28 commits and 97 changed files. This fresh
integration preserves the actual source commit and separately recovers only the
fixture harness/helper and two relevant tests from prior maintainer corrections
`2df7df666`/`1d67249b8`. It does not discard the old branch or claim its other work
was completed. The recovered harness joins native children and SDK iterators,
closes the listener, seals the final captured catalog, checks iterator/close
faults and retains failed controls before removing only joined owned sandboxes.

## Evidence

The unmodified source tests fail before incorporation because current main lacks
the factory API; that alone is not behavioral reproduction. The **real SDK/native
CLI loopback overlap probe** supplies the distinguishing behavioral evidence:

- Main-equivalent `5ddc7ed9` (same tree as `ab615ca70`) sends the second overlapping
  query without its tools: MCP initialization fails and final catalog validation
  fails. Both iterators still return success, illustrating why text/result-only
  success is inadequate.
- Candidate connects both queries and preserves the entire catalog while the
  first query remains open.
- Deliberately sharing the candidate server restores the same failure.
- Cancellation succeeds; pre-request failure, init timeout and uncooperative
  child controls fail as intended. Every case joins children, iterators and
  listener and removes only its owned sandbox. Their exit-one results remain
  recorded as failures, not rewritten as successful model runs.

All seven JSON receipts and matrix are adjacent. These October 12 runs use
Darwin ARM64, the actual SDK/native CLI, and a credentialless local responder.
They are not Linux, live model or OpenCode acceptance. No plugins are claimed for
this direct SDK fixture; actual OpenCode must separately load matching client
plugin AND server scrub before any inference.

Focused source/query/cache tests: 103 pass. Recovered fixture and real SDK
controls: 17 pass, 100 assertions. Typecheck passes. Standalone build passes. Full npm test (CI Bun 1.3.11)
is running. The existing historical Linux matrix is reference only.
Required gates remain actual Linux/OpenCode/Opus history/tool/retry/followup,
four E41 modes, relevant V2 E42, independently installed package and final-head CI.
The final streaming run on #1344 returned OAuth-token-revoked; no further model
attempt or credential refresh is part of this incorporation. Source stays open.


## Full-suite first-run failure retained

The first full npm test stopped after its primary process: 5,229 pass, 35 skip,
one failure in the unchanged build-observer Node bundle test. Bun reported
EISDIR while reading zod/index.js in the shared dependency directory. A focused
rerun passed 4/4; that alone does not establish causality or a fixed regression.
The worktree's dependency symlink was removed and replaced with its own
`bun install --frozen-lockfile` using CI Bun 1.3.11, and a complete npm test is
running again. An attempted npm ci correctly refused main's stale npm lock
(native package 2.1.284 versus declared 2.1.296); it made no source/lock change.
CI uses the Bun lock. Preserve the first failure and do not claim a full green
gate until the independent-install full run terminates successfully.


## Short actual-client gate escrow

`scripts/e2e-mcp-client-opencode.mjs` prepares a bounded actual OpenCode V1
read/result/same-session continuation gate, derived from the scrub-qualified
streaming harness. It requires an independently installed Meridian package,
matching client-plugin setup, active server scrub identity before inference and
successful hook witnesses after both turns. The read receipt is present only in
an owned file, never in the initial user prompt; the returned client tool result
must reach Meridian before the follow-up can be accepted. It records original
child/pipe joins and stops the client on its first SSE/provider error.

Syntax validation passes. Missing E2E_PLUGIN_PATH rejects before grant access or
client launch (actual negative invocation exits 1 with the preflight assertion).
The actual run is not yet claimed. This short flow supplements, not replaces,
the causal overlap transport matrix, E41 modes or relevant V2/E42 checks.


The independent frozen-install full run also exited 1: the bundled-worker case
passes, but the unchanged cross-process modified-history/non-passthrough/JSON
case received HTTP 500 instead of 400. Its focused rerun passes unchanged
(1 pass, four assertions). This does not prove a resolved flaky failure. The
fixture now includes its synthetic response in the failing assertion so a future
failure preserves the diagnostic that the old assertion discarded. Expected
status and all original assertions remain unchanged. Full-suite acceptance is
still open; do not replace either failed full result with the targeted pass.


## Actual installed-package Linux/OpenCode/Opus read gate: PASS

Clean source `51c37b71af046ee187d8be250187527679eb4337` was built, packed
(SHA-1 `38dd436d82c1847cc63aef79b07f9b309a3f6baf`), and independently installed
in the Linux x64 image. Actual OpenCode 1.18.34, SDK 0.2.141, native 2.1.296 and
Opus 5.5 completed the owned file read, delivered its exact tool result and
continued the same client session with the receipt intact. All four observed
requests are HTTP 200 with no captured SSE error. This is Linux Docker emulation
on Darwin ARM64, not native Windows evidence.

Matching V1 plugin configuration plus session/agent witnesses passed. Explicit
independently installed server scrub 0.2.3 was active before inference and invoked
four times with zero errors. Every original observed child and stdout/stderr
pipe joined; the staged access-only grant was removed after joining. Read-only
readiness beforehand showed included usage and Extra Usage disabled; no refresh,
account switch or Extra Usage setting change occurred. No claim that the earlier
streaming token-revoked failure is causally resolved follows from this success.

The committed short harness SHA-256 is
`54ade18276837e07d4f26cc17e71cd11a0aeabfc4181e9cd1478b570e21c869e`.
Adjacent live report, installed identity, package integrity and readiness record
qualify this exact flow. The frozen-install cross-process suite also passes on
its own (11 tests / 67 assertions); the complete npm run remains failed as
recorded above. Remaining acceptance: diagnostic resolution/full npm gate,
four E41 modes, relevant V2/E42 and interrupted retry/history checks, final-head CI.
Do not merge or close #1283 yet.

After removing the grant, a metadata-only docker cp failed because Docker tried
to recreate the missing bind source as a directory. No grant was recreated. The
empty directory was removed; package metadata was instead read from a new
credentialless invocation of the same immutable test image, with no volumes or
client/model launch. This does not change the live run's retained report.


## Qualified E41 and timeout-fixture correction in progress

`scripts/e2e-qualified-passthrough-turns.mjs` retains the original E41 gates
and adds explicit installed OpenCode server scrub preflight/invocation, HTTP/SSE
error admission stop, owned-file restriction and original child/pipe joins.
It is a direct protocol fixture, not an actual client-plugin witness; the actual
client is separately qualified above. Sequential JSON has passed real Opus 5.5
with exact 1+1+1 batches, immutable parents, one real answer per call, durable
forks/follow-up and cache continuity. The other three arms stop on the first
failure. No complete four-mode pass is claimed until their receipts finish.

The diagnostic full run did not reproduce the cross-process 500; instead it
exposed a timeout fixture startup race. The 400ms Git boundary killed a Node
fixture before it wrote calls.jsonl, so the test failed ENOENT before checking
its assertion. A dedicated finite fixture now installs ignored TERM in a shell,
logs its original pid and execs /bin/sleep in that same pid. No descendant is
left behind. An explicit TERM control takes at least 1.2s and exits zero, proving
resistance; production gitOutput still rejects at its unchanged 400ms budget
and must finish below the unchanged 1s assertion. Both original pids are checked
joined. This changes test setup only, not production timeouts or expectations.
The focused control passes. The unrelated earlier cross-process 500 remains
unexplained rather than declared fixed by its isolated pass.


## E41 stopped: SSE cache and model identity failures

Source `e5cce1f71` ran in immutable Linux/amd64 image
`sha256:0984ed32d37682f0390a5258fb9757a5a79c1c28cf59374ffe8fdf31fa1173ff`
with Bun 1.3.11, SDK 0.2.141/native 2.1.296 and installed server scrub 0.2.3.
Sequential JSON passed its original predicates. Sequential SSE failed:
turn 2 read 763 cached tokens against a prior cached prefix of 2803
(required at least 95%). The supported SDK active history also reported both
`claude-opus-4-8` and `claude-opus-5-5`; exact-model qualification therefore
failed independently. Tool batches, immutable source histories, result delivery,
fork shape and saved follow-up passed. Neither failure has an established cause;
no attribution to the contributor factory change is justified yet.

The matrix stopped before either parallel arm. All original observed processes
and pipes joined in both completed arms, and access-only grants were deleted.
The adjacent JSON receipts and bounded console verdicts preserve both outcomes.
No quota refusal, paid-usage diagnosis or four-mode success is claimed.

These direct protocol fixtures load the server scrub but do not exercise the
actual client plugin. They cannot replace the separately qualified real OpenCode
client run. Per the owner's required plugin constraint, do not launch additional
live protocol arms until the matching client plugin path is integrated and its
execution verified before inference. Credentialless diagnosis may continue.

Image preparation initially lacked development dependency `glob` because it
reused production dependencies. A credentialless preflight caught this before
grant staging. A frozen source dependency install corrected the image; the next
negative preflight stopped on the absent grant with all actors joined.

The direct E41 entry point now exits with an explicit missing-client-plugin
error before grant access, server startup or actor creation. A credentialless
launch verified exit 1 at that guard. E2E.md documents the restriction and forbids
fallback to the older unqualified direct script. The prior JSON pass remains
a protocol observation, not qualified live acceptance under the owner's plugin
requirement. No additional live inference was performed during this diagnosis.


## Installed client-hook integration and full-test correction

The temporary unconditional E41 stop is replaced by mandatory installed-client
resolution and actual hook execution. The protocol host loads the bundled V1
plugin, calls config, then executes chat.headers on every request. Empty-output
preflight rejects a missing/inert hook before grant access; each real request
checks session, request and agent headers. Package identity and immutable file
hash are retained. The owner fixture supplies one root session via the plugin's
host API. This is explicitly not evidence of the OpenCode executable; that
separate real-client receipt remains required. Both plugin paths are mandatory.

Credentialless controls reject missing/relative/wrong-package versions, absent
or inert hooks and changed plugin bytes. The real source hook replaces spoofed
headers. The actual worktree build's bundled hook passed preflight, then the
nonexistent grant stopped the harness before any process/model call: zero
actors, zero inference requests, joined true. This is worktree-build preflight,
not independent-installed-package or live acceptance. The earlier E41 cache and
model failures remain unresolved; no assertions were removed or relaxed.

Full run session 85278 terminated exit 1: 5229 pass / 35 skip / 1 fail in the
primary suite. It exposed a distinct crash-reporter test race: the wait counted
only pending .json files, while final assertion checked all files. A claimed
.json.sending-71409 still existed after delivery began. The wait now requires
the exact same whole-directory emptiness as the unchanged final assertion.
Production reporter behavior and deadline are unchanged. The focused reporter
suite passes 16 tests / 108 assertions. This explains this failure, not the
earlier unrelated cross-process 500; that limitation remains recorded.


## Read-only model provenance audit

The original stopped SSE fixture was inspected only through SDK
`getSessionMessages` and Meridian's public store snapshot API. The owned
container's entry script was replaced with the adjacent audit script; fetch and
all child-process launch APIs were disabled. A literal `{}` file satisfied the
old bind mount, contained no credentials, and was removed after audit exit 0.
The supported API returned 12 rows: the first three assistant fragments share
one response id, model `claude-opus-4-8`, and the first delivered tool id. Later
assistant rows use `claude-opus-5-5`. The first saved usage also differs from
the original wire usage. This is a recorded discrepancy, not proof of its cause.

A separate credentialless Linux/amd64 control used the same SDK 0.2.141/native
2.1.296 image with Docker `--network none`, no credential mount and isolated
loopback-only upstream. Alias `opus[1m]` plus the explicit 5.5 env pin reached
the loopback as 5.5; both overlapping queries returned 5.5 in SDK stream-start
and assistant events. All original children, iterators and listener joined and
sandbox removal completed. No real inference occurred. This rules out a
universal alias-pin/SDK metadata failure in that control; it does not explain
the earlier live mismatch or cache miss. Exact audit scripts and sanitized
receipts are adjacent; run the native probe from `scripts/` beside its helper.

The qualified E41 harness now stops after its first failed cache predicate or
wrong-model supported source snapshot, before another model request. The final
assertions remain unchanged. A further live run must use both actual installed
plugins and records the changed qualification as such, not an unexplained
green rerun of the old incomplete fixture.


## All four plugin-qualified E41 modes pass

The final qualification uses harness `451c43c7` with the unchanged contributor
product code in server source `e5cce1f71`, SDK 0.2.141/native 2.1.296, Linux amd64
under Docker emulation. Image and exact harness hash are in
`e41-qualified-matrix.json`. The actual bundled client hook comes from the
independently installed clean `51c37b71` package; its hash is identical to the
current build. Scrub 0.2.3 is independently installed and active.

Sequential JSON/SSE both deliver exact 1+1+1 batches; parallel JSON/SSE both
deliver one batch of three. Every mode retains one real answer per call,
unchanged source histories, distinct durable forks, saved-session follow-up,
exact Opus 5.5 in supported SDK history, and at least 95% prior-prefix cache
reads on every continuation. Client and server hooks each execute 16 times
across the matrix with zero errors. All original observed processes and pipes
join. Grants are removed after receipts are copied and joins confirmed.
Read-only readiness before each arm showed included capacity and Extra Usage
disabled; no refresh, account switch, or billing setting change occurred.

This is successful qualification of the corrected two-plugin protocol host,
not proof of the cause of the older plugin-incomplete model/cache failure. Both
failed receipts and the supported-API audit remain preserved. Actual OpenCode
1.18.34 installed-package read/result/continuation is separately qualified.
No V2 executable or interrupted-client-flow success is inferred from E41.

Adversarial product review reconfirms that only three product files differ: the
tool-set factory, its query-option caller, and cache comments/log wording. Tool
names, schema/order/definition objects and cache keys remain stable; no plugin
API, V2 dispatch, model routing, session identity or checkpoint policy changes.
The loopback shared-server mutant fails, and separate native overlap/cancel
controls establish transport lifetime independently of model prose.


## Full local gate completed

Owned session 4259 terminated exit 0. Under CI Bun 1.3.11, `npm test` passes
5,659 tests, skips 35, and fails zero; `npm run typecheck` and `npm run build`
then pass. Exact command, source identity, product hashes and full-log hash are
in `final-local-gates.json`. Product and tested source remained unchanged during
the run; later changes were the E41 diagnostic script and evidence.

Earlier failures stay recorded. The finite Git and crash-reporter fixture
races have specific corrected causes; this successful full run alone does not
explain the earlier non-passthrough cross-process 500 or bundler EISDIR. Neither
path exercises this MCP server factory. No broad flaky-test fix is claimed.
