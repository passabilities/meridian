# Hostname consent incorporation (#1233 / #1259)

## Owner decision and scope

On 2026-10-04 the owner explicitly approved the public contract tracked by
[#1259](https://github.com/rynfar/meridian/issues/1259) in the review
conversation. The exact presented question was:

> Approve the hostname contract tracked in Meridian issue #1259? It adds authenticated GET/PUT /settings/api/header, defaults hostname display off, and includes hostname on unauthenticated /health only while enabled. AGENTS.md requires owner approval before changing this public API.

The owner's exact reply was:

> Approve the opt-in hostname contract

The approval covers the shared product header, including standalone
Antigravity. The existing optional `MERIDIAN_API_KEY` semantics are preserved.

Review accepted the bounded reverse-proxy correction: allow
exact request Origin, or HTTPS Origin with the same normalized public Host/
port while the internal request uses HTTP. Explicit public 443 and omitted
HTTPS 443 are equivalent. No forwarding header establishes trust, no public
configuration field was added, and a proxy that rewrites Host must preserve
the public Host for this route. This is an authority-preserving TLS bridge,
not detection or authentication of a proxy.

## Source and credit

Source [#1233](https://github.com/rynfar/meridian/pull/1233) was refreshed on
2026-10-04 at head `322d3af68691eb41552b53c010d1996e9474c130`, base
`f299fe06e72411b786380b5212edea79cd13966a`. The complete commit, file diff,
PR body, comments and reviews were inspected; comments and reviews were
empty. The earlier `c609e8d1` checkpoint is obsolete. The current source is
one actual authored commit with responsive-header rebasing, and contains no
changes from adjacent #1232.

| Source commit | Initial authored cherry-pick | Browser/full-suite rebase on `9d77d8e2` | Final authored rebase on `5bd6b765` | Author / AuthorDate |
| --- | --- | --- | --- | --- |
| `322d3af68691eb41552b53c010d1996e9474c130` | `9939c6d585fbaf22e7b50f8a7e0a612571fe88c3` | `ae6bf5e4441d31c872315de11bb2e7a71e6782bb` | `3055d6b3ac988807316d14735a3c761966d4871a` | Nowaker `<spam@nowaker.net>` / `2026-10-01T17:40:02-05:00` (same instant as `2026-10-01T22:40:02Z`) |

The contributor commit was cherry-picked without conflict from then-current
main and rebased onto `9d77d8e282cb9c58d99b8962b900777e9f4b0803` after the
verified header-separator integration. Maintainer product corrections remain
separate in `a6be2cd3d5c3a168610c5a94a67adfa1d1dabba7`. Local final-head
checks and browser evidence are recorded below before
handoff to the queue owner. No push, PR creation, merge, closure, community
comment or release is performed by this implementation agent.

After verified test-preload cleanup #1265 landed, the branch was rebased again
onto `5bd6b765fc7507780e1e9238b6d48a99f3d44810`. The contributor's git Author
and AuthorDate match the source exactly. The rebased maintainer product commit
is `6fb37564d4b7c141ded9d7751670eb522d25d592`; the bounded browser harness
commit is `2fa3ce708eee87d5b81cac967dbcfd09f7385bd0`. Product and both harness
file blobs were compared to `f33f93a1` and are identical, so existing browser
evidence remains applicable. The only intervening main changes are preload
helpers, their tests and evidence; they do not change the application.

## Adversarial findings and corrections

- The source captures consent before an asynchronous Claude auth probe. A
  delayed enabled probe still disclosed hostname after a completed disable.
  Health now reads consent immediately before response assembly, after all
  auth/account/body awaits. Health and settings bypass caches.
- The source's permissive CORS permits a foreign-origin PUT to opt an unkeyed
  instance into public disclosure. The shared handler rejects foreign,
  opaque, malformed and different-port origins with 403, with and without a
  valid key. Same-origin and origin-less authenticated CLI controls pass.
  Independent review rejected a strict internal-origin comparison because
  Node sees HTTP behind a TLS terminator; the bounded public-HTTPS bridge
  above has implicit/explicit 443 and preserved 8443 controls.
- Standalone Antigravity uses the shared header but source settings routes
  return 404 and its health omits hostname. It now uses the same validation
  and persisted consent behind its existing API-key boundary. Healthy,
  draining and error health bodies/statuses are preserved; only the optional
  hostname and `no-store` policy are added. `/livez`, `/readyz` and unrelated
  settings traffic retain their prior behavior.
- Older browser health polls can restore a name after a newer disabled
  refresh. Refresh generations now discard superseded responses, and a
  failed current poll removes the label and tooltip.
- Concurrent checkbox saves could persist an older enable after a later
  disable. The UI disables the control through save/reload and restores it
  after failure. The input now has the accessible name “Show hostname.”
- Persisted null/malformed documents and invalid truthy values fail closed
  for this feature. Invalid request bodies preserve consent, missing fields
  are no-ops, and null removes the stored field without affecting unrelated
  settings. DNS/IP labels use `textContent`, retain full-name tooltips and
  reuse existing responsive-header fitting and tokens.

The independent review inspected source and maintainer changes in settings,
Claude and Antigravity dispatch, shared helper, profile bar, settings UI,
tests, architecture and API references. No injection, dependency-cycle or
use of credentials/model generation is needed by this behavior.

## Reproducible controls and evidence

The durable [source control record](1233-hostname-source-controls.json)
preserves the unchanged-contributor result: 7 pass / 17 fail, 101 assertions,
exit 1, using the expanded maintained HTTP test in the contributor tree.
Observed failures include foreign PUT 200 instead of 403, delayed Claude
hostname after disable, null persisted settings returning 500, missing
standalone routes, and cacheable consent. These are discriminating tests,
not a green rerun of the contributor's original coverage.

Reproduce with an isolated detached checkout of the source commit, copy
`src/__tests__/header-settings-routes.test.ts` from the delivery tree, supply
dependencies, and run `bun test --timeout 30000
src/__tests__/header-settings-routes.test.ts`. The file controls model auth
and provider account checks and is isolated in the npm test script because
Bun module mocks are process-global.

After correction, the focused HTTP plus pure-label command passed 28 tests,
249 assertions, exit 0. At exact code/harness head
`f33f93a1acfd93fdd73db89b3b1f05ac7a91b65e` on main `9d77d8e2`, full
`npm test` passed **5333 / 35 skipped / 0 failed**, 26558 assertions over 19
isolated process stages, exit 0, including pretest typechecking. The new
isolated header HTTP stage passed 24 tests / 240 assertions. Standalone
`npm run typecheck` and `npm run build` also passed on this head, on
darwin/arm64, Bun 1.3.14, Node v22.22.3. These are exact-head local results,
not final-head CI claims. The [local gate record](1233-hostname-local-gates.json)
preserves command/count/head provenance.

After the second rebase, exact head
`a4c60935eb239ac9c008b753f41cdae49cdc8bb4` passed the isolated hostname HTTP
stage (24 tests / 240 assertions), then preload-cleanup/shared-header/pure
host/build-badge checks (76 tests / 306 assertions), standalone typecheck and
build, all exit 0. The full suite was not redundantly rerun: its exact
`f33f93a1` provenance stays explicit, and final-head CI remains required.
The subsequent evidence-only commit is content/link/diff checked.

The maintained [HTTP/browser fixture](../../../scripts/e2e-hostname-header.mjs)
serves actual app pages, routes and settings writes in isolated configuration;
auth/account probes are controlled and SDK/model requests are fenced. Use
`E2E_BASELINE_ROOT=<unchanged main> E2E_PORT=42233 bun
scripts/e2e-hostname-header.mjs`, then open `/fixture/frame?width=375&path=/settings`
in the native collaborative browser and evaluate the complete
[browser probe](../../../scripts/e2e-hostname-header-browser.js) in the owned
frame. Repeat at 320/375/414/768/1280px, on `path=/fixture/provider`, and on
`path=/fixture/before/settings` for baseline comparison. The probe exercises
the real click/save path, blocked concurrent save, reversed-response and
failed-poll controls, DNS/IP tooltips, clipping and intact update notices.
The probe compares document width to an actual same-width baseline frame;
hostname and header bounds remain strict. Long/IP labels and update payloads
are explicitly synthetic stress controls;
ordinary settings and health use the actual OS name. It restores consent off.

The visual baseline fixture is exact main
`9d77d8e282cb9c58d99b8962b900777e9f4b0803`. The queue owner ran the final
frozen timer-bounded probe at `f33f93a1` in native T3 Code Electron 44.4.2 /
Chromium 152.0.7977.130 on macOS 26.6.2 arm64. All **10 rows passed**:
Settings and standalone provider at 320/375/414/768/1280px. Every Settings
row passed single-save, old-poll and failed-poll controls; both pages passed
actual settings persistence, DNS/IP labels, full tooltips, clipping, intact
update notices and no added overflow. Long DNS labels clip at 97px on phones
and 166.289px on desktop. Consent ended off after every row and SDK generation
count stayed zero. Complete results are in the committed
[browser matrix](1233-hostname-browser-matrix.json).

The independent final reviewer approved exact product head `a6be2cd3`,
harness head `f33f93a1` and the 10-row matrix without material findings.
No live model E2E is implicated: this changes header/settings/health only.
Required final-head CI, source-head freshness and integration remain gates
owned by the queue owner.

At 320px, native browser inspection found a pre-existing Settings feature-row
overflow: baseline and corrected off-state both have document width 323px
and header right edge 305px. The hostname itself stays clipped within the
header. The acceptance claim is **no added overflow**, not zero baseline
overflow. The maintained probe measures that unchanged baseline directly.
The unrelated baseline feature-row layout is outside this hostname change.

An initial standalone-provider comparison also reported added overflow, then
passed on immediate diagnostic rerun without a product change. Review found
two concrete fixture flaws: baseline provider requests were dispatched to
Claude health instead of the controlled standalone backend, and bounds were
sampled immediately after label text arrived, before asynchronous header
fitting settled. The maintained fixture now dispatches both provider pages'
requests to standalone with provider facts controlled to forbid subprocesses;
the probe waits for two stable 200ms geometry intervals after fonts/rendering,
using bounded timers because hidden previews can suspend animation frames.
The fresh frozen full-matrix result above establishes acceptance after those
fixture corrections; the unexplained initial rerun is not treated as proof.

## Native visual evidence availability

The queue owner inspected matching native 375px before/after application
frames, a current Settings row showing “shown” with its checkbox checked,
and a 2.952-second 750x1600 native toggle recording. Three extracted video
frames show actual OS label Mac -> hidden -> Mac; current DOM rows and actual
PUT/GET responses show shown/true -> hidden/false -> shown/true. A detached
checkbox reference initially retained old row text because settings reload
replaces the row; re-querying the current DOM confirmed the correct state.
No product correction was indicated. The recording contains no secrets and
consent ended off.

The [native media record](1233-hostname-native-media.json) preserves exact
local artifact paths, byte sizes and SHA-256 identities. These are native
userdata artifacts, **not uploaded PR/CI media**; no upload facility was
available. The committed fixture/probe and full matrix are the durable,
shareable proof. Preliminary blank/unsettled captures are excluded. Matching
frame captures include an outer-wrapper scrollbar and do not claim zero
application overflow; application bounds come from the measured matrix.
