# Correcting omitted OpenCode scrub preflight

On main `16fac4c6b`, `e2e-extra-usage-opencode.mjs` creates an isolated HOME,
starts Meridian without pluginConfigPath/pluginDir, and installs only the V1
client plugin. Draft 1344's `e2e-tool-input-opencode.mjs` has the same omission.
No server scrub can be inherited from the owner in these isolated runs. Thus
the captured refusal cannot establish account exhaustion or correct-client
acceptance. PR descriptions 1344/1346 are corrected; raw historical evidence
and actual merge state remain intact.

The shared helper rejects missing/relative/wrong-package/version paths before
accessing a live grant, writes explicit owned enabled plugin config, and requires
exact loaded identity and an active onRequest hook before inference. After the
client request it requires successful invocation and zero hook errors. It records
package/runtime versions separately and hashes the actual entrypoint. Existing
client plugin setup/config/session-header proof remains independent and required.

Credentialless verification:

```sh
bun test src/__tests__/opencode-scrub-preflight.test.mjs
E2E_PLUGIN_PATH=/absolute/installed/scrub/dist/index.js E2E_SCRUB_VERSION=0.2.3 \
  bun scripts/e2e-opencode-scrub-preflight.mjs
```

The second command uses the real loader and transform pipeline, not a mock or
model. Fresh independently npm-installed official 0.2.3 loads active and removes
the synthetic identity line while preserving ordinary project instructions;
one request-hook invocation, zero errors. The JSON receipt is adjacent.
Initial fixture failures are retained here: the first call omitted the pipeline's
adapter argument; after fixing that, a fixture without the real line terminator
did not match the published rule. Supplying the required adapter and actual
newline-delimited shape passes. Neither failure was a product/account result.

Adversarial checks reject absent, disabled, duplicate or wrong plugin entries,
missing hooks, missing invocation and hook failures. Configuration uses an owned
empty discovery directory, so ambient plugins cannot satisfy these assertions.
This is harness qualification only. No live model, login refresh, alternate
account, Extra Usage setting or paid operation was used. Correctly configured
actual OpenCode/SDK/Opus acceptance still needs to run.
