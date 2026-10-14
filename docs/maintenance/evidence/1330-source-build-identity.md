# #1330 source identity after fingerprint failure — 2026-10-11

## Disposition and provenance

**Accept with maintainer corrections; local implementation and credentialless
source-HTTP verification complete.** Independent Pi/Claude Fable 5.1 high-effort
review approved production and escrow at `87286e62`, independently reproducing
both HTTP arms, the six correction failures, Node 22.11/24.20 controls, typecheck
and the complete 5,574-pass suite. Delivery [#1333](https://github.com/rynfar/meridian/pull/1333)
is open. Parent review additionally makes the POSIX-shebang recovery controls
explicitly skip on Windows; it does not change production or weaken POSIX
assertions. Fresh final-head CI and merge/credit/source-head checks remain owed.
No source closure, external comment or release is claimed.

- Worktree: `/Users/rynfar/.t3/worktrees/meridian/codex-backlog-oldest-first`.
- Branch: `codex/backlog-oldest-first`.
- Base: `6e510dbcb7713997e0299a7f954ee73bb45ceae7`.
- Read-only refresh: source [#1330](https://github.com/rynfar/meridian/pull/1330)
  remains OPEN at `c040c19be36d0ae24cace6eac7c27db023627a5d`; remote main still
  equals the specified base. This is not an inventory refresh or authorization
  to advance to another backlog item.

| Source | Incorporated commit | Authorship |
| --- | --- | --- |
| `c040c19be36d0ae24cace6eac7c27db023627a5d` | `d2c2a6463d4463b82d21f61042275909fbbb5434` | Nowaker `<spam@nowaker.net>`, AuthorDate `2026-10-09T22:51:13-05:00`, preserved by signed `git cherry-pick -x` |
| Maintainer corrections/tests | `9b7fbda5159e908a83b573ee2cb14fd13a227c55` | Separate signed commit |
| Runnable HTTP escrow and this evidence | The commit containing this record | Separate from contributor and correction commits |

No commands wrote to the owner's `/Users/rynfar/repos/meridian` checkout.
Installed dependencies were read through a symlink in the disposable fixture;
no dependency reinstall, version change, tag or publish was performed.

## Corrected behavior and whole-diff review

Reviewed the entire diff from the base, `buildSnapshot`/`buildRuntime` callers,
`buildArtifacts`/fingerprint/observer/comparison boundaries, tests and harness.
The useful contributor behavior is retained: recover source Git ancestry when a
full byte fingerprint cannot be captured, without certifying those source bytes.
Public response fields, lifecycle and config signatures are unchanged.

Concrete findings and resolutions:

1. Five fresh two-second Git timeouts could add approximately ten seconds after
   fingerprint failure. Recovery now has **one fresh aggregate 2,000 ms budget**.
   Canonical root and SHA come first. Optional branch, status and remote each get
   at most 250 ms from the remaining budget; expiration does not launch another
   child. Status is attempted at most once in recovery, so repeating the failed
   snapshot's expensive status cannot consume another full two seconds.
2. Node's default timeout signal is TERM. A finite TERM-resistant process could
   return late with status zero despite `ETIMEDOUT`; the old helper accepted it.
   `gitOutput` now rejects `result.error` as well as nonzero status and uses
   `SIGKILL`. The synchronous call returns after direct child and captured-pipe
   settlement. This also covers the normal fingerprint and artifact-store Git
   callers. There is **no arbitrary descendant/process-tree custody guarantee**,
   and filesystem work, kernel scheduling and process join can overshoot nominal
   deadlines. The implementation does not promise wall-clock real-time startup.
3. Spreading launcher metadata into recovered facts mixed a new SHA with a stale
   branch on detached HEAD, or stale `dirty: false` after failed status. Recovery
   now replaces the identity as a unit. Missing optional facts stay absent;
   launcher SHA/branch/dirty survive only when the entire recovery fails.
4. Retained the canonical-root guard against adopting an unrelated parent repo,
   immutable startup capture, safe public-forge links, and source/artifact/npm
   separation. A SHA is ancestry, **not a dirty-byte certificate**. No recovered
   `sourceHash`, certification, counter, scope or attempt ID is fabricated; disk
   comparison stays `unknown` even after a source edit and HEAD movement.

No UI, adapter, lineage, session, build counter, release/version or public API
expansion is included. No sourceHash comparison was introduced into recovery.

## Same-assertion real SOURCE HTTP before/after

Committed gate: [`scripts/e2e-source-build-identity.mjs`](../../../scripts/e2e-source-build-identity.mjs).
Durable sanitized responses, mappings, versions, process exits and controlled
Git timings: [`1330-source-build-identity.json`](1330-source-build-identity.json).
Harness SHA-256: `9d7bfee6d5a2bebe2d250e9f8527e63f6fe32bd0949e169f9d5a13a75c8a59ff`.

```sh
# Same final assertions: expected exit 1 on actual unchanged main.
E2E_BUILD_SOURCE_REF=6e510dbcb7713997e0299a7f954ee73bb45ceae7 \
  node scripts/e2e-source-build-identity.mjs
# Expected exit 0 on corrected source.
E2E_BUILD_SOURCE_REF=9b7fbda5159e908a83b573ee2cb14fd13a227c55 \
  node scripts/e2e-source-build-identity.mjs
```

The driver archives the selected **committed source**, initializes an owned
fixture Git repo, links installed `node_modules`, and adds a 65 MiB sparse
untracked file. It supplies an allowlisted environment, isolated HOME/config/
sessions, an empty named Claude profile and explicit installed CLI path before
Bun dynamically imports the fixture's actual `src/proxy/server.ts`. The Hono
Node HTTP listener uses an ephemeral loopback port. Only `/health` and
`/build-status` are requested: no generation, login, owner-credential or client
model-access probe. The real installed SDK is loaded, not mocked, but its model
API is not called.

| Observation | Unchanged main | Corrected source |
| --- | --- | --- |
| Archived source SHA | `6e510dbc…` | `9b7fbda5…` |
| Actual fixture startup HEAD | `39b4199c086d76a43633dfe441b8bd503c34c6f7` | `a457cc9bd27ad0c35a06ec5276b146954e480918` |
| `/health` | 503, `loggedIn: false`, build missing SHA/branch/dirty | 503, `loggedIn: false`, actual fixture SHA, `source-build-fixture`, `dirty: true` |
| `/build-status` | 200, `unknown` | 200, `unknown`, same actual fixture SHA |
| Edit tracked input and move HEAD | Identity unchanged but incomplete | Identity remains the startup SHA, branch and dirty facts |
| Hash/counter/certification | Absent | Absent, no `latest` comparison |
| Same final SHA assertion | FAIL (`undefined` versus startup HEAD); worker/driver exit 1 | PASS; worker/driver exit 0 |
| Cleanup | Listener and backend closed; direct worker and both pipes returned | Same, normal exit; credential file remains absent |

**Source SHA versus fixture SHA is intentional:** the source archive contains
exactly the selected tree, but the owned Git commit has its own metadata and
SHA. The assertion compares health to the *actual fixture HEAD*, not to the
upstream archive's SHA. These mappings are retained in the JSON proof.

Versions: macOS/Darwin arm64, Node driver **24.20.0**, Bun **1.3.14** (its
`process.version` compatibility value is `v24.3.0`, not a second stock Node
installation), Agent SDK **0.2.141**, installed/native Claude Code **2.1.284**
(`--version` checked), Apple Git **2.54.0**. The isolated CLI auth-status exit
was 1 with `loggedIn: false`; backend shutdown awaited the existing probe owner
cleanup. No credentials were present before or after; model requests: **0**.

**Limits:** This is a real source HTTP/server boundary test on Darwin, using a
deterministic fingerprint **file-cap failure**, not reproduction of the original
heavily loaded Linux host's time-budget symptom. Windows/Linux live scheduling,
filesystem behavior and that exact loaded-host symptom are not established.
The new fake-Git recovery file explicitly skips Windows because its controlled
executables use POSIX shebangs; existing platform-neutral certification controls
are unchanged. Being omitted from Windows CI alone would not make those fixtures
portable for a contributor's full Windows `npm test`.
No model/client generation gate is applicable to these build-only reads. This
must not be presented as an actual Linux or successful-model result.

## Regression controls and local gates

`src/__tests__/build-source-recovery.test.ts` bundles the selected source helper
for **stock Node** and executes controlled direct Git processes without global
PATH mutation or SDK/module mocks. Same final assertions on the uncorrected
contributor commit: **4 pass / 6 fail**, exit 1. Corrected: **10 pass / 0 fail**,
exit 0. Controls cover detached/conflicting launcher environment, failed-status
stale-clean facts, complete recovery failure retaining launcher fallback, small
source fingerprinting and disk changes, unrelated nested root, safe links,
aggregate budget, exhausted root, TERM-resistant finite Git, and the ordinary
fingerprint path using the changed helper.

Measured controlled records (not hard scheduling promises):

| Case | Uncorrected source | Final full-suite run |
| --- | --- | --- |
| Five slow commands / shared budget | 3,462.52 ms; all five executed, optional facts claimed | 2,002.34 ms; root+SHA recovered, optional facts omitted, four commands started |
| Exhausted canonical-root timeout | 3,292.46 ms | 2,002.05 ms; one command, rejected |
| TERM-resistant finite child, 400 ms deadline | 1,778.55 ms; **accepted** late clean output | 403.67 ms; rejected |
| Fingerprint Git timeout | 3,291.45 ms | 2,002.70 ms; rejected |

Every recorded controlled direct PID was checked absent after the probe returned.
No child watchers or unbounded timers were created. Helper tests allow small
scheduling tolerance; the controlled programs are finite even on the baseline.

Final code-head checks at `9b7fbda5…`:

- Focused existing build tests: **79 pass / 0 fail** across six files; new
  recovery controls: **10 pass / 0 fail**. Adjacent artifact controls include
  uncertified/unstamped launcher fallback, npm separation, counter rollback,
  mismatched embedded metadata, split chunks, failed certification, independent
  worktrees, root aliases, oversized artifact/metadata and immutable source
  observations. Existing mocked `/health` tests passed in their isolated group.
- `npm test`: pretest typecheck plus **5,574 pass / 0 fail / 35 skip**, 21 isolated
  invocations, exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0; Node entrypoint checks and local certification pass.
- `node --check scripts/e2e-source-build-identity.mjs`: exit 0.
- `git diff --check`: clean; local documentation links checked.

Supplemental logs live under `/tmp/meridian-backlog-202607/build1330-*.log`
(`recovery-before`, `recovery-after`, `http-before`, `http-after`, `focused`,
`npm-test`, `typecheck`, `build`). Those temporary paths are not the escrow;
this committed harness, JSON proof and review record are the durable handoff.
The implementation's own whole-diff review is **not** the parent's final
independent review or a final-head CI claim.
