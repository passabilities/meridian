/**
 * Version-only Mac regression proof; run with Bun. No auth/SDK/client/model call.
 * Example: bun scripts/e2e-claude-version-cold-start.mjs \
 *   --baseline-models /owned/baseline/src/proxy/models.ts \
 *   --fixed-models src/proxy/models.ts --claude /installed/claude --output /owned/logs
 * Baseline module and relative imports must be exact unchanged-main files, with
 * the same lockfile-installed dependencies available. Each arm gets a fresh Bun
 * process with PATH set before startup (important for legacy sync lookup).
 */
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { delimiter, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

const { values } = parseArgs({ options: {
  "baseline-models": { type: "string" }, "fixed-models": { type: "string" },
  claude: { type: "string" }, output: { type: "string" },
  worker: { type: "boolean", default: false }, models: { type: "string" },
  engine: { type: "string" }, candidate: { type: "string" },
  expected: { type: "string" }, label: { type: "string" },
} })

if (values.worker) {
  assert.ok(values.models && values.engine && values.candidate && values.expected)
  const models = await import(pathToFileURL(resolve(values.models)).href)
  const started = performance.now()
  const result = values.engine === "async"
    ? await models.resolveClaudeExecutableWithSource()
    : models.resolveClaudeExecutableSync()
  const row = { label: values.label, engine: values.engine, elapsedMs: Math.round(performance.now() - started), result, expected: values.expected }
  console.log(JSON.stringify({ event: "resolver-return", ...row }))
  if (values.expected === "path-lookup") assert.deepEqual(result, { path: values.candidate, source: "path-lookup" })
  else {
    assert.ok(result, "A real installed packaged fallback must exist")
    assert.notEqual(result.path, values.candidate)
    assert.ok(result.source === "bundled" || result.source === "platform-package")
  }
  console.log(JSON.stringify({ event: "arm-pass", ...row }))
} else {
  assert.equal(process.platform, "darwin", "This harness verifies the actual Mac flow")
  assert.ok(process.versions.bun, "Run this TypeScript-source proof using Bun")
  assert.ok(values["baseline-models"] && values["fixed-models"] && values.claude && values.output)
  assert.equal(process.env.MERIDIAN_CLAUDE_PATH, undefined, "Explicit override would bypass PATH")
  const baseline = resolve(values["baseline-models"])
  const fixed = resolve(values["fixed-models"])
  const cli = resolve(values.claude)
  const output = resolve(values.output)
  await mkdir(output, { recursive: true })
  const marker = join(output, "native-version-exec-intents-corrected.jsonl")
  await writeFile(marker, "")
  const hash = async path => createHash("sha256").update(await readFile(path)).digest("hex")
  const sourceBefore = { baseline: await hash(baseline), fixed: await hash(fixed), cli: await hash(cli) }
  const savedPath = process.env.PATH
  const savedHome = process.env.HOME
  const savedCodexHome = process.env.CODEX_HOME
  const cliVersion = execFileSync(cli, ["--version"], { encoding: "utf8", timeout: 15_000, maxBuffer: 16_384 }).trim()
  assert.match(cliVersion, /^\d+\.\d+\.\d+(?:[-+][\w.-]+)? \(Claude Code\)$/)
  console.log(JSON.stringify({ event: "direct-native-version", cliVersion, cli, platform: process.platform, arch: process.arch, bun: process.versions.bun }))
  const rows = []
  for (const revision of ["baseline", "fixed"]) {
    for (const control of ["delayed3.1s", "fast", "rejected-exit3"]) {
      for (const engine of ["async", "sync"]) {
        const label = `${revision}-${control}-${engine}`
        const dir = join(output, "owned-path-corrected", label)
        await mkdir(dir, { recursive: true })
        const candidate = join(dir, "claude")
        const reject = control === "rejected-exit3"
        const body = `#!/usr/bin/python3\nimport os, sys, time, json\nif sys.argv[1:] != ["--version"]:\n    sys.exit(97)\n${reject ? "sys.exit(3)" : `time.sleep(${control === "delayed3.1s" ? 3.1 : 0})\nwith open(${JSON.stringify(marker)}, "a") as output:\n    output.write(json.dumps({"label": ${JSON.stringify(label)}, "pid": os.getpid(), "argv": ["--version"], "event": "exec-intent"}) + "\\n")\nos.execv(${JSON.stringify(cli)}, [${JSON.stringify(cli)}, "--version"])`}\n`
        await writeFile(candidate, body)
        await chmod(candidate, 0o755)
        const expected = control === "fast" || (revision === "fixed" && control === "delayed3.1s") ? "path-lookup" : "packaged-fallback"
        const args = [process.argv[1], "--worker", "--models", revision === "baseline" ? baseline : fixed, "--engine", engine, "--candidate", candidate, "--expected", expected, "--label", label]
        const launched = spawnSync(process.execPath, args, {
          encoding: "utf8", timeout: 60_000, maxBuffer: 64_000,
          env: { ...process.env, PATH: `${dir}${delimiter}/usr/bin:/bin:/usr/sbin:/sbin` },
          stdio: ["ignore", "pipe", "pipe"],
        })
        const capture = { label, status: launched.status, signal: launched.signal, stdout: launched.stdout ?? "", stderr: launched.stderr ?? "", error: launched.error?.message ?? null }
        await writeFile(join(output, `${label}.log`), JSON.stringify(capture, null, 2) + "\n")
        console.log(JSON.stringify({ event: "worker-capture", ...capture }))
        assert.equal(launched.error, undefined, "Fresh worker must launch successfully")
        assert.equal(launched.signal, null, "Fresh worker must complete without a signal")
        assert.equal(launched.status, 0, "Fresh worker assertions must pass")
        const stdout = capture.stdout
        console.log(stdout.trim())
        const passed = stdout.split("\n").filter(Boolean).map(line => JSON.parse(line)).find(row => row.event === "arm-pass")
        assert.ok(passed, "The worker must record its returned object and passing assertions")
        rows.push(passed)
      }
    }
  }
  const intents = (await readFile(marker, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
  assert.equal(intents.length, 6)
  assert.equal(intents.filter(row => row.label.includes("delayed3.1s")).length, 2)
  assert.ok(intents.filter(row => row.label.includes("delayed3.1s")).every(row => row.label.startsWith("fixed-")))
  assert.equal(intents.filter(row => row.label.includes("fast")).length, 4)
  assert.equal(process.env.PATH, savedPath)
  assert.equal(process.env.HOME, savedHome)
  assert.equal(process.env.CODEX_HOME, savedCodexHome)
  const sourceAfter = { baseline: await hash(baseline), fixed: await hash(fixed), cli: await hash(cli) }
  assert.deepEqual(sourceAfter, sourceBefore, "Sources and actual CLI must stay unchanged during the live run")
  const result = {
    status: "PASS_NATIVE_VERSION_ONLY_BASELINE_FIXED_ASYNC_SYNC", cliVersion,
    platform: process.platform, arch: process.arch, bun: process.versions.bun,
    baseline, fixed, cli, sourceBefore, sourceAfter, rows,
    nativeInvocationCounts: { directReceipt: 1, successfulWrapperVersionResponses: 6, totalThisCorrectedRun: 7, baselineDelayedNativeExecs: 0, qualification: "Six exec intents are paired with accepted native version responses; two baseline delayed wrappers are killed before native exec. Earlier failed-run total remains separately unrecorded." },
    controlledDelaySeconds: 3.1, naturalMemoryPressureColdStartReproduced: false,
    homeOrCodexHomeOverridden: false, parentPathUnchanged: true,
    authSdkClientModelOperationsRequested: false, linuxWindowsVerified: false,
  }
  await writeFile(join(output, "live-version-corrected-results.json"), JSON.stringify(result, null, 2) + "\n")
  console.log(JSON.stringify({ status: result.status, cliVersion, arms: rows.length, nativeInvocationCounts: result.nativeInvocationCounts }))
}
