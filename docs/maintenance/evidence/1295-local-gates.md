# PR 1295 final local gates

Collected 2026-10-06 in the isolated worktree
`/Users/rynfar/repos/meridian-pr1295-publication-stall-20261006`.
Production/test HEAD stayed
`c8c9377b3181e453a01489b1e50345347d7904c0` throughout all gates, based on
`ca6a5c0a4eddb87da52d83993f8f9e105712f0f6`.

The existing isolated Bun **1.3.11** (`af24e281`) was selected through a
command-local PATH, matching repository `packageManager: bun@1.3.11`.
Exactly one `npm test` ran, followed serially by separate typecheck and build:

| Gate | Exit | Result |
| --- | ---: | --- |
| npm test | 0 | Pretest typecheck passed; **5,393 pass, 35 skip, 0 fail**, all 19 suite stages reached |
| npm run typecheck | 0 | Passed |
| npm run build | 0 | Passed, including bundled Node entrypoints |

The broad stage passed 5,048 tests with 35 skips and zero failures. Every
separate process also passed, including the final profile-credential and
header-settings stages. The session-store timing test passed in the original
full command: warm median 4.5 ms, maximum 5.6 ms, full-document median 18.1 ms.
No rerun, isolated completion run, baseline comparison, threshold edit or
source correction was needed. No benchmark import-graph equivalence with
baseline is claimed; this candidate changes lifecycle queue/operational-log
inputs.

All five changed source/test files were SHA256-hashed before and after and
remained byte-identical:

| File | Before/after SHA256 |
| --- | --- |
| src/__tests__/lifecycle-lock-queue.test.ts | c166020bd1e9beb1066b2f98e2cde02fd22881986385cafcfbe76f6e8089dbcb |
| src/__tests__/lifecycle-publication-degrade.test.ts | 7101bf9665e06fba09dc0712ccfcb9cbe5e408be6b8d006fa8614fa50223b27c |
| src/proxy/operationalLog.ts | 1d34ad91ab7d5d85544d699501a276bec671b1c816ec8e60598472936fc01354 |
| src/proxy/server.ts | e80eb55790554dcbf9403e46b60673b22bcba0cdefe9a59531e798c46035c631 |
| src/proxy/session/lifecycleLockQueue.ts | 8bb032057b0f8b1e9381efa6146f67bc92fc6a30ea53f1f7d30f47129314f1de |

There was no concurrent HEAD advance. Another owner prepared only the
untracked standalone `scripts/e2e-publication-lock-fallback.mjs` during these
gates; this task did not edit or execute it. This receipt is a new document
prepared after the gate run.

Ordinary first-run logs, exact commands, stage counts and input receipts are
retained in
`/Users/rynfar/repos/meridian-review-evidence-20261006/pr1295-local-gates`:
`npm-test-first.log`, `typecheck-first.log`, `build-first.log`,
`source-test-before.txt`, `source-test-after.txt`, and
`local-gates-outcome.txt`.
Each gate used the command prefix:

```sh
env PATH="/Users/rynfar/repos/meridian-review-evidence-20261006/pr1290/tooling/bun-1.3.11/package/bin:$PATH"
```

This task ran only the required normal mocked unit/integration suite and
build. It added no live SDK/CLI/client/model/auth/package/Docker/GitHub flows,
accessed no private paths, and changed no dependencies or production/tests.
The dirty root checkout and all PR 1290 receipts were preserved. Affected-flow
E2E, independent review and remote final-head CI remain separate root-owned
gates; this receipt supplies no merge or release acceptance verdict.
