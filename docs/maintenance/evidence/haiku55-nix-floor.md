# Haiku 5.5 Nix floor correction

Status: independent static review passed; exact-new-head CI remains pending.
Haiku real-model/client acceptance and release remain held. This is not a Nix build or model receipt.

## Exact-head CI failure

Draft #1337 head `cb42827e55f1fba0694b74835b323b8398563f31`, base
`e68b9bcadd7597d16724a3655b7322cd02a965ad`, refreshed 2026-10-11:

- `test`, smoke, Windows smoke, verification, desktop builds, and Docker build
  succeeded.
- Nix `check` and package builds on Ubuntu and macOS failed.
- Package evaluation marks Meridian broken when its effective native CLI is
  older than the `package.json` floor. Existing nixpkgs revision `3ed67ec...`
  plus the immutable 2.1.284 fallback manifest cannot satisfy 2.1.293.
- CI's diagnostic update to nixpkgs `6510408...` satisfies the floor and explicitly
  requests including the generated lock change. No retry was used to mask this.
- FlakeHub cache authentication warnings are not the package-evaluation cause.

Durable CI references:

- <https://github.com/rynfar/meridian/actions/runs/38139246977/job/114469489704>
- <https://github.com/rynfar/meridian/actions/runs/38139246994/job/114469489896>
- <https://github.com/rynfar/meridian/actions/runs/38139246994/job/114469489990>

## Generated correction and qualification

A secret-free owned Linux ARM64 container used Nix **2.35.2** with image digest
`nixos/nix@sha256:7a007c766426c1877758ddc5cb87a965ac131fc78c582ce0083d922d51ae945c`.
The mounted source was `git archive` of the exact pushed head, not the dirty
user checkout or any SQLite work. No credentials, owner HOME, or model access.

The same verification script:

1. Requires old-lock x86-64 Linux package evaluation to fail.
2. Runs the real `nix flake update nixpkgs`.
3. Evaluates package derivations for x86-64 Linux, ARM64 Linux, and ARM64 Darwin.
4. Evaluates the x86-64 Linux Home Manager check derivation.

All after evaluations pass; the original owned container exits 0. This evaluates
Darwin output on Linux—it is **not** execution or build qualification on macOS.
The qualification scratch tree also contains its `before-eval.log`; reported
derivation paths are diagnostic identities, not exact committed-final-source
artifact identities. Final-head CI must qualify the actual package build.

The generated lock changes **only** nixpkgs `lastModified`, `narHash`, and `rev`:

- Revision: `6510408d147d8c5e6d76043e899e9251756f6a75`
- Hash: `sha256-XK4KceonkwD8LuMAt/vNrz982mXJM5jeHAxMwsUXXAQ=`
- Timestamp: `1791594108` (2026-10-10)

All other lock inputs, the CLI floor, native release manifest, package build and
wrapper definitions, and CI enforcement stay unchanged. No `allowBroken`, check
bypass, manual version/tag/npm publication, or unapproved model/account retry.

## Remaining acceptance

- Independent Pi / GPT-6.1-Sol high-reasoning round 4 found no material defect
  in the generated lock-only correction. Static clearance does not waive gates.
- The effective package-set change also affects Bun, Node 22, stdenv, wrappers,
  and followed tooling despite only three lock fields changing. Exact-new-head
  Linux/macOS package builds and Home Manager rendering checks must pass;
  evaluation alone is not build.
- Record and execute the Nix-selected native CLI version and verify retained SDK
  launch compatibility. The npm-qualified 2.1.296 binary is not automatically
  evidence for a different Nix-selected executable. Installed binary checks
  remain required.
- A successful actual Haiku 5.5 turn through the corrected native-Node Pi harness,
  read receipt, public SDK model history, original SDK gate and both pipe closures
  remain missing.
- Independent installed-package actual affected model flow remains missing.
- Release Please, tag, registry/provenance, fresh registry install and Docker
  release verification have not started. Draft remains held.
