# Deferred client-tool rejection recovery (#1192)

Source `4e55f7de9d1bc52ddbb3d63b61aa13b5ee44ab15` by Nowaker,
cherry-picked as `b636e87875949d6845de49ea3681a82a1aef8e79` with original
Author/AuthorDate. Maintainer harnesses are separate commits. Baseline is
`cc74cd2dd65ec3a246512179fc7958a79a1bccd6`; final base is
`4c5e602e2640348a0fa32668e30e2e621eea700c`. UI-only base advances leave
production errors.ts blob `8805d9e442a754d940f0df3082e1fecc3a58858c` unchanged.

The CLI can reject an already streamed bare client-tool name before PreToolUse.
With more than 80 tools, the proxy budgets four turns. Registered-name digest
retries and repeated rejections exhaust that budget. Accept the confirmed,
id/name-matched rejection at a proxy-set budget, evict the rejected SDK session,
and hand off the original complete client-visible tool block. Unproven opt-in
recovery retains the one-turn/no-drop limits.

## Reproducible controls

Run `bun scripts/e2e-opencode-deferred-refusal.mjs` with Bun 1.3.11 and real
OpenCode installed, after `npm run build`. For baseline, run the identical
harness with the unchanged baseline errors.ts and `E2E_EXPECT_ERROR=1`.
This uses real OpenCode, real SDK 0.2.141 and Claude Code 2.1.284 against a
controlled local Anthropic API. It is fault injection, not a live model claim.
The model identifier in that synthetic response is not evidence of model use.

Both macOS arm64 / OpenCode 1.18.33 and Linux arm64 / OpenCode 1.18.32:

| Observation | Baseline | Corrected |
| --- | --- | --- |
| Actual client-declared roster | 90 tools | 90 tools |
| Actual SDK cap result | error_max_turns, budget 4 | same |
| Bare call rejected before hook | yes | yes |
| Registered digest retry reached hook | yes | yes |
| Client tool completion | 1 | 1 |
| Client error events | 1 | 0 |
| Client-only random read result reached next request | no | yes |
| Follow-up uses fresh SDK query, no rejected resume | absent | yes |

Baseline expectation probes and corrected probes exit 0 with these assertions;
running the positive assertion against unchanged macOS baseline exits 1.
The contributor CLI-level probe also reproduces max_turns on baseline and
passes after: `bun scripts/e2e-capped-turns.mjs --case=client-refusal --stream --deferred`.
Neither direct HTTP nor a mocked SDK establishes actual-client behavior.

## Actual implicated live flow

`E2E_DEFER_ROSTER=1 E2E_TOOL_RECEIPT=1 E2E_PLUGIN_PATH=<installed scrub entrypoint>
node scripts/e2e-opencode-lifecycle-admission.mjs` uses actual Opus 5.5,
SDK 0.2.141 / Claude Code 2.1.284, independent OpenCode state and scrub 0.2.3.
macOS arm64 OpenCode 1.18.33 passes. Linux arm64 Node 24.20.0 / OpenCode 1.18.32
passes on bundled final rebased source: one real read tool, random receipt in
actual SDK request, same-client-session continuation, zero client errors and
four scrub invocations / zero scrub errors. This proves adjacent live operation;
the deterministic fault probe proves the reported rejection mechanism.

Linux setup is escrowed in `scripts/e2e-deferred-tools.Dockerfile` and its
container-only entrypoint. The disposable image lacks machine-id; the entrypoint
creates one before testing, retaining process identity fences. No production
allow-missing switch is used. Live testing mounts an existing access-token-only
credential snapshot read-only; never copy a refresh token or print credentials.
The first build failed in dependency bun2nix postinstall; explicit installation
steps fix that. Initial Node harness startup raced the listening event; it now
awaits listening. An early fault assertion selected the zero-tool title query;
it now asserts the actual four-turn request rather than the first query.

Two live Linux attempts initially stopped before tools with authentication_error.
The retained client error established this cause; the read-only snapshot still
had time remaining but differed from the current host credential. Re-copying
only the current access token made the identical code/assertions pass. Token
rotation/revocation causality is inferred, not proven; this is not an unexplained
green rerun and no host credential was written. Private raw artifacts remain
local; this durable record and committed harness are the shareable proof.

## Adversarial review and gates

Reviewed the complete source diff, callers and session eviction: no public
contract change; captured calls, duplicate/forced-single calls, cancellation,
undeclared names, incomplete envelopes and generic failures still cannot use
this path. Focused recovery/integration tests: 133 pass. Final `npm test`:
5014 pass / 0 fail / 4 skip, standalone typecheck and build pass. Mandatory
final-head CI remains a merge gate. This does not resolve the separate unproven
abort-window canary issue #1009 or prove all deferred tool/model combinations.

## 2026-10-05: the roster request is one turn now

Deferred tools no longer lift the passthrough turn cap (E2E.md E75): the
ToolSearch turn the lift was for cannot happen, because passthrough strips
ToolSearch with the SDK's other built-in tools. Everything above describes the
four-turn budget as it was and is left as written. What changes for this
record:

- "With more than 80 tools, the proxy budgets four turns" is no longer true.
  The roster request is asked with `maxTurns` 1, the bare call's rejection is
  the turn's only Messages call, and no registered-name retry follows.
- `scripts/e2e-opencode-deferred-refusal.mjs` asserts that shape: the roster
  query counted deferred and capped at 1, one upstream call, no hook, then the
  same client-side outcome as before (one tool completion, no client error,
  the client-only receipt in the next request, a fresh SDK query for it).
- `bun scripts/e2e-capped-turns.mjs --case=client-refusal --stream --deferred`
  is now `--multi-turn`, which reaches the four-turn budget through
  `MERIDIAN_PASSTHROUGH_MAX_TURNS=4`. `--deferred` is refused with a message.

macOS arm64, OpenCode 1.18.33, SDK 0.2.141, SDK child Claude Code 2.1.289, Bun
1.3.14, controlled local API. On the parent of the change the harness as it
stood passes (roster query `maxTurns` 4, rejections 1/3/4, hook for 2). On the
change, the harness as it stood reports the same client-side outcome and then
fails its `maxTurns===4` assertion; with the assertions updated it passes
(roster query `maxTurns` 1, one rejection, no hook, exit 0, no client error,
one tool completion, receipt delivered).

Not re-run: the Linux container, and the live Opus flow
(`e2e-opencode-lifecycle-admission.mjs`).
