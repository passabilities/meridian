# OpenCode trailing-system checkpoint review — 2026-10-12

Accept with harness correction, pending live and full final acceptance. Source #1301 `05e2381fa53a6fc6e0aca8992d3825c4c873b7c1` was cherry-picked onto main `736e9fd61` as `e836a81a9`, preserving Aleksey Proshutinskiy and original AuthorDate.

Fits the existing checkpoint contract: complete exact-ID echo, unchanged stored history prefix, settled results and one trailing nonblank text system turn. Reminder stays user-level SDK content. Crush remains a proved armed-checkpoint negative control. Existing server adapter selection is extended without a new public interface or dependency.

Original targeted process 43236 exited 0: 202 tests pass, zero failures, 1,402 assertions and separate typecheck. Defect-present control process 52565 removed only the OpenCode opt-in, with source restored in finally: 132 pass, exactly five expected OpenCode resume cases fail. This establishes the tests discriminate the change. Build process 41646 exited 0.

Maintainer correction: contributor HTTP gate previously imitated OpenCode headers without loading its required client/server plugins. It now resolves the installed V2 package, executes its HTTP hook in an explicitly simulated stable host, verifies canonical session/primary identity, verifies active server scrub before inference and invocation/error counts after requests, and disposes hooks. Credentialless built-plugin preflight passed with one invocation, zero errors; missing-plugin control failed before server/model startup. No actual OpenCode executable or model inference ran in these checks.

Remaining: actual OpenCode 2.0.21 instruction-change before/after, exact model/SDK identities, source and independently installed qualification, E41 four modes and relevant E42 matrix, complete final local/CI gates, adversarial final review. The legacy direct harness still asserts model answer wording and prints prompts; do not treat it as sufficient final evidence or run against customer history. Use only owned fixture values and sanitized durable receipts. No merge, source closure or release.
