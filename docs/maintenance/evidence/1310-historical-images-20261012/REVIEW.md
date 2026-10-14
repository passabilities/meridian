# Historical image amplification — 2026-10-12

Disposition: implement #1310, acceptance pending full/live verification. Issue
reviewed live with no comments. Baseline current main is
`3f5f4f81cd2205ebd62381d8c574d6a6f9ded2d9`. Isolated branch
`codex/historical-images-1310-20261012`; no contributor PR is being rewritten.

Exact feedback control on main: one historical image, three fresh replay/read-back
cycles produces 1,2,4 outbound images. Four new pure controls fail; unchanged
native checkpoint/resume control passes. The HTTP-to-SDK control also fails in
both stream modes: two byte-identical images reach SDK input instead of one.

Candidate: the feedback sequence is 1,1,1. Historical inline base64 images share
one visual copy by SHA-256 of decoded bytes and MIME; each duplicate becomes an
occurrence reference in its original position. Surrounding text, tool-result IDs,
source history and original provenance counts remain. Current-turn media is never
deduplicated, even if byte-identical to history. Distinct bytes/MIME, URL images,
malformed payloads and extended unknown shapes remain for ordinary validation.
Documents/files are outside this rule. Ending on assistant context also deduplicates
historical images without inventing a current user turn. A single current input
and native checkpoint/ordinary resume coalescing remain unchanged.

Adversarial review: limited to pure fresh replay rendering, below server orchestration;
no I/O, adapter logic or public contract changes. Normalization has already rendered
tool-result metadata before deduplication. Both server call sites are fresh replay;
ordinary resumes use coalesceStructuredUserMessages instead. Source mutation and
current-image controls pass. The digest includes MIME and validates base64 roundtrip
before comparing decoded bytes; URL equality is not treated as byte equality.

19 pure replay tests and 44 HTTP/SDK-parameter tests pass; standalone typecheck
passed after initial pure changes. Full npm test/typecheck/build is running in
owned exec session 73954, log /tmp/meridian-1310-full-gates.log. Do not restart on
observation timeout. These are synthetic/mocked proofs, not actual SDK attachment
materialization or Pi acceptance.

Remaining gates: full local checks; real affected Pi + matching client/server
plugins + actual SDK/model input inspection through supported APIs, including
read-back feedback and current-image control; applicable E41 four modes and E65;
final-head CI and final review. The reporter gives Meridian 1.75.0 and Pi but does
not specify Pi version, model or OS. Record the actual qualification environment
and that limit rather than claiming an exact reporter-environment reproduction.
No model call, package release, issue closure or merge is claimed.

## Combined current main and isolated dependencies

Initial full suite terminated exit 1: 5239 pass, 35 skip, one build-observer
failure. Bun reported EISDIR while reading the shared-worktree zod/index.js;
the target was actually a regular file. Removed only this worktree's dependency
symlink and installed its frozen dependencies locally. The same four build-observer
controls then pass. Do not infer a product image regression or claim the upstream
Bun cause is established. Failure and passing control are retained adjacent.

Streaming main `8edccd790` is incorporated as `2127507c`, with no product conflict.
Fresh combined npm test/typecheck/build is running in original session 32853,
log /tmp/meridian-1351-combined-gates.log. Actual Pi/SDK and E41/E65 remain open.

## Combined local gates and qualified Pi harness preparation

Original session 32853 completed exit 0: 5681 pass /35 skip /zero failures,
typecheck and build. Product source includes streaming main. That build was dirty
because the new Pi harness was being written; rebuild clean after committing it
before package acceptance. No full-suite restart is warranted by harness-only edits.

Committed e2e-pi-historical-image-dedup.mjs uses actual Pi 1.1.0 sessions, fresh
per-cycle affinity, a real read tool returning an owned same-byte PNG, and supported
SDK getSessionMessages inspection. Three fresh cycles plus a genuine current-image
control must retain one historical visual copy. The baseline stops after observing
a duplicate on round two. This models attachment read-back using an owned file;
it does not discover or inspect private SDK attachment files. Exact native model,
route status, tool execution, source image counts and original process joins are
asserted. The harness itself has not yet run live and supplies no acceptance yet.

Pi scrub 0.2.2 preflights before grant loading. A credentialless control using the
actual Pi-generated prompt verifies identity/docs removal and cwd retention; an
initial hand-written sample omitted Pi's exact identity prefix and therefore did
not match the scrub, so it was replaced with the actual builder, not treated as a
provider refusal. Wrong-client package and missing-inventory controls reject.
Actual Pi constructor/history/read-tool setup passes with fetch disabled, zero
network attempts and no credentials. Receipts are adjacent.

## First actual Pi attempt: harness metadata failure

Published 1.81.0 / actual Pi 1.1.0 / SDK 0.2.141 / native 2.1.296 on Darwin
ARM64 completed the owned read, then the harness failed its route/model assertion.
The source of that assertion is now identified: RequestMetric.resolvedModel is
explicitly the Haiku-tier pin, not an Opus served-model field. The copied Haiku
assertion was therefore invalid for this Opus gate. Corrected to requestModel for
request identity while retaining the stronger exact actual-model assertion through
supported SDK assistant history. This is a harness correction, not a product fix.
The initial FAIL report is retained; it does not prove image duplication. All
original actors/pipes joined, driver exited 1, and temporary grant was removed.
No refresh, account switch or Extra Usage change occurred.

## Actual Pi/SDK before and after, plus adjacent four-mode proof

Same corrected harness b92cc66f: published 1.81.0 baseline yields historical SDK
image counts 1,2 across two fresh actual Pi sessions with a real same-byte read in
each. Clean installed candidate b6624d9f yields 1,1,1 across three sessions, then
one historical and one genuine current red image in the fourth. Pi 1.1.0,
SDK 0.2.141, native CLI 2.1.296, Node22.22.3, Darwin ARM64. Supported SDK history
confirms Opus 5.5 in every observed assistant message. Baseline/candidate Pi scrub
0.2.2 hooks run 4/7 times, zero errors. Real tool reads run exactly once per feedback
cycle; current-image control uses none. Original processes/pipes join, drivers
exit 0 (baseline PASS means defect reproduced), grants removed. Extra Usage disabled.
No refresh, account switch or billing enablement occurred.

All four E41 modes pass on frozen source b92cc66f in Linux amd64 Docker, with
actual installed OpenCode V1 hook and server scrub 0.2.3. Exact Opus 5.5, sequential
1+1+1 and parallel 3 calls, result identity, immutable source history, forks,
follow-up and cache predicates pass. Every original actor/pipe joins; all grants
removed. This is the protocol host, not the OpenCode executable. Receipts adjacent.
The actual Pi history/current-media checks cover the implicated E65 behavior;
no separate Oh My Pi executable run or release qualification is claimed.

Final adversarial correction: Node accepts malformed base64 padding such as a
missing required equals sign. The old key could therefore hide an invalid repeated
image behind a valid copy. A new control fails before correction (5 pass/1 fail)
and passes after requiring padded strings to match canonical encoding exactly.
Correctly unpadded representations still deduplicate by bytes. All 20 pure replay
controls and typecheck pass. This changes only malformed-padding handling; the
valid-image Pi and no-image E41 flows above are unchanged. Final full local gates
and a clean final package qualification remain before merge, as does final-head CI.
