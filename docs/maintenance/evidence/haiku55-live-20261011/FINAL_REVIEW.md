# Final Haiku review R7 and responses

Pi / GPT-6.1-Sol / high reasoning, `haiku55-final-product-review-r7`, read-only. **No new material implementation blocker for the bounded Haiku 5.5 change and the specifically recorded flows.** Not blanket merge/release authorization.

## Concrete findings and corrections

1. User-facing legacy guidance incorrectly called 200k a replay budget. `docs/configuration.md` now distinguishes 200k context / 160k replay allowance / 20k reserve. It also explicitly distinguishes SDK-style `budgetTokens` from the pre-existing, unqualified snake-case `budget_tokens` path beside manual-budget advice. No adjacent product fix is claimed.
2. Two 947-byte `dist/server.js` hashes are entrypoint identities, not full bundles/imported chunks. The actual-flow README now says so; tarball SHA identifies the complete installed packed artifact. Recorded hashes were not relabeled as more comprehensive proof.
3. `public-history-corroboration.json` was missing from the hash index. The refreshed evidence index includes it, SHA-256 `1cdb2b3a0cc16edd257cade0d11c0797083f6c032198b0d3b0f9eda6056562ca`.
4. E2E's old unexecuted-Node checkpoint was stale. It now links the specific qualified Darwin source/independent-pack tuple, retains the original Bun/missing-header negatives, and keeps registry/Nix macOS boundaries explicit.

## Independent product/evidence checks

The reviewer found routing/context/replay and downward dependencies coherent; explicit legacy/profile/shell pins distinct; unsupported thinking intent refused before generation; public pricing/override schema flat; tier threshold/cache/output/whole-request/override precedence correct; pin telemetry/persistence separate from served model and reconstructed historical bills.

It independently ran **53 pure pricing/compatibility controls, zero failures**, syntax/JSON/link/whitespace checks, verified all nine core hashes/byte equality to pack source, exact archive and all 1,089 Nix source hashes/modes, all 60 indexed Nix evidence identities/six historical harness bindings, and actual-flow/corroboration consistency. No actors/builds/provider/credential/account/publication operations occurred in review.

Each actual flow contains one real owned read/exact receipt, two HTTP 200 Pi/pin/grouping rows/error null, individually corroborated public native Haiku 5.5 sessions/tool use and receipt continuation, three original process/both-pipe joins. The 0/1/0 exit sequence remains factual; continued successful tool operation plus actual physical joins supports these runs, not a universal claim that exit 1 is benign.

Linux installed-Nix credentialless evidence does not establish inference, actual OpenCode, full terminal SSE conformance, universal descendant/fault custody or Nix macOS execution. The reviewer found no demonstrated Nix macOS failure blocking the bounded npm/Pi result, but an all-platform/Nix-macOS claim needs missing proof or explicit owner scope determination. The parent asked for that material scope/workflow decision; it is **not silently cleared**.

## Parent final gates

After integration, `npm test` **5,615 pass / 35 skip / 0 fail, 21 isolated invocations**, standalone typecheck/build, both harness syntax and tracked whitespace passed. Frozen logs and `FINAL_LOCAL_GATES.json` are adjacent. The subsequent four documentation/evidence-only corrections require content/hash/link/diff validation, not more model calls. Exact committed-head CI remains required after final escrow commit.

Feature landing and release remain gated by scope determination, final-head review/checks and guarded contribution workflow. Release Please exact range/head/diff, tag/release/commit, npm latest/version/integrity/provenance, fresh registry-installed actual flow and Docker tags/architectures remain open. No release action or old negative-custody waiver follows from this review.
