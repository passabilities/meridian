# Opencodex discovery compatibility finding

The reporter of Meridian issue #1315 owns a public fork of lidge-jun/opencodex.
Its current main is 6d881db206c6a74da6b64fa22b6980faf05d0122 (package 2.12.0).
This is a plausible affected-client source, not proof of the reporter's installed
revision. The exact installed version remains unconfirmed.

An actual import of its unchanged catalogHintsFromModelsApiItem ignores Meridian's
context_window field. Its fetchProviderModels HTTP discovery path also drops
that value: the candidate advertises Opus 5.5 at 1,000,000, but the discovered
row has no contextWindow. A controlled additional context_length field with the
same value yields contextWindow=1,000,000. Two GET /v1/models calls were observed;
no other HTTP route is served. The copied probe asserts both outcomes and closes
the local listener in finally. The endpoint uses the actual candidate's pure
buildModelList(false, 0), not an actual Pro account or full Meridian server.

Run on macOS with Bun 1.3.14 and an independently installed dependency tree for
the pinned opencodex source (npm install --ignore-scripts --omit=dev --omit=optional):

```sh
OPENCODEX_HOME=/tmp/owned-opencodex-catalog-config bun catalog-discovery-probe.ts /path/to/pinned/opencodex /path/to/candidate/meridian
```

The recorded run additionally used a macOS Seatbelt policy denying network except
loopback, user-home writes, and reads from the real Codex/Claude/config/Keychain
stores. No credentials, auth refresh, plugins, or inference are used by this
catalog-only probe. It does not establish Codex app adoption, effective compaction
threshold, provider inclusion/entitlement, or complete issue resolution.

Initial HTTP attempt was refused by the client's destination policy because
loopback was not enabled. Its local provider fixture now explicitly uses the
supported allowPrivateNetwork=true option; the unchanged client then makes both
GET requests. Preserve the initial refusal as harness-configuration evidence,
not as a product failure. An earlier Seatbelt syntax error occurred before the
client started (the policy requires localhost rather than a numeric host).

Disposition: keep #1358 draft. Before claiming the client's compaction fixed,
confirm the exact opencodex version and its effective catalog. Decide whether the
client should consume context_window or Meridian should expose a compatible alias;
do not assume the numeric catalog correction alone proves downstream adoption.
No new public response field was added during this investigation.
