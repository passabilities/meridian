# #1214 scope cross-check — 2026-10-11

## Corrected triage disposition

Fresh original head is still `1c8f17099ad62dbd2a511f69c12e5b4e15d9da7f`.
Its non-SSE branch retains every chunk to EOF and Blob/text-copies them without
a cap. This is **not present on current main** `109cf9e45`: main has no
`sseFailureSniff.ts` because the proposed SSE priority feature is not landed.

Crucially, this is **already corrected in preserved maintainer preparation**.
Closed administrative delivery #1273 is not a rejected fix or lost work. Its
fresh body preserves current local branch `codex/sse-priority-current-1214-20261007`
at `96ea3780cd2b214f6c3480faf6ba75b485e8b654`, tree
`23f280d8e4e7bc61f933d4a3d21217ee4a4d7340`, and archive
`refs/archive/sse-priority-current-1214-20261007/validated`. The worktree was
removed normally; no current evidence or source branch was modified here.
Historical remote delivery is `8e1bf53b`, with authored source/correction mappings.

Static comparison of the exact current preserved source confirms fixed 65,536-
byte classification buffer, check before copy/decode, first original reader
cancellation caching/join, terminal-error verdict and retained authority on
failed retirement. Existing completed candidate evidence already includes
before/after boundary, no-EOF, oversize, retirement, exposure, Unicode, pool and
same-turn controls. Do not duplicate the incorporation, make another draft, or
claim the original's unchanged bug is a newly discovered main vulnerability.

## Existing control/remaining-gate matrix

| Flow | Original source | Preserved correction/evidence | Remaining acceptance |
| --- | --- | --- | --- |
| Non-SSE >64KiB, no EOF | Waits/buffers to EOF; no terminal frame | Fixed diagnostic buffer; checks first excess byte before copy; one api_error before joined cancellation | Actual SDK/client refusal flow, not synthetic Response alone |
| 65,535 / 65,536 / 65,537 bytes | Over-limit completed quota JSON may qualify | Exact-limit refusal can qualify; overflow cannot replay | Real applicable provider envelope and account behavior |
| Large single SSE chunk | Decode before advertised bound | Stand down before decode and relay exact raw bytes without replay | Actual current producer/version witness |
| UTF-8 / CRLF / colonless fields | Colonless event did not reset | Exact-byte fragmentation and empty-value fields corrected | No unrelated model or mock as acceptance |
| Repeated cancellation, stalled/rejected retirement | Second cancel could resolve before first; swallowed failures | Cache/join first operation; fence failed retirement; no forced authority release | Actual installed-client cancel/continuation and original writer closure |
| Quota pool exhaustion | Source reviewed separately | Oct7 regression distinguishes earliest91s from wrong last317s, one terminal frame, exact cleanup and same-turn retry | Real Linux Fable5.1/Opus5.5/account-pool flow and installed package |
| Small never-ending body | Waits for EOF/cancel | Still waits for existing cancellation/deadline; no new wall-clock policy | Accepted documented limitation, not a new timeout request |
| One-byte incomplete SSE | Potential quadratic scanning | Documented CPU-hardening limit; no current producer establishing defect | Revisit only with actual current fragmented producer witness |

## Work done and not claimed

Read-only extraction and source/doc review only; no tests, model/SDK calls,
credential changes, source checkout, issue/PR mutation or release in this check.
Fresh #1273 is CLOSED, `mergeCommit: null`, with explicit instruction to reopen
the same delivery only when ready. Original #1214 stays OPEN.

Current preserved gates are historical, qualified evidence: tested product
`00d324f3` on `c0c5f4c8` passed5514/35skip/0fail across19 stages with a task-only
macOS credential-boundary preload, plus typecheck/build. They do not validate
current-main rebasing or replace Linux Fable5.1/Opus5.5 client/package acceptance.
Quota exhaustion makes that live gate unavailable now. No extra query retry,
account switch, paid-usage change or owner scope exception is attempted.

Next action: reuse the preserved candidate and existing reproducible negative
controls, refresh current-main impact when resuming, and reopen #1273 only with
actual affected-flow/package acceptance plus fresh review and final-head CI.
No additional source correction is justified by this repeated static finding.
