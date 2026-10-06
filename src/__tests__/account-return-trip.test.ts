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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installSdkMock } from "./sdkMock"
import { installLoggerMock } from "./loggerMock"
import { installMcpToolsMock } from "./mcpToolsMock"
import { assistantMessage, resolveMockSdkSessionId } from "./helpers"

interface SeenQuery {
  dir: string
  resume: string | undefined
  prompt: string
  /** The resumed session's transcript, as the CLI would have read it. */
  resumedFrom?: string
}
let seen: SeenQuery[] = []
let writeTranscripts = false

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
    return (async function* () {
      const prompt = await promptText(params.prompt)
      const query: SeenQuery = { dir, resume: params.options?.resume, prompt }
      seen.push(query)
      if (writeTranscripts) {
        // As the CLI: a resume reads the session from this config directory
        // only, and the turn is written to the session it forks into.
        let earlier = ""
        if (query.resume) {
          const from = transcriptPath(dir, cwd, query.resume)
          if (!existsSync(from)) throw new Error(`No conversation found with session ID: ${query.resume}`)
          earlier = readFileSync(from, "utf8")
          query.resumedFrom = earlier
        }
        const to = transcriptPath(dir, cwd, sessionId)
        mkdirSync(join(to, ".."), { recursive: true })
        writeFileSync(to, `${earlier}${JSON.stringify({ type: "user", sessionId, prompt })}\n${JSON.stringify({ type: "assistant", sessionId, text: `answer from ${dir}` })}\n`)
      }
      yield { ...assistantMessage([{ type: "text", text: `answer from ${dir}` }]), session_id: sessionId }
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

type TestApp = { fetch: (r: Request) => Response | Promise<Response> }
type Message = { role: "user" | "assistant"; content: string }

async function turn(app: TestApp, session: string, messages: Message[]) {
  const res = await app.fetch(new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-opencode-session": session },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 128, stream: false, messages }),
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
async function awayAndBack(app: TestApp, session: string): Promise<{ moved: SeenQuery; stayed: SeenQuery; back: SeenQuery }> {
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
  root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-return-trip-")))
  resetOAuthUsageCache()
  clearSessionCache()
  resetActiveProfile()
  rateLimitStore.clear()
  __setFetchOAuthUsageOverride(async () => null)
  for (const key of ["MERIDIAN_ROUTING", "MERIDIAN_PROFILE_ORDER", "MERIDIAN_SESSION_CARRY"]) savedEnv[key] = process.env[key]
  process.env.MERIDIAN_ROUTING = "active+priority"
  process.env.MERIDIAN_PROFILE_ORDER = "work,personal"
  delete process.env.MERIDIAN_SESSION_CARRY
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

  it("replays instead of carrying when MERIDIAN_SESSION_CARRY=0", async () => {
    writeTranscripts = true
    process.env.MERIDIAN_SESSION_CARRY = "0"
    const { moved, back } = await awayAndBack(createApp(), "rt-off")
    expect(moved.resume).toBeUndefined()
    expect(moved.prompt).toContain("<conversation_history>")
    expect(back.resume).toBeUndefined()
    expect(back.prompt).toContain("PERSONAL-ANSWER-3")
  })
})
