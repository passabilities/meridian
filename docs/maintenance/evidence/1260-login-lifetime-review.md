# PR 1260 bounded review — 2026-10-04

Disposition: **defer pending a new owner API decision; if approved, accept only with maintainer corrections and affected-flow proof**. The per-account renewal deadline is useful for Meridian's account-management product; the current source has material persistence and state-reporting defects.

Source: https://github.com/rynfar/meridian/pull/1260, exact head `99b8f0c46fbf8ce0b7f28cb14d2bdce4929948ef`, main/PR base at initial assessment `f299fe06e72411b786380b5212edea79cd13966a`. One commit, Author `Nowaker <spam@nowaker.net>`, AuthorDate `2026-10-03T19:11:08-05:00`; no reviews, inline comments or issue comments. Six executed source-head CI checks passed, including https://github.com/rynfar/meridian/actions/runs/37189270719/job/111397859092. Source CI does not validate an incorporation/correction head.

Detached read-only source worktree: `/Users/rynfar/repos/meridian-review-1260-20261004`. No source edits, model calls, native-store access, browser automation, comments, PR edits, integration, closure or release. `node_modules` is a read-only symlink to the existing checkout's dependency directory. The user's dirty main checkout and earlier worktrees were not changed.

## Contract and product scope

The source adds nine fields to the stable `GET /profiles/list` response: `refreshTokenExpiresAt`, `daysUntilRenewal`, `renewalRequiredSoon`, `accessTokenExpiresAt`, `authObtainedAt`, `authObtainedVia`, `lastRefreshAt`, `firstUnauthedAt`, `unauthedReason`. It introduces persistent `auth-lifecycle.json` and diagnostic category `auth`, plus browser/CLI login recording and shared UI facts. It retains API/setup-token isolation introduced in #1258. No model request, SDK session or lineage behavior is changed.

Owner issue #1215 authorizes authenticated browser start/status/completion and existing profile API preservation; it does not authorize these new response fields or persistent auth-history semantics. #1258 is an internal credential-isolation fix preserving existing interfaces. A new issue and owner decision are required under `.agents/references/api-contract.md`; general backlog authorization does not resolve that contract decision. Agree on whether `firstUnauthedAt` records refresh rejection or loss of usable authentication before approving the field semantics.

## Material findings, reproduced against exact source

1. **P2 — concurrent history writers lose accepted transitions.** `src/proxy/authLifecycle.ts:393` reads the whole map, mutates it, and writes by rename at `:362`; `renameAuthLifecycleKey` at `:440` uses the same unprotected sequence. Atomic rename prevents half-file reads, not stale read/modify/write loss. A deterministic two-process control pauses writer A after its read, lets writer B persist a different credential login, then releases A. Both exit 0; final keys contain only A's record. This contradicts support for server and `meridian profile login` writers and can erase the newly established login/last-logout history. Use serialized writers or transactional updates with a non-destructive failed-read policy; verify simultaneous distinct-key and same-key login/logout controls, rename, interrupted writes, and native-store observation races.

2. **P2 — every HTTP 400/401 becomes a logout.** `src/proxy/tokenRefresh.ts:418` treats status alone as grant rejection. A standards-valid `400 {"error":"invalid_request"}` records `firstUnauthedAt` and `refresh_rejected` on a healthy credential. OAuth error status does not establish revoked/expired grant: [RFC 6749 section 5.2](https://www.rfc-editor.org/rfc/rfc6749#section-5.2) distinguishes malformed request/client errors from `invalid_grant`. Use explicit grant-invalid evidence and retain non-grant failure/unknown negative controls.

3. **P2 — an unreadable rotation check is treated as unchanged credentials.** `src/proxy/tokenRefresh.ts:546` folds store rejection/null into undefined token, then `:552` records logout after 750 ms. A controlled store returns the original credential before refresh, then null on both post-refusal reads; the source incorrectly records `refresh_rejected`. This violates its own three-state unknown-store rule. Require a successfully read matching grant before marking rejection; unknown must remain unknown. The 750 ms delay also cannot establish cross-process write completion; preserve a delayed-write/rotation control.

4. **P2 — an external re-login with a nearer deadline keeps stale grant state.** `src/proxy/authLifecycle.ts:189` recognizes only a deadline increase of at least one hour as a new grant; `:199` labels nearer/small deadline changes `deadline_moved`. A replacement valid login with a 28-day deadline after a prior 29-day deadline retains the prior `authObtainedAt` and `refresh_rejected` marker. This scenario is compatible with the contributor's observed 27.5–29.5 day variability. An external login may also omit a deadline, and rotation changes a refresh token without changing its original grant, so timestamps alone cannot reliably identify a new grant. Preserve uncertainty rather than asserting an old login age/logout for the replacement. Add earlier, equal, small-forward and absent-deadline replacement controls.

5. **P2 — still-serving accounts are displayed as logged out.** `src/telemetry/profileFacts.ts:45` gives `firstUnauthedAt` precedence over expiry/access facts. The source deliberately marks refusal while its access token may still work (`authLifecycle.ts:278`). The shared builder produces `Status: ✓ Authenticated` and `Logged out: 0m ago` simultaneously and removes the `stops in 3h` countdown. Distinguish inability to refresh from exhausted/cleared access; preserve the usable-token countdown and a truthful status. This needs actual profile/landing browser proof, including narrow/wide views.

6. **P3 — re-login keeps an earlier grant's last-refresh timestamp.** `applyLogin` at `authLifecycle.ts:210` spreads the previous record without clearing `lastRefreshAt`. The control proves a newly completed login retains a refresh time from an hour before its `authObtainedAt`; the tooltip presents it as the current token's last renewal. Clear grant-specific state when recording a new login (or explicitly scope it as credential-wide history).

Additional UI gap: landing `infoIcon` at `src/telemetry/landing.ts:343` drops `f.title`, so the newly promised logout reason/observed-time qualification does not appear in the home overlay. The Profiles renderer preserves it. This is an existing renderer limitation exposed by the new facts and should be corrected as part of the UI proof.

## What was checked without a finding

All 14 changed files and neighboring callers were inspected. Dependencies remain downward: `authLifecycle.ts` imports only config/fs/path and no server/session modules. Plan reads, credential-presence override, and all lifetime reads are gated to stored `claude-max` profiles; explicit API/setup-token profiles do not consult unrelated native stores. Lifetime persistence contains timestamps, bounded events and credential-store identities, no OAuth values; writes create private 0600 temporary files and replace atomically. New semantic colors use shared `--yellow` and existing shared facts/header composition. Existing API/profile fields are not removed. No SDK/client model behavior changed directly.

## Local review checks

- `bun test --timeout 30000 src/__tests__/auth-lifecycle.test.ts src/__tests__/profile-facts.test.ts src/__tests__/token-refresh.test.ts`: 128 pass / 0 fail.
- `bun test --timeout 30000 src/__tests__/profile-credential-isolation.test.ts`: 8 pass / 0 fail; actual HTTP, mocked native/auth/SDK boundaries.
- `bun test --timeout 30000 src/__tests__/profiles-list-login-lifetime.test.ts`: 0 pass / 2 platform skips on macOS.
- `npm run typecheck`: exit 0.
- `git diff --check HEAD^ HEAD`: exit 0; detached source worktree stays clean.
- `bun /tmp/meridian-backlog-20261004/meridian/1260/review-controls.mjs`: expected defective source behavior reproduced, no actual OAuth/SDK/model requests. Runnable script and sanitized results are beside this report. Zero exit means the review completed, **not** acceptance or fix proof.

## Remaining acceptance evidence

No source incorporation is approved. After contract decision and corrections, preserve authored cherry-pick/source-to-delivery mapping, add direct regressions including interprocess fault controls, run final npm test/typecheck/build, and obtain required final-head CI. Use actual owned native Linux credential files and macOS Keychain, real OAuth new-login and re-authentication, normal refresh, refusal/rotation/unknown controls, plus the actual implicated supported-client/model flow. Existing `E2E.md` browser/login and credential-isolation harnesses provide the boundaries; keep credentials/codes/URLs private. The contributor reports production deadline reads on Linux/macOS, but explicitly has performed neither a post-deploy login nor a post-deploy logout. That is not proof of the changed login/deadline-write/logout paths. The unconditional never-extends deadline wording is based on that contributor fleet measurement, not a documented Anthropic universal contract; present expiry as provider-reported evidence and preserve deadline-change controls. Root owns shared preview. The exact sanitized harness and result are escrowed below in this durable review record. Before acceptance, a maintained repository regression/fault harness and final before/after proof remain required.


## Escrowed credentialless review harness

Review runtime: macOS arm64, Bun 1.3.14. Save the following JavaScript block to a local `review-controls.mjs`, then run it against the exact source checkout with installed dependencies:

```sh
E2E_SOURCE_ROOT=/absolute/path/to/source-at-99b8f0c4 bun review-controls.mjs
```

The script isolates Meridian configuration, mocks only the OAuth endpoint and a worker's filesystem read rendezvous, uses synthetic credentials and never starts a proxy or accesses native grants. It emits observations of defective behavior rather than claiming a pass. The race starts two independent processes and controls their real lifecycle-file interleaving; both production update calls must complete. For acceptance, turn each `true` defect predicate into a required `false` assertion, require both final race keys, and compare the same assertions before/after without changing the fixture.

```javascript
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const repo = process.env.E2E_SOURCE_ROOT || '/Users/rynfar/repos/meridian-review-1260-20261004';
const root = mkdtempSync(join(tmpdir(), 'meridian-1260-controls-'));
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MERIDIAN_') || key.startsWith('CLAUDE_PROXY_')) delete process.env[key];
}
process.env.MERIDIAN_CONFIG_DIR = root;
const lifecycle = await import(repo + '/src/proxy/authLifecycle.ts');
const refresh = await import(repo + '/src/proxy/tokenRefresh.ts');
const { profileFactsJs } = await import(repo + '/src/telemetry/profileFacts.ts');
const facts = new Function(profileFactsJs + '\nreturn profileFacts;')();
const HOUR = 3600000, DAY = 24 * HOUR, now = Date.now();
const summary = {};
let old = lifecycle.applyLogin(undefined, { at: now - DAY, refreshTokenExpiresAt: now + 29 * DAY }).record;
old = lifecycle.applyRefreshSucceeded(old, { at: now - HOUR, refreshTokenExpiresAt: now + 29 * DAY }).record;
const relogin = lifecycle.applyLogin(old, { at: now, refreshTokenExpiresAt: now + 28 * DAY }).record;
summary.explicitRelogin = { authObtainedAt: relogin.authObtainedAt, lastRefreshAt: relogin.lastRefreshAt, retainedPriorRefresh: relogin.lastRefreshAt === old.lastRefreshAt };
old = lifecycle.applyRefreshRejected(old, { at: now - 1000, detail: 'invalid_grant' }).record;
const replaced = lifecycle.applyObservation(old, { at: now, presence: 'present', refreshTokenExpiresAt: now + 28 * DAY }).record;
summary.externallyReplacedGrant = { authObtainedAt: replaced.authObtainedAt, firstUnauthedAt: replaced.firstUnauthedAt, latestEventKind: replaced.events.at(-1)?.kind, remainsLoggedOut: Boolean(replaced.firstUnauthedAt) };
const ui = facts({ loggedIn: true, ...old, accessTokenExpiresAt: now + 3 * HOUR });
summary.servingAfterRefreshRefusal = { accessExpiresInHours: 3, facts: ui.map(({label,value,tone}) => ({label,value,tone})), hidesServingCountdown: !ui.some(f => f.value.includes('stops in')) };
const store = { refreshKey: 'review:invalid-request', async read() { return { claudeAiOauth: { accessToken: 'synthetic', refreshToken: 'synthetic-refresh', expiresAt: now + HOUR, refreshTokenExpiresAt: now + 29 * DAY } }; }, async write() { throw new Error('No write expected'); } };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 });
await refresh.refreshOAuthToken(store);
globalThis.fetch = originalFetch;
summary.nonGrantOAuthFailure = { oauthError: 'invalid_request', firstUnauthedAt: lifecycle.authLifecycleFor(store.refreshKey)?.firstUnauthedAt, recordedAsLogout: Boolean(lifecycle.authLifecycleFor(store.refreshKey)?.firstUnauthedAt) };
const key = 'review:store-unreadable';
const unreadableStore = { ...store, refreshKey: key, async read() { this.reads = (this.reads ?? 0) + 1; return this.reads === 1 ? await store.read() : null; } };
globalThis.fetch = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
await refresh.refreshOAuthToken(unreadableStore);
globalThis.fetch = originalFetch;
summary.unreadableRotationCheck = { firstUnauthedAt: lifecycle.authLifecycleFor(key)?.firstUnauthedAt, recordedAsLogout: Boolean(lifecycle.authLifecycleFor(key)?.firstUnauthedAt) };
const worker = join(root, 'race-worker.mjs');
writeFileSync(join(root, 'auth-lifecycle.json'), '{}');
writeFileSync(worker, `import { mock } from 'bun:test';\nimport * as fs from 'node:fs';\nconst read = fs.readFileSync;\nconst root = process.env.MERIDIAN_CONFIG_DIR;\nmock.module('node:fs', () => ({ ...fs, readFileSync(file, ...rest) { const bytes = read(file, ...rest); if (process.env.RACE_WAIT === '1' && String(file).endsWith('auth-lifecycle.json')) { fs.writeFileSync(root + '/ready', ''); const deadline = Date.now() + 10000; const scratch = new Int32Array(new SharedArrayBuffer(4)); while (!fs.existsSync(root + '/release') && Date.now() < deadline) Atomics.wait(scratch, 0, 0, 20); if (!fs.existsSync(root + '/release')) throw new Error('race rendezvous timeout'); } return bytes; } }));\nconst { noteAuthLogin } = await import(${JSON.stringify(repo + '/src/proxy/authLifecycle.ts')});\nnoteAuthLogin(process.env.RACE_KEY, { at: 1790000000000 });\n`);
const run = (env) => { const child = spawn(process.execPath, [worker], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk); const exit = new Promise(resolve => child.on('exit', code => resolve({ code, output }))); return { child, exit }; };
const first = run({RACE_WAIT: '1', RACE_KEY: 'review:server'});
const until = Date.now() + 10000;
while (!existsSync(join(root, 'ready')) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
if (!existsSync(join(root, 'ready'))) throw new Error('First writer never read the lifecycle');
const second = run({RACE_WAIT: '0', RACE_KEY: 'review:cli'});
const secondResult = await second.exit;
writeFileSync(join(root, 'release'), '');
const firstResult = await first.exit;
summary.crossProcessRace = { first: firstResult, second: secondResult, finalKeys: Object.keys(JSON.parse(readFileSync(join(root, 'auth-lifecycle.json'), 'utf8'))) };
console.log(JSON.stringify(summary, null, 2));
rmSync(root, { recursive: true, force: true });
```

Sanitized result on the reviewed source (absolute timestamps reflect the local run; the boolean and key assertions are stable):

```json
{
  "explicitRelogin": {
    "authObtainedAt": 1791147356167,
    "lastRefreshAt": 1791143756167,
    "retainedPriorRefresh": true
  },
  "externallyReplacedGrant": {
    "authObtainedAt": 1791060956167,
    "firstUnauthedAt": 1791147355167,
    "latestEventKind": "deadline_moved",
    "remainsLoggedOut": true
  },
  "servingAfterRefreshRefusal": {
    "accessExpiresInHours": 3,
    "facts": [
      {
        "label": "Status",
        "value": "✓ Authenticated",
        "tone": "ok"
      },
      {
        "label": "Logged out",
        "value": "0m ago",
        "tone": "err"
      },
      {
        "label": "Logged in",
        "value": "1d 0h ago",
        "tone": ""
      }
    ],
    "hidesServingCountdown": true
  },
  "nonGrantOAuthFailure": {
    "oauthError": "invalid_request",
    "firstUnauthedAt": 1791147356921,
    "recordedAsLogout": true
  },
  "unreadableRotationCheck": {
    "firstUnauthedAt": 1791147357674,
    "recordedAsLogout": true
  },
  "crossProcessRace": {
    "first": {
      "code": 0,
      "output": ""
    },
    "second": {
      "code": 0,
      "output": ""
    },
    "finalKeys": [
      "review:server"
    ]
  }
}
```
