# Config-local plugin loading — source #1360

Disposition: accept with corrections, merged as the contributor's own PR #1360.
Local and source/installed CLI config acceptance pass; model inference through a
relocated plugin was not run.
Current-main e0f9feab defaults plugin paths to the user's global Meridian tree
although MERIDIAN_CONFIG_DIR selects a separate instance. The original manifest
assertion and added discovery-isolation control both fail there; the same
assertions pass with Nowaker's commit applied. Explicit plugin directory
and manifest settings retain precedence. No exported configuration type, route,
or lifecycle interface changes.

Nowaker's commit is 219160f2796422b31a54f2ed52ad101a44137f5a on their branch.
The receipts below were recorded on maintainer draft #1362, whose tree is
identical (cherry-picked copy 13abefad5 plus the same maintainer commits); that
draft is closed unmerged. Maintainer commits on Nowaker's branch add
CLI help consistency and controls for distinct configuration roots, retained
per-instance plugin lists and explicit directory/manifest precedence.
[Regression receipt](regression.json): baseline2 failures; corrected34 tests /
79 assertions and typecheck pass. The baseline loader read existing global
plugin names; no /v1/messages or live inference was invoked by those assertions.

Full local `npm test`, standalone typecheck and build passed on frozen
584bd172826e192282b20bb1a586a04fc6447da7; see [receipt](full-local-gates.json).

Real source CLI and independently packed/installed Node CLI pass both distinct
config-root discovery and absolute manifest entry assertions, explicit overrides
and retention of the first running instance. All processes joined with exit 0.
The same harness fails unchanged main: the selected config plugins are absent.
[Baseline receipt](baseline-cli-receipt.json), [source](source-cli-receipt.json),
[installed](installed-cli-receipt.json), [identity](cli-identity.json).
Run `node e2e-cli-config.mjs <runtime> <absolute-cli-entry> <fresh-root>` on macOS.
The committed harness fences network to loopback, denies host credential trees,
and supplies a dummy API profile plus an auth-status-only fixture; it invokes
GET readiness/plugin listing only. No live SDK/client/model proof is claimed.

Adversarial review: defaults now use the existing central config directory;
explicit options still win. Two simultaneous processes cannot read each other's
plugin sets in the tested flow. Disabled manifest entries retain precedence over
discovery. No exported interface, profile entitlement or request hook changes.

Not run: a model request through a plugin loaded from a relocated config
directory. The change moves two default paths and touches no request path.
