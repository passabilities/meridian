# PR 1290 implementation preparation

This is the retained preparation record. Subsequent [local gates/E61](1290-local-gates-e61.md),
[actual Pi receipt](1290-pi-live.md) and [four-mode E41 receipt](1290-e41-live.md)
supersede its pending execution/version questions. The owner confirmed that
the reporter tuple is unknown and approved the supported isolated Pi run.

Prepared 2026-10-06 for root's independent review. No semantic acceptance,
publication, GitHub write, SDK/CLI execution, model call, native client run,
login, refresh, or credential-store change is claimed. Full `npm test`, actual
affected-flow verification and final-head CI remain root-owned gates.

Source: [PR 1290](https://github.com/rynfar/meridian/pull/1290),
[issue 1289](https://github.com/rynfar/meridian/issues/1289).
GitHub main and fetched `origin/main` matched
`ca6a5c0a4eddb87da52d83993f8f9e105712f0f6` after PR 1287.
Exact source `97cc5ab4ec52bbf3e750e3991f5691efae60d582` was cherry-picked as
`85aba6f93da81d8a972c03aab9f529557d0a0e68`, retaining Jaedyn Chilton
`95606062+jaedync@users.noreply.github.com` and AuthorDate
`2026-10-06T11:51:01-05:00`. Maintainer changes are separate.

Worktree: `/Users/rynfar/repos/meridian-pr1290-capped-unstreamed-20261006`.
Branch: `codex/pr1290-capped-unstreamed-20261006`.
Detached unchanged-main control:
`/Users/rynfar/repos/meridian-pr1290-main-baseline-20261006`.
Both use an ignored symlink to the root checkout's existing dependencies.
The dirty root checkout remains at `446a0f1633be3a0cf36d8f1e9f222e914d2f7c83`.

The contribution recovers complete captured client calls from an unstreamed
one-turn-capped attempt. It retains the settled assistant checkpoint only when
the canonical result was observed; larger budgets, idle failure and process
exit retain their existing eligibility rules. Internal orchestration changes
preserve the public plugin interfaces, headers and Anthropic JSON/SSE formats.
This is a preparation recommendation, not product acceptance.

The contributor's acknowledged recovery defect is concrete: eviction or
publication CAS loss throws inside the SDK error handler. Rejecting
`ReadableStream.start()` then errors the reader and discards queued SSE frames.
The separate correction catches that failure after cleanup, emits truncation
with `max_tokens`, an error **before** `message_stop`, and closes the body.
It never grants a `tool_use` terminal or overwrites the winning mapping.
Four HTTP/mock-SDK tests cover streamed/unstreamed × publication/invalidation
loss. The source tests' newly introduced `as any` casts were removed.
E61 now also asserts exact tool ID/arguments, block closure and one terminal pair.

Offline controls used the unchanged test fixture while replacing only
`src/proxy/server.ts`, then restored the prepared server byte-for-byte:

- Current-main server, `bun test --timeout 10000 src/__tests__/passthrough-early-stop-integration.test.ts -t 'non-streamed'`: 3 fail, 2 pass. Recovery is absent; larger-budget and process-exit controls pass.
- Incorporated-source server, `bun test --timeout 10000 src/__tests__/passthrough-early-stop-integration.test.ts -t 'capped recovery when'`: 4 fail with the exact publication/invalidation exceptions.
- Corrected server: the same four cases pass; complete integration file: 122 pass.
- `proxy-passthrough-tool-use.test.ts`: 6 pass; `proxy-request-cancellation.test.ts`: 5 pass; `proxy-error-handling.test.ts`: 22 pass, each in its own process.
- `unstreamed-assistant.test.ts` + `passthrough-early-stop.test.ts`: 68 pass.
- `npm run typecheck`, `npm run build`, `node --check scripts/e2e-unstreamed-fallback.mjs` and `git diff --check`: pass.

Local runtime: Bun 1.3.14, Node 22.22.3, TypeScript 5.9.3. Dependency metadata
reports Agent SDK 0.2.141 and Claude Code 2.1.284; neither was executed.
The issue reports Claude Code 2.1.285, so the local CLI metadata does not match
that version. The issue does not name the Pi version or operating system;
confirm those before treating a native run as the affected-client evidence.
Root still needs its full-suite gate on the repository's pinned Bun 1.3.11.

Runnable escrow: `scripts/e2e-unstreamed-fallback.mjs`. After root authorizes
SDK/CLI execution, run the **same candidate harness** against each server:

```sh
E2E_MERIDIAN_ROOT=/Users/rynfar/repos/meridian-pr1290-main-baseline-20261006 bun /Users/rynfar/repos/meridian-pr1290-capped-unstreamed-20261006/scripts/e2e-unstreamed-fallback.mjs --case=tool-capped
E2E_MERIDIAN_ROOT=/Users/rynfar/repos/meridian-pr1290-capped-unstreamed-20261006 bun /Users/rynfar/repos/meridian-pr1290-capped-unstreamed-20261006/scripts/e2e-unstreamed-fallback.mjs --case=tool-capped
```

The before arm must expose the capped-turn failure; the after arm must deliver
text, exact `get_weather` call/arguments, closed blocks, `tool_use` and one
`message_stop`, with no error. Run all four existing E61 cases afterward.
This fixture uses a local API and dummy profile key, isolated config/session/cwd,
and the real SDK/CLI; it consumes no model quota and is **not actual Pi proof**.

Root's remaining real-flow gates are actual Pi with the reported Opus model
and confirmed reported platform, default one-turn cap, exact tool/result
pairing, a same-session follow-up, `adapter=pi`, `lineage=continuation`, SDK
`isResume=true` at the captured assistant UUID, supported-API history inspection,
and cache continuity. The existing `scripts/e2e-pi-live-idle-control.mjs` uses
actual Pi 0.87.1, Opus 5.5, independently installed Pi scrub, a client tool
receipt and a persisted follow-up; it neither forces fallback nor asserts
resume, so its green result alone cannot close the reported defect.
Also run E41's four sequential/parallel × streaming/nonstreaming modes with
`PROBE_ADAPTER=pi PROBE_MODEL=claude-opus-5-5`; its manually stamped requests
are SDK/history controls, not native Pi proof. Any later actual OpenCode or
Claude verification must load and witness both the matching Meridian client
plugin and independent scrub plugin. Preserve fresh before/after evidence;
source CI awaiting contributor workflow approval is not product evidence.
