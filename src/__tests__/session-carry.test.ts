/**
 * The file work of carrying a conversation's SDK session to another account
 * (sessionCarry.ts): finding the transcript under one config directory and
 * copying it into another's, as a new session.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { copyTranscriptAs, findTranscriptFile, projectFolderName, transcriptAs } from "../proxy/sessionCarry"

let root = ""
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "meridian-session-carry-"))) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const record = (fields: Record<string, unknown>) => JSON.stringify(fields)

describe("projectFolderName", () => {
  it("is the project directory with every character but letters and digits made a dash, as the CLI names it", () => {
    expect(projectFolderName("/Users/someone/Projects/my.app")).toBe("-Users-someone-Projects-my-app")
  })

  it("is not given for a directory the CLI shortens with a hash of its own", () => {
    expect(projectFolderName(`/${"a".repeat(200)}`)).toBeUndefined()
    expect(projectFolderName(`/${"a".repeat(199)}`)).toBe(`-${"a".repeat(199)}`)
  })
})

describe("transcriptAs", () => {
  it("gives every record the new session id and leaves the rest of it as it was", () => {
    const text = [
      record({ type: "user", sessionId: "old", uuid: "u-1", parentUuid: null, message: { role: "user", content: "hi" } }),
      record({ type: "assistant", sessionId: "old", uuid: "a-1", parentUuid: "u-1", message: { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig" }] } }),
      "",
    ].join("\n")
    const lines = transcriptAs(text, "new").split("\n")
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]!)).toEqual({ type: "user", sessionId: "new", uuid: "u-1", parentUuid: null, message: { role: "user", content: "hi" } })
    expect(JSON.parse(lines[1]!)).toMatchObject({ sessionId: "new", uuid: "a-1", parentUuid: "u-1", message: { content: [{ signature: "sig" }] } })
    expect(lines[2]).toBe("")
  })

  it("leaves a record without a session id, and a line that is not one, as they were", () => {
    const summary = record({ type: "summary", summary: "x", leafUuid: "a-1" })
    const torn = "{\"type\":\"user\",\"sessionId\":\"old\",\"mess"
    expect(transcriptAs(`${summary}\n${torn}`, "new")).toBe(`${summary}\n${torn}`)
  })
})

describe("findTranscriptFile", () => {
  it("finds a session in its project's folder", async () => {
    const folder = join(root, "account", "projects", "-work-repo")
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, "s-1.jsonl"), "{}\n")
    expect(await findTranscriptFile(join(root, "account"), "s-1", "/work/repo")).toBe(join(folder, "s-1.jsonl"))
  })

  it("finds it in whichever folder holds it when the project's own name is not known", async () => {
    const folder = join(root, "account", "projects", "-shortened-abc123")
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, "s-2.jsonl"), "{}\n")
    expect(await findTranscriptFile(join(root, "account"), "s-2", `/${"a".repeat(250)}`)).toBe(join(folder, "s-2.jsonl"))
  })

  it("finds nothing where there is no such session, or no projects at all", async () => {
    mkdirSync(join(root, "account", "projects", "-work-repo"), { recursive: true })
    expect(await findTranscriptFile(join(root, "account"), "missing", "/work/repo")).toBeUndefined()
    expect(await findTranscriptFile(join(root, "empty"), "missing", "/work/repo")).toBeUndefined()
  })

  it("looks past a file among the project folders, as Finder leaves one", async () => {
    const projects = join(root, "account", "projects")
    mkdirSync(join(projects, "-work-repo"), { recursive: true })
    writeFileSync(join(projects, ".DS_Store"), "")
    expect(await findTranscriptFile(join(root, "account"), "missing", `/${"a".repeat(250)}`)).toBeUndefined()
  })
})

describe("copyTranscriptAs", () => {
  it("writes the copy into the same project folder under the other config directory, as the new session", async () => {
    const source = join(root, "from", "projects", "-work-repo", "s-1.jsonl")
    mkdirSync(join(source, ".."), { recursive: true })
    writeFileSync(source, `${record({ type: "user", sessionId: "s-1", uuid: "u-1" })}\n`)
    const target = await copyTranscriptAs(source, join(root, "to"), "s-2")
    expect(target).toBe(join(root, "to", "projects", "-work-repo", "s-2.jsonl"))
    expect(JSON.parse(readFileSync(target, "utf8").split("\n")[0]!)).toEqual({ type: "user", sessionId: "s-2", uuid: "u-1" })
    // Nothing half-written is left beside it, and the source is untouched.
    expect(readdirSync(join(root, "to", "projects", "-work-repo"))).toEqual(["s-2.jsonl"])
    expect(readFileSync(source, "utf8")).toContain("\"sessionId\":\"s-1\"")
  })

  it("is readable by its owner alone, as the CLI keeps its own transcripts", async () => {
    const source = join(root, "from", "projects", "-work-repo", "s-1.jsonl")
    mkdirSync(join(source, ".."), { recursive: true })
    writeFileSync(source, `${record({ sessionId: "s-1" })}\n`, { mode: 0o600 })
    const target = await copyTranscriptAs(source, join(root, "to"), "s-2")
    expect(statSync(target).mode & 0o777).toBe(0o600)
    expect(statSync(join(root, "to", "projects")).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, "to", "projects", "-work-repo")).mode & 0o777).toBe(0o700)
  })

  it("never writes over a transcript already there", async () => {
    const source = join(root, "from", "projects", "-work-repo", "s-1.jsonl")
    mkdirSync(join(source, ".."), { recursive: true })
    writeFileSync(source, `${record({ sessionId: "s-1" })}\n`)
    const target = await copyTranscriptAs(source, join(root, "to"), "s-2")
    // The carry always names a new session; one already there is not its own.
    writeFileSync(source, `${record({ sessionId: "s-1", uuid: "later" })}\n`)
    await expect(copyTranscriptAs(source, join(root, "to"), "s-2")).rejects.toThrow()
    expect(readdirSync(join(root, "to", "projects", "-work-repo"))).toEqual(["s-2.jsonl"])
    expect(readFileSync(target, "utf8")).toBe(`${record({ sessionId: "s-2" })}\n`)
  })

  it("waits for the records it must hold, which the session's last process may still be writing", async () => {
    const source = join(root, "from", "projects", "-work-repo", "s-1.jsonl")
    mkdirSync(join(source, ".."), { recursive: true })
    writeFileSync(source, `${record({ sessionId: "s-1", uuid: "u-1" })}\n`)
    setTimeout(() => appendFileSync(source, `${record({ sessionId: "s-1", uuid: "a-1", parentUuid: "u-1" })}\n`), 50)
    const target = await copyTranscriptAs(source, join(root, "to"), "s-2", { holding: ["a-1"], waitMs: 2000 })
    expect(readFileSync(target, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line).uuid)).toEqual(["u-1", "a-1"])
  })

  it("copies nothing from a transcript that never gets them", async () => {
    const source = join(root, "from", "projects", "-work-repo", "s-1.jsonl")
    mkdirSync(join(source, ".."), { recursive: true })
    // Named only as a parent, the record is not there.
    writeFileSync(source, `${record({ sessionId: "s-1", uuid: "u-1", parentUuid: "a-1" })}\n`)
    await expect(copyTranscriptAs(source, join(root, "to"), "s-2", { holding: ["a-1"], waitMs: 50 })).rejects.toThrow("a-1")
    expect(existsSync(join(root, "to"))).toBe(false)
  })

  it("stops waiting when its request is cancelled", async () => {
    const source = join(root, "from", "projects", "-work-repo", "s-1.jsonl")
    mkdirSync(join(source, ".."), { recursive: true })
    writeFileSync(source, `${record({ sessionId: "s-1", uuid: "u-1" })}\n`)
    const cancel = new AbortController()
    setTimeout(() => cancel.abort(), 20)
    const started = Date.now()
    await expect(copyTranscriptAs(source, join(root, "to"), "s-2", { holding: ["a-1"], waitMs: 5000, signal: cancel.signal })).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(existsSync(join(root, "to"))).toBe(false)
  })
})
