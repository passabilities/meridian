#!/bin/sh
set -eu
ip link set lo up
export E2E_NIX_OUT=/nix/store/h9qgwh3knsc0xz86n1hdshxz26x1lx13-meridian-1.81.0
export E2E_OUTPUT_DIR=/tmp/meridian-nix1342-runtime-evidence-20261012
exec /nix/store/1nzpiv2idya913acb1wd1ydxvd2dw0pz-nodejs-22.23.3/bin/node /tmp/meridian-nix1342-runtime-20261012.mjs
