#!/usr/bin/env bun
// Real SDK + raw HTTP bookkeeping proof. Native client/plugin proof is separate.
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { basename, isAbsolute, join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const REQUEST_MS = 120_000
const RUN_MS = 600_000
const HELPER_ACQUIRE_MS = 5_000
const HELPER_READY_MS = 8_000
const HELPER_HOLD_MS = 15_000
const HELPER_JOIN_MS = 2_000
const LOCK_WAIT_MS = 500
const SHUTDOWN_MS = 15_000
const delay = milliseconds => new Promise(accept => setTimeout(accept, milliseconds))
const digest = value => createHash("sha256").update(value).digest("hex")
const moduleAt = (root, path) => pathToFileURL(join(root, path)).href

async function within(promise, milliseconds, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds)
    })])
  } finally {
    clearTimeout(timer)
  }
}

// This child has no grant or provider environment. It owns the real canonical
// external lock through the same initialized-candidate function as production.
async function holdExternalLock(lockPath, targetRoot, token) {
  assert(isAbsolute(lockPath) && basename(lockPath) === "session-gc.json.lock")
  const lifecycle = await import(moduleAt(targetRoot, "src/proxy/sessionLifecycle.ts"))
  const { captureProcessIncarnation } = await import(moduleAt(targetRoot, "src/proxy/session/processIncarnation.ts"))
  const incarnation = captureProcessIncarnation()
  assert(incarnation, "helper cannot establish its exact process incarnation")
  const owner = JSON.stringify({ pid: process.pid, hostname: hostname(), token, incarnation })
  const candidate = await lifecycle.createInitializedSidecarLockCandidate(lockPath, `${owner}\n${Date.now()}\n`)
  let releaseRequested = false
  let release
  const released = new Promise(accept => { release = () => { releaseRequested = true; accept() } })
  process.stdin.on("data", release)
  process.stdin.on("end", release)
  process.once("SIGTERM", release)
  process.stdin.resume()
  let timer
  let published = false
  try {
    const acquisitionDeadline = Date.now() + HELPER_ACQUIRE_MS
    while (!published && !releaseRequested) {
      published = await candidate.publish()
      if (!published) {
        assert(Date.now() < acquisitionDeadline, "helper could not own the external lock")
        await delay(25)
      }
    }
    assert(published, "helper released before acquiring the external lock")
    await candidate.discard()
    timer = setTimeout(release, HELPER_HOLD_MS)
    process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid })}\n`)
    await released
  } finally {
    clearTimeout(timer)
    await candidate.discard()
    // Do not remove a successor's lock.
    if (published && existsSync(lockPath)) {
      assert(readFileSync(lockPath, "utf8").startsWith(`${owner}\n`), "helper lost exact lock ownership")
      unlinkSync(lockPath)
    }
    process.stdin.pause()
  }
}

if (process.argv[2] === "--lock-helper") {
  await holdExternalLock(process.argv[3], realpathSync(process.argv[4]), process.argv[5])
  process.exit(0)
}
if (process.argv.includes("--help")) {
  console.log("E2E_AUTH_FILE=<private access-only snapshot> E2E_MODEL=<model> bun scripts/e2e-publication-lock-fallback.mjs --json|--stream\nE2E_MERIDIAN_ROOT selects an unchanged baseline or corrected source checkout. Native client/plugin proof is separate.")
  process.exit(0)
}
assert(process.argv.slice(2).every(flag => flag === "--json" || flag === "--stream"), "supported flags: --json or --stream")
assert.equal(Number(process.argv.includes("--json")) + Number(process.argv.includes("--stream")), 1, "select exactly one response mode")
const stream = process.argv.includes("--stream")
const model = process.env.E2E_MODEL
assert(typeof model === "string" && model.length > 0, "E2E_MODEL must name the owner-selected model")
const expectedModel = process.env.E2E_EXPECTED_SERVED_MODEL ?? model
assert(expectedModel.length > 0, "expected actual served model must be explicit and nonempty")
const targetRoot = realpathSync(process.env.E2E_MERIDIAN_ROOT ?? fileURLToPath(new URL("..", import.meta.url)))
const authPath = realpathSync(process.env.E2E_AUTH_FILE)
const authBytes = readFileSync(authPath)
const auth = JSON.parse(authBytes.toString())
assert(typeof auth.accessToken === "string" && auth.accessToken.length > 0
  && typeof auth.expiresAt === "number" && Number.isFinite(auth.expiresAt) && auth.expiresAt > Date.now() + RUN_MS,
  "provide a current private access-only snapshot valid for the ten-minute run")
assert.deepEqual(Object.keys(auth).sort(), ["accessToken", "expiresAt"], "snapshot must contain only accessToken and expiresAt; no refresh grant")
const authSourceDigest = digest(authBytes)
const root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-publication-lock-")))
const project = join(root, "project")
const storeDir = join(root, "sessions")
for (const dir of ["project", "sessions", "config", "plugins"]) mkdirSync(join(root, dir), { mode: 0o700 })
const claudeExecutable = process.env.E2E_CLAUDE_BIN ? realpathSync(process.env.E2E_CLAUDE_BIN) : undefined
for (const key of Object.keys(process.env)) {
  if (/^(MERIDIAN_|CLAUDE_PROXY_|CLAUDE_|ANTHROPIC_|OPENAI_|OPENCODE_CLAUDE_PROVIDER_)/.test(key)) delete process.env[key]
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR: join(root, "config"), MERIDIAN_SESSION_DIR: storeDir, MERIDIAN_WORKDIR: project,
  MERIDIAN_TELEMETRY_PERSIST: "0", MERIDIAN_CREDENTIALS_READONLY: "1", MERIDIAN_NO_UPDATE_CHECK: "1",
  MERIDIAN_PASSTHROUGH: "1", MERIDIAN_LOAD_CONTEXT: "0", MERIDIAN_ROUTING: "manual",
  MERIDIAN_SESSION_GC_GRACE_MS: String(RUN_MS * 2),
  ...(claudeExecutable ? { MERIDIAN_CLAUDE_PATH: claudeExecutable } : {}),
})
const requireTarget = createRequire(join(targetRoot, "package.json"))
const sdk = await import(pathToFileURL(requireTarget.resolve("@anthropic-ai/claude-agent-sdk")).href)
const { spyOn } = await import("bun:test")
const lifecycle = await import(moduleAt(targetRoot, "src/proxy/sessionLifecycle.ts"))
const { lookupSharedSession } = await import(moduleAt(targetRoot, "src/proxy/sessionStore.ts"))
const { diagnosticLog } = await import(moduleAt(targetRoot, "src/telemetry/index.ts"))
const profileId = "publication-access-only"
assert.equal(execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: targetRoot, encoding: "utf8" }), "",
  "selected source must have no tracked changes")
let phase = "startup"
let instance
let faultArmed = false
let activeHelper
const queries = []
const joinedKeys = new Map()
const fault = { attempted: false, callbackEntered: false, externalTimeout: false, helperJoined: false, helperLockRemoved: false }
const summary = {
  result: "FAIL", scope: "real SDK/raw HTTP terminal publication; native client/plugin proof separate",
  productionTuple: "unknown client/model/version; author reports Linux and Mac only",
  platform: `${process.platform}/${process.arch}`, runtime: `Bun ${Bun.version}`, stream,
  requestedModel: model, expectedServedModel: expectedModel,
  sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: targetRoot, encoding: "utf8" }).trim(),
  meridian: JSON.parse(readFileSync(join(targetRoot, "package.json"), "utf8")).version,
  sdk: JSON.parse(readFileSync(join(targetRoot, "node_modules/@anthropic-ai/claude-agent-sdk/package.json"), "utf8")).version,
  lockfilesSha256: Object.fromEntries(["package-lock.json", "bun.lock"].map(name => [name, digest(readFileSync(join(targetRoot, name)))])),
  execution: "source modules; no bundle build exercised",
  harnessSha256: digest(readFileSync(fileURLToPath(import.meta.url))),
  boundsMs: { request: REQUEST_MS, run: RUN_MS, finalProcess: RUN_MS + 30_000, helperAcquire: HELPER_ACQUIRE_MS, helperReady: HELPER_READY_MS,
    helperHold: HELPER_HOLD_MS, helperJoin: HELPER_JOIN_MS, externalAcquisition: LOCK_WAIT_MS, shutdown: SHUTDOWN_MS },
  privateArtifacts: root, fault,
}
const safeMessage = error => String(error instanceof Error ? error.message : error)
  .replaceAll(auth.accessToken, "[redacted]").replaceAll(authPath, "[private access snapshot]")
function saveSummary() {
  summary.queries = queries.map(({ prompt, assistantText, ...facts }) => ({ ...facts,
    promptSha256: typeof prompt === "string" ? digest(prompt) : null, assistantTextSha256: digest(assistantText) }))
  // Complete observed answers and exact replay inputs stay in private artifacts;
  // the printed summary contains only hashes and metadata, never query env.
  const observations = JSON.stringify(queries, null, 2)
  assert(!observations.includes(auth.accessToken), "access grant leaked into an observed SDK payload")
  writeFileSync(join(root, "sdk-observations.json"), observations, { mode: 0o600 })
  writeFileSync(join(root, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 })
}

const query = sdk.query
const querySpy = spyOn(sdk, "query").mockImplementation(input => {
  assert(!queries.some(record => record.phase === phase), "unexpected retry or extra model turn")
  assert(queries.length < 5, "gate permits at most five real SDK queries")
  assert.equal(typeof input.prompt, "string", "ordinary text fixture needs one observable SDK input")
  assert.equal(input.options?.env?.CLAUDE_CODE_OAUTH_TOKEN, auth.accessToken, "SDK did not receive the selected access-only profile")
  assert.equal(input.options?.env?.CLAUDE_CONFIG_DIR, join(root, "config", "profiles", profileId), "SDK config escaped the isolated profile")
  const record = { phase, resume: input.options?.resume ?? null, resumeAt: input.options?.resumeSessionAt ?? null,
    forkSession: input.options?.forkSession === true, target: input.options?.sessionId ?? null,
    sdkOptionModel: input.options?.model ?? null, prompt: input.prompt, assistantText: "", servedModels: [],
    returnedSessionIds: [], cliVersions: [], results: [], profileMatched: true, configIsolated: true }
  queries.push(record)
  const real = query(input) // Exact input, real SDK, real model; no synthetic messages.
  return new Proxy(real, { get(target, key) {
    if (key === Symbol.asyncIterator) return async function* () {
      for await (const message of real) {
        if (typeof message.session_id === "string" && !record.returnedSessionIds.includes(message.session_id)) record.returnedSessionIds.push(message.session_id)
        if (message.type === "system" && message.subtype === "init" && typeof message.claude_code_version === "string") record.cliVersions.push(message.claude_code_version)
        const served = message.type === "assistant" ? message.message?.model
          : message.type === "stream_event" && message.event?.type === "message_start" ? message.event.message?.model : undefined
        if (typeof served === "string" && !record.servedModels.includes(served)) record.servedModels.push(served)
        if (message.type === "assistant") {
          assert(!message.message?.content?.some(block => block.type === "tool_use"), "ordinary text fixture unexpectedly used a tool")
          record.assistantText += (message.message?.content ?? []).filter(block => block.type === "text").map(block => block.text).join("")
        }
        if (message.type === "result") record.results.push({ subtype: message.subtype, isError: message.is_error === true })
        yield message
      }
    }
    const value = Reflect.get(target, key, target)
    return typeof value === "function" ? value.bind(target) : value
  } })
})
const releaseJoined = lifecycle.releaseJoinedTranscriptLease
const releaseSpy = spyOn(lifecycle, "releaseJoinedTranscriptLease").mockImplementation(async (lease, options) => {
  await releaseJoined(lease, options)
  for (const key of lease.resourceKeys) joinedKeys.set(key, phase)
})

async function startLockHelper(lockPath) {
  const token = randomUUID()
  const child = Bun.spawn([process.execPath, fileURLToPath(import.meta.url), "--lock-helper", lockPath, targetRoot, token], {
    cwd: root, env: { PATH: process.env.PATH ?? "", MERIDIAN_SESSION_DIR: storeDir, MERIDIAN_CONFIG_DIR: join(root, "helper-config") },
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  })
  const errors = new Response(child.stderr).text()
  const output = child.stdout.getReader()
  const helper = { child, token, lockPath, errors, output, stop: undefined }
  activeHelper = helper
  let readyLine = ""
  try {
    await within((async () => {
      while (!readyLine.includes("\n")) {
        const chunk = await output.read()
        assert(!chunk.done, "helper exited before ready")
        readyLine += new TextDecoder().decode(chunk.value)
        assert(readyLine.length <= 1_024, "unexpected helper output")
      }
    })(), HELPER_READY_MS, "helper readiness")
    const ready = JSON.parse(readyLine.trim())
    assert(ready.ready && ready.pid === child.pid, "helper readiness did not identify its process")
    const owner = JSON.parse(readFileSync(lockPath, "utf8").split("\n", 1)[0])
    assert.equal(owner.pid, child.pid)
    assert.equal(owner.token, token)
    return helper
  } catch (error) {
    await stopLockHelper(helper)
    throw error
  }
}

function stopLockHelper(helper) {
  // Cleanup is idempotent even when readiness or publication fails.
  helper.stop ??= joinLockHelper(helper)
  return helper.stop
}
async function joinLockHelper(helper) {
  let releaseError
  if (helper.child.exitCode === null) {
    try {
      helper.child.stdin.write("release\n")
      helper.child.stdin.end()
    } catch (error) {
      releaseError = safeMessage(error)
    }
  }
  let forced = false
  try {
    await within(helper.child.exited, HELPER_JOIN_MS, "helper join")
  } catch {
    forced = true
    helper.child.kill("SIGKILL")
    await within(helper.child.exited, HELPER_JOIN_MS, "killed helper join")
  } finally {
    // Settle any readiness read still pending when its timeout fired.
    await helper.output.cancel()
    helper.output.releaseLock()
  }
  // A killed helper may leave its lock. Removal is permitted only after join
  // and only when the canonical owner still has this exact PID and nonce.
  let lockLeftByHelper = false
  if (existsSync(helper.lockPath)) {
    const owner = JSON.parse(readFileSync(helper.lockPath, "utf8").split("\n", 1)[0])
    if (owner.pid === helper.child.pid && owner.token === helper.token) {
      lockLeftByHelper = true
      unlinkSync(helper.lockPath)
    }
  }
  let stagingLeftByHelper = false
  for (const name of readdirSync(storeDir).filter(name => name.startsWith(`session-gc.json.lock.candidate-${helper.child.pid}-`))) {
    const path = join(storeDir, name)
    const owner = JSON.parse(readFileSync(path, "utf8").split("\n", 1)[0])
    if (owner.pid === helper.child.pid && owner.token === helper.token) {
      stagingLeftByHelper = true
      unlinkSync(path)
    }
  }
  const ownerRemaining = existsSync(helper.lockPath)
    && JSON.parse(readFileSync(helper.lockPath, "utf8").split("\n", 1)[0]).token === helper.token
  assert(!ownerRemaining, "helper's exact lock remains after join")
  const stderr = await helper.errors
  activeHelper = undefined
  fault.helperCleanup = { forced, exitCode: helper.child.exitCode, lockLeftByHelper, stagingLeftByHelper, releaseError }
  assert(!forced && helper.child.exitCode === 0 && !lockLeftByHelper && !stagingLeftByHelper && !releaseError,
    `helper did not join and remove its own files normally: ${safeMessage(stderr)}`)
  fault.helperJoined = true
  fault.helperLockRemoved = true
}

const publish = lifecycle.publishPinnedTranscript
const publicationSpy = spyOn(lifecycle, "publishPinnedTranscript").mockImplementation(async (locator, callback, options) => {
  if (!faultArmed || phase !== "fault-turn") return publish(locator, callback, options)
  faultArmed = false
  fault.attempted = true
  const key = lifecycle.getTranscriptResourceKey(locator)
  assert.equal(joinedKeys.get(key), phase, "terminal publication did not follow this request's joined writer lease")
  const sidecar = JSON.parse(readFileSync(join(storeDir, "session-gc.json"), "utf8"))
  const resource = sidecar.resources[key]
  assert(resource && Object.values(resource.activeLeases ?? {}).every(lease => lease.purpose === "publication"),
    "an SDK writer lease remains at terminal publication")
  const record = queries.find(record => record.phase === phase)
  assert(record?.assistantText.length > 0 && record.results.some(result => !result.isError && result.subtype === "success"),
    "fault must follow a complete real SDK answer")
  assertModelObservation(record)
  assert(record.returnedSessionIds.includes(locator.sessionId), "publication target differs from the real SDK session")
  fault.writerJoined = true
  fault.target = locator.sessionId
  const lockPath = join(storeDir, "session-gc.json.lock")
  const helper = await startLockHelper(lockPath)
  const started = performance.now()
  try {
    return await publish(locator, () => {
      fault.callbackEntered = true
      return callback()
    }, { ...options, lockWaitMs: LOCK_WAIT_MS, lockRetryMs: 25 })
  } catch (error) {
    fault.acquisitionElapsedMs = Math.round(performance.now() - started)
    assert(error instanceof lifecycle.SessionLifecycleLockError && error.message === `timed out waiting for ${lockPath}`,
      "injection did not produce the real external acquisition timeout")
    assert.equal(fault.callbackEntered, false, "publication callback entered despite the held external lock")
    assert(fault.acquisitionElapsedMs >= LOCK_WAIT_MS, "acquisition failed before its real wait budget elapsed")
    const owner = JSON.parse(readFileSync(lockPath, "utf8").split("\n", 1)[0])
    assert(helper.child.exitCode === null && owner.pid === helper.child.pid && owner.token === helper.token,
      "helper did not retain actual lock ownership through rejection")
    fault.helperHeldThroughRejection = true
    fault.externalTimeout = true
    throw error // Original acquisition error; never fabricated inside a callback.
  } finally {
    await stopLockHelper(helper)
  }
})
const runAbort = new AbortController()
const deadline = setTimeout(() => runAbort.abort(new Error("publication probe exceeded ten minutes")), RUN_MS)
const hardDeadline = setTimeout(() => { process.stderr.write("publication probe cleanup exceeded its final bound\n"); process.exit(124) }, RUN_MS + 30_000)
hardDeadline.unref()

async function request(label, key, messages) {
  phase = label
  const address = instance.server.address()
  const signal = AbortSignal.any([runAbort.signal, AbortSignal.timeout(REQUEST_MS)])
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/messages`, {
    method: "POST", headers: { "content-type": "application/json", "x-opencode-session": key,
      "user-agent": "meridian-publication-fault-http-fixture", "x-meridian-profile": profileId },
    body: JSON.stringify({ model, max_tokens: 512, stream, messages }),
    signal,
  })
  const raw = await response.text()
  assert(!signal.aborted, `${label}: response body did not finish before its deadline`)
  assert(!raw.includes(auth.accessToken), "access grant leaked into an HTTP response")
  writeFileSync(join(root, `${label}-response.${stream ? "sse" : "json"}`), raw, { mode: 0o600 })
  const events = stream ? raw.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5))) : []
  const json = stream ? undefined : JSON.parse(raw)
  const text = stream ? events.filter(event => event.delta?.type === "text_delta").map(event => event.delta.text).join("")
    : (json.content ?? []).filter(block => block.type === "text").map(block => block.text).join("")
  return { status: response.status, text, naturallyClosed: true, rawSha256: digest(raw), errors: stream ? events.filter(event => event.type === "error").length : Number(json.type === "error"),
    deltas: events.filter(event => event.type === "message_delta").map(event => event.delta.stop_reason),
    stops: events.filter(event => event.type === "message_stop").length, stopReason: json?.stop_reason }
}
function assertModelObservation(record) {
  assert(record.servedModels.length > 0 && record.servedModels.every(served => served === expectedModel),
    `${record.phase}: actual SDK model metadata differs from the explicit expected model`)
  assert(record.cliVersions.length > 0, `${record.phase}: actual SDK init metadata did not identify the Claude CLI version`)
}
function assertDelivered(label, response) {
  const record = queries.find(record => record.phase === label)
  assert(record?.assistantText.length > 0, `${label}: no complete real SDK text answer`)
  assertModelObservation(record)
  assert.equal(response.status, 200, `${label}: answered request did not return HTTP 200`)
  assert.equal(response.errors, 0, `${label}: answered request emitted an error`)
  assert.equal(response.text, record.assistantText, `${label}: delivery differs from the real SDK answer`)
  if (stream) {
    assert.deepEqual(response.deltas, ["end_turn"], `${label}: SSE terminal delta is incomplete or duplicated`)
    assert.equal(response.stops, 1, `${label}: SSE must naturally finish with one message_stop`)
  } else assert.equal(response.stopReason, "end_turn", `${label}: JSON answer did not finish normally`)
}
const mapping = key => lookupSharedSession(`${profileId}:${key}`)
async function history(stored) {
  assert(stored?.currentTranscript, "mapping has no supported history locator")
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = stored.currentTranscript.configDir
  try {
    const rows = await sdk.getSessionMessages(stored.claudeSessionId, { dir: stored.currentTranscript.projectDir })
    assert(rows.length > 0, "supported SDK history is empty")
    const artifact = JSON.stringify(rows, null, 2)
    assert(!artifact.includes(auth.accessToken), "access grant leaked into supported SDK history")
    summary.histories ??= []
    const filename = `history-${summary.histories.length}.json`
    writeFileSync(join(root, filename), artifact, { mode: 0o600 })
    summary.histories.push({ phase, sessionId: stored.claudeSessionId, filename, sha256: digest(artifact) })
    return rows
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
  }
}

try {
  const { startProxyServer } = await import(moduleAt(targetRoot, "src/proxy/server.ts"))
  instance = await startProxyServer({ port: 0, host: "127.0.0.1", silent: true, maxConcurrent: 1,
    pluginDir: join(root, "plugins"), pluginConfigPath: join(root, "config", "plugins.json"),
    profiles: [{ id: profileId, type: "oauth-token", oauthToken: auth.accessToken }], defaultProfile: profileId })
  if (!instance.server.listening) await within(once(instance.server, "listening"), 5_000, "listener readiness")
  const healthyKey = `healthy-${randomUUID()}`
  const healthyOpening = { role: "user", content: `This is an isolated bookkeeping fixture ${randomUUID()}. Reply with a short acknowledgement. Do not use tools.` }
  const healthyFirst = await request("healthy-seed", healthyKey, [healthyOpening])
  assertDelivered("healthy-seed", healthyFirst)
  const healthySource = mapping(healthyKey)
  const healthyRows = await history(healthySource)
  const healthySecond = await request("healthy-followup", healthyKey, [healthyOpening, { role: "assistant", content: healthyFirst.text },
    { role: "user", content: "Acknowledge one ordinary continuation, without tools." }])
  assertDelivered("healthy-followup", healthySecond)
  assert.equal(queries.find(record => record.phase === "healthy-followup").resume, healthySource.claudeSessionId, "healthy control did not natively resume")
  assert.notEqual(mapping(healthyKey)?.claudeSessionId, healthySource.claudeSessionId, "healthy fork did not publish a distinct target")
  assert.deepEqual(await history(healthySource), healthyRows, "healthy source history changed")
  summary.healthyControl = { delivered: true, nativeResume: true, sourceUnchanged: true }

  const key = `fault-${randomUUID()}`
  const opening = { role: "user", content: `Remember this isolated opening marker ${randomUUID()}. Reply with a short acknowledgement. Do not use tools.` }
  const first = await request("fault-seed", key, [opening])
  assertDelivered("fault-seed", first)
  const source = mapping(key)
  const sourceRows = await history(source)
  const nextUser = { role: "user", content: `Remember this second isolated marker ${randomUUID()}. Reply with a short acknowledgement. Do not use tools.` }
  const messages = [opening, { role: "assistant", content: first.text }, nextUser]
  faultArmed = true
  const second = await request("fault-turn", key, messages)
  summary.faultResponse = { ...second, text: undefined, textSha256: digest(second.text) }
  summary.mappingAfterFault = { absent: !mapping(key), stillSource: mapping(key)?.claudeSessionId === source.claudeSessionId }
  summary.faultDeferrals = diagnosticLog.getRecent({ category: "session", limit: 200 })
    .filter(entry => entry.message.includes("session.publication_deferred")).length
  saveSummary() // Baseline failure retains acquisition, answer and mapping facts.
  assert(fault.attempted && fault.externalTimeout && !fault.callbackEntered && fault.helperHeldThroughRejection
    && fault.helperJoined && fault.helperLockRemoved,
    "real pre-entry acquisition/owned-helper cleanup was not established")
  assertDelivered("fault-turn", second)
  assert.equal(mapping(key), undefined, "deferred publication retained the pre-answer mapping")
  assert.equal(summary.faultDeferrals, 1, "expected one ordinary terminal-publication deferral")
  assert.deepEqual(await history(source), sourceRows, "publication fault changed the mapped source history")

  const liveUser = { role: "user", content: `Acknowledge this final isolated marker ${randomUUID()}, without tools.` }
  const fullHistory = [...messages, { role: "assistant", content: second.text }, liveUser]
  const third = await request("fresh-replay", key, fullHistory)
  assertDelivered("fresh-replay", third)
  const replay = queries.find(record => record.phase === "fresh-replay")
  assert(replay.target && !replay.resume && !replay.resumeAt && !replay.forkSession, "follow-up used stale resume instead of a fresh target")
  const current = mapping(key)
  assert(current?.claudeSessionId === replay.target && current.messageCount === fullHistory.length, "fresh replay mapping differs from its complete request")
  assert.notEqual(current.claudeSessionId, source.claudeSessionId)
  assert.notEqual(current.claudeSessionId, fault.target)
  const expectedHistory = [opening.content, `[Assistant: ${first.text}]`, nextUser.content, `[Assistant: ${second.text}]`].join("\n\n")
  assert.equal(typeof replay.prompt, "string", "ordinary text fixture was not captured as one SDK input")
  assert.equal(replay.prompt.match(/^<conversation_history>\n([\s\S]*?)\n<\/conversation_history>/)?.[1], expectedHistory, "fresh SDK input omitted or changed earlier conversation content")
  assert(replay.prompt.endsWith(liveUser.content), "fresh SDK input lost its live final turn")
  const rows = await history(current)
  const sdkUserText = rows.filter(row => row.type === "user").flatMap(row => typeof row.message?.content === "string"
    ? [row.message.content] : (row.message?.content ?? []).filter(block => block.type === "text").map(block => block.text)).join("\n")
  for (const item of [opening.content, first.text, nextUser.content, second.text, liveUser.content]) assert(sdkUserText.includes(item), "supported SDK history lost supplied replay content")
  assert.deepEqual(await history(source), sourceRows, "fresh replay changed the original SDK source")
  assert.equal(queries.length, 5)
  summary.freshReplay = { distinctTarget: true, noResume: true, completeSdkInput: true, supportedHistory: true, sourceUnchanged: true }
  summary.result = "PASS"
} catch (error) {
  summary.failedPhase = phase
  summary.failure = safeMessage(error)
  process.exitCode = 1
} finally {
  const cleanupErrors = []
  if (activeHelper) {
    try {
      await stopLockHelper(activeHelper)
    } catch (error) {
      cleanupErrors.push(safeMessage(error))
    }
  }
  if (instance) {
    try {
      await within(instance.close(), SHUTDOWN_MS, "proxy shutdown")
    } catch (error) {
      cleanupErrors.push(safeMessage(error))
    }
  }
  if (cleanupErrors.length > 0) {
    summary.result = "FAIL"
    summary.cleanupFailure = cleanupErrors.join("; ")
    process.exitCode = 1
  }
  publicationSpy.mockRestore()
  releaseSpy.mockRestore()
  querySpy.mockRestore()
  clearTimeout(deadline)
  try {
    summary.authSourceUnchanged = digest(readFileSync(authPath)) === authSourceDigest
    assert(summary.authSourceUnchanged, "access-only source snapshot changed")
  } catch (error) {
    summary.result = "FAIL"
    summary.credentialFixtureFailure = safeMessage(error)
    process.exitCode = 1
  }
  saveSummary()
  console.log(JSON.stringify(summary))
  // If close failed, the final process bound still ends an open listener.
  if (!summary.cleanupFailure) clearTimeout(hardDeadline)
}
