# SSE failover review — 2026-10-12

Disposition: accept with maintainer corrections, verification pending. Keep source
[#1214](https://github.com/rynfar/meridian/pull/1214) open until live acceptance and
final-head CI pass. Source `1c8f17099ad62dbd2a511f69c12e5b4e15d9da7f`, no comments
or reviews at refresh. Base current main `3f5f4f81cd2205ebd62381d8c574d6a6f9ded2d9`.

Authored cherry-picks retain Aleksey Proshutinskiy <alexey.prosh@fluence.one>
and original AuthorDate:

- `d4e36fa90a3ecfbcb48c91c8c4023224b1386f32` → `623cf1de2`
- `1c8f17099ad62dbd2a511f69c12e5b4e15d9da7f` → `eb000767c`

The feature fits priority routing: content-free keepalives must not commit an
account, but exposed model content/tools must never replay on another account.
The contribution preserves pre-stream HTTP statuses, classifies failures after
headers as SSE errors, and joins a suppressed attempt before retry selection.
The outer completion map separately joins final cleanup; ReadableStream.cancel
itself is not evidence that the SDK process has exited. Real-process proof remains.

Reproduction on clean main with the exact contributor HTTP test: a 16-second
billing refusal behind the service heartbeat returns billing_error to the client,
never the fallback response (0 pass /1 fail). Same test on incorporated candidate:
1 pass /0 fail; fallback exactly once, suppressed error absent. These are mocked
SDK HTTP integration facts, not real account or client acceptance.

Adversarial finding: the new non-SSE fallback inspection accumulated an unbounded
body. A 256-KiB account-shaped JSON regression control fails on authored source
(36 pass /1 fail). Maintainer correction stops at 64 KiB, joins reader cancellation,
and emits api_error without treating the oversized response as replay permission.
All 37 relay controls now pass, including exact bytes, UTF-8 fragmentation,
backpressure, cancellation, header hints and no replay after content. Typecheck
passes. Full npm test/typecheck/build is running; do not claim completion yet.

Harness finding: contributor installed-package probe defaulted to live Claude Max
without mandatory matching client-plugin/server-scrub preflights. Live mode now
fails before profiles, servers or SDK queries. The credentialless transport mode
is retained, explicitly labelled as such. No model calls, account switches,
credential refresh or Extra Usage changes occurred during this review.

Remaining: finish full local checks and independently installed fixture gate;
implement qualified affected-client/model live proof without deliberately
incurring paid usage; all four E41 modes for routing/session continuity; final
adversarial review, source/base/head recheck and CI before merge. Streaming #1344
is still a separate integration; revalidate if it lands. No release authorization
is implied. Sanitized failing/passing verdicts are adjacent; executable regressions
are committed in src/__tests__ and the fixture harness in scripts/.

## Qualified probe implementation (not yet executed live)

The installed-package probe now has opt-in live answering-leg support with
mandatory installed V1 client-hook and server-scrub preflights before reading
an access-only grant. It verifies request hooks and joins original children/pipes,
writing a durable-ready report in its owned directory. Three credentialless
negative preflight controls reject missing opt-in, grant and plugins before setup.
This implementation has not established live acceptance yet. The refused leg
remains local; the host is explicitly a protocol fixture, not OpenCode itself.
No account spending or model call occurred in implementing these checks.

## Full local gate completed

Owned session 54534 is terminal exit 0: 5707 pass /35 skip /zero failures, then
standalone typecheck and build pass. Clean certified package source is `a9fece93`;
see local-gates.json. The independently installed fixture package is being built;
its passing execution and all live acceptance gates remain unproven. Do not restart
that completed full-suite process.

## Independently installed fixture failed its header deadline

Clean installed `a9fece93`, Node 22.23.3 / SDK 0.2.141 / CLI 2.1.296,
Linux amd64 Docker under Darwin ARM64 emulation, with Docker network disabled:
nonstreaming failover passes (one refused/one served telemetry attempt; the native
CLI made four local refusal HTTP calls). SSE headers arrived in 335.1 ms, failing
the contributor's absolute 100 ms assertion before the stream assertions ran.
Original actors/pipes joined; original session 25498 exited 1. No credentials or
remote model requests were involved. Report and console are retained adjacent.
This is an installed-fixture FAIL, not a passed SSE acceptance gate. Do not rerun
unchanged and call it fixed; review the timing predicate against the retained
15-second delayed-header baseline and preserve a discriminating before/after check.

## Discriminating installed timing control

The original 100 ms failure remains preserved. The revised harness `932c8f92`
uses a 1000 ms header deadline, still 15 times shorter than the service heartbeat.
The assertion now targets the reported withheld-header regression with sufficient
room for startup/scheduling overhead; it is not a claim that the earlier 335 ms
measurement vanished or that its precise host cause was diagnosed.

The exact same mounted harness ran against two independent installed packages
with Docker network disabled. Unchanged baseline source `6ef677ce` fails at
15,083.2 ms. Candidate `a9fece93` passes at 104.1 ms, with the first keepalive
before the first local refusal, one refused/one served account in telemetry,
no leaked refusal and exactly one message_start. Nonstream parity passes on both.
Native CLI makes four local refusal HTTP calls per case; the account-level
attempt count is one. Original actors/pipes join in both runs; driver exits 1/0.
SDK 0.2.141/native 2.1.296, Node22.23.3, Linux amd64 emulation on Darwin ARM64.
Receipts, installed build identities and tarball/harness hashes are adjacent.

This is credentialless installed transport evidence, not a live model/account or
OpenCode-executable run. Combined source `0730fab1` now also includes streaming
main `8edccd790`; its full local gate is active in session 8226. Old-package
success alone does not validate that combined tree. No credentials were staged.

## Combined installed live fallback

Original session 23810 exited 0 against independently installed clean a41e1998
including streaming main. SDK 0.2.141, actual system-selected native CLI 2.1.296
(version independently checked), Node 22.22.3, Darwin ARM64, Opus 5.5 confirmed
through supported SDK assistant history in both cases. This is the installed
OpenCode client hook protocol host with server scrub 0.2.3, not the OpenCode
executable and not a naturally exhausted account. The local refusal prevents
deliberately spending quota to construct a test. Each case records exactly one
refused account and one answering account, despite four native refusal requests.
SSE headers arrive in 25.1 ms, heartbeat precedes the first refusal, no refusal
leaks, and exactly one message_start reaches the client. Nonstream parity passes.
Both plugin witnesses run with zero errors. All original actors/pipes join, grant
removed, Extra Usage disabled; no credential refresh or account switch. Actual
OpenCode executable and four-mode E41 qualification remain open.

Four-mode E41 finished in original session 78225, exit 0. All four modes pass
on frozen cbb340eba (combined streaming-main product) in Linux amd64 Docker,
SDK 0.2.141/native 2.1.296/Opus 5.5, installed V1 hook plus server scrub 0.2.3.
Sequential 1+1+1 and parallel 3 tool batching, result identity, immutable source
history, forks, continuation and cache predicates pass. All original actors/pipes
join; temporary grants removed. Receipts adjacent. Actual OpenCode executable
qualification and integration of newly merged image main remain open.
