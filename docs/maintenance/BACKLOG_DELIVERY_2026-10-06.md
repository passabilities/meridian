# Backlog delivery — 2026-10-06

## #1223: declined and closed

[Source PR #1223](https://github.com/rynfar/meridian/pull/1223) was closed without
merging at unchanged head `537ccad864336a4f4dc25f925e92177cd12fe6b2`,
2026-10-06 15:52:07 UTC. Its ownerless-grace recovery can admit another holder
after an unreadable owner record and elapsed time, without proving that the
original holder is dead or fencing it. The retained same-boot, stopped-holder
control acquired a replacement while the original PID remained alive. This is
evidence against the submitted recovery rule; it is not a power-loss/ext4 crash
reproduction.

The independent final disposition checked the complete source diff and current
protocol callers. On current main `338630adb2832381e7ddfcee7bb8567e61cc9293`, the
relevant lock protocol still matches the source parent. No source change arrived
before closure. No public comment was posted.

This supersedes the earlier recommendation to keep the excluded recovery in
#1223 open. It does not claim that the reported crash problem is fixed or that
the separately reviewed fsync/publication subset was accepted. Revisit recovery
with affirmative owner-death/boot evidence or a fencing protocol; elapsed grace
alone is insufficient.

## #1286: accepted with corrections and delivered as #1287

[Source PR #1286](https://github.com/rynfar/meridian/pull/1286) was created during
this delivery pass. Consequently the fresh Meridian inventory still has 20
open PRs: one source was closed and one new source arrived.

The source head is `b7caeacaf89f3f9c95d2e13ca5d1e53556eb6b46`. Its actual
Nowaker commit was cherry-picked as `20d81324d2fcc061722df1c82bb2f36710694c1c`,
preserving `Nowaker <spam@nowaker.net>` and AuthorDate
`2026-10-05T01:50:27Z`. The isolated integration branch starts at current main
`338630adb2832381e7ddfcee7bb8567e61cc9293`.

Separate maintainer correction `fdc4c5023b4202669943ac28a5471b68fe12e589`
uses one 45-second PATH lookup/probe budget across candidates, leaving room
within desktop startup's existing 60-second health wait. Profile listing
resolves the executable once, including a miss, instead of repeating its wait
for every browser profile. Auth checks remain per profile. Token-only lists
do not resolve an executable. Existing executable preference, explicit override,
and public health data remain unchanged.

The first independent review's desktop and repeated-profile findings were
corrected. Its synchronous-readiness finding used an older checkout and is
superseded: this main already has asynchronous readiness resolution, which was
not changed. A fresh independent review is checking canonical current callers
and the complete integration.

Focused validation passes: 51 tests, 89 assertions, zero failures; typecheck
and build pass. [Durable native timing proof](evidence/1286-claude-cold-start.md)
passes all twelve actual-macOS baseline/fixed controls with Claude 2.1.289.
Fresh independent review accepts the complete correction and exact harness.
The original full `npm test` retains one unchanged store benchmark failure;
the isolated baseline/current graph is byte-identical and both comparisons
pass. Previously unreached stages pass separately. No benchmark threshold
was changed and the first failure remains recorded. Delivery CI, including
`test`, and exact-head merge verification remain pending. The first live fixture's
sync arm failed an unsupported fallback-source assertion after its PATH was
changed inside Bun; its result was not logged first. That failure remains
retained, and the corrected fixture supplies PATH before launching each fresh
Bun arm. It does not count as a passed before/after control.

Delivery [PR #1287](https://github.com/rynfar/meridian/pull/1287) merged on
2026-10-06 at 20:34:29 UTC, after all six executed final-head checks passed
and the expected changelog check skipped. The [test run](https://github.com/rynfar/meridian/actions/runs/37496805897)
passed on head `c06c03535da79f72b2a389dc036a60d7fdc02b38`.
Merge `ca6a5c0a4eddb87da52d83993f8f9e105712f0f6` has the exact validated tree
`aa4ff3f0c2ba83594f96c3ca7a168965db9e49cd` and verified
`Co-authored-by: Nowaker <spam@nowaker.net>` credit. Source #1286 was rechecked
at unchanged `b7caeacaf89f3f9c95d2e13ca5d1e53556eb6b46` and closed at
20:35:06 UTC. Earlier CI-pending statements above describe preparation only;
the retained local benchmark and first fixture failures remain unchanged.

This pass adds no shared guardian or general test-platform work. The owner's
dirty checkout remains preserved; releases and public comments remain
unauthorized.


## #1290 / #1289: accepted with corrections, delivery ready for CI

[Source #1290](https://github.com/rynfar/meridian/pull/1290), unchanged
`97cc5ab4ec52bbf3e750e3991f5691efae60d582`, is authored cherry-pick
`85aba6f93da81d8a972c03aab9f529557d0a0e68` from main `ca6a5c0a`.
Jaedyn Chilton's Author/AuthorDate remain intact. Maintainer corrections
`7a20dacd` and `acc5d3fe` close CAS-loss streams with an error before stop,
preserve concurrent winners, and avoid a contradictory terminal after an
observer throws. Meaningful negative controls reproduced each defect before
correction; all 124 focused integration tests pass. Public contracts are preserved.

Fresh independent review round 2 accepted the production correction and
actual-Pi harness at `5e608a7f`, with no surviving material findings. Its two
prior P2 findings are corrected: deadline cancellation cannot count as EOF,
and post-terminal observer failure cannot append a contradictory terminal.
Final review of the E41 additions and complete durable receipts is pending.

[Local gates/E61](evidence/1290-local-gates-e61.md),
[actual Pi](evidence/1290-pi-live.md), and
[real-provider E41](evidence/1290-e41-live.md) are complete. Supported Pi 1.0.2
on Darwin arm64, SDK 0.2.141, CLI 2.1.285 and independently installed scrub
0.2.2 reproduce capped fallback failure on unchanged main and pass the same
controlled harness on the correction. A separate actual Opus 5.5 work-profile
run passes real receipt, checkpoint/fork, saved follow-up and supported history.
E41's four sequential/parallel × JSON/streaming modes pass actual Opus,
unchanged source histories and cache continuity. The reporter Pi/OS remains
unknown; the owner approved the isolated supported client. Leftover scrub
docs wrappers remain qualified, not claimed fixed.

Default live authentication failure and the first E41 default-profile setup
failure remain recorded. Corrected setup explicitly passes a private supported
access-only profile to the programmatic server. Seven owned snapshot copies
were removed after launches joined; no owner login/refresh/source-store write
was performed. The first full npm run retains the unrelated timing-ratio
failure, with matching graph and narrow baseline/current comparisons; all
remaining stages, typecheck and build pass. Final integration CI including
`test`, exact-head squash, human credit, merged tree and source closure remain
required. No source or issue closure is claimed yet.

The next contribution is #1295. Independent triage found an unbounded late
queue-timer extension and silent-mode logging regression. Its separate authored
integration is correcting those and testing publication/replay/CAS/cancellation
behavior while #1290 finishes. No general guardian/runtime platform expansion
or new owner decision is needed for these internal fixes.
