/**
 * Carrying a conversation's SDK session to another account.
 *
 * Each account's SDK child keeps its transcripts under that account's
 * CLAUDE_CONFIG_DIR and resumes a session only from there. A conversation that
 * moved to another account was replayed there from the client's history,
 * flattened: its assistant turns as bracketed text in one user message, their
 * thinking gone. The model re-plans from that, at many times a resumed turn's
 * output, and the conversation goes on in that form.
 *
 * Copied into the new account's directory, the session resumes there as it
 * would have where it was: the same messages, the same system prompt (the CLI
 * resends a session's first one), and the same message UUIDs, which the
 * conversation's stored resume points name. What the new account pays is what
 * a direct client switching accounts pays: the prompt written to its cache.
 *
 * File work only. Which session is carried, and when, is the server's.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

/**
 * The longest folder name the CLI gives a project directory as it is. Longer
 * ones it cuts and suffixes with a hash of its own (2.1.284); those are found
 * by looking.
 */
const PROJECT_FOLDER_MAX = 200

/** The CLI's folder under `projects/` for a project directory, when it is not one it shortens. */
export function projectFolderName(projectDir: string): string | undefined {
  const name = projectDir.replace(/[^a-zA-Z0-9]/g, "-")
  return name.length <= PROJECT_FOLDER_MAX ? name : undefined
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    // ENOTDIR: a path through a file, as one beside the project folders gives.
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return false
    throw error
  }
}

/**
 * Where an SDK session's transcript is under a config directory: in its
 * project's folder, or failing that in whichever folder holds that session id.
 * Undefined when there is none.
 */
export async function findTranscriptFile(configDir: string, sessionId: string, projectDir?: string): Promise<string | undefined> {
  const projects = join(configDir, "projects")
  const own = projectDir ? projectFolderName(projectDir) : undefined
  if (own && await isFile(join(projects, own, `${sessionId}.jsonl`))) return join(projects, own, `${sessionId}.jsonl`)
  let folders: string[]
  try {
    folders = await readdir(projects)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  for (const folder of folders) {
    const path = join(projects, folder, `${sessionId}.jsonl`)
    if (await isFile(path)) return path
  }
  return undefined
}

/**
 * A transcript's text as session `sessionId`: each record's own `sessionId`
 * rewritten, everything else (message UUIDs among it) as it was. A line that
 * is not a JSON object is kept as it is.
 */
export function transcriptAs(text: string, sessionId: string): string {
  return text.split("\n").map(line => {
    if (!line.trim()) return line
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      // Not a record the CLI wrote whole (a torn last line): left for the CLI to judge.
      return line
    }
    if (typeof record !== "object" || record === null || Array.isArray(record) || !("sessionId" in record)) return line
    return JSON.stringify({ ...record, sessionId })
  }).join("\n")
}

/** The UUIDs of a transcript's records, each its own line. */
function recordUuids(text: string): Set<string> {
  const uuids = new Set<string>()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      // A torn last line, still being written: not a record yet.
      continue
    }
    if (typeof record === "object" && record !== null && "uuid" in record && typeof record.uuid === "string") uuids.add(record.uuid)
  }
  return uuids
}

/**
 * How often a transcript still missing a record is read again: the CLI
 * batches its transcript writes on a timer this long (2.1.284).
 */
const RECORD_POLL_MS = 100

export interface CopyTranscriptOptions {
  /**
   * Records the copy must hold, by UUID: the session's last turn. The
   * session's previous process can still be writing that turn when the next
   * request arrives (the CLI batches its writes, and the process exits after
   * the turn is answered), and a copy taken before it lands would resume
   * without it.
   */
  readonly holding?: readonly string[]
  /** How long to wait for them, in milliseconds. */
  readonly waitMs?: number
  /** Ends the wait, as the request that wants the copy is cancelled. */
  readonly signal?: AbortSignal
}

/**
 * Copy a transcript into another config directory, into the same project
 * folder, as session `sessionId`, once it holds every record in `holding`.
 * Only its owner can read the copy, as the CLI keeps its own (0600): it holds
 * the conversation. It is written in place, never over a file already there:
 * nothing reads the session until it is handed out as the conversation's, and
 * one cut short is deleted with the prepared session it is
 * (sessionLifecycle.ts). Returns its path.
 */
export async function copyTranscriptAs(
  sourcePath: string,
  targetConfigDir: string,
  sessionId: string,
  { holding = [], waitMs = 0, signal }: CopyTranscriptOptions = {},
): Promise<string> {
  const deadline = Date.now() + waitMs
  let text: string
  for (;;) {
    if (signal?.aborted) throw signal.reason
    text = await readFile(sourcePath, "utf8")
    const uuids = recordUuids(text)
    const missing = holding.filter(uuid => !uuids.has(uuid))
    if (missing.length === 0) break
    const left = deadline - Date.now()
    if (left <= 0) throw new Error(`the transcript does not hold the session's last turn (${missing.join(", ")})`)
    await sleep(Math.min(RECORD_POLL_MS, left), undefined, { signal })
  }
  const folder = join(targetConfigDir, "projects", basename(dirname(sourcePath)))
  const target = join(folder, `${sessionId}.jsonl`)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  await writeFile(target, transcriptAs(text, sessionId), { flag: "wx", mode: 0o600 })
  return target
}
