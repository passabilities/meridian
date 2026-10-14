## Plugin-preflight correction — 2026-10-12

The October 12 harness installed the Meridian OpenCode V1 client plugin but
never configured `pluginConfigPath`/`pluginDir` or loaded the required OpenCode
server scrub plugin. Its isolated HOME ruled out the owner's installed scrub.
The provider refusal and client receipt below remain real observations, but
neither qualifies a correctly configured affected-client flow nor proves
subscription exhaustion. The prior account-quota interpretation is withdrawn.

The corrected harness requires `E2E_PLUGIN_PATH` and optionally pins
`E2E_SCRUB_VERSION`. It retains package identity/hash, checks the exact active
loaded path and onRequest hook before inference, and requires successful hook
invocation with zero errors afterward. Client plugin setup/config/header checks
remain required independently. No new live model call has been made by this
correction. Source #1327 is already incorporated; this record corrects evidence,
not the historical merge state. Correctly configured live acceptance is pending.

## Resumed on current main — 2026-10-12

Current base `a48a84982453d3b4748ddbdf566455597e13c836`. The actual author commit
`9106fa7b0b96b6155e97b0c61b1e2298ed73cf04` is cherry-picked with `-x` as
`f6a6d554c`; prior maintainer correction `e83ca03e` is separately replayed as
`4f35a88d0`. The historical records below retain their earlier SHAs and gates.
Focused current checks pass 252 tests / zero failures; full checks are running.

A real installed 1.81.0 baseline through OpenCode 1.18.34 and its verified V1
Meridian plugin on Linux x64 (Docker under emulation on Darwin ARM64) produced
native `API Error: 400 You're out of extra usage. Add more at claude.ai/settings/usage and keep going.`
The client received misleading generic subscription text. Current corrected
installed-package flow reaches the same actual provider refusal and quotes it
in the real client's persistent log. The first harness's stdout-only assertion
failed after deliberately stopping retries; the durable client log establishes
receipt, and the harness has been corrected to assert that witness. Final corrected run passes with the real client log witness, native provider diagnostic, unchanged 402/billing_error classification and original process/pipe joins. See [durable live receipt](1327-extra-usage/live-opencode-20261012.json). Full local gates and exact-head CI remain pending at this checkpoint.

No Extra Usage setting, payment, account switch or credential refresh is involved.
This is real refusal-path verification, not a successful-generation claim.

# Extra Usage refusal correction (#1327)

**SOURCE_CORRECTED_WITH_PROVIDER_AND_FINAL_CI_HOLDS.** The submitted helper could
quote a tool/context line as Anthropic's refusal and deny a lapsed subscription
when an unrelated primary error already reported one. The correction strips the
existing SDK wrappers, considers only the primary line and recognizes the two
reported native refusal families (out of Extra Usage; third-party apps drawing
from Extra Usage). It preserves the bounded primary text and omits unsupported
assertions about subscription health or plan coverage. Other billing refusals
retain existing subscription advice. Status, error type and failover policy are
unchanged. The quoted primary line remains bounded to 300 characters; this is
not a general-purpose secret redaction or arbitrary-provider text parser.

The actual Nowaker commit `9106fa7b` is replayed as `3a03e6d180938ae0bd71c16e8ca941398018d6d6`, with raw Author,
AuthorDate and complete message preserved. The maintainer correction is separate.
Base `85db81fee02dc00e08f8d3bb9d910aecc8bc1124` includes delivered logout #1331. See
[identity](1327-extra-usage/identity.json).

Three causal classifier regressions fail the submitted source; three adjacent
recognition/bound controls already pass. Corrected classifier: **226 pass,
zero fail, 458 expectations**, Bun 1.3.11. Four identical mocked-SDK HTTP controls
fail submitted production and pass after correction in JSON and SSE. They
assert actual client-facing billing type, unchanged HTTP/error-frame semantics,
preserved primary provider quote, exclusion of unrelated context and absence of
unproven account claims. This is transport-level mock evidence, not a live
Anthropic refusal. Final frozen checkpoint `66f43f27422609be6b702c41966447e266774f87` passes
full npm test: **5,572 pass / zero fail / 35 skip**, across 21 isolated
invocations. Standalone typecheck and build exit zero with Bun 1.3.11 and
Node 22.22.3. See [local gate receipt](1327-extra-usage/local-gates.json).

Root inspected the complete contributor/correction diff, classifier priority,
recognized native forms/wrapper/CRLF/cap controls, account and quota failover,
1M fallback callers, the JSON/SSE error paths and public API boundaries. No
additional material scoped source finding remains. Earlier extraction findings
are retained in the original source review. This is root adversarial review,
not a delegated review. Original contributor assertions are retained.

A fresh refusal through the actual implicated provider/model/SDK/client remains
missing; synthetic error strings cannot establish that production extraction is
correct for all native shapes. Live provider proof and exact final-head CI remain open. No integration PR, merge, source
closure or release is claimed for this correction. The source branch and proof
are durable checkpoints while independent queue work continues.
