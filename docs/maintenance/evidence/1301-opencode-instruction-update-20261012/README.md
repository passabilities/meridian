## Current verdict: all required live client gates pass

Beta18314/18866/19271 extended installed gates all exit0 (originals58550,
15803,44041). Each proves two distinct proxy processes, both PASS/joined, and
access-only grants removed. Sanitized receipts are e42-beta*-qualified.json.
Stable2.0.16/2.0.21, six offline beta source/installed arms, actual instruction
before/after and all four E41 modes also pass. Final local and CI remain gates.

Beta19271's first attempt failed before inference because HTTP readiness preceded
asynchronous catalog reload. The warm gate now polls the supported /api/model
endpoint for the selected model; its separate cold standalone test remains.
The retained credentialless control proves readiness and successful selection,
with the later offline completion assertion still failing as documented.
The corrected full live run passes; no earlier failure was relabeled.

Final adversarial pass inspected runtime changes, strict prefix/exact-ID/result
invariants, armed Crush negative control, default OpenCode adapter scope, user-level
reminder delivery, setup allowlist, installed plugin qualification, real process
restart/custody, catalog/effort semantics and historical evidence limitations.
No public interface or dependency change. Diagnostic wording that overstated
live Haiku as a Meridian-only variant was corrected: that stronger discovery
claim belongs to the controlled offline fixture, which retains its negative
and invalidation controls. No material runtime finding remains; local/CI gates
and exact source/head refresh still precede integration.

## Beta18314 complete

Original58550 exited0/PASS on independently installed b90324930, actual
Haiku5.5 and scrub0.2.3. Two distinct proxy worker PIDs establish a real process
restart. Ordinary/restart resume, warm and cold xhigh, tool results, separate
client/proxy directories, fork/original and undo isolation, concurrent children
and compaction pass. Both workers report PASS with original actors joined;
access-only grant removed. Sanitized full gate receipt is
`e42-beta18314-qualified.json`. This supersedes only the beta18314 acceptance
hold; beta18866/19271 and final local/CI/adversarial gates remain open.

## Primary completion assertion correction

Original99036 exits1 after confirming actual primary xhigh and completed response.
Its second xhigh request was a detached title call still in flight when the
primary CLI returned. The prior assertion incorrectly required that auxiliary
request to have already closed. Sanitized identity/timing evidence is retained
in `18314-wire-qualified-failure.json`; workers joined and grant was removed.
The assertion now requires at least one primary xhigh request and completion of
all primary xhigh requests, excluding source-tagged auxiliary calls. All request
fields remain recorded. Original58550 is the causally corrected live attempt;
no passing result is claimed until its entire original process completes.

## Beta recorder cause established

Credentialless actual beta18314 warm-host controls vary the catalog while keeping
the installed plugin and host fixed. Minimal Haiku5.5 catalog sends top-level
`effort: xhigh`; the real catalog sends `output_config.effort: xhigh` with adaptive
thinking. Both controls deliberately remain full-gate exit1 (the original
completion or top-level-only assertion); neither is relabeled as acceptance.
Exact scripts and sanitized wire fields are escrowed adjacent. Meridian already
accepts both fields in server.ts. The E42 recorder now uses the same top-level,
then output_config precedence and retains both raw field shapes. The real live
beta gate is rerunning with unchanged effort and subprocess-restart requirements.

## Current qualification — OpenCode 2.0.21 passes; beta effort gate remains open

On candidate `b90324930`, original process57372 exited0/PASS. The independently
installed package now passes normal setup and the entire stable OpenCode2.0.21
E42 gate: signed primary, same-session resume, title/generate isolation, xhigh
on the wire, real tool results, fork/original isolation and compaction. Actual
Haiku5.5 is verified via supported SDK session APIs. Installed server scrub0.2.3
was verified before inference and after; all original subprocesses and pipes
joined, and the access-only grant was removed. See `e42-stable-2021-report.json`
and its adjacent exact qualified wrapper. This supersedes the setup rejection
as a current candidate limitation; the historical manual baseline remains valid.

The corrected beta18314 gate now restarts two actual proxy subprocesses and
passes ordinary/restart resume. Original43258 exited1 at warm-server xhigh:
selection succeeded, but all three observed request efforts were absent.
All workers joined and the grant was removed. This is not an acceptance pass.
A credentialless warm-host control with a known initial model and minimal
Haiku5.5 catalog sends top-level xhigh, ruling out a universal recorder-field
error. Its full-gate exit1 is retained: offline responses lack the live upstream
completion timestamp. Testing the actual catalog is the next discriminating
control. Do not weaken the effort or real-process-restart assertion.

Material setup/harness changes since the earlier full local gate require new
final local gates and CI. All three extended beta gates and final adversarial
review remain open; #1354 stays draft. Source#1301 is unchanged05e2381f and open.

# Actual OpenCode instruction update — 2026-10-12

Actual OpenCode 2.0.21 on Darwin ARM64, Node host, independently installed
Meridian packages, Agent SDK0.2.141 and native Claude2.1.296. Primary actual model
Haiku5.5 was verified through supported getSessionMessages. Client V2 plugin
SHA256 d8fd970f561a05a1d2716f7a118ec7e59e44d1942b25a1edca263a00cc779b56
is identical in both packages. Server scrub0.2.3 is independently installed,
active before inference and invoked without errors. Package identities adjacent.
Baseline is clean5498892b (tree verified equal merged506a811d); candidate package
is cleanb08b40bf. Later harness changes do not change either installed runtime.

The actual client writes an owned AGENTS.md and emits
user -> assistant[thinking,tool_use] -> user[tool_result] -> system[text].
Baseline records continuation with isResume=false. Candidate records continuation
with isResume=true, completes the real read/result loop and a same-session
follow-up. Candidate original process36496 exits0/PASS; all original subprocess
exit/close and stdout/stderr-close witnesses join, then the access-only grant is
deleted. No refresh token is copied; supported source is read twice unchanged.
Readiness showed included capacity and Extra Usage disabled.

Baseline original80305 exits1 on an over-broad model assertion that included
the detached Haiku4.5 title session. The baseline checkpoint assertion itself
passes (isResume=false). Supported SDK inspection of the exact instruction-update
session independently confirms Haiku5.5. baseline-qualified-report preserves
that post-run check and original failure; no successful rerun is invented.
Candidate scopes model validation to the actual primary request IDs.

Retained setup/harness findings:
- Meridian setup rejects2.0.21; only2.0.16 and pinned betas are qualified. The
  diagnostic manually configures exactly one installed V2 plugin in its owned
  fixture. This is actual-client evidence, not a setup/E42 acceptance pass.
- An early inherited-PWD run edited AGENTS.md in the isolated review worktree,
  not the owner checkout. That edit was restored immediately. The harness now
  sets cwd/PWD/INIT_CWD to the canonical owned project and rejects a mismatched
  primary request before inference.
- An initial fixture key used an invalid length. Corrected to32 random bytes
  encoded base64url. Ambient client environment was then removed; only fixture
  HOME/XDG/PATH/config/key settings are passed. The earlier unsigned-request
  observations are retained and are not claimed as a product fix.
- Initial human turn must be signed. Tool-result continuations in this live
  instruction-change flow lack that signature, but carry the installed plugin's
  same session/agent identity. They are admitted only into the already signed
  owned session; flags are retained. This is not priority-routing qualification.
- Credentialless exact-host controls show the installed V2 hook can sign primary
  requests, including a scripted tool round; actual source/runtime surfaces must
  be tested rather than inferred from a missing header.

Reproduce with the committed scripts/e2e-opencode-instruction-update.mjs:
E2E_ALLOW_LIVE_MODEL=1, E2E_EXPECT=baseline|candidate, E2E_MODEL=claude-haiku-5-5,
E2E_LIVE_PROFILE_FILE pointing to a private access-only OAuth profile array,
E2E_OPENCODE_BIN to @opencode/cli2.0.21, E2E_MERIDIAN_ROOT to the installed
package, E2E_PLUGIN_PATH to installed server scrub, and E2E_NATIVE_BIN to the
qualified native CLI. Run with native Node. Keep grant until report.joined=true.
The harness is isolated; never point its project at customer files.

Acceptance remains open: qualified setup/host coverage, all four E41 modes,
relevant E42, full final local/CI gates and final adversarial review. No merge,
source closure or release is claimed. Reporter specified haiku without an exact
served version; this independent proof explicitly covers Haiku5.5.

## Additional gates completed

Clean head0aab7d26 original local28183 exited0:5743pass/35skip/0fail,
full npm test, standalone typecheck and build.
E41 original32660 exited0: all four chain/parallel by JSON/SSE modes pass on
Darwin ARM64 with actual Opus5.5, installed client hook and server scrub,
exact call/result pairing, unchanged source history, cache continuity and
joined original actors. Each grant was removed after joined=true.
Offline E42 original83785 exited0: all three pinned betas18314/18866/19271
pass source and independently installed-package gates, six arms total.
Sanitized receipts preserve gate verdicts/catalog/cold-start/invalidation facts
without raw request authorization or attestation headers.
Installed actual released OpenCode2.0.16 E42 original57684 exits0: setup,
primary signature, title/generate isolation, same-session resume, xhigh discovery,
real tool result, fork/original isolation and compaction all pass. Actual Haiku5.5
is observed through supported SDK messages; server scrub is verified before and
after. Original SDK and client processes/pipes join; grant removed. Exact
external-proxy wrapper is escrowed here with fixed owned fixture paths.

## Extended beta gate remains open

Original34036 failed because the external proxy adapter lacked the gate's
mid-run proxy.close/restart handle. Original61202 then failed at selecting
claude-haiku-4-5#xhigh (provider.no-route). Both original processes joined and
grants were removed. Neither is counted as acceptance. The second adapter
restarted only the proxy instance, not its OS process; that is insufficient
for the existing durable process-restart assertion even though it advanced
past that assertion. Preserve a real subprocess restart in the corrected gate.
The live beta harness also assumes Haiku4.5 advertises xhigh; update the live
model/catalog expectation to the actual supported Haiku5.5 while retaining
the offline fixture's controlled catalog and all resume/cache checks. Do not
weaken the restart or effort-discovery assertions merely to obtain a pass.
These harness corrections and the 2.0.21 setup qualification remain open.
