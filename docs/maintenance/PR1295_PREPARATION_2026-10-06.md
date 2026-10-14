# #1295 authored incorporation preparation

Historical preparation below predates the release rebase and live runs.
[Current verification](evidence/1295-live.md) records code head `0a504fc0`,
released baseline `c2052aac`, completed local/live proof and preserved failures.
Final independent acceptance review and delivery-head CI remain before merge.
This record covers only
[#1295](https://github.com/rynfar/meridian/pull/1295).

## Source and author custody

Worktree: `/Users/rynfar/repos/meridian-pr1295-publication-stall-20261006`.
Branch: `codex/pr1295-publication-stall-20261006`.
Fresh `origin/main` at preparation: `ca6a5c0a4eddb87da52d83993f8f9e105712f0f6`.
Refreshed contributor head: `9d932c846afbb19b92d1a8f516772b3cd2552491`.

| Actual contributor commit | Authored incorporation |
| --- | --- |
| `31dfea0b09bbc5ad851ac9dd2e5d6de035584746` | `1d76be40355ddac7aabebfa2f2d9cc5b92637d87` |
| `9d932c846afbb19b92d1a8f516772b3cd2552491` | `b2ec72c763f82283ff6fb5e3ec96e564bc939f17` |

Both actual cherry-picks preserve Nowaker `<spam@nowaker.net>` and AuthorDates
2026-09-28T08:18:11Z / 2026-09-29T20:54:22Z. They were made with `git cherry-pick
-S` using the repository's SSH signing setup. Local signature trust verification
remains unavailable because `gpg.ssh.allowedSignersFile` is not configured; no
trust configuration was changed. Maintainer corrections are separate in
`ee40d8484b2ab1507302a021952482ae63aee1dd`.

The dirty owner checkout and #1290 worktree were preserved. Existing dependency
files are shared through a `node_modules` symlink; no install or dependency
modification occurred.

## Corrections and scope review

- P2: a holder gets at most one additional full window when its first deadline
  runs late. The second callback rejects queued and new callers even when it is
  late again. The active holder retains ownership until its real completion;
  work never overlaps. A frozen event loop still cannot execute a timer, so this
  bounds extensions once callbacks run rather than promising a wall-clock
  deadline while JavaScript is suspended.
- P3: the existing process-wide operational stderr policy moved from server
  orchestration into `operationalLog.ts`. The server and queue import that leaf;
  `silent: true` suppresses the late-deadline operational line while diagnostic
  entries remain. Nonsilent hosts retain the operational line. This preserves
  the existing process-wide policy and changes no public configuration or route.
- Publication assertions now inspect SDK identity/options and exact replay
  history. After deferral, the next target differs from both the original source
  and abandoned target, has no resume/resume-at/fork options, and receives all
  supplied earlier user and assistant turns plus the live user turn.
- Both JSON and SSE have controls for healthy publication/resume, fresh and
  headerless deferral, a concurrent CAS winner, durable invalidation throwing,
  cancellation, forced shutdown, and durable priority publication. Priority
  assignment and mapping generation retain their existing atomic authority.
- Actual queue-capacity and external-acquisition rejections are exercised before
  the publication callback enters. The latter invokes the real lifecycle
  acquisition with a current isolated lock fixture and zero wait budget; the
  callback sentinel stays false. These are bookkeeping tests with a mocked SDK,
  not evidence from an actual model or Linux deployment.

The production pre-entry guarantee, durable mapping CAS, priority exclusion,
cancellation/revocation checks and cleanup ownership are unchanged. Alternate
captured-tool and silent-recovery publication barriers remain separate; the new
fallback is not a claim about those paths. No general recovery guardian, public
interface or test platform was added.

## Focused reproducible evidence

Runtime: Bun 1.3.11 (`af24e281`), supplied isolated Darwin arm64 executable at
`/Users/rynfar/repos/meridian-review-evidence-20261006/pr1290/tooling/bun-1.3.11/package/bin/bun`.
The SDK and model responses are mocked; the requested model string in the HTTP
fixtures is `claude-sonnet-4-6`, not a tested actual model ID.

```sh
bun test src/__tests__/lifecycle-lock-queue.test.ts \
  src/__tests__/lifecycle-publication-degrade.test.ts \
  --test-name-pattern 'recurrently|late-deadline diagnostics' --timeout 10000
```

Before the correction, the nonsilent control passed and two assertions failed:
the second `clock.advance(111)` left the waiter unrejected, and a silent proxy
still emitted one operational stderr line. Result: 1 pass / 2 fail, exit 1.
The corrected assertions pass: 3 pass / 0 fail, 11 assertions, exit 0.

The final tests were additionally run against a reversible two-line mutation of
`lifecycleLockQueue.ts`: remove `&& !graceUsed` from the late-deadline condition
and replace `plog` in `logQueueEvent` with `console.error`. This restores the two
authored defects without altering fixtures or removing the new logging leaf.
It produced the same 1 pass / 2 fail result. The queue file was byte-restored
(SHA256 `8bb032057b0f8b1e9381efa6146f67bc92fc6a30ea53f1f7d30f47129314f1de`),
and the same focused command then passed 3 / 0.

```sh
bun test src/__tests__/lifecycle-lock-queue.test.ts \
  src/__tests__/lifecycle-publication-degrade.test.ts --timeout 10000
npm run typecheck
git diff --check
```

Final focused files together: 37 pass / 0 fail, 262 assertions, 6.63 seconds.
Typecheck and diff checks pass. Broad `npm test` and build were intentionally not
run while the authorized owner was running #1290 live gates.

## Escrowed publication fault harness — not executed

[`scripts/e2e-publication-lock-fallback.mjs`](../../scripts/e2e-publication-lock-fallback.mjs)
delegates the exact query input and every actual SDK message unchanged. It uses
an isolated supported `oauth-token` profile, loopback port, config/session store,
empty plugin directory and disposable project. Its private access-only snapshot
must contain exactly `{accessToken, expiresAt}`, expire beyond the ten-minute
run, and carry no refresh grant. The source snapshot is read and hash-checked;
the harness never writes it or native source credentials. Existing credential
and provider environment is cleared before product imports; refresh is disabled
through read-only mode and the profile's isolated Claude configuration.

The one fault brackets ordinary terminal `publishPinnedTranscript`. Before
injecting, it requires a real successful answer, observed actual model/CLI
metadata, the production joined-lease release witness, and absence of an SDK
writer lease in the durable sidecar. A grantless owned child acquires the actual
canonical `session-gc.json.lock` through production's initialized-candidate
hardlink publication. The original publication function then waits 500 ms on
that lock. The gate requires the genuine acquisition-timeout class/message, a
false durable-callback sentinel, and exact child ownership through rejection.
It rethrows that original error only after joining the helper and proving its
owned lock/staging files were removed. Forced cleanup or callback entry fails
the gate; no lock error is manufactured inside a durable callback.

The healthy control makes two real turns, requires native resume to a distinct
fork, and checks the immutable source through supported `getSessionMessages`.
The fault flow makes three real turns: seed, answered publication failure, then
complete-history fresh replay. Fixed source must deliver the exact observed SDK
answer, invalidate the old mapping, and use a target distinct from both the old
source and abandoned target with no resume/resume-at/fork option. It asserts the
exact earlier user/assistant replay input, live final turn, supported SDK history
and unchanged source. SSE additionally requires natural body completion, one
`end_turn` delta and one `message_stop`; JSON must end normally.

Reproduce later with the **same harness file/hash** and dependencies against two
clean isolated checkouts. The proposed supported owner tuple is Linux x86_64,
Bun 1.3.11, Anthropic Claude Max through the real SDK, and explicit Opus 5.5;
record the actual installed SDK/CLI versions rather than inferring them from a
lockfile. The owner supplies the private snapshot separately.
`E2E_EXPECTED_SERVED_MODEL` may be set only to the
explicit expected actual SDK model ID when its metadata differs from the request
alias. Optional `E2E_CLAUDE_BIN` pins an existing supported CLI executable.

```sh
E2E_MERIDIAN_ROOT="$BASELINE_CHECKOUT" E2E_AUTH_FILE="$PRIVATE_ACCESS_SNAPSHOT" \
  E2E_MODEL=claude-opus-5-5 bun "$HARNESS_CHECKOUT/scripts/e2e-publication-lock-fallback.mjs" --json
E2E_MERIDIAN_ROOT="$CORRECTED_CHECKOUT" E2E_AUTH_FILE="$PRIVATE_ACCESS_SNAPSHOT" \
  E2E_MODEL=claude-opus-5-5 bun "$HARNESS_CHECKOUT/scripts/e2e-publication-lock-fallback.mjs" --json
```

Repeat both commands with `--stream`. Unchanged main is expected to exit 1 at
fault delivery, with the genuine pre-entry timeout/owned-helper cleanup proved,
the actual answer preserved privately, and the source mapping still present.
An earlier startup/provider/model/helper failure is **not** the baseline
counterexample. Corrected source must exit 0 with `result: PASS` and all five
observed actual queries. The script records exact source/lockfile/harness hashes,
Meridian/SDK versions, actual served model IDs and actual CLI init versions.
No bundle is exercised. Private mode-0600 artifacts include SDK inputs/answers,
HTTP bodies and supported history; the printed summary contains hashes and
metadata. Retain reviewed sanitized before/after evidence durably before claiming
acceptance; raw private artifacts must not be published.

Static bounds per run: at most five real SDK queries; request 120 s, run abort
600 s, final process bound 630 s; helper acquire 5 s, readiness 8 s, owned hold
15 s, normal join 2 s then forced join 2 s; external acquisition 500 ms; shutdown
15 s. These JavaScript deadlines require a scheduling event loop. Use the
owner's external process deadline for a frozen-runtime experiment. Preparation
ran only `node --check` and content/diff checks, never the executable payload.

This narrow raw-HTTP text fixture does not establish native Pi/OpenCode plugin
behavior or tool identity, recurring live timer lag, concurrent-winner, failed
invalidation, priority or cancellation under a real provider. The latter
bookkeeping controls are discriminated in mocked integration tests above; the
repeated-delay/one-delay controls are deterministic queue tests. Live timer and
tool-history proof remain open where required by the full acceptance brief.
The author's production client/model/version tuple remains unknown (Linux and
Mac were reported). The owner-selected supported tuple is separate evidence,
not an attribution to that deployment.

## Required next gates

1. Independent final-diff review, required local `npm test` / typecheck / build,
   including process-global mock isolation, and final corrected-head CI with
   `test`. No branch push, PR creation, merge or external comment occurred.
2. Run the escrowed fault gate on unchanged baseline and corrected source in
   both modes with an explicit owner-selected tuple; capture actual before/after
   artifacts. The author's production client/model/version tuple is unknown.
3. Run E2E.md's concurrent transcript publication gate in both modes with the
   implicated model explicitly selected, all four E41 sequential/parallel ×
   JSON/SSE arms, and actual affected-client continuation with its required
   plugin witnesses. Actual OpenCode requires its generation-matching Meridian
   plugin; the canonical Linux gate also requires scrub and both runtime route
   witnesses. No SDK, model, auth, provider, package, Docker or live client
   operation was performed during this preparation.
4. Refresh source head and current main before delivery and immediately before
   any exact-head merge. Preserve contributor credit on the eventual squash.
   Release authorization remains separate.
