# #1303: identical transcript locator publication

## Scope and credit

[Máté Rémiás (@materemias)'s report](https://github.com/rynfar/meridian/issues/1303)
provides the synthetic Linux/Bun/tmpfs reproduction and proposes separating
successful attachment from a changed transaction. The committed harness is
explicitly adapted from that reproduction. No contributor PR is incorporated.

This correction handles **only the identical-locator no-op**. A genuine session
mutation still replaces the complete JSON document. Lock-file maintenance still
occurs on a no-op. There is no SQLite migration, lifecycle-sidecar optimization,
fsync removal, retention change, new public contract or cache shortcut. Keep
#1303 open for its broader storage/write-volume scope; this evidence does not
approve draft #1243 or waive any older native/client/ownership hold.

## Defect and correction

`attachSharedTranscriptLocator` already returns the existing generation for an
identical locator, but its mutator formerly returned `true` and triggered a
complete durable publication. The no-op branch now returns `false` **inside the
existing locked transaction**, after rollback-mapping, SDK-ID and optional
expected-generation checks. The outer API still returns its successful existing
generation. The changed-locator branch and durable publication implementation
are unchanged, including coherent mapping/priority-generation advancement.

Baseline: `7e89f843e0477cf61bcedb6ffc2dbe5dbcad651f` (current main after #1335).
Tested code/harness: `130d8fac681aa970678b0fd39515ef464567d851`.
[Machine-readable receipts](1303-transcript-locator-noop.json) retain image,
source/harness digests and both actual native results. Fixture hashes include
random generated mapping IDs/timestamps and isolated paths; they are not
expected to agree across runs. The same harness bytes ran in both arms.

## Actual implicated native flow

Linux arm64, actual Bun **1.4.2**, `/dev/shm` tmpfs, production store module
imported directly from source. The reporter specifies Linux/Bun but no CPU
architecture. Docker image is pinned at
`oven/bun@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895`.
Both native runs use isolated synthetic metadata with network disabled, a
read-only source mount, 384 MiB tmpfs and an owned synthetic machine-id. There
are no model, SDK `query()`, HTTP, auth, real transcript or live-store calls;
none is implicated in the reported no-op reproduction.

| Sessions | Seed JSON bytes | 20 genuine mutations: payload bytes, both arms | 5 identical calls: baseline payload bytes | Candidate payload bytes |
| --- | ---: | ---: | ---: | ---: |
| 100 | 947,871 | 18,959,243 | 4,740,775 | 0 |
| 900 | 8,533,471 | 170,671,243 | 42,668,775 | 0 |

Both arms preserve bytes and mapping generation during identical calls.
Baseline replaces the store inode five times per fixture; candidate preserves
inode/device/size/mtime/ctime. Both arms replace the inode twenty times for
real mutations. Measurements are **replacement-file payload sizes**, not
physical SSD/NAND writes, performance measurements or total filesystem bytes.
The ten-byte difference from the issue's five-call figures is explained by this
harness's one-character-longer temporary directory prefix in two locator paths.

The unchanged baseline was exported with `git archive` at the exact SHA above,
then given the identical harness. It exits **1** on `5 !== 0` after emitting
both fixture measurements. Candidate exits **0** on the same no-publication
assertion. The new direct regression test also fails baseline on inode/mtime/
ctime changes and passes candidate. Sixty-three focused tests across priority,
ordinary store, locking and mutation-loop-lag suites pass. These include stale
CAS/ABA, rollback-mapping rejection, locator validation, copy ownership and
atomic route publication. The new regression also checks same-value cloned
locators with and without an expected generation, wrong SDK/missing mapping,
stale generation, optional locator-field changes and priority-route coherence.
Full local gates and final-head CI remain mandatory before landing.

An initial container run failed before fixture creation because the official
image lacks a readable machine-id. That is **not** the defect reproduction or
acceptance evidence. Supplying an owned synthetic machine-id satisfies the
production process-incarnation check without weakening it or using the host's
identity; both qualified arms use the same setup.

## Reproduce safely

From a checkout containing the harness, with Docker available:

```sh
SOURCE_ROOT="$PWD"
RUN=$(mktemp -d)
BASE=7e89f843e0477cf61bcedb6ffc2dbe5dbcad651f
IMAGE=oven/bun@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895
mkdir "$RUN/baseline"
git archive "$BASE" | tar -x -C "$RUN/baseline"
cp scripts/e2e-session-locator-noop.ts "$RUN/baseline/scripts/"
openssl rand -hex 16 > "$RUN/machine-id"
for ARM in baseline candidate; do
  ROOT="$SOURCE_ROOT"
  if [ "$ARM" = baseline ]; then ROOT="$RUN/baseline"; fi
  docker run --rm --platform linux/arm64 --network none \
    --tmpfs /dev/shm:rw,size=384m,nodev,nosuid \
    -v "$RUN/machine-id:/etc/machine-id:ro" \
    -v "$ROOT:/source:ro" -w /source "$IMAGE" \
    bun scripts/e2e-session-locator-noop.ts > "$RUN/$ARM.log" 2>&1
  CODE=$?
  printf '%s exit=%s\n' "$ARM" "$CODE"
  # Baseline must be 1 for the no-publication assertion, candidate must be 0.
  # Inspect both logs, not only exit codes. Do not use `set -e` for this loop.
done
```

The harness verifies Linux/tmpfs before creating its own private fixture, resets
the module's store override, restores HOME and removes fixtures in `finally`.
Retain sanitized logs before removing only the owned `$RUN` directory. On other
platforms use the direct regression/adjacent suites; that is not a substitute
for the qualified Linux native reproduction.

## Independent review and landing gate

Independent adversarial review must check the full committed diff, successful
API result versus transaction-publication boolean, locked guard ordering,
changed-locator durability and priority atomicity, synthetic isolation, precise
proof scope, baseline discriminating assertion and current-main/head status.
No merge is authorized by a green native harness alone. Require full local
`npm test`, typecheck/build and all relevant exact-head CI including `test`.
