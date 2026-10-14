# Haiku 5.5 support — release preparation

## Authorization and scope

The owner requested **Haiku 5.5 support ASAP and a release** on 2026-10-11.
Preparation starts from main `e68b9bcadd7597d16724a3655b7322cd02a965ad` on
`codex/haiku-55-release`. It excludes the held image, SDK-close, SQLite,
Antigravity and scrub preparations. This is not permission to change accounts,
refresh owner credentials, enable Extra Usage, bypass CI or publish manually.

Official sources, retrieved 2026-10-11:

- [Haiku 5.5 overview](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
- [Migration guide](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)
- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)

They establish fixed ID `claude-haiku-5-5`, native 1M context, 128K output,
adaptive thinking, prompt-tier prices, and Claude Code **2.1.293 minimum**.

## Implementation and review corrections

- Pin bare `haiku` to 5.5, advertise its native 1M/adaptive-only capabilities,
  and retain explicit/datestamped 4.5 routing and 200k discovery.
- Replay capacity follows the effective request/profile/shell Haiku pin on
  every fresh/recovery path. Other families keep their existing policy.
- Raise the bundled CLI floor to `^2.1.293`; locked CLI is **2.1.296** and
  SDK remains **0.2.141**. Regenerated `bun.nix` changes only CLI packages.
- Estimate 5.5 at $0.10/$0.50 per MTok through 100,000 prompt tokens, and
  $0.50/$2.50 above it. Both cache buckets count toward the threshold; cache
  write/read multipliers are 1.25/0.10. Custom overrides stay flat.
- Independent review found the native disabled-thinking control is omitted
  upstream, where Haiku 5.5 defaults to adaptive. An omitted display becomes
  `updates`; the text-only fixture did **not** establish a consumer-visible
  reasoning leak. Both explicit controls now fail clearly **before generation**
  on the tested 5.5 path. Defaults/adaptive and explicit legacy pins remain usable.
  HTTP controls cover JSON/SSE, adapter-off and thinking-beta stripping.
- Independent review also found legacy-pinned aliases would receive 5.5 prices.
  New metrics retain optional `resolvedModel` (effective SDK pin, **not observed
  served-model evidence**), persisted by an additive nullable SQLite column.
  Request grouping/identity stay unchanged and request-key overrides still win.
  Historical aliases without a pin retain current-alias valuation, not historical
  served-model reconstruction. SDK-aggregate tiering/cache-TTL estimates are not bills.

The new leaf compatibility helper has no imports, I/O or state. Query construction
also refuses unsupported explicit controls, so direct helper callers cannot bypass
the HTTP guard. No pricing/config JSON schema fields were added.

## Discriminating controls

The same final tests were copied into an exact archive of main, using identical
installed dependencies; standalone Bun tests establish runtime behavior, not types.

| Suite | Main before | Candidate |
|---|---:|---:|
| Model defaults | 94 pass / 1 fail | 95 / 0 |
| Discovery | 119 / 2 | 121 / 0 |
| Pricing | 32 / 17 | 49 / 0 |
| SDK pin environment | 24 / 2 | 26 / 0 |
| Thinking HTTP / pin metrics | 9 / 4 | 13 / 0 |
| Replay budget | 14 / 1 | 15 / 0 |
| SQLite round-trip/migration/restart | 24 / 3 | 27 / 0 |

[`e2e-haiku55-native-compat.mjs`](../../../scripts/e2e-haiku55-native-compat.mjs)
uses actual CLI/SDK, production option/pin helpers and public SDK history, with a
scripted localhost Anthropic endpoint. macOS `sandbox-exec` denies external
networking and owner credentials/Keychains. It does **not** run production HTTP,
the real model or an actual coding client. Every original process and both pipes
must close. Identical final-script assertions fail main (4/8 cases) and pass the
candidate (8/8): defaults reach 5.5, explicit legacy remains 4.5, native manual
thinking becomes adaptive without `budget_tokens`, and unsupported controls are
refused before spawning. The earlier report had three failures, including an
inappropriate legacy-effort assertion; its original hash/report remain in JSON.
The corrected final script has a new hash and a separate qualified run.

## Initial Pi attempt — refused, NOT accepted

[`e2e-haiku55-pi-live.mjs`](../../../scripts/e2e-haiku55-pi-live.mjs) escrows
actual Pi controller/read, production HTTP, supported access-only profile,
public SDK model-history verification and physical SDK gate/pipe observation.
An attempt with actual **Pi 1.1.0**, Darwin arm64 and the existing native account
received `rate_limit_error`: **"Claude Max rate limit reached. Wait a moment and
try again."** No successful Haiku 5.5 materialization/read-back was witnessed.

The first live script was run under Bun. Its zero observed original children made
its `cleanupJoined: true` calculation vacuous and **unqualified**. Preserve the
original negative receipt; it does not establish that no SDK process ran. Private
fixtures/access-only grant remain retained, and no old writer/session custody is
waived. R2 review additionally found the unsupported `profiles[0].env` property was
ignored: generation used the owned OAuth-profile directory rather than the
parent's history directory, and intended HOME isolation did not take effect.
The corrected script sets HOME before module loading, scopes history lookup to
that actual OAuth-profile directory, and restores the lookup environment. It
requires **native Node**, a witnessed production SDK gate whenever a turn was
attempted, and original close plus both pipes. At that initial checkpoint it had
only syntax/pure-resolution validation. The later actual-flow record below
supersedes that missing runtime check, not the negative receipt. Never rerun the
provider while the account remains blocked.

Read-only usage at `2026-10-11T10:24:46.914Z` showed **100% general weekly usage**,
Extra Usage disabled, reset `2026-10-11T16:59:59.901Z`. No account switch, paid
usage change or parent-initiated model retry occurred. Original credentials were
read to create one private access-only grant, not refreshed or rewritten.

## Updated actual and Nix-installed flows

After the reset, read-only availability from the same default credential store
was weekly 0%, five-hour 3%, Extra Usage disabled. The parent did not refresh or
write the credential store, change accounts, or enable paid usage. The expired
old grant remains retained; a new access-only grant used an already-valid current
token. One native-Node fixture run exposed a missing documented Pi adapter header
and remains negative. Its reviewed correction did not change product code.

[Actual Pi and independent installed-package read-back](haiku55-live-20261011/README.md)
now both **PASS** with Pi 1.1.0, native Node 24.20.0, CLI 2.1.296, SDK 0.2.141,
Darwin ARM64: exact owned read and receipt, both HTTP 200s with Pi/effective-pin
metadata, public native assistant-model history, original SDK gates/both pipes
joined. Current qualified harness hash is
`38b43a6b17b35442dff065b18239a24390c1fb1d7dcaa490856a75d8f11c476d`.
The earlier negative and vacuous Bun cleanup remain unqualified.

[Installed Nix Linux ARM64](haiku55-nix-installed-20261011/README.md) independently
built exact archive `34bcb028`, executed the actual default-selected CLI 2.1.295
and installed SDK 0.2.141, and passed 10 credentialless cases with nine physical
process/both-pipe joins. Independent R5 cleared only that bounded evidence.
It does not prove real Nix macOS execution, full SSE protocol conformance,
universal subprocess faults, or legacy snake-case manual budgets.
[Latest exact-head CI](haiku55-final-head-ci-20261011.json) includes successful
test/Nix/Linux/macOS/Home Manager checks; its cancelled push duplicate was
superseded normally. Final evidence head must be rechecked before landing.

## Release gates

**Not landed or released; final review/CI/merge/publication gates remain.** Final
local product-source gates now pass: **5,615 tests / 35 skip / 0 fail** over 21
isolated invocations, standalone typecheck and build. The final pass follows the
corrected global-mock alias assertion and non-Max catalog assertion (Haiku 5.5's
native 1M is the exception). Earlier failures/timeouts are not green gates. R2
independent review passed 119 focused checks and found no further product defect;
its harness finding above was fixed. Targeted R3 verified dummy-token resolution,
shared-memory directory preservation, SDK manifest path, syntax and all nine
unchanged core hashes. Reviewed live-harness SHA-256 is
`f4a6519ef350bfafeb22d0c099c22f7b16b552f0ebff279891c9f869cf71413a`.
R3 found no further blocking implementation issue, but explicitly did not approve
landing/release or runtime-qualify the corrected Node flow.

An independently installed tarball built from `d3e28b489251908cda3add02c3a1fe251510545d`
passes HTTP catalog/legacy metadata and all four JSON/SSE unsupported-intent 400s.
Its separately installed CLI 2.1.296 version probe closes the original process and
both pipes; SDK is 0.2.141. No SDK/model generation was requested by this smoke.
[Exact script](../../../scripts/e2e-haiku55-package-smoke.mjs) and
[artifact integrity/hash/receipt](haiku55-package-smoke.json) are durable. This
is an unpublished candidate `1.80.0` tarball, **not a registry release**. Its
later actual installed-package model flow is separately qualified above; the
smoke itself still proves no generation.

Complete final-head CI and targeted final review of the integrated evidence and
harness. Preserve the qualified native-Node actual Pi/source and independent
installed-package flows and their physical cleanup receipts; do not replace them
with the smoke. Preserve missing evidence even
when structural checks pass. Follow Release Please; normal code PRs squash with
`--match-head-commit`, release PRs use `--merge`. Never run manual version/tag/npm
publication. Publication requires release/tag/registry/provenance/installed-flow
and Docker verification, not just a merged release PR.

See the adjacent [machine-readable receipts](haiku55-support.json). Local scratch
logs are `/tmp/meridian-haiku55-release`; private credentials are not artifacts.
