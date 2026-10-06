/**
 * The file work of carrying a conversation's SDK session to another account
 * (sessionCarry.ts): finding the transcript under one config directory and
 * copying it into another's, as a new session.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
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

  it("leaves only the whole file, even written twice under one id", async () => {
    const source = join(root, "from", "projects", "-work-repo", "s-1.jsonl")
    mkdirSync(join(source, ".."), { recursive: true })
    writeFileSync(source, `${record({ sessionId: "s-1" })}\n`)
    await copyTranscriptAs(source, join(root, "to"), "s-2")
    // The carry always names a new session; were it not, the second copy
    // would replace the first whole, by rename, never leaving a part behind.
    await copyTranscriptAs(source, join(root, "to"), "s-2")
    expect(readdirSync(join(root, "to", "projects", "-work-repo"))).toEqual(["s-2.jsonl"])
    expect(readFileSync(join(root, "to", "projects", "-work-repo", "s-2.jsonl"), "utf8")).toBe(`${record({ sessionId: "s-2" })}\n`)
  })
})
