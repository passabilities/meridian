# E41 signed thinking fidelity

The E41 verification harness replayed signed `thinking` as `{type: "thinking"}`
and `redacted_thinking` as `{type: "redacted_thinking"}`. Its streaming parser
also ignored `thinking_delta` and `signature_delta`. OpenCode's adapter supports
thinking, so this could make the verification client differ from the response it
actually received. Correct the harness before using a thinking run as evidence.

This is an internal verification correction initially based on
`3afca1f5a0d51d74f8c7437b90f43d5686cf4163`, then rebased onto the documentation-only
main advancement `0369441786b082aadeb31689dcbce41d7e8574d9`. It does not incorporate contributor
code or change proxy behavior, exported contracts, billing, or cache thresholds.
The original #1245/#1220 200-token cache-read discrepancy remains unexplained.

## Reproducible failure and correction

```sh
bun scripts/e2e-e41-thinking-fidelity.mjs
bun test src/__tests__/e41-assistant-response.test.ts
```

The committed offline control retrieves the immutable baseline harness through
Git, executes only its pure parser and replay expression with owned synthetic
blocks, and runs the same assertions against the current shared helper. It
starts no proxy, reads no SDK transcripts or credentials, and makes no network
or model requests. Three assertions fail before and pass after: signed JSON
thinking replay, redacted JSON thinking replay, and streamed thinking/signature
plus redacted replay. Ordinary tool/text replay and cache usage are controls.

`scripts/lib/e41-assistant-response.ts` is the parser used by E41 and its direct
regressions. It accumulates the received thinking/signature fragments, retains
redacted data, and deep-clones entire received blocks for replay. It never
creates a signature or fills in missing thinking fields. Tool JSON parsing and
usage merging retain their existing behavior. No parser is copied into the
current live harness or the fault control.

At frozen executable head `b49defeccf2be9dcae30863689b35b3a6e0d42fd`, full
`npm test` exits 0: **5,354 pass / 35 existing skips / 0 fail**, across 19 isolated
stages with 26,623 assertions and its pretest typecheck. Focused validation is
nine tests / 18 assertions; standalone typecheck and build pass. The offline
failure control passes with three expected baseline failures and three corrected
successes. The only later change is this evidence update. Final-head CI remains
required. No live generation was used or needed for this harness-only correction;
the original native Opus cache observation retains its separate evidence gate.

Adversarial controls cover fragmented signatures, mixed thinking/redacted/text/
tool responses, preserved citations and nested tool input, detached replay
objects, unchanged usage, wrong-block deltas, and malformed tool JSON. The same
helper is directly exercised instead of testing a second implementation.

An independent reviewer inspected the complete helper, all nine tests, the
immutable-baseline escrow expression, E41 integration and report scope at
`b49defec`. JSON retains opaque/full received fields; streaming thinking and
signature deltas append only to their matching block type; tool parsing and
usage remain intact; replay copies are detached. The controls discriminate the
original fidelity loss from corrected preservation and cover ordinary/tool/cache
traffic and wrong-block deltas. No material finding survived. The review
explicitly keeps the original 200-token causal gate open.

## What this establishes about #1245/#1220

The original aggregate response reported read 3,132 / creation 3,461. Its
published thinking/tool assistant instead recorded read 0 / creation 3,332;
the next turn read 3,132. Aggregation explains the larger overstatement, but
does not prove the cause of the remaining 200. The unchanged 95% floor still
requires 3,165.4 from the published counter. Keep that acceptance gate open.

Offline comparison at old base `d57388724a242116f123ff75b88fd2be2846abe3`,
source #1245 `1cb9e53cb4ded92b8589177265cb736eb0978011`, and current main
`3afca1f5a0d51d74f8c7437b90f43d5686cf4163` used the exact default harness
initial request expressions with one fixed owned fixture directory. All four
sequential/parallel × JSON/streaming modes produced matching initial request,
tool schema, built query options, stable fresh/resume options and lineage.
Effort, thinking, directory and tool-result mutation controls were distinguishable.
The source's query, message, lineage, passthrough tool and OpenCode adapter
modules are byte-identical to that old base. Main's thinking-display handling
and transient OpenCode recovery canonicalization do not affect these default
fixtures. These checks do not recreate the missing original generated history
or original SDK transport request, and are not a passing live E41 claim.

Native checkpoint resumes send new user/tool-result content and restore the
SDK's native assistant history. The harness's damaged client echo therefore
does not, by itself, prove native prefix deletion or explain the residual.
Likewise, an encrypted retry and aggregate billing are not causal proof.

## Exact recovery requirements

For supported offline history recovery, recover the original owned fixture's
recorded `CLAUDE_CONFIG_DIR`, project workdir (`E2E_HISTORY_DIR`), and session
UUIDs for the failing thinking/tool turn and the next turn. A Meridian store
locator's `currentTranscript`/`previousTranscript` fields can supply these
identities if the original owned store location is recovered. An expired grant
does not prevent this supported local history inspection. Do not infer the
scope from global credentials or inspect private SDK files.

The existing #1245 `scripts/e2e-session-store-history-usage.mjs` can retrieve
assistant counts through `getSessionMessages`. To compare the exact checkpoint,
also retain SDK row UUIDs, message IDs, ordered role/block hashes, tool call and
result IDs, and system-message metadata via that supported API. The committed
summary currently contains neither the exact fixture locator nor those UUIDs.

To establish the 200-token cause, the original run additionally needs its
ordered SDK query prompt fingerprints, stable option fingerprints (system/tool
schema, model, thinking, effort, cwd/settings), `resume`/`resumeSessionAt`/fork
identities, per-native-message counters and retry ordering, and request start
times/cache lifetimes. If transport evidence was captured, compare the ordered
tools/system/message blocks through their actual cache breakpoints, including
transient retry transformations. Supported history alone cannot recover an
unrecorded transient transport prompt or its cache markers and timings.

Caching matches the prefix through its cache breakpoint, has a request-start
lifetime, and depends on thinking/effort configuration. A smaller cache-read
counter alone cannot select which condition changed. See the primary
[prompt caching documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
and [thinking documentation](https://platform.claude.com/docs/en/build-with-claude/thinking).

A ready, owned native profile for Opus 5.5 can support a future instrumented
reproduction on the same SDK 0.2.141 / CLI 2.1.284 / client flow and platform.
It cannot recreate missing original request identity merely by producing a
green rerun. Any later generation needs root's coordination, and acceptance
remains open until the original failure is explained or causally reproduced.
