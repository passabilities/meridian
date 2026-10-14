#!/bin/sh
set -eu
exec > /artifacts/build.log 2>&1
export NIX_CONFIG='experimental-features = nix-command flakes
accept-flake-config = false
substituters = https://cache.nixos.org
max-jobs = 2
cores = 2
sandbox = true
connect-timeout = 30
stalled-download-timeout = 120'
finish() { code=$?; printf '%s\n' "$code" > /artifacts/build.exit; date -u +%FT%TZ > /artifacts/build.finished; }
trap finish EXIT
nix --version
uname -a
df -h /nix/store
nix eval --no-update-lock-file --raw path:/source#packages.aarch64-linux.meridian.drvPath > /artifacts/drvPath
nix eval --no-update-lock-file --raw path:/source#packages.aarch64-linux.meridian.outPath > /artifacts/outPath
nix build --no-update-lock-file --no-link --json -L path:/source#packages.aarch64-linux.meridian > /artifacts/build-result.json
out=$(cat /artifacts/outPath)
nix path-info --json --recursive "$out" > /artifacts/closure.json
nix derivation show "$(cat /artifacts/drvPath)" > /artifacts/derivation.json
printf 'BUILD_COMPLETE\n'
df -h /nix/store
