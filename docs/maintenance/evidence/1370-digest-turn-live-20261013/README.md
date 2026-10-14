# Digest turn on a lifted passthrough budget — #1370 (2026-10-13)

Contributor PR #1370 by @justprosh, fixing their issue #1367, landed as their
own PR at `431ec2014`. The fix and its fixture stand are entirely theirs and
their branch carries no maintainer commit. This live gate and record are a
separate maintainer change.

## Live before/after

`bun scripts/e2e-deferred-digest-turn-live.mjs`, same script on both trees
(`--expect-digest` on the unfixed one). macOS arm64, `/v1/messages` with the
OpenCode adapter in passthrough, Claude Agent SDK 0.2.141, native Claude Code
2.1.296, requested model `claude-opus-5-5`, Claude Max. Model requests are
counted from the distinct message ids the SDK reports during one hand-off.

| Hand-off to the client | Unchanged `main` `f8eea2c35` | PR head `9b417dff5` |
|---|---|---|
| Control, one ordinary tool (`maxTurns` 1), both transports | 1 model request, 3,885 prompt tokens | 1 model request, 3,879 prompt tokens |
| Deferred tool (`maxTurns` 4), non-stream | **3 model requests, 12,210 prompt tokens reported** | 1 model request, 3,969 prompt tokens |
| Deferred tool (`maxTurns` 4), stream | **3 model requests, 12,210 prompt tokens in telemetry** | 1 model request, 3,969 prompt tokens |
| Follow-up with the client's tool result | resumed at the checkpoint, nonce returned | resumed at the checkpoint, nonce returned |

On both trees the client received exactly one `read_fixture` call with
`stop_reason: "tool_use"`. The unfixed tree spent two further model requests
per hand-off that the client never saw. Raw reports:
[baseline](baseline-report.json), [candidate](candidate-report.json).

The contributor's fixture stand `scripts/e2e-deferred-digest-turn.mjs` was also
run on both trees, both transports: it fails on `f8eea2c35` ("The CLI sent a
model request after the forwarded tool batch") and passes on the PR head.

## Local gates

`npm test` with typecheck and `npm run build` on the PR head, which already
held current `main`; final-head CI on the PR.

## Review findings

An independent review traced the capture bookkeeping, mixed and repeated
batches, the result-subtype handling and the exclusions (one-turn cap,
structured output, `MERIDIAN_PASSTHROUGH_EARLY_STOP=0`, non-passthrough). No
material finding. Recorded, not blocking:

- The mocked integration test proves the hook's wiring and its captured-id
  bookkeeping, not that the query ends: the mock ignores `continue: false`. The
  end of the query is proven by the two stands, which are not in CI.
- On the non-streaming path the checkpoint gate is evaluated on assistant and
  user messages only, so the digest turn's messages no longer give it a second
  chance. If an ordering ever left the gate unsatisfied the session would be
  evicted and the next turn replayed: a cache miss, not a wrong answer. No such
  ordering was found, and the non-stream follow-up above resumed.
- The comment in `src/proxy/passthroughEarlyStop.ts` still said the digest
  turn generates for deferred tools and advisors; corrected with this record.
- Four `as any` casts in the new block of `src/__tests__/query.test.ts`, in the
  style of the rest of that file.

## Not covered

- Only Claude Code 2.1.296. `package.json` allows `^2.1.293`, and an operator
  may point Meridian at another executable; what an older CLI does with a
  `PostToolBatch` registration was not tried.
- The live run lifts the budget with a `defer_loading` tool. An advisor and a
  pinned `MERIDIAN_PASSTHROUGH_MAX_TURNS` share the code path but were not run
  live. ToolSearch discovery itself was not exercised.
- Requests were sent by hand with the OpenCode session header; the OpenCode
  binary was not run. macOS arm64 only.
