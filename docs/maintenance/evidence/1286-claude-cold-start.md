# Claude PATH cold-start timing — #1286

Source: [#1286](https://github.com/rynfar/meridian/pull/1286),
`b7caeacaf89f3f9c95d2e13ca5d1e53556eb6b46`; authored cherry-pick
`20d81324d2fcc061722df1c82bb2f36710694c1c` preserves Nowaker's Author/AuthorDate.
Unchanged main is `338630adb2832381e7ddfcee7bb8567e61cc9293`; separately
corrected product/tests are `fdc4c5023b4202669943ac28a5471b68fe12e589`.

The source's two-second version probe could silently reject a healthy
operator-installed Claude that was cold in memory and select a different
packaged installation. Its proposed 90-second wait exceeded desktop startup's
60-second health wait. The accepted correction shares 45 seconds across PATH
lookup and all candidates, and profile listing resolves once even when no
executable is found. Per-profile auth checks and token-only isolation remain.
Resolver order, explicit override and public health fields are unchanged.

## Native before/after proof

The committed harness is `scripts/e2e-claude-version-cold-start.mjs`; its command
is documented in [E2E.md](../../../E2E.md#operator-managed-claude-executable-selection).
Use a fresh output directory for each attempt to preserve prior logs and markers.
It uses the actual installed native binary with a controlled 3.1-second delay
before `--version`. Fresh Bun processes receive PATH before startup, and their
returned resolution objects are logged before assertions. No auth, SDK, client,
model, login or credential-store operation is requested.

On **macOS 26.6.2 arm64**, **Bun 1.3.14**, **Claude Code 2.1.289**, the final
repository-harness run passes all 12 baseline/fixed × async/sync × delayed/fast/exit-3
arms:

| Control | Unchanged async / sync | Corrected async / sync |
| --- | --- | --- |
| 3.1-second delay, then real native version | Packaged fallback, 2014 / 2007 ms | PATH wrapper retained, 3336 / 3352 ms |
| Real native version without delay | PATH retained | PATH retained |
| Candidate exits 3 | Packaged fallback | Packaged fallback |

Seven native version invocations completed in that run: one direct version
receipt, four fast-wrapper responses and two corrected delayed-wrapper
responses. The baseline's delayed wrappers were terminated before executing
the native binary. Source and native hashes matched before/after; parent PATH,
HOME and CODEX_HOME were not changed. All twelve worker exits were zero with
null signals. Successful-worker stderr is retained, including both fixed
exit-3 rejection warnings. The 3.1-second arms are below the five-second
slow-warning threshold.

[The sanitized result projection](1286-claude-cold-start.json) retains all
twelve timings, selected sources, terminal results, warnings and source/native
hashes. The harness is 8026 bytes,
SHA256 `32f313a111b24bd10ddf10bf3767b0fca0ea9c3bcdf7f8da74452e5bfae5890b`.
An earlier corrected run also passed with seven native version invocations;
the two successful runs total fourteen. That first run discarded successful
worker stderr; the final run corrects capture without changing product code.

The initial fixture changed PATH inside Bun. Its unchanged-main async arm
fell back after 2015 ms; the sync arm returned another path, then failed an
unsupported fallback-source assertion before logging the object. The exact
first failure remains retained. Supplying PATH before each fresh Bun launch
corrects that fixture ambiguity; the failed attempt is not retroactively passed,
and its sync native invocation count remains unknown.

This is controlled native version timing, not a natural memory-pressure
reproduction, Linux/Windows verification or the older #1246 Linux
OpenCode/Opus incompatible-version gate. That gate's existing assertions remain
required for installation preference, override and package/version compatibility
changes. No model or client participates in this reported version-probe defect.
The shared subprocess timeout does not promise hard process death when a child
ignores termination; [synchronous Node timeout semantics](https://github.com/nodejs/node/blob/v22.x/doc/api/child_process.md)
are inherited.

## Review and validation

The first review's desktop deadline and repeated-profile findings are corrected,
with async/sync aggregate-budget and successful/missing/token-only profile-list
controls. Its readiness finding read an older checkout: current main already
uses asynchronous readiness resolution and was not changed.

Focused tests: **51 pass, zero failures, 89 assertions**. Final typecheck and
build both pass on product/test head `fdc4c502`.

The full `npm test` command exited **1** in stage 17 on the unchanged
`store-mutation-loop-lag.test.ts:136` benchmark: warm median 23.070791 ms
exceeded its 21.1296255 ms limit (75% of the 28.172834 ms full-document median).
The main batch passed 5018 tests with 35 skips and no failures; all preceding
isolated batches passed. The two stages not reached by that command were then
run separately with the exact npm-runner commands: profile credential isolation
8 pass, header settings routes 24 pass. Across all original stages this is
**5362 pass, 35 skip, one fail**, not a clean full-suite pass.

The failing test, its complete conservative local import graph, preload and
configuration are byte-identical to unchanged main; they do not import the
changed models/profile CLI. One sequential unchanged-main/current comparison
passes 9 tests in each arm, without changing the test or its threshold:

| Store benchmark arm | Warm median / max | Full-document median |
| --- | --- | --- |
| Unchanged main | 9.0 / 12.4 ms | 27.3 ms |
| Corrected branch | 5.9 / 10.1 ms | 26.3 ms |

The original failed command/log remains retained. These samples support an
unrelated variable host/filesystem timing result; they do not establish a store
fix or retroactively pass the full command. No full-suite retry or threshold
weakening was used. Passing final-head CI, including `test`, remains a landing
gate.

The fresh independent review accepts the integration with maintainer
corrections. It reviewed the complete authored/maintainer diff, canonical
current callers, tests, exact final harness and evidence scope. No material
product, regression, harness or documentation finding remains. This proves the
reported version-probe timing assertion; desktop startup was not separately
run end to end. Passing final-head CI and exact-head merge verification remain
required before landing.
