# SDK process-gate close and escalation — 2026-10-11

## Scope and disposition

**Implementation reviewed; delivery held for actual SDK/client acceptance.**
The precise internal join contract is independently reproduced, but that does
not waive the project's affected-flow product gate. No owner scope exception
has been supplied. This is **not a resolution of #1326**. Its reported Linux/OpenCode 1.18.31 /
opencode-with-claude 1.10.4 / SDK 0.2.141 / Claude Code 2.1.293 / Opus `[1m]`
OAuth-refresh hang has not been reproduced. No successful model/client inference
is claimed, and that issue remains open.

Read-only investigation of #1326 at `6e510dbcb` distinguished pending stream
completion from explicit cleanup-failure fence retention. The ordinary error
path logs the reported error after query/process cleanup, enqueues and closes
its SSE error before awaiting fork abandonment. Advancing turn-lock heartbeats
and `/inflight` alone do not establish which finalizer is pending. The existing
`session.turn_fenced_after_cleanup_failure` marker distinguishes another path.
No concrete issue-specific deadlock or authority to release an unjoined writer
was established. No timeout-only, early-fence-release or public API change was
accepted.

The investigation found two separate defects in `session/sdkProcessGate.ts`:

1. `closeAndJoin` accepted `child.exitCode !== null` instead of the original
   captured `close` witness. A parent can exit while a helper still holds its
   inherited pipes; the gate returned true without its documented join barrier.
2. SIGTERM waiting consumed the whole deadline. The subsequent SIGKILL had
   effectively no close-observation budget, so an actually killed writer could
   be classified unjoined and leave its lease fail-closed unnecessarily.

The correction tracks the actual original `close`, and divides termination and
observation within the **existing** total budget. The usual 250 ms passive
phase remains for the default 7-second budget; short budgets reserve time too.
POSIX reserves at most 2 seconds (half the remaining short budget) before TERM,
then uses the remaining time for SIGKILL/close. Windows retains its separate
wrapper-owned cancellation protocol; no new descendant kill or recovery
policy is added. Publication must still settle before true is returned. Unknown
close/publication remains false; no lease is released merely on an error,
telemetry row, elapsed deadline or signal attempt.

## Meaningful native before/after

The committed `scripts/e2e-sdk-process-join.mjs` exercises the **production
process gate with actual controlled Node subprocesses**, not mocked ChildProcess
objects. It does not call SDK `query()`, launch Claude, use a real model/client,
or make a network request. A model is not implicated in these join-barrier
assertions. This is bounded native-process proof of the two internal defects,
not affected-client acceptance of the original OAuth-refresh report.

Three identical arms run before and after:

- Ordinary child exits: both must return true only with original close observed.
- Parent exits with a still-open inherited pipe-holder: a controlled owned marker
  releases the finite helper only **after** the verdict; the first verdict must
  remain false. This is not a race against a short sleep.
- Child installs a SIGTERM-ignore handler, then signals readiness: must observe
  that TERM was ignored and return true only after actual close following KILL.

Original handles and close promises are captured before awaits. Cleanup releases
only the owned marker, joins the original close and publication, and removes
fixtures only with known cleanup. Unknown cleanup retains the directory and
fails. Signals use the production gate's exact owned child, never a bare PID.
Elapsed times are recorded, not enforced as noisy model/performance thresholds.

Observed with stock Node 24.20.0 on Darwin arm64 and Linux arm64 (native ARM
Docker VM; read-only bundle and owned machine-id mounts, isolated `--rm`
containers):

| Assertion | Unchanged source `6e510dbcb` | Corrected source |
| --- | --- | --- |
| Ordinary exit | true, original close observed | true, original close observed |
| Exit with held pipes | **true without close** | false without close |
| TERM-resistant child | **false without close at verdict** | true with original close |
| Subsequent cleanup | All original close/publication joins | All original close/publication joins |
| Harness exit | 1 | 0 |

Sanitized native receipts and artifact hashes are escrowed in
[`sdk-process-close-join.json`](sdk-process-close-join.json). The same harness
bytes/assertions were built against each source. The initial exploratory harness
failed to arm because nested JavaScript newline escaping was wrong; its timeout
was not product evidence. A first Docker preparation lacked machine-id and
correctly failed process-incarnation capture. The qualified comparison mounts
an owned readable identity and preserves that fail-closed requirement.

## Reproduction

```sh
bun scripts/e2e-sdk-process-join.mjs
# Stock Node exercises the same production gate:
bun build scripts/e2e-sdk-process-join.mjs --target=node --outfile=/tmp/sdk-join-proof.mjs
node /tmp/sdk-join-proof.mjs
```

For Linux, run that standalone bundle in an owned Node 24.20.0 container, with
`--rm`, a read-only `/fixture.mjs` mount and a private, owned valid machine-id
file mounted read-only at `/etc/machine-id`. No source checkout, owner HOME,
credentials or registry token is mounted. To prove the unchanged baseline,
archive `6e510dbcb` into a disposable directory, copy the **same** committed
harness to its `scripts/`, build and run there; expect exit 1. The leaf bundle
requires no installed model package at runtime.

The exact historical baseline bytes are now retained at
[`artifacts/sdk-close-join-baseline.mjs`](artifacts/sdk-close-join-baseline.mjs).
Their SHA-256 is `47e9246316cbd1f82bcdc8140b090433fc7f70db0a5e5500adbc8fccf146b6c2`,
matching both original native receipts. `node` on that retained bundle still
fails the same assertions and joins/removes all fixtures. It is deliberately a
**failing owned-process fixture**, not product code to import or deploy.

Independent review rebuilt the baseline archive with Bun 1.3.14 and observed
`79974d20308f85b7d634d76a6a86f014f0fb826a4947ac63e8d0416fc2dea26c` rather than
the historical digest. Parent reproduced that exact alternate digest and
compared both bundles: only Bun's generated source-path section comments
(`// ...src/proxy/session/...` and `// ...scripts/...`) differ. Normalizing those
six headers produces byte-identical content; no runtime code is excluded or
changed. The manifest retains the original command, cwd and actual artifact,
so historical tested-byte provenance no longer relies on a generic path layout.

`src/__tests__/sdk-process-gate-close.test.ts` retains the same two direct
regression controls. Identical tests fail both assertions on baseline and pass
after. The first new typecheck caught that the SDK's minimal `SpawnedProcess`
type does not declare `close`. A checked `instanceof ChildProcess` narrows the
actual original POSIX handle; no casts, ignored diagnostics, fabricated close
or reduced assertions are used.

POSIX controls explicitly skip Windows. Existing Windows process-gate tests and
required Windows CI remain adjacent gates; this is not native Windows proof.
No original Linux x64/consumer/model tuple, arbitrary descendant custody, SDK
error-result HTTP path or production #1326 resolution is claimed. Keep missing
original-flow acceptance separate. Final local gates at `ea868971` pass: `npm test` 5,576 pass / 0 fail / 35 skip
in 21 isolated invocations, standalone typecheck and build. Independent
Pi/GPT-6.1-Sol high-effort review found no P1/P2 implementation defect,
independently reproduced both baseline failures and candidate controls, and
added armed zero/short/default and concurrent/cached-join probes. Its P3 bundle
provenance finding is answered above without changing production, tests or
harness bytes.

Actual SDK/client/model acceptance remains a **material landing hold**, unless
the owner explicitly determines this precise internal correction is outside
that product gate. Native fixtures are not that approval. The current account
is quota-exhausted; no extra generation, account switch or paid-usage change is
attempted. A held draft and exact-head CI may preserve progress, but green CI
cannot waive acceptance. Keep #1326 open. No release is authorized.
