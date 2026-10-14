# Header separator review and proof — 2026-10-04

Disposition: accept source [#1262](https://github.com/rynfar/meridian/pull/1262)
with a separate verification-fixture correction. Only full provenance separator
painting changes; link text still underlines, metadata spans remain undecorated,
and compact forms keep their existing hyphens and links.

Base: `f299fe06e72411b786380b5212edea79cd13966a`.
Source: `b7bea911ecf41cdeeed34d5cc6d7f08c9936fe5f`.
Authored incorporation: `797e10fa`, Nowaker `<spam@nowaker.net>`, original
AuthorDate `2026-10-03T09:34:09Z` retained. Maintainer fixture/evidence changes
are a separate commit. Final-head CI and verified integration remain gates.

## Before/after and negative controls

The maintained `scripts/e2e-build-header-fixture.ts` renders the actual shared
`themeCss`, `profileBarCss`, `profileBarHtml` and `profileBarJs` with synthetic,
credentialless health/provenance data. No SDK/model call is relevant to this CSS
change. The fixture now declares UTF-8: its prior unspecified encoding painted
the UTF-8 dot as `Â·`, so those initial screenshots were discarded. The only
before-code control removes the new `display: inline-block` declaration; all
other source rendering and fitting remain unchanged.

```sh
E2E_HEADER_PORT=42231 bun scripts/e2e-build-header-fixture.ts
```

Open `http://127.0.0.1:42231/?separator=before` in the product-native collaborative
browser at 1280 × 800, then `http://127.0.0.1:42231/` for the corrected source.
Temporarily prevent link navigation in the fixture, click the inspected branch
and commit links to place the pointer over each, and check `:hover` is true.
Wait for painting before saving screenshots. Observed on macOS arm64, Electron
44.4.2 / Chromium 152.0.7977.130:

| Assertion | Before control | Corrected source |
| --- | --- | --- |
| Actual branch link hover | true | true |
| Link text decoration | underline | underline |
| Separator computed display | inline | inline-block |
| Painted dot inherits underline | yes | no |
| Correct UTF-8 separator | `·` | `·` |

The commit link also remains underlined while its atomic separator is plain.
Non-link version/run/dirty spans all retain `text-decoration: none`. A long
branch still clips with `text-overflow: ellipsis` and retains its tooltip.
After settling resize observers, 375/320/768/1280 CSS-pixel viewports have zero
document/header horizontal overflow and provenance forms commit/commit/run/full,
respectively; the full form returns on widening. Compact markup is untouched.

Inspected before/after images are retained by T3 Code's browser artifact store:

- Before branch: `browser-screenshot-127-0-0-1-muuaxocn-9eae98f3.png`.
- After branch: `browser-screenshot-127-0-0-1-muub41g0-5fef4c0d.png`.
- After commit: `browser-screenshot-127-0-0-1-muub5zd7-859ab8a5.png`.

These media supplement this reproducible repository record. No GitHub media
upload facility was available; images are not committed to source. No secrets,
native credentials or customer history are present in the fixture or media.

## Adversarial review and checks

An independent reviewer inspected the complete source/incorporation diff,
shared-header polling, responsive fitting, build URL validation, design tokens,
public API boundaries and source author metadata. No material finding remained.
The focused separator assertion fails unchanged baseline CSS and passes the
incorporation. Compact forms, focus outlines, safe URL filtering and provenance
values are unchanged. The verification fixture's UTF-8 and before-code query
corrections affect only the manual proof surface.

- `npm test`: **5,304 passed / 0 failed / 35 platform skips**, 18 isolated stages,
  including its typecheck pretest, Bun 1.3.14 / Node 22.22.3.
- `npm run typecheck` and `npm run build`: exit 0.
- Final focused `site-header.test.ts` + `build-badge.test.ts`: **59 / 0**.
- `bun build scripts/e2e-build-header-fixture.ts --target bun`: exit 0.
- `git diff --check`: exit 0.

The full local suite/typecheck/build validated the product code; the subsequent
fixture-only correction was compiled and its browser proof rerun. Docs and
fixture changes do not justify repeating the unrelated full model/mock suite.
Required final-head CI remains mandatory before merge. Browser proof is limited
to this actual Chromium/macOS surface; no Safari/Firefox or other-platform paint
claim is made.
