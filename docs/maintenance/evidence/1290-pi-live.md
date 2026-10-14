# PR 1290 actual Pi receipt

Prepared 2026-10-06 from four existing sanitized first-run logs and the
committed [Pi harness](../../../scripts/e2e-pi-capped-unstreamed.mjs). Preparing
this receipt launched no probes and accessed no private auth, config, session
or SDK transcript data. Original failed logs and the
[local-gates receipt](1290-local-gates-e61.md) remain intact.
The [count/assertion JSON](1290-pi-live-counts.json) escrows the observed counts
and explicitly separates logged fields from harness-asserted history proof.

The tested tuple is **Pi 1.0.2, Darwin arm64, Bun 1.3.11, Agent SDK 0.2.141,
Claude Code 2.1.285, Opus 5.5, independently installed Pi scrub 0.2.2**.
The reporter's Pi version and OS are unknown. The user explicitly approved
testing a supported isolated client; these results qualify that tuple and do
not establish the reporter's unknown tuple. Version/platform fields are in
the logs; Bun and independent installation are supplied by the run owner.
The run owner records unchanged baseline `ca6a5c0a4eddb87da52d83993f8f9e105712f0f6`
and candidate `5e608a7f813efb709b41fa4ee7134c501edbc4d6`. Both used the identical
candidate harness, SHA256 `62cdba85c2f21e9b635dcb705373c2e900e23c79576c2222568dff55debf8950`.
The logs do not embed tested SHAs; these revision identities are run-owner records.
Receipt preparation used repository HEAD
`45800528cb311d5c30c29baec5db611e18eaa805`.

| First-run log | Reported result | SDK queries | Pi turns | Events per turn | Error events per turn | Read completions |
| --- | --- | ---: | ---: | --- | --- | --- |
| pi-controlled-baseline-first.log | FAIL | 1 | 1 | 12 | 2 | 0 |
| pi-controlled-fixed-first.log | PASS | 3 | 2 | 26, 13 | 0, 0 | 1, 0 |
| pi-live-fixed-first.log | FAIL | 1 | 1 | 12 | 2 | 0 |
| pi-live-work-snapshot-first.log | PASS | 3 | 2 | 32, 22 | 0, 0 | 1, 0 |

Every recorded Pi child exit is 0. The failing harness results come from
observed error/aborted assistant events, so child exit alone is not success.
No turn hit the output bound or deadline. The logged `capped: false` refers
to the harness output bound; SDK query records independently show
`maxTurns: 1` in every arm, with the passthrough budget override left unset.

The controlled actual-Pi baseline fails at `product-tool-receipt` after one
stream refusal and one nonstream retry. Pi received two error/aborted events
and executed no read. The candidate controlled run passes: three streaming
requests and three nonstream retries, one real Pi read, correlated receipt
delivery, and `upstreamReceipt: true`, with no fixture errors. This proves
the real client/SDK/CLI fallback and continuation path against the local API.
Its returned model metadata is fixture-supplied and does not prove a live
provider model or reproduce a live provider burst.

The first default login-snapshot live attempt also failed at
`product-tool-receipt`, with two error/aborted events and no read. Root
separately observed this sanitized classification in its owned **Pi client**
session: `authentication_error`, with message “Claude authentication expired
or invalid. Run 'claude login' in your terminal to re-authenticate, then
restart the proxy.” The underlying HTTP status was not exposed. That client
session was not reread for this receipt; no source credential write, refresh
or login was performed.

The successful live attempt used a **distinct supported work profile** and a
read-only access-token-only snapshot prepared by the run owner. Its summary
reports `observedAssistantModels: ["claude-opus-5-5"]`. The harness obtains
this metadata through the supported `sdk.getSessionMessages` API and requires
every observed live assistant model to match Opus 5.5. This supplies actual
5.5 evidence for the work-profile arm. Its local fixture counters are unused;
their zeros do not count provider requests or indicate missing receipt proof.
The live arm does not force the stream-refusal fallback.

Runtime plugin and routing proof are concrete. The committed harness checks
`/plugins/list` for active `pi-scrub` version 0.2.2, brackets the independently
installed scrub with request witnesses, and starts actual Pi through the
Meridian `anthropic-messages` provider. Both passing arms logged three
streaming requests with `adapter: pi` and the selected profile (`fixture` or
`owner-work-snapshot`). Before scrub, Pi identity, documentation, additional
documentation, project context and tools are present. After scrub, identity
and documentation phrases are absent, the generic assistant instruction is
present, and project context/tools are preserved, including in SDK options.
**Leftover `<docs>` wrappers remain in every arm.** This is a qualified
content witness, not a claim of complete wrapper removal or evidence for
another client generation.

Both passing arms executed exactly one successful actual Pi `read` returning
the synthetic receipt unchanged. The controlled tool ID was
`toolu_pi_fallback_read`; the live ID was
`toolu_01V5evSEW8ny4gNbdfBWGHdU`. Before/after request witnesses carry each
same ID with the exact client tool result. The first Pi turn has two assistant
message ends (tool boundary plus completion); the saved follow-up has one.
These event-boundary counts are not duplicate final-answer counts.

The three observed SDK queries in each passing arm show: initial source
session; resume at its captured assistant checkpoint into a different fork
target; then saved Pi follow-up resuming that published receipt fork. Each
uses the exact selected 2.1.285 executable, isolated config, default one-turn
cap, `opus[1m]` alias and `claude-opus-5-5` pin. The harness also requires the
stored checkpoint's tool IDs to include the delivered actual Pi call and the
published Meridian mapping to identify the completed receipt fork.
The follow-up executes no repeat read. Logged summaries explicitly report
`checkpointFork`, `savedFollowup` and `exactClientReceipt` as true.

The passing harness then reads supported SDK history and asserts **exactly
one correlated `tool_result`**, its content equal to the actual client
receipt, `is_error` false, and no forwarding denial. PASS plus those explicit
committed assertions supplies the supported-history proof. The actual
history count and denial check are not separately printed in the logs; the
JSON receipt marks this distinction and includes no raw history.

Raw HTTP **E41 sequential/parallel × streaming/nonstreaming** subsequently
passed all four modes; [its separate receipt](1290-e41-live.md) records
source immutability, cache continuity and actual model metadata.
No OpenCode, Sonnet or Linux inference is claimed. Final-head CI and the
previously recorded full-suite timing failure remain separate gates.

The four unchanged original logs are retained at
`/Users/rynfar/repos/meridian-review-evidence-20261006/pr1290` with the exact
filenames in the table. Private snapshot files, OAuth tokens, raw client/SDK
histories and temporary artifact paths are excluded from this escrow.
