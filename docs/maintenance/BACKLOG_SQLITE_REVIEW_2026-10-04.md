# Managed backlog: complete SQLite semantic review — 2026-10-04

This follows [checkpoint #1274](https://github.com/rynfar/meridian/pull/1274),
merged as `8e1c8bf738d7372ded01f28e99d6ec167acaf76f` from independently reviewed
`aec112743df30f9d920d0767518ffb43bcbfb479`. The merge tree exactly matches
`6c46d0f1a70972846b6a2370adfe5cbecf287c69`; six executed CI checks passed,
including required test, plus the expected changelog skip. Human authorship
and blank squash body were verified. #1269 was already merged; its later
passed-check notification was stale and its watch is stopped.

The user's dirty root checkout remains preserved. This review delivery starts
from that checkpoint in `codex/sqlite-semantic-review-20261004`. Root remains
the queue owner. No source product implementation, owner credential mutation,
real generation, external community comment or release occurred in this review.

## Queue refresh and prior gates

One paginated refresh at **2026-10-05 00:19:02 UTC** covered 164 accessible
account repositories, Centeva (107) and pylon-code (3), current plugin links and
the same six managed repositories. All 118 read requests succeeded, with no
permission gaps, newly discovered managed repos, unexpected contributor head
changes or substantive new/edited discussions. Snapshot: **27 open PRs / 12
issues**, Meridian 24/12, OpenCode scrub 2/0, Pi scrub 1/0, remaining managed
scrubs zero. Known deltas are #1274's merge, Sonnet `fe93ce44`, and transcript
enrollment `e47fbb28`; held Release Please #1202 advanced to
`c4d0bc05767521cd3ee255377d3d38a707fe751a`. No release is authorized. New
contract issue #1277 was opened after this bounded discovery snapshot.

Sonnet [draft #1267](https://github.com/rynfar/meridian/pull/1267) is pushed at
`fe93ce447bd277a45157fcaad957cd37e4eba2e6`. Fresh full local gates at frozen
`73b2d122de205990d96097e00805114696776010` pass: **5,362 / 35 skips / 0
failures**, 19 stages / 26,745 assertions; standalone typecheck/build pass at
the same clean head. Final changes are six evidence/artifact files; product,
harness, E2E and architecture blobs are unchanged. Complete compressed local
logs and hash manifest are committed to that delivery. Independent final review
passed. Actual package-installed Meridian OpenCode V2 plugin execution is
confirmed, but large Sonnet baseline/fixed/resume remains NOT RUN: default 401
and personal/work refusals yielded two attempts and zero valid completions.
Owner source credentials were only copied read-only and private copies were
removed. A working owner login with Sonnet 5.5 inference remains needed.
T3 watches #1267 and [#1276](https://github.com/rynfar/meridian/pull/1276);
their later final-head status must be refreshed when notified. Other live
product gates in the [prior continuation](BACKLOG_CONTINUATION_2026-10-04.md)
remain open, and Sonnet's refusal does not establish other models' availability.

## Complete SQLite review and decision

The [durable full review](evidence/sqlite-semantic-review-20261004/README.md)
supersedes the extraction-only/full-semantic-review-pending statements for
these exact scopes:

- #1219 `0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f`: all 176 unique files,
  every assigned changed hunk, nine packets, immutable source and patch hashes.
- #1243 `6558c209f8bddf8e59b554d16c9834381c7817c2`: all 38 SQL-delta files /
  194 changed hunks above `c159bf9`, plus the separately inspected async JSON
  prerequisite and all three authored commits. This is not an inflated second
  full review of every unchanged prerequisite test body.

**Defer both submitted heads.** #1219 requires complete SQL profile-copy pruning,
native-handle unwind and truthful/eventual close, bounded GC/accounting,
approved clear-reset behavior, recovery entry-point ordering and corrected
historical SQLite/current-main test controls. #1243 has three reproduced P1
authority regressions: mutable priority fences, retirement of newer unimported
JSON and loss of a live publication lease. Its retained eviction gate never
holds SQL. Actual published native build/source lacks the upstream WAL-reset
salt guard; source/topology resolution is a compatibility gate, with no
corruption reproduction or Meridian corruption claim.

Bounded private synthetic probes and controls, first setup failures, exact
scripts, raw results, source/runtime identities and evidence limits are escrowed
in the repository. Mocked shutdown SDK invocation, synthetic GC deletion and
injected I/O faults are clearly distinguished from actual SDK/model/platform
proof. Review completion supplies neither product acceptance nor a merge gate.

[Issue #1277](https://github.com/rynfar/meridian/issues/1277) records the owner
contract approved on **2026-10-04**: JSON default, explicit opt-in SQLite,
opaque async embedding owner handle, joined truthful close, explicit guarded
offline migration/latest export/rollback and supported same-host local topology. The automatic/default
replacement in #1243 is held; no contributed public SQL interface was
incorporated. Approval authorizes a corrected opt-in implementation; it does
not accept unsafe heads or remove evidence gates.
#1244's asynchronous cleanup contract remains approved; do not ask again.

Next: implement the approved contract and material corrections while continuing
independent queue work; preserve authored contribution identity and separate
corrections in any later implementation. Each accepted behavior still needs
affected-flow actual client/model/SDK/platform E2E, full local gates, independent adversarial review,
installed package/native engine/topology proof and required final-head CI. No
source issue is closed and no release is authorized by this review checkpoint.
