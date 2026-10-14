# Haiku 5.5 actual Pi and independent installed-package flows — 2026-10-11

## Qualified result

**PASS for both source-built and independently npm-pack-installed actual Pi flows**, Darwin ARM64, native Node 24.20.0, Pi 1.1.0, Agent SDK 0.2.141, native Claude Code 2.1.296. This is real `claude-haiku-5-5` inference through Pi → production Meridian HTTP → SDK/native. It is not registry/release acceptance or qualification of every client/platform.

- Bare client model `haiku`; no inherited Haiku pin.
- Each fresh Pi session executed exactly one actual `read` on its own immutable receipt file and returned that exact receipt.
- Both HTTP requests per run recorded adapter `pi`, request grouping `haiku`, effective pin `claude-haiku-5-5`, status 200, error null.
- Public `getSessionMessages` history in the supported owned OAuth-profile directory independently confirmed native assistant model `claude-haiku-5-5`. Effective-pin telemetry alone was not treated as served-model proof.
- Each run observed three original ChildProcess actors: explicit native version probe plus two production SDK gates. Every original process emitted `close`, and both captured output pipes closed before acceptance.
- Gate exit codes were **1 then 0**, version probe 0. They are retained, not rewritten to zero or assumed universally benign. Successful owned-tool continuation, both 200 metrics, public native history, client terminal `stop`, and actual physical joins qualify this bounded flow. These receipts do not establish ordinary exit-zero behavior or adversarial teardown fault coverage.

[Source receipt](source.json), [independent installed receipt](installedPack.json), [source/artifact identities](identities.json), [availability](availability.json), [hashes](EVIDENCE_HASHES.json). A subsequent **read-only public SDK history corroboration** checked every individual session, not just the aggregate set: both sessions in each run contain native Haiku 5.5 assistant messages and a tool-use record; each final continuation also contains the owned receipt. [Per-session corroboration](public-history-corroboration.json) made no queries/provider calls/native launches and exposes no transcripts or receipt contents.

The installed package is the existing independently installed unpublished `@rynfar/meridian@1.80.0` tarball from feature source `d3e28b489251908cda3add02c3a1fe251510545d`, SHA-256 `d5553b86af17f26efb5d4c28f1416a4a9131e82e1d932d646ad0ecdc64ed638d`. Its own SDK and native CLI were used, not checkout dependencies. All nine product-source modules remain byte-identical to the current pushed implementation head `34bcb02820c69fc8c3932c5974dbb457b53eb76d`; the intervening changes were evidence and the generated Nix lock. The 947-byte `dist/server.js` entrypoint hashes are independently recorded, not presumed identical despite build metadata differences; they are **not complete imported-chunk/bundle identities**. The tarball SHA identifies the full installed packed artifact. This is **not a fresh registry install**.

## Negative evidence and corrected fixture

The original pre-reset Bun attempt stays negative: rate-limit refusal, vacuous original-child observation, unsupported profile-env isolation. Its original private fixtures/grant and unresolved historical custody are retained; the new receipts do not retroactively qualify it.

After the reset, the old copied access-only grant returned 401 on one read-only usage request. A read-only check of the same default credential store found an already-valid current token. The parent did not refresh/login/write that credential store, select another profile/account, or enable Extra Usage. A **new private access-only grant**, containing no refresh token, was made without overwriting the old grant. Current availability was weekly 0%, five-hour 3%, Extra Usage disabled. Token contents, credential fingerprints, refresh credentials, account metadata, raw history and private paths are not public artifacts.

The first corrected native-Node attempt read the receipt and physically joined its three actors, but failed the unchanged adapter/pin assertion. [Preserved negative receipt](nativeHeaderFailure.json) is **FAIL**, not acceptance. The fixture had omitted Pi's documented `x-meridian-agent: pi` header; Pi cannot be selected from User-Agent alone, and the existing affinity hint instead selected OpenCode. No product change was made to waive that assertion.

The harness now supplies the documented Pi/profile headers through actual Pi provider configuration and captures allowlisted request metadata before asserting it. Actual read-back/count are recorded only after the real-read and exact-receipt assertions. Independent R6 review traced Pi header propagation and production adapter/profile selection, tested negative capture order, checked syntax/whitespace, and found no material delta blocker. Its clearance was structural, not model acceptance; the two later actual successful runs provide the runtime evidence. Telemetry error text is not assumed safe: nonempty errors are redacted in public receipts, with originals retained privately.

Qualified harness SHA-256: `38b43a6b17b35442dff065b18239a24390c1fb1d7dcaa490856a75d8f11c476d`. [Repository harness](../../../../scripts/e2e-haiku55-pi-live.mjs) is the reproducible actual-client path. It requires native Node, explicit live authorization, a mode-0600 owned access-only grant, exact installed/source root, actual Pi package and exact native CLI; it never deletes fixtures. See its invocation comments. Provider attempts were bounded and driven by a verified fixture correction—not a blind quota retry loop.

## Review and remaining gates

R6 (Pi / GPT-6.1-Sol / high) found no material blocker in the small routing/capture delta. The independent final product/evidence review, committed final-head CI and guarded feature merge remain required. The separate installed-Nix Linux ARM64 credentialless run/review qualifies wrapper-selected CLI 2.1.295 with SDK 0.2.141; it is not actual Nix macOS SDK execution or inference. Linux/macOS Nix package CI builds are recorded separately.

No release/tag/npm publication has occurred. Release Please range/head/CI review and guarded release merge, GitHub tag/release/commit, registry version/latest/integrity/provenance, **fresh registry installed actual flow**, and Docker version tags/architectures remain publication gates. Missing Nix macOS installed-native execution and broader client/platform evidence remain explicit; these new receipts must not be cited as those flows.
