# PR 1290 local gates and E61 receipt

Collected 2026-10-06. This records local verification and the authorized
credentialless SDK/CLI fixture; it supplies no product acceptance verdict.
Actual Pi, reported Opus model/platform, continuity and final-head CI evidence
remain separate root-owned gates.

Unchanged baseline: `ca6a5c0a4eddb87da52d83993f8f9e105712f0f6`.
Production/test freeze: `acc5d3fe356b2023f4907d999cf5ecc7db51ea40`.
During the full gate, HEAD advanced to
`5e608a7f813efb709b41fa4ee7134c501edbc4d6` by adding the standalone Pi harness;
the production server, integration tests and E61 harness stayed byte-identical.

Runtime: Darwin arm64, Node 22.22.3, Bun **1.3.11** (`af24e281`), Agent SDK
0.2.141, exact public native Claude Code **2.1.285**. Bun and the native CLI
were unpacked from public npm platform packages in an isolated evidence
directory with `npm pack --ignore-scripts`; both registry SHA512 integrities
matched and harmless isolated `--version` checks exited 0. Shared dependencies
and global PATH/HOME/CODEX_HOME were unchanged. Existing `node_modules`
Claude Code package metadata remains 2.1.284.

The initial `npm test` at `6a108cdd3ee7e8b643d437549419d30ae642e182` was
interrupted at root's request while correcting two review findings, with
exit 130. Its log is retained and is not a passing gate.

The one final `npm test` used command-local Bun 1.3.11. Its pretest typecheck
passed, and the reached test stages produced **5,341 pass, 35 skip, 1 fail**.
The failure was the unchanged session-store timing ratio at
`src/__tests__/store-mutation-loop-lag.test.ts:136`: warm median 17.447 ms,
full-document median 18.5115 ms, required less than 13.883625 ms. Its other
eight tests passed, including the direct no-reparse/no-reserialize invariant.
The original exit 1 and log remain intact; no wholesale suite rerun or
threshold change was made.

Root authorized running the two unreached isolated stages once:
`profile-credential-isolation.test.ts` passed 8 tests and
`header-settings-routes.test.ts` passed 24, both with zero failures.
Separate `npm run typecheck` and `npm run build` exited 0.

Narrow benchmark diagnosis verified matching bytes across the full local
import graph, including the test preload and type-only superset, plus
`bunfig.toml`, package/lock and TypeScript configuration. Both worktrees
resolve the same existing `node_modules`. One identical Bun 1.3.11 benchmark
file run on unchanged main passed 9 tests (warm 4.0 ms / full 17.1 ms); one
candidate comparison passed 9 (warm 3.6 ms / full 17.6 ms). Warm mutation also
includes locking, temporary publication, rename and parent-directory fsync,
which the synthetic full-document baseline does not measure. These narrow
comparisons establish matching inputs and no candidate-only reproduction;
they do not turn the original failed full-suite gate into a pass.

E61 used the **same** [candidate harness](../../../scripts/e2e-unstreamed-fallback.mjs)
for before and after, with its approved `E2E_CLAUDE_BIN` isolation input. The
unchanged baseline's `--case=tool-capped` exited 1 as expected: the downstream
SSE contained `api_error` with `Reached maximum number of turns (1)`.
The candidate's first capped run and all three controls exited 0:

| Case | Stream calls | Nonstream calls | Stop |
| --- | ---: | ---: | --- |
| tool-capped | 1 | 1 | tool_use |
| text | 1 | 1 | end_turn |
| tool | 2 | 2 | tool_use |
| control | 1 | 0 | end_turn |

Each run asserted and printed the exact selected CLI path with resolver
source `env`. Both tool cases require exactly one `get_weather` call with ID
`toolu_fallback_weather` and arguments `{"city":"Paris"}`, exact block
closure, one `message_start`, one `message_delta`, one final `message_stop`,
and no error. The streaming control requires zero nonstreaming retries.
No SDK output was rewritten or private SDK transcript inspected. No provider
inference, owner credentials/login/refresh or actual Pi evidence is claimed.

Source SHA256 values:

- Baseline `src/proxy/server.ts`:
  `2ac35fd73cf2220fe954f07e7865e2c80126b6f955c0661548986b0b7be5936e`.
- Final server:
  `d3d981a1e1943aceb48b28cb90e43d840c2ec78cc9c50be0adf77bca61cfc428`.
- Final integration test:
  `44913e56b750457f8127c55564fd1425c780338c890e1fdfd901f3aaec7d04e1`.
- Same before/after E61 harness:
  `ddec213f7705291690ba79db746c5308d414b5debf0b8b3095791705fde718e2`.

Ordinary logs and exact command/exit receipts are retained under
`/Users/rynfar/repos/meridian-review-evidence-20261006/pr1290`:
`local-gates-outcome.txt`, `benchmark-input-equality.txt`, `e61-outcome.txt`,
`runtime-versions.txt`, and the corresponding untouched `*-first.log` files.
