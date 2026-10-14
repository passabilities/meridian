# Installed Nix Haiku 5.5 credentialless qualification — 2026-10-11

**Bounded result: PASS, not feature/release acceptance.** The exact committed
archive `34bcb02820c69fc8c3932c5974dbb457b53eb76d` actually built and executed
on Linux ARM64. The Nix-selected Claude Code **2.1.295**, native Node
**22.23.3**, and installed Agent SDK **0.2.141** successfully exercised
Meridian's installed HTTP implementation and original production SDK process
gate against an owned, scripted Anthropic loopback server.

This is **not** real Haiku inference, actual Pi/OpenCode execution, Nix macOS
SDK execution, auth/account readiness, registry installation, or publication
acceptance. No credentials, credential refresh, alternate accounts, paid usage,
provider calls, release operations, or external comments were used. The default
HTTP adapter's telemetry label is `opencode`; that is not an actual OpenCode
client run and does not claim plugin/client qualification.

## Source, build and executable custody

- Base: `e68b9bcadd7597d16724a3655b7322cd02a965ad`; draft PR #1337.
- `git archive` of the exact SHA, not a dirty checkout, Git directory or owner
  HOME. Archive SHA-256:
  `2e613f740aa07f6ad2944b2afb2510c7cbb6e338f73364fa428e260059a53f5b`.
- [Source manifest](source-manifest.json) records all archive file hashes and
  executable bits. Archive and actual derivation source have identical NAR hash:
  `sha256-J8Aobc/KJydqjZwHgc7MiZnudEpaPrgKrro0j7/gh4Q=`.
- Actual build source: `/nix/store/c4xn5mfwxwr1py6gy62ixrx7mlkm3vla-source`.
- **Actual** drvPath:
  `/nix/store/i3dmzwz0myg0b9cxkk0bm8xif76420gw-meridian-1.80.0.drv`.
- **Actual** outPath:
  `/nix/store/hqps475ckwynap87p9g62ij784qq9d8d-meridian-1.80.0`.
- These are identities of the exact archive actually built, not old diagnostic
  scratch identities. [Derivation](derivation.json), [build result](build-result.json)
  and [closure/NAR identities](closure.json) are retained. The normal archive
  build reports unavailable local Git provenance; no build/hash guard was bypassed.
- The committed lock stayed unchanged; nixpkgs is
  `6510408d147d8c5e6d76043e899e9251756f6a75`. Nix 2.35.2 built with
  `--no-update-lock-file`, public `cache.nixos.org` only, and no cache/GitHub
  credentials. [Build log](build.log.gz): exit 0, 16:56:21–16:58:28 UTC (127 seconds).
- A **new owned** Docker container, `meridian-haiku55-nix-installed-20261011`,
  used the requested immutable `nixos/nix` image digest, 2 CPUs, 4 GiB RAM/swap
  limit and 256-process limit. No existing container/baseline was reused or touched.
  Only read-only archived source/build-script and writable owned artifacts were
  bound. Docker filesystem free space was 69 GiB before and 62 GiB after;
  there was no host Nix installation, prune or removal of others' artifacts.
- The installed [wrapper](meridian-wrapper.sh.gz) was executed with no
  `MERIDIAN_CLAUDE_PATH` override. A minimal native-Node preload witnessed its
  **default** selection and runtime, then normal `meridian --version` completed.
  Qualification used that observed selection, never an npm CLI substitute:
  `/nix/store/s1jz9vfr84mwya1mkr70dib6j89zml32-claude-code-2.1.295/bin/claude`.
- Both actual version probes exited 0 and closed their original captured pipes.
  The installed package contained no removed bundled CLI/SDK native packages.
  Every generation gate also witnessed `/proc/<owned-child>/exe` resolve to the
  same package's `bin/.claude-wrapped`, ELF SHA-256
  `8d3953900b354f7d4e990d2ce23dee16e91b71c9349def592d916f9e118223df`.
- The new [harness](../../../../scripts/e2e-haiku55-nix-compat.mjs) lives outside
  the archived product source. No core, lock, package or existing harness was
  edited. SDK and server are loaded from the actual installed output; no copied
  source helpers, SDK internals, model-response interception or process facade
  substitution were used.

## Qualified assertions

[Final run](run-6.json), [sanitized log](run-6.log.gz), [summary](summary.json):
**10/10 cases pass**, comprising six actual SDK/native generations and four
pre-query refusals:

1. Bare `haiku` resolves to `claude-haiku-5-5` through installed HTTP JSON and SSE.
2. Explicit 5.5 and alias manual thinking with **SDK-supported `budgetTokens=2048`**
   arrive on the native wire as `adaptive`, with no `budget_tokens`.
3. Explicit adaptive/summarized display and medium/high effort remain on the wire.
4. Explicit dated Haiku 4.5 remains 4.5, with `enabled` thinking and budget 2048.
5. 5.5 disabled and alias adaptive/omitted controls return clear 400s for both
   JSON/SSE requests, with **no generation request and no production SDK gate**.

Each successful case has its own receipt and a fresh, distinct public SDK session;
installed HTTP materialization and supported SDK history agree on that case's
receipt and model. The fake provider independently rejects Haiku 5.5 manual
thinking with a 400, so an unconverted native request cannot pass accidentally.
This establishes scripted native compatibility, not provider service support.

Before executing any SDK generation, the owned container was disconnected from
**all** Docker networks. The final run records only `lo`/127.0.0.1/::1 and an empty
IPv4 route table; Docker network receipts also show `{}` before/after execution.
Descendants remain in that same network namespace. The entire inherited environment
is cleared, isolated HOME/config/state is established before imports, and the sole
API key is a literal dummy fixture key. This is Docker network isolation, **not**
macOS `sandbox-exec` qualification.

## Preserved failed attempts and limitation

- [Run 1](run-1.json): minimal Nix image had no machine ID, so production correctly
  refused session startup. A fresh random **task-owned** machine ID was installed
  in only the new container; no missing-boot-identity bypass was enabled.
- [Run 2](run-2.json): the fixture mistakenly compared the raw route against
  `/v1/messages`, rejecting legitimate `?beta=true`. The sanitized PATH also
  omitted real coreutils `sleep`, causing production gate warnings. The fixture
  now validates pathname/query separately and includes the container's real
  coreutils directory. Product/package/gate code remained unchanged.
- [Run 3](run-3.json): five 5.5 generations and all guards passed, but an extra
  assumption that legacy `budget_tokens=2048` would preserve 2048 failed: the wire
  used the native default 31999. [Unchanged base/head source evidence](legacy-budget-source-evidence.json)
  shows the existing HTTP builder forwards thinking without translating snake-case
  `budget_tokens` to SDK `budgetTokens`. **Snake-case legacy budget preservation
  is not qualified.** This task did not fix that adjacent pre-existing limitation;
  parent review must retain it rather than imply broad HTTP contract acceptance.
- [Run 4](run-4.json) passed the original matrix after choosing the existing
  supported legacy `budgetTokens` control. [Run 5](run-5.json) added detection of
  otherwise unwitnessed synchronous subprocesses and again passed.
- Final self-review strengthened both 5.5 manual cases to use `budgetTokens` too,
  ensuring the explicit SDK budget was actually exercised before native adaptive
  conversion. [Run 6](run-6.json) reran all unchanged behavior assertions with
  that stronger input and the sync detector. Earlier passes are not substituted
  for the final harness run. All distinct executed harness hashes/copies are retained.

## Physical cleanup and self-review

The native-Node observer retains the **original ChildProcess objects**, not PID-only
handles or the SDK facade. All nine actors (two explicit versions, one production
readiness version, six production SDK gates) exit 0, emit original `close`, and
close both captured output pipes. Each gate has published-command and actual
native-exec witnesses. No synchronous subprocesses or timeout escalations occurred.
The installed proxy and fake-provider listener close, all nine owned HTTP sockets
close, and active fixture handlers reach zero. `exitCode` alone is never a join.

On missing joins, the harness records failure and retains fixtures/container;
TERM/KILL escalation uses only its retained original child handles. It never kills
bare PIDs or deletes fixtures. The final external process snapshot shows only idle
PID1 `sleep`. Only then was the owned container stopped and retained, not removed.
Docker's 5-second stop of that idle PID1 produces exit 137; this is **not** an SDK
actor failure or missing native join. A subsequent final-harness refinement restarted
only this task-owned, still-disconnected container, then repeated the same checks
before its final stop. Existing containers and baseline scratch were not affected.

Self-review checked non-vacuous actor witnesses, process facade versus physical
join, retained failure reports, independent 400 negative control, fresh session/
per-case receipt discrimination, loopback route/resource bounds, environment
custody, actual installed external SDK resolution, original exec/spawn coverage
(including sync detection), native binary identity, and source NAR equality.
[Parent independent R5 review](PARENT_REVIEW.md) cleared the bounded evidence,
with narrower HTTP/observer/budget limitations retained. During final staging,
the verbatim Nix-generated wrapper's trailing space failed committed whitespace
validation. Its original bytes are now compressed, not trimmed: decoded SHA-256
`3da72c9c7d0999f90f4996d9e6eaa390e95fa8622315ce8b911708360afcd661`.
The original reviewed [manifest](artifact-manifest-r5.json.gz) and
[README](README-r5.md.gz) remain byte-preserved; the current artifact manifest
indexes the compressed wrapper and updated explanatory README. The repository
ignores raw `*.log` files, so all sixteen build/run/custody logs are also retained
as byte-exact `.log.gz` files; their decoded hashes/sizes preserve every original
reviewed manifest identity. Decode compressed entries to verify the historical
manifest. This is an escrow-format correction, not a rebuild, rerun or changed
executable. Final staging verifies every indexed artifact is actually in Git,
not merely present in an ignored working-tree path.

## Reproduction and holds

Use a fresh owned directory/container. Reconstruct the exact SHA with `git archive`,
extract to a read-only `/source` mount, and mount [build.sh](build.sh) outside it.
Use the immutable image/resource configuration in [summary.json](summary.json),
no secret environment, and only public build dependencies. Execute `sh /build.sh`;
bound any unfinished build to 30 minutes and retain logs/status without waiving it.
After build, generate a random container-only `/etc/machine-id` if absent; do not
use an owner's identity or `MERIDIAN_ALLOW_MISSING_BOOT_IDENTITY`.

Copy the repository harness to writable owned `/artifacts`, disconnect every
container network, and run (paths are this exact closure's actual identities):

```sh
docker exec meridian-haiku55-nix-installed-20261011 env \
  E2E_NIX_OUT=/nix/store/hqps475ckwynap87p9g62ij784qq9d8d-meridian-1.80.0 \
  E2E_OUTPUT_DIR=/artifacts/fresh-run \
  /nix/store/1nzpiv2idya913acb1wd1ydxvd2dw0pz-nodejs-22.23.3/bin/node \
  /artifacts/e2e-haiku55-nix-compat.mjs
```

The output directory must be fresh. For another independently rebuilt closure,
select its actual outPath and the actual Node executable in its wrapper, not an
npm/default host binary. Preserve original actors/listeners/sockets/handlers before
stopping the new container. Do not reuse the unrelated verification container.

**Holds remain:** actual authorized Haiku/Pi provider flow, actual independent
installed-package provider flow, Nix macOS installed-native/SDK execution, parent
review, registry/provenance/tag/publication/fresh-install/Docker release evidence.
This credentialless result neither consumes nor overrides account quota and does
not authorize another provider attempt. No commit, push, PR comment, merge, tag,
`npm version`, publication, or modifications to the owner's root checkout occurred.
