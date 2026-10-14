// Credentialless SOURCE HTTP provenance gate. Never rebuilds or edits the input
// checkout. Run with Node; an owned archive fixture is served by Bun from TS.
// E2E_BUILD_SOURCE_REF selects an unchanged baseline or corrected committed head.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { once } from "node:events"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const script = fileURLToPath(import.meta.url)
const root = resolve(dirname(script), "..")
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.error || result.status !== 0) throw new Error(`${executable} failed (${result.status ?? result.signal}): ${result.stderr ?? result.error}`)
  return result.stdout.trim()
}

if (process.argv[2] === "--worker") {
  // The parent supplies a minimal environment and an isolated HOME, configs,
  // sessions and named Claude profile BEFORE this dynamic source import.
  const fixture = realpathSync(process.argv[3])
  const expectedSha = process.argv[4]
  const credentials = process.env.CLAUDE_CONFIG_DIR
  assert.ok(credentials && !existsSync(join(credentials, ".credentials.json")))
  const { createProxyServer } = await import(pathToFileURL(join(fixture, "src/proxy/server.ts")).href)
  const { serve } = await import(pathToFileURL(join(fixture, "node_modules/@hono/node-server/dist/index.mjs")).href)
  const version = JSON.parse(readFileSync(join(fixture, "package.json"), "utf8")).version
  const proxy = createProxyServer({ port: 0, host: "127.0.0.1", silent: true, version,
    profiles: [{ id: "source-build-proof", claudeConfigDir: credentials }], defaultProfile: "source-build-proof" })
  const server = serve({ fetch: proxy.app.fetch, port: 0, hostname: "127.0.0.1" })
  await once(server, "listening")
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const url = `http://127.0.0.1:${address.port}`
  async function get(path) {
    assert.ok(["/health", "/build-status"].includes(path), "only build-related HTTP reads are allowed")
    const response = await fetch(url + path, { signal: AbortSignal.timeout(15000) })
    assert.equal(response.headers.get("cache-control"), "no-store")
    return { status: response.status, body: await response.json() }
  }
  let record
  try {
    const before = { health: await get("/health"), status: await get("/build-status") }
    writeFileSync(join(fixture, "proof-input.txt"), "edited after dynamic import\n")
    command("git", ["-C", fixture, "add", "proof-input.txt"])
    command("git", ["-C", fixture, "commit", "-m", "move fixture HEAD after runtime capture"])
    const movedSha = command("git", ["-C", fixture, "rev-parse", "HEAD"])
    assert.notEqual(movedSha, expectedSha)
    const after = { health: await get("/health"), status: await get("/build-status") }
    record = { before, after, expectedSha, movedSha, sourceEntry: "src/proxy/server.ts", routes: ["/health", "/build-status"], modelRequests: 0,
      node: process.version, bun: Bun.version, platform: process.platform, arch: process.arch,
      sdk: JSON.parse(readFileSync(join(fixture, "node_modules/@anthropic-ai/claude-agent-sdk/package.json"), "utf8")).version,
      claudeCodePackage: JSON.parse(readFileSync(join(fixture, "node_modules/@anthropic-ai/claude-code/package.json"), "utf8")).version,
      claudeCodeExecutableVersion: command(process.env.MERIDIAN_CLAUDE_PATH, ["--version"]) }
  } finally {
    // Listener close and backend close include owned auth/probe custody. Do not
    // force process.exit: successful exit is a natural child/pipes join witness.
    await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
    await proxy.closeBackend?.()
  }
  record.listenerClosed = true
  record.backendClosed = true
  record.credentialsAbsent = !existsSync(join(credentials, ".credentials.json"))
  console.log(JSON.stringify({ phase: "source-http-evidence", ...record }))
  const build = record.before.health.body.build
  assert.equal(record.before.health.status, 503, "empty named profile is not authenticated")
  assert.equal(record.before.health.body.auth?.loggedIn, false)
  assert.equal(record.credentialsAbsent, true)
  assert.equal(record.before.status.status, 200)
  assert.equal(build?.kind, "source")
  assert.equal(build?.sha, expectedSha, "fingerprint failure must still expose the actual startup Git SHA")
  assert.equal(build.branch, "source-build-fixture")
  assert.equal(build.dirty, true)
  for (const key of ["sourceHash", "counter", "counterScope", "attemptId", "certification"]) assert.equal(build[key], undefined, `no ${key} certification`)
  assert.equal(record.before.status.body.state, "unknown")
  assert.equal(record.before.status.body.latest, undefined)
  assert.equal(record.before.status.body.runtime.sha, expectedSha)
  assert.deepEqual(record.after.health.body.build, build, "health identity is immutable after disk edit and HEAD move")
  assert.deepEqual(record.after.status, record.before.status, "unknown disk comparison cannot certify SHA-only recovery")
  console.log(JSON.stringify({ phase: "assertions", result: "PASS" }))
} else {
  const ref = process.env.E2E_BUILD_SOURCE_REF ?? "HEAD"
  const sourceSha = command("git", ["-C", root, "rev-parse", "--verify", `${ref}^{commit}`])
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "meridian-source-http-")))
  const fixture = join(scratch, "checkout")
  mkdirSync(fixture)
  const home = join(scratch, "home")
  const credentials = join(scratch, "credentials")
  mkdirSync(home, { mode: 0o700 }); mkdirSync(credentials, { mode: 0o700 })
  // Allowlist rather than inheriting credential variables, NODE_OPTIONS, a
  // developer's config overrides or Git configuration. Explicit named profile
  // and CLI path avoid consulting the owner's auth context/launcher.
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? tmpdir(), HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local/share"),
    MERIDIAN_CONFIG_DIR: join(scratch, "config"), MERIDIAN_SESSION_DIR: join(scratch, "sessions"),
    CLAUDE_CONFIG_DIR: credentials, MERIDIAN_NO_UPDATE_CHECK: "1",
    MERIDIAN_CLAUDE_PATH: realpathSync(join(root, "node_modules/.bin/claude")),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Source Build Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Source Build Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }
  try {
    // Git archive reads the selected committed tree, not dirty owner bytes.
    const archive = join(scratch, "source.tar")
    command("git", ["-C", root, "archive", "--output", archive, sourceSha], { env })
    command("tar", ["-xf", archive, "-C", fixture], { env })
    symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"), "dir")
    command("git", ["init", "-b", "source-build-fixture", fixture], { env })
    command("git", ["-C", fixture, "add", "."], { env })
    command("git", ["-C", fixture, "commit", "-m", `source archive ${sourceSha}`], { env })
    const fixtureSha = command("git", ["-C", fixture, "rev-parse", "HEAD"], { env })
    const oversized = join(fixture, "oversized.bin")
    closeSync(openSync(oversized, "w")); truncateSync(oversized, 65 * 1024 * 1024)
    console.log(JSON.stringify({ phase: "fixture", sourceSha, fixtureSha, sparseUntrackedBytes: 65 * 1024 * 1024,
      git: command("git", ["--version"], { env }), driverNode: process.version,
      limitation: "deterministic fingerprint file-cap failure, not a reproduced loaded Linux host" }))
    const child = spawnSync("bun", [script, "--worker", fixture, fixtureSha], { cwd: fixture, env,
      encoding: "utf8", timeout: 120000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 })
    process.stdout.write(child.stdout ?? "")
    process.stderr.write(child.stderr ?? "")
    const evidenceLine = child.stdout?.split("\n").find(line => line.startsWith('{"phase":"source-http-evidence"'))
    const evidence = evidenceLine ? JSON.parse(evidenceLine) : undefined
    console.log(JSON.stringify({ phase: "worker-join", exit: child.status, signal: child.signal, error: child.error?.code ?? null,
      directChildAndPipesReturned: true, listenerClosed: evidence?.listenerClosed ?? false, backendClosed: evidence?.backendClosed ?? false }))
    assert.equal(child.error, undefined, "worker must join normally, not time out")
    assert.equal(child.status, 0, "same final source HTTP assertions must pass")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
