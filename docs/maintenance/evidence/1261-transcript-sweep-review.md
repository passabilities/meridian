# Meridian contributor PR #1261 review

Disposition: **defer the proposed implementation; accept the disk-growth problem for a corrected design**. Do not integrate this head. The age-cleanup setting is supported, but root-wide cleanup does not respect Meridian's ownership and native-session retention model, and the idle-process mechanism has concrete admission and shutdown gaps. Correcting only the reproduced race is insufficient.

Source: https://github.com/rynfar/meridian/pull/1261

- Main / PR base at initial assessment: `f299fe06e72411b786380b5212edea79cd13966a`.
- Exact source head and only contributor commit: `7475d08c652332aa1b9b23cbc525024bef83ab28`.
- Author: Nowaker `<spam@nowaker.net>`; AuthorDate `2026-10-04T03:36:26-05:00`.
- Review worktree: `/Users/rynfar/repos/meridian-backlog-transcripts-1261-20261004`, detached at that source head. The original isolated review branch remains based on main at initial assessment. No source modifications, integration commit, PR message, merge, closure, or release was performed.
- Live PR discussion, reviews, and review comments were empty when inspected. No linked issue was supplied in the contribution.

## Findings

1. **P1: config-root-wide age cleanup bypasses retention authority and ownership** (`src/proxy/query.ts:632`, `src/proxy/transcriptSweep.ts:415`, `src/proxy/server.ts:897`). The flag is passed to ordinary requests as well as idle children, so the CLI can delete every old transcript in the root, including current/previous durable mapping pins, publication leases, foreign/interactive sessions, and other processes' transcripts. Neither the new setting nor the idle sweep consults the lifecycle sidecar, authoritative pin provider, lifecycle lock, or physical ownership generations. Existing `sessionLifecycle.ts:638` explicitly makes pins the retention authority, and ARCHITECTURE.md says pinned published transcripts become collectible after eviction. The disabled-by-default profile-copy pruning policy specifically preserves SDK thinking that flattened replay cannot restore. A 30-day automatic global deletion default silently changes this behavior. The PR's text-only fallback test establishes HTTP success after a mocked refusal, not preservation of native history, thinking, cache continuity, undo, or media/tool semantics. Respecting an explicit root settings value does not establish ownership of all files in a shared default `~/.claude` root.

2. **P1: the claimed same-root exclusion is racy and only instance-local** (`transcriptSweep.ts:421-432`, `server.ts:884-915`, request admission at `server.ts:1033`). Busy is checked before an asynchronous credential-store read and not checked after it. A request can mark the same root busy during that await and the sweep still launches. A request can also start after an idle sweep begins: no sweep reservation is consulted by request admission, and the default SDK concurrency budget is 10. `busySdkRoots` is private to one `createProxyServer` and uses lexical path identity; another server/process or a symlink alias is not covered. The reproducible no-model probe `review-sweep-race.ts` records `childStarts: 1, busyAtChildStart: true`. Existing tests exercise only request-first ordering, not the two reverse/race orders.

3. **P1: the deletion child can outlive ownership/shutdown reporting** (`transcriptSweep.ts:280-289`, `382-440`, `stop` at the end of the file). The idle child uses raw `query()` and `close()` rather than the existing SDK process gate's exact-incarnation close-and-join path. After abort, `settleWithin(child, 15000)` may expire; `sweepRoot` nevertheless releases its slot, and a `.last-cleanup` advance or timer deadline may be reported as swept/timed-out without joined process proof. `stop()` also returns after a bounded wait, without proving the child tree has stopped. A remaining child can continue destructive work beside requests, the next pass, or the next proxy owner. Windows executor death does not establish descendant death; existing lifecycle code intentionally preserves that fence until reboot. Any replacement must use an owned executor and prove join, retaining its root/deletion fence on failure, without killing by PID alone.

4. **P2: the advertised off switch does not cover supported settings-source configurations** (`transcriptRetention.ts:83-84`, `query.ts:632-640`, `server.ts:3484-3489`). `0` omits the flag instead of disabling every CLI cleanup source. `MERIDIAN_LOAD_CONTEXT`, `claudeMd: full`, project context, or plugin-supplied setting sources can enable files that provide a period (or enable the normal user-source default). Therefore "0 keeps every transcript" is not a general contract. The tests fix setting sources to `[]`; add the full source matrix and represent the actual guarantee. Managed policy is another documented overriding source.

5. **P2: evidence depends on private transcript format and omits affected-flow proof** (`scripts/e2e-transcript-retention.mjs:33-47`, `82-98`). The proposed harness creates `projects/<project>/<session>.jsonl` content by hand and later reasons about private paths/markers. Upstream verification explicitly says to inspect sessions through supported `listSessions`/`getSessionMessages` and never read/edit private SDK transcript files. The fake metadata/cleanup fixture cannot establish durable pinned/resume/history correctness. The idle proxy tests and login probe skip macOS, despite Keychain behavior being a major side-effect risk; the harness also treats every non-darwin platform as Linux. There is no real Windows proof. Startup proxy environment variables plus a measured connect trace for CLI 2.1.284 are not a permanent OS network-denial boundary; soften absolute promises or enforce/verify the boundary for supported providers/platforms.

## Product fit and corrected direction

Unbounded disk growth from forgotten transcripts is a useful problem to address. Prefer extending the existing bounded lifecycle GC using supported `listSessions` metadata and `deleteSession` APIs in an isolated config context. Retain current/previous pins, publication/writer leases, quarantine, authoritative ownership generations, and physical child joining. Preserve unrelated transcripts by default. Previously forgotten or foreign/shared-root sessions require an explicit, bounded adoption/cleanup policy; enumeration alone cannot prove Meridian ownership. Avoid globally enabling the CLI's autonomous sweep on request paths unless the owner deliberately adopts a different native-history retention policy and supplies its migration/safety boundary. The public SDK types installed here expose session IDs, lastModified, cwd, paginated listSessions, and exact-session deleteSession; private JSONL parsing is unnecessary for a corrected GC.

This is not a small cherry-pick-with-one-fix candidate. If implementation proceeds, preserve the original contributor commit/AuthorDate in an isolated integration and record maintainer corrections separately. A narrower request-setting-only patch still needs resolution of finding 1 and the off/source semantics; simply dropping the idle worker does not solve those.

## Verification actually performed

- Environment: macOS (`darwin`), Bun 1.3.14, installed SDK 0.2.141 / Claude Code package 2.1.284. Dependency install used `--frozen-lockfile --ignore-scripts` in the isolated worktree.
- Full 22-file diff, source commit, PR text/discussion, relevant options callers, profiles/credentials routing, existing publication/pin/lifecycle/process-gate implementation and architecture rules reviewed.
- `bun test src/__tests__/transcript-retention.test.ts src/__tests__/transcript-sweep.test.ts src/__tests__/concurrency.test.ts --timeout 30000`: **51 passed**, zero failures (`pure-tests.log`).
- Focused query/HTTP/settings tests: **138 passed, 3 skipped**, zero failures (`focused-tests.log`). The three skipped tests are every proxy idle-sweep test on macOS; do not report these as verified on this platform.
- `npm run typecheck`: exit 0 (`typecheck.log`). `npm run build`: exit 0 (`build.log`). `git diff --check origin/main...origin/pr-1261`: exit 0.
- `bun /tmp/meridian-backlog-20261004/meridian/1261/review-sweep-race.ts`: exit 0, reproduced the prohibited overlap (`review-sweep-race.log`). This is a pure scheduling probe; no CLI/model call and no raw transcript fabrication or reading.
- Independently fetched published npm `@rynfar/meridian@1.79.0` tarball (`rynfar-meridian-1.79.0.tgz`, `published-pack.json`). Its built request-options section in `dist/cli-ykdmqmn4.js` contains `settingSources: settingSources ?? []` and inline memory/preflight settings, and has no `cleanupPeriodDays` occurrence (`published-retention-inspection.json`). This corroborates the missing setting on the published baseline; it does **not** independently reproduce the claimed 150 GiB accumulation or CLI cleanup refusal.
- Primary official docs inspected: https://code.claude.com/docs/en/settings describes user/project/managed scope and shared config-directory storage; https://code.claude.com/docs/en/agent-sdk/sessions describes native persisted history and persistSession. Installed public `sdk.d.ts` confirms supported listSessions/getSessionMessages/deleteSession APIs. Current reference pages were too large for web retrieval and direct markdown requests returned HTTP 403; no current undocumented marker contract was verified.

## Remaining acceptance gates

`npm test` full isolated suite was not run in this bounded assessment. Required final-head CI, affected actual-client/model E2E, an unchanged/published baseline versus corrected-head disk-growth assertion through supported APIs, all E41 modes where native resume/history is changed, shared/default-root negative controls, pinned current/previous/publication protection, both admission orderings, duplicate instances/processes/aliases, cancellation/unjoin failure, real macOS Keychain and Windows descendant controls, and durable proof escrow remain open. No real model call was made, no published release was changed, and no claim of complete fix is warranted. The sanitized race probe and its observed verdict are escrowed below in this review record. Other `/tmp` logs and the package tarball supplement it and are not durable escrow by themselves.

## Escrowed credentialless admission probe

At source head `7475d08c652332aa1b9b23cbc525024bef83ab28`, save this exact script outside the checkout as `/tmp/meridian-1261-sweep-race.ts`. From an isolated checkout of that head, install dependencies with `bun install --frozen-lockfile --ignore-scripts`, then run:

```sh
bun /tmp/meridian-1261-sweep-race.ts
```

The import is resolved from the command's current working directory. The script only creates a disposable empty config root and substitutes the sweep child; it sends no model prompt, starts no CLI, and does not read or write SDK transcript files. It intentionally asserts that the reviewed head reproduces the forbidden overlap, so exit 0 is **defect reproduction**, not a passing acceptance gate. For a correction regression test, invert the launch assertions: expect zero children when a request made the root busy during the credential await. Include an ordinary idle control that starts one child, and a request-after-sweep-start control that must establish exclusion or preemption before request SDK launch.

```ts
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
const { createTranscriptSweep } = await import(join(process.cwd(), "src/proxy/transcriptSweep.ts"))

const fixture = mkdtempSync(join(tmpdir(), "meridian-1261-review-race-"))
const configDir = join(fixture, "claude")
mkdirSync(configDir)
process.env.MERIDIAN_CONFIG_DIR = join(fixture, "meridian")
mkdirSync(process.env.MERIDIAN_CONFIG_DIR)
for (const key of ["MERIDIAN_TRANSCRIPT_RETENTION_DAYS", "CLAUDE_PROXY_TRANSCRIPT_RETENTION_DAYS"]) delete process.env[key]
let busy = false
let busyAtChildStart = false
let childStarts = 0
let slotsReleased = 0
const sweep = createTranscriptSweep({
  listRoots: () => [{ configDir, explicitConfigDir: true, profileIds: ["fixture"] }],
  isRootBusy: () => busy,
  isDraining: () => false,
  credentialsReadOnly: () => false,
  readCredentials: async () => {
    // Equivalent to request admission updating server.ts busySdkRoots during
    // the awaited platform credential-store read after the first busy check.
    busy = true
    return {}
  },
  tryAcquireSlot: () => ({ release: () => { slotsReleased++ } }),
  runChild: async () => {
    childStarts++
    busyAtChildStart = busy
    return { refusedConnections: 0 }
  },
  log: () => undefined,
})
try {
  const results = await sweep.runPass()
  assert.equal(childStarts, 1)
  assert.equal(busyAtChildStart, true)
  assert.equal(slotsReleased, 1)
  console.log(JSON.stringify({ reproduced: "sweep starts while root is busy after credential await", childStarts, busyAtChildStart, results }))
} finally {
  await sweep.stop()
  rmSync(fixture, { recursive: true, force: true })
}
```

Observed output on macOS with Bun 1.3.14 (ephemeral config path omitted):

```json
{
  "reproduced": "sweep starts while root is busy after credential await",
  "childStarts": 1,
  "busyAtChildStart": true,
  "results": [{
    "profileIds": ["fixture"],
    "outcome": {
      "kind": "failed",
      "durationMs": 1,
      "error": "Claude Code exited before its cleanup ran"
    }
  }]
}
```

The failed cleanup outcome is expected for a promptless stub that immediately returns without changing private CLI cleanup markers; the finding is the child admission while the root is already busy.
