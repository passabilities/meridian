Latest paginated discovery: 30 open PRs and 21 issues across six managed
repositories. [Snapshot](evidence/post-1357-queue-20261012.json). Earlier counts
below are historical. Native Opus/Fable delivery [#1358](https://github.com/rynfar/meridian/pull/1358)
is draft: 5754 local tests/typecheck/build pass. The earlier worker-bundling
failure remains unexplained. Actual source HTTP discovery found that the reporter's
current opencodex fork ignores context_window; confirm the installed revision and
resolve catalog compatibility before claiming downstream compaction is fixed.
Actual Pro/Codex acceptance remains missing.

Current independent delivery: [#1342](https://github.com/rynfar/meridian/pull/1342)
through [#1357](https://github.com/rynfar/meridian/pull/1357) reduces Nix package
160→51MiB while preserving application bundle bytes (only Node shebang changes).
Merged as e0f9feab after Linux/macOS native, reproducibility, runtime, full local
and final CI gates passed. Exact tree and Connor credit verified; source closed.
It proceeds while the higher-priority account/platform-specific gates remain open.
Sonnet live testing is specifically held by the default store returning no access
token; no auth refresh, account switch or model call was attempted.

Latest integration: Antigravity [#1356](https://github.com/rynfar/meridian/pull/1356)
merged as `b68710f057a3bbdb4e01d650c0bd94b62247eea7`; exact tested tree and Cd1s
credit verified, unchanged source #1341 closed. Final CI and actual Pi/agy source
and installed-package proofs pass. No new release. Refreshed six-repository queue now has30 open PRs and21 issues:
Meridian24/20, OpenCode scrub5/1, Pi scrub1/0, others0/0.
[Current snapshot](evidence/post-1356-queue-20261012.json).
The earlier counts below are historical.

# Backlog priorities — 2026-10-12

Refreshed after #1334 and #1355 merged and Antigravity delivery #1356 opened.
The six managed repositories now have 32 open PRs and 21 issues: Meridian
26 PRs/20 issues, OpenCode scrub5 PRs/1 issue, Pi scrub1 PR/0 issues, and no
open items in HUD/Hermes/OpenClaw scrub. Counts include source/delivery pairs
and separately held releases. [Current snapshot](evidence/post-1334-queue-20261012.json).

This is the working priority report, not a claim that every remaining diff has
passed review. Fixes with direct user cost, lost work or broken requests lead.

| Order | Tickets | Why this matters | Disposition / next evidence |
| --- | --- | --- | --- |
| 1 | [#1338](https://github.com/rynfar/meridian/issues/1338), delivery [#1347](https://github.com/rynfar/meridian/pull/1347) | Priority routing can keep spending paid overage while included capacity remains elsewhere. | Fix prepared; preserve explicit pins and same-turn identity. Complete qualified account-routing evidence without deliberately incurring paid usage. |
| Done | [#1294](https://github.com/rynfar/meridian/pull/1294), delivery [#1344](https://github.com/rynfar/meridian/pull/1344) | Healthy queued turns and long tool writes were killed as idle. | Merged as `8edccd790`; exact tree/credit verified, source closed. Full local, installed actual OpenCode and all four plugin-qualified E41 modes pass, final CI passes. No new release. |
| 2 | OpenCode scrub [#21](https://github.com/rynfar/meridian-plugin-opencode-scrub/issues/21), [#22](https://github.com/rynfar/meridian-plugin-opencode-scrub/pull/22), [#23](https://github.com/rynfar/meridian-plugin-opencode-scrub/pull/23), delivery [#24](https://github.com/rynfar/meridian-plugin-opencode-scrub/pull/24) | Scrubbing can corrupt the client's working directory and send tools toward the wrong path. | Authored incorporation plus parser corrections prepared. 48 installed-package/parser cases pass; actual reported Windows/client qualification remains open. |
| Done | [#1214](https://github.com/rynfar/meridian/pull/1214), delivery [#1350](https://github.com/rynfar/meridian/pull/1350) | Keepalives previously defeated account failover. | Merged `736e9fd61`; source closed, exact tree and credit verified. 5730 local tests, typecheck/build, final CI, installed actual OpenCode/Opus flow and all four E41 modes pass. |
| Done | [#1310](https://github.com/rynfar/meridian/issues/1310) | Byte-identical historical images can multiply across fresh replay/read-back cycles, increasing attachments and usage. | Reproduced 1,2,4 amplification and duplicate SDK inputs; [#1351](https://github.com/rynfar/meridian/pull/1351) yields 1,1,1 with provenance/current media retained. Actual Pi 1.1.0 / Opus 5.5 reproduces growth on published 1.81.0 and holds at 1,1,1 on the installed candidate; current images and all four E41 modes pass. Final corrected package passed the same actual Pi flow; 5682 tests/typecheck/build and final CI pass. Merged #1351 as a8a214bfc; #1310 closed. No new release. |
| Done | [#1352](https://github.com/rynfar/meridian/pull/1352), delivery [#1353](https://github.com/rynfar/meridian/pull/1353) | Bare systemd assignments corrupted JSON and paths. | Merged `506a811d3`; exact tested tree and Connor Grady credit verified, unchanged source closed. Seven real systemd cases and installed Meridian profile startup pass; 5730 local tests, typecheck/build and final CI pass. Credentialless configuration proof; no model inference required for unit parsing. |
| 3 | [#1301](https://github.com/rynfar/meridian/pull/1301), delivery [#1354](https://github.com/rynfar/meridian/pull/1354); [#1201](https://github.com/rynfar/meridian/pull/1201) | Valid settled checkpoints can replay whole histories and increase cache writes. | OpenCode #1354 mergedfa90c9aaf after actual before/after, full E41/E42,5743 local tests/typecheck/build and final CI. Exact tree and Aleksey credit verified; source#1301 closed. #1201 retains original Meowbert runtime/model evidence hold; 75 focused tests and typecheck pass on current main. |
| 4 | [#1212](https://github.com/rynfar/meridian/issues/1212), [#1213](https://github.com/rynfar/meridian/pull/1213), [#1315](https://github.com/rynfar/meridian/issues/1315) | Model catalogs and replay budgets can trigger premature compaction at 200k for native 1M models. | Current-main authored correction is prepared on codex/sonnet-context-1213-20261012;5767 local tests/typecheck/build pass. Credentialless actual Linux/OpenCode plugin admission passes; Sonnet5.5 large-history before/after/resume remains missing. Review model-specific Pro/legacy Opus gates for #1315; adding Pro to every extended-context tier would over-advertise legacy Opus. |
| 5 | [#1334](https://github.com/rynfar/meridian/pull/1334), [#1303](https://github.com/rynfar/meridian/issues/1303) | Process cleanup and broad store rewrites can hold up or destabilize concurrent work. | #1334 merged as 0d12f6a11 after native before/after Darwin/Linux proof, actual source/installed Pi/SDK/Opus acceptance, 5746 local tests/typecheck/build and final CI. Exact merged tree verified; original #1326 hang remains independently open. #1303 identical-locator no-op already landed in #1336; broader persistence redesign retains its existing hold. |

Fresh-checkout blocker [#1355](https://github.com/rynfar/meridian/pull/1355) fixes npm-lock drift below the declared Claude Code floor. Merged as fb5854be5 after clean npm install, typecheck/build and final CI; exact merged tree verified.

MCP tool loss [#1283](https://github.com/rynfar/meridian/pull/1283) is now resolved
by merged [#1349](https://github.com/rynfar/meridian/pull/1349), commit
`3f5f4f81cd2205ebd62381d8c574d6a6f9ded2d9`. The merged tree matches the tested
head, all final CI passes, contributor credit is present, and source #1283 is
closed. Local tests: 5659 pass / 35 skip / zero failures; actual OpenCode and all
four plugin-qualified E41 modes pass. This merge is not a new npm release.

After consequential fixes, the strongest remaining feature candidates for review
are [#1302](https://github.com/rynfar/meridian/issues/1302) (detached start/stop)
and [#1311](https://github.com/rynfar/meridian/issues/1311) (client-neutral agent
identity). Public lifecycle/header interface changes still need their issue-backed
owner contract and appropriate client tests. These are candidates, not accepted
implementations. Antigravity idle retention #1341 is complete through merged
#1356, with5752 local tests/typecheck/build, actual source/installed Pi/agy proof
and final CI. Its broader Linux/DeepSeek and Windows reports remain unproven.

Keep prompt-cache keepalive #1193, the Claude side-call/checkpoint stack, and broad
SQLite migrations behind their existing review decisions and explicit contracts.
The Antigravity repeat guard #1340 remains held because suppressing an identical
completed tool call can also suppress a legitimate repeated read. Revisit only
with a discriminating execution-identity rule and negative control.

Release PRs Meridian #1345, OpenCode scrub #20 and Pi scrub #15 are deferred
pending separate release authorization. Haiku 5.5 is already published and
fresh-install verified in Meridian 1.81.0. No additional release is inferred
from this backlog instruction.

Every live harness requires the matching client plugin and server scrub before
inference. Preserve missing evidence, failed runs and exact package/source
identity; do not buy quota, enable Extra Usage, refresh credentials or switch
accounts as an implicit way around a failing test.

Transcript disk growth #1261 is consequential but its current implementation is
deferred: b999654d retains the exact previously rejected sweep/retention/query
blobs from7475d08c. Root-wide deletion still lacks pin/ownership protection and
joined, mutually exclusive admission. Revisit a corrected ownership-aware design;
do not accept text-only replay as proof that native history survives. Process
identity diagnostics #1266 remain held for exact macOS/nono/client proof.
