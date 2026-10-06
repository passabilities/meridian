/**
 * A conversation that moves to another account and comes back, through the
 * HTTP layer with a mocked SDK.
 *
 * Session mappings are kept per account, and a switch no longer clears them
 * (profile switches preserve resume state), so an account a conversation
 * comes back to still holds the session it had when the conversation left.
 * That session ends where the conversation was then. Whatever the
 * conversation did on the other account in between is not in it, and a
 * resume delta drops assistant turns on the assumption that the session wrote
 * them itself.
 *
 * Where the SDK child's transcript can be found, the conversation's newest
 * session is carried to the account that serves it next (sessionCarry.ts) and
 * resumed there; otherwise its history is replayed. The mock writes, forks and
 * resumes transcripts under each account's config directory as the CLI does,
 * when `writeTranscripts` is on.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"
import { assistantMessage, resolveMockSdkSessionId } from "./helpers"

interface SeenQuery {
  dir: string
  resume: string | undefined
  /** The session the turn is written to. */
  target: string
  prompt: string
  /** The resumed session's transcript, as the CLI would have read it. */
  resumedFrom?: string
}
let seen: SeenQuery[] = []
let writeTranscripts = false
/**
 * When the next turn's reply reaches its transcript: this many milliseconds
 * after the turn ends, as the CLI's batched writes can leave it, or never.
 */
let nextReplyWritten: number | "never" | undefined
/** An account whose API refuses every turn. */
let refusing: string | undefined

async function promptText(prompt: unknown): Promise<string> {
  if (typeof prompt === "string") return prompt
  const parts: string[] = []
  for await (const message of prompt as AsyncIterable<unknown>) parts.push(JSON.stringify(message))
  return parts.join("\n")
}

const transcriptPath = (dir: string, cwd: string, sessionId: string) =>
  join(dir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), `${sessionId}.jsonl`)

installSdkMock(() => ({
  query: (params: any) => {
    const dir = params.options?.env?.CLAUDE_CONFIG_DIR ?? "default"
    const cwd = params.options?.cwd ?? process.cwd()
    const sessionId = resolveMockSdkSessionId(params.options, "return-trip-session")
    const replyWritten = nextReplyWritten
    nextReplyWritten = undefined
    return (async function* () {
      const prompt = await promptText(params.prompt)
      const query: SeenQuery = { dir, resume: params.options?.resume, target: sessionId, prompt }
      seen.push(query)
      if (refusing && dir.endsWith(`/${refusing}`)) throw new Error("API Error: 429 rate limited")
      const reply = { ...assistantMessage([{ type: "text", text: `answer from ${dir}` }]), session_id: sessionId }
      if (writeTranscripts) {
        // As the CLI: a resume reads the session from this config directory
        // only, and the turn is written to the session it forks into, each
        // record under the uuid the SDK reports for it.
        let earlier = ""
        if (query.resume) {
          const from = transcriptPath(dir, cwd, query.resume)
          if (!existsSync(from)) throw new Error(`No conversation found with session ID: ${query.resume}`)
          earlier = readFileSync(from, "utf8")
          query.resumedFrom = earlier
        }
        const to = transcriptPath(dir, cwd, sessionId)
        mkdirSync(join(to, ".."), { recursive: true })
        const replyRecord = `${JSON.stringify({ type: "assistant", sessionId, uuid: reply.uuid, text: `answer from ${dir}` })}\n`
        writeFileSync(to, `${earlier}${JSON.stringify({ type: "user", sessionId, prompt })}\n${replyWritten === undefined ? replyRecord : ""}`)
        if (typeof replyWritten === "number") setTimeout(() => appendFileSync(to, replyRecord), replyWritten)
      }
      yield reply
    })()
  },
  createSdkMcpServer: () => ({ type: "sdk", name: "test", instance: {} }),
  tool: () => ({}),
}), "account-return-trip.test.ts")

installLoggerMock(() => ({
  claudeLog: () => {},
  withClaudeLogContext: (_ctx: unknown, fn: () => unknown) => fn(),
}))

installMcpToolsMock(() => ({
  createOpencodeMcpServer: () => ({ type: "sdk", name: "opencode", instance: {} }),
}))

const { createProxyServer, clearSessionCache } = await import("../proxy/server")
const { resetActiveProfile } = await import("../proxy/profiles")
const { __setFetchOAuthUsageOverride, resetOAuthUsageCache } = await import("../proxy/oauthUsage")
const { rateLimitStore } = await import("../proxy/rateLimitStore")
const { setSessionStoreDir } = await import("../proxy/sessionStore")

type TestApp = { fetch: (r: Request) => Response | Promise<Response> }
type Message = { role: "user" | "assistant"; content: string }

/**
 * One turn of the conversation, keyed by `session`, or, for null, by its
 * fingerprint: a client that sends no session key (ForgeCode), working in the
 * test's directory.
 */
async function turn(app: TestApp, session: string | null, messages: Message[]) {
  const res = await app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: session === null
      ? { "Content-Type": "application/json", "x-meridian-agent": "forgecode" }
      : { "Content-Type": "application/json", "x-opencode-session": session },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 128, stream: false, messages,
      ...(session === null ? { system: `<current_working_directory>${root}</current_working_directory>` } : {}),
    }),
  }))
  expect(res.status).toBe(200)
}

async function setActive(app: TestApp, profile: string) {
  const res = await app.fetch(new Request("http://localhost/profiles/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile }),
  }))
  expect(res.status).toBe(200)
}

/** The same conversation: a turn on `work`, two on `personal`, then back to `work`. */
async function awayAndBack(app: TestApp, session: string | null): Promise<{ moved: SeenQuery; stayed: SeenQuery; back: SeenQuery }> {
  await setActive(app, "work")
  const history: Message[] = [{ role: "user", content: "FIRST-QUESTION" }]
  await turn(app, session, history)
  expect(seen.at(-1)?.dir).toContain("work")

  await setActive(app, "personal")
  history.push({ role: "assistant", content: "WORK-ANSWER-1" }, { role: "user", content: "SECOND-QUESTION" })
  await turn(app, session, history)
  const moved = seen.at(-1)!
  history.push({ role: "assistant", content: "PERSONAL-ANSWER-2" }, { role: "user", content: "THIRD-QUESTION" })
  await turn(app, session, history)
  const stayed = seen.at(-1)!
  expect(moved.dir).toContain("personal")
  expect(stayed.dir).toContain("personal")

  // Back. The session `work` holds ends at the first answer.
  await setActive(app, "work")
  history.push({ role: "assistant", content: "PERSONAL-ANSWER-3" }, { role: "user", content: "FOURTH-QUESTION" })
  await turn(app, session, history)
  const back = seen.at(-1)!
  expect(back.dir).toContain("work")
  return { moved, stayed, back }
}

const savedEnv: Record<string, string | undefined> = {}
let root = ""

beforeEach(() => {
  seen = []
  writeTranscripts = false
  nextReplyWritten = undefined
  refusing = undefined
  root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-return-trip-")))
  resetOAuthUsageCache()
  clearSessionCache()
  resetActiveProfile()
  rateLimitStore.clear()
  __setFetchOAuthUsageOverride(async () => null)
  for (const key of ["MERIDIAN_ROUTING", "MERIDIAN_PROFILE_ORDER", "MERIDIAN_SESSION_CARRY", "MERIDIAN_BUSY_RETRY_DELAY_MS"]) savedEnv[key] = process.env[key]
  process.env.MERIDIAN_ROUTING = "active+priority"
  process.env.MERIDIAN_PROFILE_ORDER = "work,personal"
  delete process.env.MERIDIAN_SESSION_CARRY
  delete process.env.MERIDIAN_BUSY_RETRY_DELAY_MS
})

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  __setFetchOAuthUsageOverride(null)
  rateLimitStore.clear()
  resetActiveProfile()
  rmSync(root, { recursive: true, force: true })
})

function createApp(): TestApp {
  const profiles = ["work", "personal"].map(id => ({ id, claudeConfigDir: join(root, id) }))
  return createProxyServer({ port: 0, host: "127.0.0.1", profiles, defaultProfile: "work" }).app
}

describe("a conversation that moves to another account and comes back", () => {
  it("is not resumed from the session it left there without the turns it took elsewhere", async () => {
    // No transcript to carry: the history is replayed, all of it.
    const { stayed, back } = await awayAndBack(createApp(), "rt-replay")
    // Where the newest copy is, the conversation still resumes: `work`'s
    // older copy says nothing about `personal`'s.
    expect(stayed.resume).toBeDefined()
    expect(stayed.prompt).not.toContain("<conversation_history>")
    const resumedStale = back.resume !== undefined && !back.prompt.includes("PERSONAL-ANSWER-2")
    expect({ resumedStale, prompt: back.prompt }).toEqual({ resumedStale: false, prompt: expect.stringContaining("FOURTH-QUESTION") })
    expect(back.prompt).toContain("PERSONAL-ANSWER-2")
    expect(back.prompt).toContain("PERSONAL-ANSWER-3")
  })

  it("carries its newest session to the account that serves it, there and back", async () => {
    writeTranscripts = true
    const { moved, stayed, back } = await awayAndBack(createApp(), "rt-carry")
    // The move resumes the session `work` wrote, carried to `personal`: the
    // turn is sent as a delta, not as a flattened replay.
    expect(moved.resume).toBeDefined()
    expect(moved.resumedFrom).toContain("FIRST-QUESTION")
    expect(moved.prompt).toContain("SECOND-QUESTION")
    expect(moved.prompt).not.toContain("<conversation_history>")
    expect(stayed.resume).toBeDefined()
    // And the way back resumes `personal`'s newest session, carried to
    // `work`, not the one `work` was left with.
    expect(back.resume).toBeDefined()
    expect(back.resumedFrom).toContain("THIRD-QUESTION")
    expect(back.prompt).toContain("FOURTH-QUESTION")
    expect(back.prompt).not.toContain("<conversation_history>")
    expect(back.prompt).not.toContain("SECOND-QUESTION")
  })

  // A client that sends no session key is keyed by its conversation's
  // fingerprint, which is kept per account just the same.
  it("is not resumed from the session it left there when it is keyed by its fingerprint", async () => {
    const { back } = await awayAndBack(createApp(), null)
    const resumedStale = back.resume !== undefined && !back.prompt.includes("PERSONAL-ANSWER-2")
    expect({ resumedStale, prompt: back.prompt }).toEqual({ resumedStale: false, prompt: expect.stringContaining("FOURTH-QUESTION") })
    expect(back.prompt).toContain("PERSONAL-ANSWER-3")
  })

  it("carries its newest session there and back when it is keyed by its fingerprint", async () => {
    writeTranscripts = true
    const { moved, back } = await awayAndBack(createApp(), null)
    expect(moved.resume).toBeDefined()
    expect(moved.resumedFrom).toContain("FIRST-QUESTION")
    expect(moved.prompt).not.toContain("<conversation_history>")
    expect(back.resume).toBeDefined()
    expect(back.resumedFrom).toContain("THIRD-QUESTION")
    expect(back.prompt).toContain("FOURTH-QUESTION")
    expect(back.prompt).not.toContain("<conversation_history>")
  })

  it("carries the session it went on in elsewhere when its own copy no longer matches its history", async () => {
    writeTranscripts = true
    const app = createApp()
    await setActive(app, "work")
    await turn(app, "rt-compacted", [{ role: "user", content: "FIRST-QUESTION" }])
    // On `personal` the client compacts: its history starts again from a
    // summary, which no copy holds, and is replayed there once.
    await setActive(app, "personal")
    const history: Message[] = [
      { role: "user", content: "SUMMARY-OF-FIRST" }, { role: "assistant", content: "NOTED" },
      { role: "user", content: "SECOND-QUESTION" },
    ]
    await turn(app, "rt-compacted", history)
    history.push({ role: "assistant", content: "PERSONAL-ANSWER-2" }, { role: "user", content: "THIRD-QUESTION" })
    await turn(app, "rt-compacted", history)
    // Back on `work`, whose copy begins with the first question.
    await setActive(app, "work")
    history.push({ role: "assistant", content: "PERSONAL-ANSWER-3" }, { role: "user", content: "FOURTH-QUESTION" })
    await turn(app, "rt-compacted", history)
    const back = seen.at(-1)!
    expect(back.dir).toContain("work")
    expect({ resumed: back.resume !== undefined, replayed: back.prompt.includes("<conversation_history>") }).toEqual({ resumed: true, replayed: false })
    expect(back.resumedFrom).toContain("THIRD-QUESTION")
    expect(back.prompt).toContain("FOURTH-QUESTION")
  })

  it("replays rather than carry a session that would leave out a reply given after it", async () => {
    writeTranscripts = true
    const app = createApp()
    await setActive(app, "work")
    await turn(app, "rt-gap", [{ role: "user", content: "FIRST-QUESTION" }])
    // The history the client sends next holds a reply no copy wrote: resumed
    // from `work`'s copy, the turns after it go as a delta of the user's side.
    await setActive(app, "personal")
    await turn(app, "rt-gap", [
      { role: "user", content: "FIRST-QUESTION" }, { role: "assistant", content: "WORK-ANSWER-1" },
      { role: "user", content: "SECOND-QUESTION" }, { role: "assistant", content: "ANSWER-NO-COPY-HOLDS" },
      { role: "user", content: "THIRD-QUESTION" },
    ])
    const moved = seen.at(-1)!
    expect(moved.dir).toContain("personal")
    expect(moved.prompt).toContain("ANSWER-NO-COPY-HOLDS")
  })

  it("replays instead of carrying when MERIDIAN_SESSION_CARRY=0", async () => {
    writeTranscripts = true
    process.env.MERIDIAN_SESSION_CARRY = "0"
    const { moved, back } = await awayAndBack(createApp(), "rt-off")
    expect(moved.resume).toBeUndefined()
    expect(moved.prompt).toContain("<conversation_history>")
    expect(back.resume).toBeUndefined()
    expect(back.prompt).toContain("PERSONAL-ANSWER-3")
  })

  it("resumes its own session when the user rewinds, after a move and back, to a point it holds", async () => {
    writeTranscripts = true
    const app = createApp()
    await setActive(app, "work")
    await turn(app, "rt-rewind", [{ role: "user", content: "FIRST-QUESTION" }])
    const workSession = seen.at(-1)!.target
    await setActive(app, "personal")
    await turn(app, "rt-rewind", [
      { role: "user", content: "FIRST-QUESTION" }, { role: "assistant", content: "WORK-ANSWER-1" },
      { role: "user", content: "SECOND-QUESTION" },
    ])
    await turn(app, "rt-rewind", [
      { role: "user", content: "FIRST-QUESTION" }, { role: "assistant", content: "WORK-ANSWER-1" },
      { role: "user", content: "SECOND-QUESTION" }, { role: "assistant", content: "PERSONAL-ANSWER-2" },
      { role: "user", content: "THIRD-QUESTION" },
    ])
    // Back on `work`, the user edits the second question. What is left of
    // the history before it was all written on `work`, and `personal`'s
    // copy, gone further, holds no more of it.
    await setActive(app, "work")
    await turn(app, "rt-rewind", [
      { role: "user", content: "FIRST-QUESTION" }, { role: "assistant", content: "WORK-ANSWER-1" },
      { role: "user", content: "SECOND-QUESTION-EDITED" },
    ])
    const back = seen.at(-1)!
    expect(back.dir).toContain("work")
    expect({ resume: back.resume, replayed: back.prompt.includes("<conversation_history>") }).toEqual({ resume: workSession, replayed: false })
    expect(back.prompt).toContain("SECOND-QUESTION-EDITED")
  })

  it("leaves an account's own session as it was when the account it was carried to refuses", async () => {
    writeTranscripts = true
    const app = createApp()
    await setActive(app, "personal")
    await turn(app, "rt-refused", [{ role: "user", content: "FIRST-QUESTION" }])
    const personalSession = seen.at(-1)!.target
    // `work` comes first again and the conversation is carried there, but
    // its API refuses the turn. The request fails over to `personal`, whose
    // own copy is as current as the one just carried from it.
    await setActive(app, "work")
    refusing = "work"
    await turn(app, "rt-refused", [
      { role: "user", content: "FIRST-QUESTION" }, { role: "assistant", content: "PERSONAL-ANSWER-1" },
      { role: "user", content: "SECOND-QUESTION" },
    ])
    expect(seen.some(query => query.dir.endsWith("/work"))).toBe(true)
    const served = seen.at(-1)!
    expect(served.dir).toContain("personal")
    expect(served.resume).toBe(personalSession)
  }, 20_000)

  it("waits for the reply the other account is still writing before carrying its session", async () => {
    writeTranscripts = true
    const app = createApp()
    await setActive(app, "work")
    // The turn ends before its reply reaches the transcript: the CLI batches
    // its writes, and its subprocess can still be exiting when the next
    // request arrives.
    nextReplyWritten = 1000
    await turn(app, "rt-late", [{ role: "user", content: "FIRST-QUESTION" }])
    const workTurn = seen.at(-1)!
    await setActive(app, "personal")
    await turn(app, "rt-late", [
      { role: "user", content: "FIRST-QUESTION" }, { role: "assistant", content: "WORK-ANSWER-1" },
      { role: "user", content: "SECOND-QUESTION" },
    ])
    const moved = seen.at(-1)!
    expect(moved.resume).toBeDefined()
    expect(moved.resumedFrom).toContain(`"text":"answer from ${workTurn.dir}"`)
  })

  it("replays rather than carry a session whose last reply never reached its transcript", async () => {
    writeTranscripts = true
    process.env.MERIDIAN_BUSY_RETRY_DELAY_MS = "10"
    const app = createApp()
    await setActive(app, "work")
    nextReplyWritten = "never"
    await turn(app, "rt-unwritten", [{ role: "user", content: "FIRST-QUESTION" }])
    await setActive(app, "personal")
    await turn(app, "rt-unwritten", [
      { role: "user", content: "FIRST-QUESTION" }, { role: "assistant", content: "WORK-ANSWER-1" },
      { role: "user", content: "SECOND-QUESTION" },
    ])
    const moved = seen.at(-1)!
    expect(moved.resume).toBeUndefined()
    expect(moved.prompt).toContain("WORK-ANSWER-1")
  })

  it("lets go of a carry cancelled with its request at once", async () => {
    // Cancelled while it waits for a reply that never lands: the session it
    // prepared on `personal` is retired for deletion then, not left prepared
    // until its lease runs out.
    writeTranscripts = true
    setSessionStoreDir(join(root, "sessions"))
    try {
      const app = createApp()
      await setActive(app, "work")
      nextReplyWritten = "never"
      await turn(app, "rt-cancel", [{ role: "user", content: "FIRST-QUESTION" }])
      await setActive(app, "personal")
      const personalStates = () => {
        const sidecar = join(root, "sessions", "session-gc.json")
        if (!existsSync(sidecar)) return []
        const { resources } = JSON.parse(readFileSync(sidecar, "utf8")) as {
          resources: Record<string, { state: string; locator: { configDir: string } }>
        }
        return Object.values(resources)
          .filter(resource => resource.locator.configDir === join(root, "personal"))
          .map(resource => resource.state)
      }
      const cancel = new AbortController()
      const pending = app.fetch(new Request("http://localhost/v1/messages", {
        method: "POST",
        signal: cancel.signal,
        headers: { "Content-Type": "application/json", "x-opencode-session": "rt-cancel" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 128, stream: false, messages: [
          { role: "user", content: "FIRST-QUESTION" }, { role: "assistant", content: "WORK-ANSWER-1" },
          { role: "user", content: "SECOND-QUESTION" },
        ] }),
      }))
      await until(() => personalStates().includes("prepared"))
      const cancelledAt = Date.now()
      cancel.abort()
      await Promise.resolve(pending).catch((error: unknown) => error)
      // Ended by the cancel, not by the wait for the reply running out.
      expect(Date.now() - cancelledAt).toBeLessThan(1500)
      await until(() => !personalStates().includes("prepared"))
      expect(personalStates()).toContain("retired")
    } finally {
      setSessionStoreDir(null)
    }
  })
})

async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`not so after ${timeoutMs} ms`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
