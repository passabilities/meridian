# Nix runtime packaging — #1342 → #1357

Disposition: accept after final gates. Integration branch starts at current main
b68710f057a3bbdb4e01d650c0bd94b62247eea7. Source head
dd561af45c7b1c5135e1ae750b40892ea6c7ec05 remains open.

Authored commits by Connor Grady <connor.grady@gmail.com>:
b7c5eb49e8bddb5257178097ab9c1a99c63c1c7f →26e2dd4a5640c28f6841a19f9cd33ce6723313e0;
dd561af45c7b1c5135e1ae750b40892ea6c7ec05 →dd4bf666ec5fb06985329d3541b454e5cf0fbfcc.
Both2026-10-11 AuthorDates are preserved. The package.json conflict retains
main's additional isolated test groups while removing only nix:lock and bun2nix.
Main's npm lock repair and Home Manager environment quoting are retained.

Product fit: ship runtime dependencies without bundling build tooling; remove
the separate bun2nix toolchain while retaining pinned, reproducible dependency
inputs. No application behavior or public API changes are intended. All src/
blobs match the base. Native Linux ARM64 comparison confirms all dist/ files
are byte-identical except the CLI shebang, which Nix pins to Node22.23.3.

On the existing owned NixOS25.11/ARM64 VM, Nix2.31.5:
- Baseline package167,877,512 bytes; candidate53,236,632 bytes.
- Baseline closure800,158,024 bytes; candidate605,954,056 bytes.
- Candidate closure contains neither Bun nor the node_modules derivation;
  baseline retains bun-with-fake-node.
- Native build, locked Home Manager check, fixed-output dependency --rebuild
  and complete package --rebuild pass. No Docker image build/pull.

Original handles:2502 candidate build/home exit0;43013 dependency hash rebuild
exit0;32265 package rebuild exit0;8012 current-main baseline build exit0.
Candidate output:/nix/store/h9qgwh3knsc0xz86n1hdshxz26x1lx13-meridian-1.81.0.
Baseline output:/nix/store/30yclg023al615l4f3mfqv4fyyyn7m59-meridian-1.81.0.
Dependency outputHash remains sha256-kGWQhpGEQaldWLJXhUtuNAQD7JExzEaUSGK7Mcn0ThU=.

Actual installed native/SDK/production HTTP compatibility original87199 exit0:
10/10 cases pass, SDK0.2.141, Nix-selected Claude2.1.295, Node22.23.3.
Nine native actors, six production gates, all readable pipes, both listeners
and every observed socket joined. The exact harness and launcher are adjacent.
The harness is the committed e2e-haiku55-nix-compat.mjs with only the evidence
label changed from Docker to owned Linux network namespace. unshare --net
and loopback-only route/interface assertions fence all external traffic.
This is credentialless actual installed runtime qualification against a local
fake API, not provider/model acceptance. No real credentials or model calls.

Reproduction: archive the exact commit into an owned VM directory, then run
nix build --extra-experimental-features 'nix-command flakes' --no-update-lock-file
--no-link --print-out-paths path:<archive>#meridian path:<archive>#checks.aarch64-linux.home.
Repeat with --rebuild for #meridian.node_modules and #meridian. Run the adjacent
launcher through sudo unshare --net -- /bin/sh after replacing the output and
Node paths with the just-built outputs. Collect nix path-info --json --closure-size
and --recursive for each output. Never use real provider credentials for this gate.

Adversarial review checked dependency separation, current lock parity, module
rendering, libsql native loading, external SDK availability, wrapper/native
selection, fixed-output reproducibility, unchanged application bundles and
absence of build references in the runtime closure. No material finding remains.
Original99164 exited0 on frozen dd4bf666: clean npm ci, npm test (5752 pass /35 skip /0 fail across23 isolated groups), standalone typecheck and build pass.
Fresh macOS/Linux final-head CI remains a merge gate. Changes after tested
dd4bf666 are documentation/evidence only; production/config/test blobs match.
No release is authorized by this integration.
