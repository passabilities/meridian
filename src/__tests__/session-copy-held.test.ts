/**
 * What a session holds of a history, and what resuming it would leave out.
 *
 * A resume sends the turns after what the session holds as a delta, and the
 * delta keeps only the user's side of them: the assistant's, for turns the
 * session wrote itself, are already in it. A reply the session did not write
 * is lost to the model.
 */
import { describe, it, expect } from "bun:test"
import { messagesHeld, resumeDropsReplies } from "../proxy/session/cache"
import type { LineageResult, SessionState } from "../proxy/session/lineage"

const session: SessionState = { claudeSessionId: "s", lastAccess: 0, messageCount: 1, lineageHash: "h" }
const user = (text: string) => ({ role: "user", content: text })
const assistant = (text: string) => ({ role: "assistant", content: text })
const continuation = (resumeFrom: number): LineageResult => ({ type: "continuation", session, resumeFrom })

describe("messagesHeld", () => {
  it("counts what a continuation resumes from and the reply it wrote to it", () => {
    expect(messagesHeld(continuation(1), [user("q1"), assistant("a1"), user("q2")])).toBe(2)
  })

  it("counts nothing of a diverged session", () => {
    expect(messagesHeld({ type: "diverged", reason: "unrelated-history" }, [user("q1")])).toBe(0)
  })
})

describe("resumeDropsReplies", () => {
  it("is false for the next turn: the session's own reply, then the user's", () => {
    expect(resumeDropsReplies(continuation(1), [user("q1"), assistant("a1"), user("q2")])).toBe(false)
  })

  it("is false for several user turns queued after the session's reply", () => {
    expect(resumeDropsReplies(continuation(1), [user("q1"), assistant("a1"), user("q2"), user("q3")])).toBe(false)
  })

  it("is true when the history holds a reply given after the session's own", () => {
    // Served somewhere this session was not: its delta would carry a2 as
    // nothing, and the model would answer q3 without it.
    expect(resumeDropsReplies(continuation(1), [user("q1"), assistant("a1"), user("q2"), assistant("a2"), user("q3")])).toBe(true)
  })

  it("is false for a prefill: the history's last message, the start of the reply asked for", () => {
    expect(resumeDropsReplies(continuation(1), [user("q1"), assistant("a1"), user("q2"), assistant("prefill")])).toBe(false)
  })

  it("is false for a session that is not resumed from a delta", () => {
    expect(resumeDropsReplies({ type: "diverged", reason: "not-found" }, [user("q1"), assistant("a1"), user("q2")])).toBe(false)
  })
})
