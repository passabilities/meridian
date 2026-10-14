# libsql0.5.29 provenance and upstream WAL-reset guard comparison

Read-only trace captured 2026-10-04 for PR#1243 exact head6558c209. No database corruption experiment was performed and no Meridian corruption event is claimed. The conclusion below is a published-source comparison, not a conclusion inferred solely from SQLite's displayed version.

## Published build chain

- Official wrapper metadata: https://registry.npmjs.org/libsql/0.5.29 ; saved `npm-libsql-0.5.29.json`. gitHead55bee86d1c284f1ddf2b9e280e870d2b6cef884a.
- Official native metadata: https://registry.npmjs.org/@libsql/darwin-arm64/0.5.29 ; saved `npm-native-darwin-arm64-0.5.29.json`.
- Registry SLSA statements: https://registry.npmjs.org/-/npm/v1/attestations/libsql@0.5.29 and https://registry.npmjs.org/-/npm/v1/attestations/@libsql%2fdarwin-arm64@0.5.29 . Full envelopes and decoded SLSA payloads saved. Statements identify tagv0.5.29, source commit55bee86d, `.github/workflows/CI.yml`, run https://github.com/tursodatabase/libsql-js/actions/runs/23531631405/attempts/1 . Read/decoded statements were not independently certificate/signature-validated.
- Official tag reference: https://api.github.com/repos/tursodatabase/libsql-js/git/ref/tags/v0.5.29 ; saved `github-libsql-js-tag.json`.
- Exact wrapper build source: https://github.com/tursodatabase/libsql-js/tree/55bee86d1c284f1ddf2b9e280e870d2b6cef884a . Raw Cargo/build sources captured from `raw.githubusercontent.com/tursodatabase/libsql-js/55bee86d1c284f1ddf2b9e280e870d2b6cef884a/`: `Cargo.toml`, `Cargo.lock`, `.github/workflows/CI.yml`.
- Cargo.lock pins libsql-ffi0.9.30, checksum0be1da6f123ceb2cd23f469883415cab9ee963286a85d61e22afb8b12e15e681. Official immutable crate download: https://static.crates.io/crates/libsql-ffi/libsql-ffi-0.9.30.crate . Downloaded SHA256 matches the lock checksum exactly. The crate's `.cargo_vcs_info.json` identifies libsql commit0653c5788d77ef16a97c56ff3e9fdc11717a72d9, pathlibsql-ffi. The original review captured its bundled SQLite amalgamation. This escrow retains the build recipe/checkpoint excerpt, plus locked source identity and the omitted full amalgamation/crate digests in `archive-omissions.json`; retrieve the large public source/crate through the official URL to reconstruct it.
- Build recipe `build.rs:468–469` copies `bundled/src/sqlite3.c` over the MultipleCiphers source, and non-cipher builds compile the same bundled amalgamation. Thus the checkpoint code inspected is relevant to the published encryption-enabled wrapper, rather than merely an unused header.
- Official native tarball: https://registry.npmjs.org/@libsql/darwin-arm64/-/darwin-arm64-0.5.29.tgz . Its SHA512 matches registry integrity. Installed `probe-source/node_modules/@libsql/darwin-arm64/index.node` is byte-identical to published `package/index.node`, SHA2563fd9e58190311b5ee027c3e5452a6a410b31a5d610fd55853d797bb3c9f5db0c. The original capture byte-compared the native tarball; this escrow retains registry integrity, the tarball digest/retrieval URL and installed native byte identity rather than the large native tarball. No native rebuilding or upgrade was attempted.

Actual synthetic probe engine: libsql0.5.29; sqlite_version3.45.1; sqlite_source_id `2024-01-30 16:01:20 e876e51a0ed5c5b3126f52e532044363a014bc594cfefa87ffb5b82257ccalt1`. This is the macOSarm64 artifact; other platform artifacts were not byte-compared by this reviewer.

## Official repair and source comparison

Primary explanation: https://www.sqlite.org/wal.html#walreset . Official repair release: https://www.sqlite.org/releaselog/3_51_3.html . SQLite lists the rare concurrent checkpoint/reset race, fix3.51.3 and backports3.44.6/3.50.7; uncommon tight timing means an ordinary bounded stress run cannot establish the repair's presence.

Exact official code repair: https://github.com/sqlite/sqlite/commit/fe57e14b49f9189b56da8233ab3415ce5ff6b1ff ; API source https://api.github.com/repos/sqlite/sqlite/commits/fe57e14b49f9189b56da8233ab3415ce5ff6b1ff . Fossil origin053bd3930f827156fd67ea4546a36227cffbb6f8bada3b5d1a7cf5f1867ac624. Saved `sqlite-wal-reset-fix-commit.json` and `sqlite-wal-reset-fix.patch`.

The official patch rechecks the live WAL header's `aSalt` against the checkpoint snapshot after locking read slot0, and skips backfill when a writer has reset the WAL. In the actual pinned fork's `walCheckpoint()` (`ffi-bundled-sqlite3.c:67568`), the path after `WAL_READ_LOCK(0)` (`ffi-walCheckpoint-excerpt.c:72`) instead assigns `nBackfillAttempted` immediately and later writes `nBackfill`; it contains no live-header salt recheck. The fork uses a reverse iterator and a callback extension but the relevant guard is absent. This traces a missing upstream guard in the shipped source, rather than declaring a fork vulnerable just because it says3.45.1.

This is an incorporation compatibility gate: resolve the shipped source/backport and actual supported multi-connection/checkpoint topology before adopting authoritative WAL session state. It is not a blanket corruption claim, a reproduction result, or authorization for a blind library upgrade. #1219's independently inventoried engine identity matches, so root should apply the same source/backport gate there.

Upstream issue https://github.com/tursodatabase/libsql/issues/2271 is open with no comments at capture (saved body/comments metadata). It is a reporter's observation and is not used as a substitute for the source comparison or a maintainer safety guarantee. Its body/comments metadata remain an omitted historical capture, with digests in `archive-omissions.json`.

## Local captured file digests

All digests below are SHA256. Registry/crate byte comparisons and native file identity are separate from cryptographic verification of attestation signatures.

| Captured artifact | SHA256 |
|---|---|
| `npm-libsql-0.5.29.json` | `c821330486ca30c6c453ab9507ec38a9a0497ad9bca7747876bdc8b1f508c4bc` |
| `npm-native-darwin-arm64-0.5.29.json` | `dd78c107a1f322f45235fc6daca930646322482ca57a154397c993e28b05580f` |
| `npm-js-attestation` | `3604c4a91ea8b100952e387c9455768d0cec21316bd07578e16edf3982df6f6a` |
| `npm-native-attestation` | `3497268016b4958298a3f3abb13f83cf08fed610280d6c54dae6f9ea9118b51c` |
| `js-Cargo.toml` | `cf729f40413e3131258e98579ab760b2e75238255cd56729ebb65b4f410ea953` |
| `js-Cargo.lock` | `897f93398893ce805b389b482ddf7555b75365a5f48a2e345703f21c1c58d74e` |
| `js-CI.yml` | `91cc674f65fbda17d2d6b3d0872a6e30bb6705273ce2fd6d89a50fc3f21d7b83` |
| `libsql-ffi-0.9.30.crate` | `0be1da6f123ceb2cd23f469883415cab9ee963286a85d61e22afb8b12e15e681` |
| `ffi-bundled-sqlite3.c` | `d9791dc493f043172d75c4fe6ef48307db6534c98f2106c843551ca5cbfa2912` |
| `ffi-walCheckpoint-excerpt.c` | `dbaa9229d6d1174184d81b086a571f8a6f5b13591414768df11d35ecdf839992` |
| `ffi-libsql-ffi-0.9.30--build.rs` | `452e349bbcfcc4367565352650341eea33a0a2492d90f4709ca4ce3a843cd2ed` |
| `ffi-libsql-ffi-0.9.30--.cargo_vcs_info.json` | `cf48a893f10eb872ff85a81632be926ad5b71f2be0f04e17205b1530263b8fde` |
| `native-darwin-arm64-0.5.29.tgz` | `c2f451572527ed9980485a427201a1d2bf95716d7c6d90a18a0dee00c72d925a` |
| `sqlite-wal-reset-fix-commit.json` | `d6f223be56edb054ae45821a2103f1392d7f5dcd5ebdf1b0dbaa58a4298d1cf5` |
| `sqlite-wal-reset-fix.patch` | `370b26f605c1497e47288cfe0b731f0d3e55e3ed153ceff79e034d6501ac5d2a` |
