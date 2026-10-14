# Nix packaging

Paths are relative to repository root. Read before changing `flake.nix`,
anything under `nix/`, or the dependencies in `package.json` and `bun.lock`.

## Layout

Each package lives in `nix/pkgs/<name>/`, with its entry point in
`package.nix` and every file specific to it beside it: `nix/pkgs/meridian/`
for meridian, whose `package.nix` calls `node_modules.nix` for its dependency
trees, and `nix/pkgs/meridian-plugin/` for the scrub plugins.

A module, its test and its check share one name: the flake output that exports
the module, without the `Modules` suffix. `homeModules` is backed by
`nix/modules/home.nix`, tested by `nix/tests/home.nix` and checked as
`checks.<system>.home`.

A file references only files in its own directory or below by relative path.
Anything else in the repository is reached through the flake's `self`, which
`flake.nix` passes in, such as `"${self}/package.json"`, never through `../`.

## Dependencies come from nixpkgs

Every `package.nix` is a plain `callPackage` function whose dependencies are
nixpkgs attributes. Do not add a flake input to supply a build tool, and do not
extend `pkgs` with another flake's overlay to reach one. If nixpkgs lacks a
tool, do the work with what nixpkgs has. This is why meridian does not use
bun2nix: its builders are bound to the package set bun2nix's own flake
evaluates, which is not the one the package is called with.

## node_modules is a fixed-output derivation

`node_modules.nix` runs `bun install --frozen-lockfile` with network access and
pins the result by `outputHash`, the way nixpkgs packages bun projects
(`opencode`, `hunk`, `kilo`).

- It takes the package's own `src`. Its store path depends only on its name
  and `outputHash`, so it is fetched again only when the hash changes.
- It passes `--cpu='*' --os='*'`, so the tree, and its hash, is the same on
  every system. Never introduce per-system hashes.
- It keeps the hoisted linker. The isolated linker hides libsql's optional
  platform package from the bundled CLI, which then fails on first import.
- It keeps `dontFixup`. A fixed-output derivation must not reference the
  store, and fixup's patchShebangs would make it.
- It drops the npm-vendored Claude Code CLI and the SDK's per-platform
  binaries. Meridian runs nixpkgs' `claude-code` through `MERIDIAN_CLAUDE_PATH`,
  so those are never executed.

Any change to `bun.lock`, or to the dependency sections of `package.json`,
changes the hash. Update it in the same commit:

```sh
nix run --inputs-from . nixpkgs#nix-update -- --flake --version=skip --subpackage node_modules meridian
```

A stale hash goes unnoticed wherever the old output is already in the store.
The `Nix node_modules hash` workflow recomputes it from scratch and fails the
PR, and its macOS build leg refetches the tree to prove the hash holds there.

## Build-time and run-time dependencies stay separate

The fixed-output derivation holds two trees installed from the one lockfile:

- `build/` has dependencies and devDependencies. It is copied into the build
  directory for `bun run build` and never reaches `$out`.
- `runtime/` has dependencies only (`--production`). It is the only tree
  installed into `$out`.

The split is `package.json`'s own. A package the bundled `dist/` loads at run
time (a `--external` in `scripts/build.ts`, or a dynamic `require` such as
libsql's platform package) belongs in `dependencies`. A package only the build
needs belongs in `devDependencies`. Moving a package between the two is how to
change what ships; never copy individual packages from the build tree.

- `prune-foreign-platforms.mjs` removes other platforms' optional packages from
  the shipped tree, using the `os` and `cpu` fields of each `package.json`.
- The derivation sets `strictDeps`. A tool the build runs goes in
  `nativeBuildInputs`. What the output runs goes in `buildInputs`, which is
  what fixup resolves the shipped `#!/usr/bin/env node` lines against.

After a change, check the run-time closure. It must contain neither `bun` nor
the `node_modules` derivation:

```sh
nix path-info --recursive "$(nix build --no-link --print-out-paths .#meridian)"
```
