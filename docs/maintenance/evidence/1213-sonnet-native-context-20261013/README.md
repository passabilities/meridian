# Native Sonnet context past 200k — #1213 / #1212 (2026-10-13)

Contributor PR #1213 by @robertn702, landed as their own PR. Maintainer commits
on their branch: a merge of `main` (conflicts with the Haiku 5.5 native-window
change), two test corrections, a documentation correction and this live gate.

## Live before/after

`scripts/e2e-sonnet-native-context.mjs`, same script and assertions on both
trees. macOS arm64, actual OpenCode 2.0.16 with the installed Meridian V2
plugin, server scrub `@rynfar/meridian-plugin-opencode-scrub@0.2.3`, Claude
Agent SDK 0.2.141, native Claude Code 2.1.296, requested model
`claude-sonnet-5-5`, Claude Max. Bun 1.3.14, Node 22.22.3.

| Check | Unchanged `main` `58c4126c3` | PR tree |
|---|---|---|
| `/v1/models` window for `claude-sonnet-5-5` | 200,000 — FAIL | 1,000,000 — PASS |
| Client compaction requests | 1 — FAIL | 0 — PASS |
| Input tokens on the replayed turn | 128,428 — FAIL | 238,570 — PASS |
| Meridian trimmed the fresh replay | no | no |
| V2 plugin fetched the catalog; replayed turn signed | PASS | PASS |
| Result | FAIL (exit 1) | PASS (exit 0) |

Reports: [baseline](baseline-report.json), [candidate](candidate-report.json).

On unchanged `main` the client adopted the advertised 200k and compacted before
the conversation could exceed it, so Meridian's own replay trim was never
reached there. The trim is covered by the mocked HTTP tests in
`proxy-replay-envelope.test.ts`, which fail without the change.

## Local gates

`npm test` on the merged branch: 5,773 pass, 35 skip, 0 fail, with typecheck;
`npm run build` passes.

## Review findings

- The earlier maintainer draft narrowed the helper to the exact ids
  `claude-sonnet-5` and `claude-sonnet-5-5`. Not carried: it would budget a
  dated Sonnet 5 pin at 200k, and Anthropic documents the native window for
  "Sonnet 5 and later". The contributor's version-based match stands.
- That draft also made Meridian honor `CLAUDE_CODE_DISABLE_1M_CONTEXT`. Not
  carried: `main` already ignores that flag for Opus, Fable and Haiku 5.5, so
  it is a separate change, and an over-estimate is still covered by the
  overflow retry. Open as a follow-up if wanted.
- `MERIDIAN_1M_CONTEXT_SUPPORT=0` does not shrink a native window. The
  configuration table now says so.
- An existing overflow-retry test used plain `sonnet` with a history that now
  fits the 1M budget. Its fixtures are sized per window.

## Not covered

- The reporter's platform is not stated; this ran on macOS arm64 only.
- A two-archive session, not a long organic one; no tool calls in the replay.
- Sonnet 4.x `sonnet[1m]` billing behavior is unchanged and was not re-run live.
- A caution found while building the gate: a `limit.context` written in the
  user's own OpenCode config overrides what the plugin discovers, so such a
  user keeps their configured window.
