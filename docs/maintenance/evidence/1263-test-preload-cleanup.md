# PR #1263 — test preload scratch cleanup

## Disposition and source

Accept with maintainer corrections. [Nowaker's PR #1263](https://github.com/rynfar/meridian/pull/1263) addresses test infrastructure accumulation: each Bun test process on unchanged main creates settings and session scratch directories that outlive passing, failing and timed-out suites. No production behavior, public API, model adapter or user configuration changes.

- Reproduced baseline/original reviewed base: `f299fe06e72411b786380b5212edea79cd13966a`.
- Current delivery base after merged header PR #1264: `9d77d8e282cb9c58d99b8962b900777e9f4b0803`.
- Reviewed source head: `3a959e12569d72db44be9f868ea25fdf54fde49a`.
- Current authored cherry-pick: `19334b24e762249628821a76ddc0b3bec83c3c9f` (original source `3a959e12569d72db44be9f868ea25fdf54fde49a`; historical pre-rebase cherry-pick `3b86fb69beed0db87e2bc7113bd3a8be176cfb3e`).
- Current separate maintainer correction: `c169e46d80cd20689990e5276900f14f6655f215` (historical pre-rebase correction/full-suite validation head `fb795476ef9be300c9be4960c639e003ea3e366c`).
- Current carried evidence commit: `f905a9d93c2c6ab513b0eff8373156c275934c9f` (historical pre-rebase delivery head `9961a379ee3e61f178185ffa8d8ead9917d18909`).
- Preserved Author: `Nowaker <spam@nowaker.net>`; AuthorDate: `2026-10-04T13:33:12Z`.
- Worktree/branch: `/Users/rynfar/repos/meridian-backlog-preload-1263-20261004`, `codex/backlog-preload-1263-20261004`.
- No linked issue, source comments, inline reviews or review objections were present at review. Source PR remains open; no merge, closure or community comment is authorized by this delivery.

## Baseline and final assertions

Platform: macOS arm64; Node `v22.22.3`; Bun `1.3.14 (0d9b296a)`. These are real Bun subprocess/file-system checks. Model/SDK/client calls are not implicated by test infrastructure changes and were not run.

Before changing the tracked baseline preload, copied only the contributor's new `preload-tmp-cleanup.test.ts` and `test-tmp-dirs.ts` into the fresh baseline worktree and ran:

```sh
bun test src/__tests__/preload-tmp-cleanup.test.ts
```

The original five assertions produced **1 pass, 4 fail, exit 1**: passing, failing and timed-out children left their pairs behind; the next run did not sweep the SIGKILLed child's pair. The synthetic dead/live-owner control passed. An isolated `TMPDIR` also contained the outer runner's two scratch directories after exit. Each probe root was cleaned by its harness afterward; the user's checkout/configuration was preserved.

After the authored cherry-pick, the same five assertions produced **5 pass, 0 fail, exit 0**.

The final committed test includes twelve cases and **47 assertions**. All pass with exit 0, covering:

- live directory availability and teardown of passing, failing and timed-out test runs, with actual failure/timeout diagnostics asserted;
- SIGKILL leftovers swept by the next real preload without deleting the live parent's directory; guaranteed child kill/wait cleanup on assertion/startup failure;
- current-PID stale sentinels reset before tests and the pair kept available through two files' `afterAll` hooks;
- a real permission-denied own-PID reset aborting startup rather than inheriting state (explicitly skipped on Windows and root, where the permission control is inapplicable);
- known-dead pairs removed; current process pairs, uncertain liveness, malformed PID encodings, unrelated directories, matching foreign files and symlinks preserved;
- failed deletions not reported as successes, with a later successful retry and unreadable/non-directory root handling.

The independent review additionally checked preload teardown on import/parse failures, skipped/empty suites and watch reruns on this Bun/platform combination. Those probes found no teardown-order regression.

## Adversarial findings and corrections

1. **P2 — deletion safety:** the source accepted leading-zero and out-of-range PID names; unexpected `process.kill` errors could classify their owners as dead. It also recursively removed matching regular files and symlinks. Corrections accept only canonical positive signed-32-bit PID encodings and real directory entries, and consider only `ESRCH` proof that an owner is gone. `EPERM` and unknown failures preserve state. Symlink targets were already spared by `rmSync`; the corrected sweep preserves the symlink too.
2. **P2 — startup isolation:** best-effort removal could fail and leave reused-PID state available to the new suite. Startup now checks the result and aborts if its own pair cannot be reset; teardown and stale sweeps remain best effort.
3. **P3 — inaccurate result:** the source returned a directory in `removed` even after deletion failed. The removal helper now returns a boolean, and the sweep lists only successful removals.
4. **P2 — harness cleanup:** the source's hanging child could survive when readiness/assertions failed. Spawn failures/early exits are handled, and a `finally` block always terminates and awaits that child.

Independent final-diff review found no remaining material product-fit or regression objection. This stays within test-only helpers and preload initialization; no production module dependency or configuration contract changes.

## Actual default-helper negative controls

These before/after observations use the default process probe and real file system, without mocked liveness/removal callbacks. Both candidate PID values were first checked unoccupied. A real read-only parent directory produced the removal failure on this non-root POSIX host.

```jsonl
{"label":"contributor-before","case":"actual-default-sweep","reportedRemoved":["meridian-test-sessions-2147483647","meridian-test-settings-0002147483647","meridian-test-settings-2147483646","meridian-test-settings-2147483647","meridian-test-settings-99999999999999999999"],"hugePidPreserved":false,"leadingZeroPreserved":false,"foreignFilePreserved":false,"foreignSymlinkPreserved":false,"symlinkTargetPreserved":true,"liveOwnerPreserved":true,"confirmedDeadDirectoryRemoved":true}
{"label":"contributor-before","case":"actual-deletion-error","reportedRemoved":1,"stillExists":true}
{"label":"corrected-after","case":"actual-default-sweep","reportedRemoved":["meridian-test-settings-2147483646"],"hugePidPreserved":true,"leadingZeroPreserved":true,"foreignFilePreserved":true,"foreignSymlinkPreserved":true,"symlinkTargetPreserved":true,"liveOwnerPreserved":true,"confirmedDeadDirectoryRemoved":true}
{"label":"corrected-after","case":"actual-deletion-error","reportedRemoved":0,"stillExists":true}
```

The exact sanitized probe below is retained here so `/tmp` is not the only evidence source. Save the block as `cleanup-probe.ts` outside the repository and run against source and delivery helpers:

```sh
git show 3a959e12569d72db44be9f868ea25fdf54fde49a:src/__tests__/test-tmp-dirs.ts > contributor-helper.ts
bun cleanup-probe.ts contributor-helper.ts contributor-before
bun cleanup-probe.ts /absolute/path/to/delivery/src/__tests__/test-tmp-dirs.ts corrected-after
```

```ts
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
const { sweepStaleTestDirs, isProcessAlive } = await import(pathToFileURL(resolve(process.argv[2]!)).href)
const label = process.argv[3]!
const root = mkdtempSync(join(tmpdir(), "meridian-cleanup-review-"))
try {
  const foreignPid = 2147483647
  const deadPid = 2147483646
  if (isProcessAlive(foreignPid) || isProcessAlive(deadPid)) throw new Error("negative-control PID is occupied")
  const huge = join(root, "meridian-test-settings-99999999999999999999")
  const leading = join(root, "meridian-test-settings-0002147483647")
  const file = join(root, `meridian-test-settings-${foreignPid}`)
  const target = join(root, "foreign-target")
  const link = join(root, `meridian-test-sessions-${foreignPid}`)
  const stale = join(root, `meridian-test-settings-${deadPid}`)
  const live = join(root, `meridian-test-settings-${process.pid}`)
  for (const dir of [huge, leading, target, stale, live]) mkdirSync(dir)
  writeFileSync(file, "foreign file")
  writeFileSync(join(target, "sentinel"), "keep")
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir")
  const removed = sweepStaleTestDirs(root)
  console.log(JSON.stringify({label, case: "actual-default-sweep", reportedRemoved: removed.map((path: string) => basename(path)).sort(), hugePidPreserved: existsSync(huge), leadingZeroPreserved: existsSync(leading), foreignFilePreserved: existsSync(file), foreignSymlinkPreserved: existsSync(link), symlinkTargetPreserved: existsSync(join(target,"sentinel")), liveOwnerPreserved: existsSync(live), confirmedDeadDirectoryRemoved: !existsSync(stale)}))
  if (process.platform !== "win32") {
    const deniedRoot = join(root, "denied")
    mkdirSync(deniedRoot)
    const denied = join(deniedRoot, `meridian-test-settings-${deadPid}`)
    mkdirSync(denied)
    chmodSync(deniedRoot, 0o500)
    try {
      const reported = sweepStaleTestDirs(deniedRoot)
      console.log(JSON.stringify({label, case: "actual-deletion-error", reportedRemoved: reported.length, stillExists: existsSync(denied)}))
    } finally { chmodSync(deniedRoot, 0o700) }
  }
} finally { rmSync(root, {recursive: true, force: true}) }
```

## Required gates and delivery status

- Focused actual Bun cleanup tests: **12 pass, 0 fail**, exit 0.
- `npm run typecheck`: **pass**, exit 0 on the rebased source; the historical full `npm test` pretest also passed.
- `npm run build`: **pass**, exit 0 on the rebased source, including Node entrypoint/export validation.
- `git diff --check`: **pass**.
- Historical full `npm test` before the header-only rebase, at `fb795476ef9be300c9be4960c639e003ea3e366c` on baseline `f299fe06e72411b786380b5212edea79cd13966a`: **pass**, exit 0, **5,316 pass / 35 skip / 0 fail**, 26,355 assertions across all **18 process-isolated stages**. Ran with an isolated `TMPDIR`; **zero** `meridian-test-(settings|sessions)-<pid>` directories remained. Three unrelated project fixtures (`meridian-test-droid-project`, `meridian-test-forgecode-project`, `meridian-test-opencode-project`) remained outside this sweep's intended scope; the harness subsequently removed its entire private root.
- Delivery [PR #1265](https://github.com/rynfar/meridian/pull/1265) is created and linked. Root must push the rebased head and obtain fresh final-head CI, including `test`; the historical full-suite result and source PR's green CI do not substitute for that gate.
- Windows/Linux final-head CI remains required; no local Windows/Linux execution is claimed. The permission-specific fixture explicitly skips Windows/root.
- Remote base at rebase: `9d77d8e282cb9c58d99b8962b900777e9f4b0803`; contributor head remains `3a959e12569d72db44be9f868ea25fdf54fde49a`. Source and delivery PRs are linked to the T3 thread.
- No PR has been merged, no original issue/PR has been closed, no release has been initiated.

### Historical full-suite stage results

| Stage | Pass | Skip | Fail | Assertions | Files |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 4995 | 35 | 0 | 25211 | 311 |
| 2 | 3 | 0 | 0 | 16 | 1 |
| 3 | 24 | 0 | 0 | 105 | 1 |
| 4 | 5 | 0 | 0 | 21 | 1 |
| 5 | 7 | 0 | 0 | 135 | 1 |
| 6 | 12 | 0 | 0 | 15 | 1 |
| 7 | 3 | 0 | 0 | 16 | 1 |
| 8 | 22 | 0 | 0 | 63 | 1 |
| 9 | 10 | 0 | 0 | 36 | 1 |
| 10 | 11 | 0 | 0 | 21 | 1 |
| 11 | 8 | 0 | 0 | 9 | 1 |
| 12 | 95 | 0 | 0 | 169 | 1 |
| 13 | 13 | 0 | 0 | 39 | 1 |
| 14 | 11 | 0 | 0 | 37 | 1 |
| 15 | 73 | 0 | 0 | 369 | 1 |
| 16 | 7 | 0 | 0 | 16 | 1 |
| 17 | 9 | 0 | 0 | 28 | 1 |
| 18 | 8 | 0 | 0 | 49 | 1 |

## Header-only base update and impact review

After root merged header PR #1264, rebased this isolated feature branch onto `9d77d8e282cb9c58d99b8962b900777e9f4b0803`. Rebase preserved the contributor Author and AuthorDate above. Reviewed the complete base delta from `f299fe06e72411b786380b5212edea79cd13966a`: only shared-header separator CSS, its existing static assertion, a manual header fixture and its verification documentation/evidence changed. There is no change to preload ownership, process probing, test teardown, session/configuration initialization or production interfaces.

`git diff --exit-code 9961a379ee3e61f178185ffa8d8ead9917d18909 f905a9d93c2c6ab513b0eff8373156c275934c9f -- src/__tests__/preload.ts src/__tests__/test-tmp-dirs.ts src/__tests__/preload-tmp-cleanup.test.ts` exited **0**, proving all cleanup source/test blobs are identical to the prior validated delivery. The base's CSS/test correction is retained as merged. Independent adversarial findings above therefore remain resolved.

Impact-appropriate checks on the rebased source/evidence head `f905a9d93c2c6ab513b0eff8373156c275934c9f`:

```sh
bun test src/__tests__/preload-tmp-cleanup.test.ts src/__tests__/site-header.test.ts src/__tests__/build-badge.test.ts
npm run typecheck
npm run build
git diff --check origin/main
```

The focused command passed **71 tests / 293 assertions / 0 failures**, exit **0**, across all three files. An isolated temporary-root inventory again found **zero** per-process settings/session scratch directories afterward. Standalone typecheck, build and whitespace validation passed with exit **0**. No full suite was rerun while another queue item held the serialized suite slot; the unchanged-source historical full-suite proof above is retained. Fresh CI on the pushed rebased final head remains mandatory before integration. No model calls, GitHub mutations, community comments, merges, closures or releases were performed by this rebase task.
