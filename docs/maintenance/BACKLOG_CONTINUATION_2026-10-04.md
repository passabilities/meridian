# Managed backlog continuation — 2026-10-04

## Scope and authority

This follows the [merged initial checkpoint](BACKLOG_REVIEW_2026-10-04.md).
Root remains the sole queue owner. This documentation branch starts from
`0369441786b082aadeb31689dcbce41d7e8574d9` and is rebased onto the verified
E41 merge `d3be0c628ee164d6bb41882c6fa0f9fe97b74a1e`; the user's dirty checkout and
other delivery worktrees are preserved. The controller supplied the current
GitHub decisions below; active branch records were read locally. This is a
bounded continuation of the earlier semantic reviews. A fresh whole-queue
metadata check does not establish acceptance of every open item. Earlier
records remain historical wherever superseded here.
No release or community-comment authorization is inferred.

After the E41 merge, one paginated repository/queue refresh at 23:38:04 UTC
confirmed the same six managed repositories, 164 accessible repositories plus
Centeva/pylon-code organization discovery, unchanged permissions and plugin-link
coverage, and no inaccessible managed candidate. The live queue has **27 open
PRs / 12 issues**: Meridian 24/12, OpenCode scrub 2/0, Pi scrub 1/0; the other
three managed scrub repositories have no open items. Retained contributor heads
and substantive metadata are unchanged; new items are the known owner deliveries
and approved #1270. Held Release Please #1202 advanced to
`ebbc22e7800cde2751d0d141c6d6c5284b653112`; plugin release heads are unchanged.
This refresh supplies metadata leads, not release authorization or new semantic
acceptance. Exact source dispositions in the earlier checkpoint still apply
where not superseded here.

## Delivered checkpoint and current decisions

- [Checkpoint #1269](https://github.com/rynfar/meridian/pull/1269) merged as
  `0369441786b082aadeb31689dcbce41d7e8574d9` from validated head
  `65b7793001e9982296459a7e33b85813bc2e8509`. Both trees are
  `e6ea7edcea9a81aeba9dd7b13cfed32f60eef4a2`; required
  [test run 37238890010](https://github.com/rynfar/meridian/actions/runs/37238890010)
  passed. Its earlier CI-pending statement is superseded.
- [Source #1228](https://github.com/rynfar/meridian/pull/1228), unchanged at
  `cee10174bb1fa500cd85d5937ec0c99339e8374d`, was declined and closed at
  22:45 UTC. Private SDK transcript mutation conflicts with Meridian's
  supported-API history boundary. Closing that implementation does not resolve
  the original history/rollback symptom. Revisit through a supported SDK
  operation with the actual affected Pi/model/platform and rollback/tool/undo/
  cancellation evidence.
- The owner approved [#1270](https://github.com/rynfar/meridian/issues/1270):
  authenticated `/profiles/list` may add exactly `refreshTokenExpiresAt`,
  `daysUntilRenewal`, `renewalRequiredSoon` and `accessTokenExpiresAt`, with shared
  current-expiry UI. This is advisory current metadata, not an authentication
  verdict or universal provider lifetime. [Source #1260](https://github.com/rynfar/meridian/pull/1260)
  remains open at `99b8f0c46fbf8ce0b7f28cb14d2bdce4929948ef`; its five history
  fields, lifecycle storage/listeners and auth-category logging remain excluded
  and deferred. Earlier blanket approval-pending wording is superseded only for
  these four fields and their approved UI/persistence scope.
- [#1219](https://github.com/rynfar/meridian/pull/1219) now has a complete extracted
  source diff. The [durable bounded SQLite review](evidence/1219-sqlite-scope-review.md)
  supersedes the HTTP-406 extraction blocker, while whole-stack semantic review,
  SQL public/operator contract approval and affected-flow acceptance remain open.
  No new approval issue was opened by this checkpoint. #1244's asynchronous
  cleanup contract was already approved; do not request that approval again.

## Active deliveries and open gates

Heads below identify the observed committed state, not final acceptance.
Use each delivery's applicable local checks, independent final review and fresh
final-head CI. Product behavior acceptance still requires actual affected-client/
model/SDK/platform proof; an internal harness correction does not resolve the
original product evidence gate by itself.
The controller refreshed the entries below after the initial documentation
draft. Active branches can still advance; refresh their exact heads before use.

| Path | Exact observed head | Evidence and remaining work |
| --- | --- | --- |
| [Draft durability #1271](https://github.com/rynfar/meridian/pull/1271), partial #1223 | `7de8cf5ff511110ab20dbfeffeb5b21a92c8c10e` | Safe ownership fsync/publication only; uncertain owners remain fail closed. Full suite at pre-rebase correction `f6df52be`: 5,349 pass / 35 skips / 0 failures, typecheck/build and independent review pass. Documentation-base rebase preserves executable/test blobs; two corrected comments are non-executable. Affected-flow/native durability remains open; submitted-head CI passes. Original torn-lock symptom and excluded ownerless recovery remain unresolved; #1223 stays open. |
| [Draft SSE #1273](https://github.com/rynfar/meridian/pull/1273), source #1214 | `8e1bf53b24b763311d6160f7a213de1bbe39d7d8` | Product `bb33d26d` passes 5,406 / 35 skips / 0 failures across 19 stages, typecheck/build and independent review. Test-only settled-request synchronization at `dabb2165` has discriminating before/after controls and passing typecheck/build; final commit is evidence only, with product/harness blobs unchanged. Actual implicated client/model keepalive/refusal/failover/cancellation/continuation remain open; submitted-head CI passes. |
| [Merged E41 #1272](https://github.com/rynfar/meridian/pull/1272), for #1245/#1220 | Merge `d3be0c628ee164d6bb41882c6fa0f9fe97b74a1e`, reviewed `8a08d3d4deebeab8370ad8bd27bd29e544f5b918` | Internal harness correction preserves signed/redacted thinking through JSON and streaming replay. Full suite: 5,354 / 35 skips / 0 failures; focused/typecheck/build and independent review pass. All six executed final-head CI checks passed, including test; expected changelog skip. Merge tree exactly matches reviewed tree `56d1b172c169ea4ad2fb45c743ab39b2bbe65608`, with human authorship and blank squash body verified. Original 200-token canonical-prefix cause and live E41 product acceptance remain open. |
| [Draft expiry #1275](https://github.com/rynfar/meridian/pull/1275), approved #1270 / partial #1260 | `1856ee652d4c9402337f5d06e7bf10c9b5d9324a` | Full suite at unchanged executable `b386b148` passes 5,374 / 35 skips / 0 failures; final change is evidence only. Four-field route/exchange controls and retained-selection correction preserve history exclusions. Actual inactive-browser DOM probes on both pages pass retained polling, blur/resumption and in-flight success/failure; the first unqualified home trial remains explicitly unknown, with no source change before the controlled proof. Visible keyboard/screen-reader/current media, positive native/provider login/re-authentication, supported-client receipt/package proof remain open; submitted-head CI passes. |
| [Draft recorded transcript enrollment #1276](https://github.com/rynfar/meridian/pull/1276), partial #1261 | `e47fbb285dc10a4c3c030b1a8a3ea11d59614a36` | Exact-locator ownership and setup/target-installed-SDK harness corrections have independent approval and discriminating controls; no contributor hunks were retained. The first `ab9bb9ae` full-run failure is preserved; the modern fixture uses real metadata registration with every assertion retained. Frozen `b20a0e66` full suite passes 5,392 / 35 skips / 0 failures across 19 batches. Current-main rebase preserves all eight patches and product/harness/test blobs; focused 76/0 plus isolated store 24/0, typecheck/build pass. Native/client/Windows and final-head CI remain open; unknown/already-forgotten sessions and the untracked backlog remain outside scope. Source stays open. |
| [Draft Sonnet #1267](https://github.com/rynfar/meridian/pull/1267) / #1213/#1212 | Local `73b2d122de205990d96097e00805114696776010`, terminal run `5a8097c3` | Default-native 401/zero queries and personal/work synthetic refusals remain separate. Round three made one tiny real Linux/OpenCode 2.0.16/SDK 0.2.141/Sonnet 5.5 query: zero input, `is_error=true`, provider HTTP 400/API Error mentioning extra usage, no receipt; precise cause unproven. Actual package-installed Meridian V2 plugin execution is established by setup/config assertions, catalog discovery and plugin-generated attested primary request; the relay forwards unchanged headers to Meridian. Large baseline/fixed/resume were NOT RUN; retained rounds total two attempts/zero valid required-model completions. Independent production/harness review passes; later evidence corrections clarify changed harness scope, remove credential fingerprints and record controller copy cleanup. Fresh full suite is running at frozen `73b2d122` after GC released the slot; native and final-head CI gates remain open. |

A subsequent readiness check confirmed all six executed CI checks, including
`test`, pass at the exact submitted heads of drafts #1271 (`7de8cf5f`), #1273
(`8e1bf53b`) and #1275 (`1856ee65`), with the expected changelog skip. Their
historical CI-pending wording is superseded for those submitted heads only;
refresh after any head/base change. These drafts still require their real
affected-flow evidence before landing.

Sonnet round three also verified each arm's 409 installed dist files and SDK/CLI/
OpenCode identities against the selected source/packages. Credentialless
rehearsal, syntax/privacy/link/diff checks pass; root verified terminal status
and cleanup. Read-only usage 200 and intact packages did not establish usable
inference. The earlier default 401 and personal refusal remain separate facts;
round three does not explain their precise causes. The controller owns the
owner-requested working-login follow-up while independent work continues.

## Source preservation and evidence locators

Durability preserves Nowaker's source `537ccad864336a4f4dc25f925e92177cd12fe6b2`
as authored `0007beb9837415c8c385f19bf2864ba985975406`, with separate correction
`90aa8ab173e85cd95f9d292d0eb95463621df240`. Its committed
[delivery record](https://github.com/rynfar/meridian/blob/7de8cf5ff511110ab20dbfeffeb5b21a92c8c10e/docs/maintenance/evidence/1223-turn-lock-durability.md)
retains the original author/date and discriminating durability/refusal controls.

Expiry preserves source `99b8f0c4` as authored
`dbcdb01507899d36c058c86ccd3d61e8b955109b`, with separate scope/correction
`c48e838d5dfdaca6cc9854610c5cda0ad848f3b8`. SSE maps authored sources
`d4e36fa90a3ecfbcb48c91c8c4023224b1386f32` and
`1c8f17099ad62dbd2a511f69c12e5b4e15d9da7f` to
`4c4abdbd8ba649a69f4aaf5b01ffacc522a6b0d8` and
`928c9f319a59469ecc5210f126fe6d55f2745fd7`; maintainer corrections are separate.
Sonnet's current contributor mappings are
`179257b96c1e1d591d0c5d2ed28ccff1af1ae85e` →
`c6991b05f48a96401d1df9e35a1c5ef1d540bef8` and
`553fd5c386de5e18e531a1d0101d64ef3a3b1792` →
`390c45d593e5189e84bfd9a2225abc8bc2353f88`.
Final squash credit remains an integration check.

For an unpublished active branch, use the exact local head above and its
repository-relative record below; working drafts may contain newer uncommitted
facts and must be frozen before final review. These records are in isolated
`/Users/rynfar/repos/` worktrees:

| Worktree | Repository-relative record |
| --- | --- |
| `meridian-sse-priority-incorporation-1214-20261004` | `docs/maintenance/evidence/1214-sse-priority-failover.md` |
| `meridian-e41-thinking-fidelity-20261004` | `docs/maintenance/evidence/e41-thinking-fidelity.md` |
| `meridian-login-deadline-1260-20261004` | `docs/maintenance/evidence/1270-profile-expiry.md` |
| `meridian-transcript-retention-correction-1261-20261004` | `docs/maintenance/evidence/1261-legacy-enrollment.md` (delivery `e47fbb28`; frozen full-suite proof at `b20a0e66`) |
| `meridian-sonnet-context-1213-20261004` | `docs/maintenance/evidence/1213-native-sonnet-context.md` and sanitized acceptance record (round-three terminal facts at `5a8097c3`; reviewed evidence/plugin clarification at `73b2d122`) |

No model/browser/code validation ran for this documentation change. Content,
links and diff validation are its local gates; required final-head CI remains a
separate gate for its own PR. No item is accepted merely because another branch
passed tests, and no release is authorized.
