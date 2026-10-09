/**
 * Tests for the Claude Code CLI adapter.
 *
 * Claude Code's request shape differs from the other adapters in two ways
 * that this adapter handles:
 *  - It usually runs on a different host than the proxy, so its local CWD
 *    must not be used as the SDK subprocess cwd.
 *  - It embeds working-directory info as `Primary working directory: …`
 *    inside a `# Environment` section rather than the `<env>…</env>` block
 *    OpenCode uses.
 */
import { describe, it, expect } from "bun:test"
import type { Context } from "hono"
import { agentSummaryReplayMessages, CLAUDE_CODE_AGENT_ID_HEADER, claudeCodeAdapter, claudeCodeAuxiliaryPromptGrows, claudeCodeSessionKey, isClaudeCodeAuxiliaryRequest, sideForkReplayMessages } from "../proxy/adapters/claudecode"

describe("claudeCodeAdapter — identity", () => {
  it("has name 'claude-code'", () => {
    expect(claudeCodeAdapter.name).toBe("claude-code")
  })
})

describe("claudeCodeAdapter — where its environment is", () => {
  it("may run elsewhere than the proxy, and shares the child's environment when it is on this host in the child's directory", () => {
    expect(claudeCodeAdapter.clientEnvironmentMayDifferFromProxy).toBe(true)
    expect(claudeCodeAdapter.sharesEnvironmentOnLoopback).toBe(true)
  })
})

describe("claudeCodeAdapter.getSessionId", () => {
  it("extracts a session ID from Claude Code's JSON-string metadata", () => {
    // Any unrelated header value is ignored; only the agent-id header keys.
    const ctx = {
      req: { header: (name: string) => name === CLAUDE_CODE_AGENT_ID_HEADER ? undefined : "any-value" },
    }
    const body = {
      metadata: {
        user_id: JSON.stringify({
          device_id: "device-1",
          account_uuid: "",
          session_id: "session-from-metadata",
        }),
      },
    }
    expect(claudeCodeAdapter.getSessionId(ctx as any, body)).toBe("session-from-metadata")
  })

  it("accepts object-form metadata for compatible gateways", () => {
    const ctx = { req: { header: () => undefined } }
    const body = { metadata: { user_id: { session_id: "object-session" } } }
    expect(claudeCodeAdapter.getSessionId(ctx as any, body)).toBe("object-session")
  })

  it("keeps the key equal to session_id when parent linkage is present", () => {
    // parent_session_id is additive (#902): it must never change the key a
    // client's cached mappings are already stored under.
    const ctx = { req: { header: () => undefined } }
    const body = {
      metadata: { user_id: JSON.stringify({ session_id: "child", parent_session_id: "parent" }) },
    }
    expect(claudeCodeAdapter.getSessionId(ctx as any, body)).toBe("child")
    expect(claudeCodeAdapter.getParentSessionId!(ctx as any, body)).toBe("parent")
  })

  it("reports no parent for a root session", () => {
    const ctx = { req: { header: () => undefined } }
    expect(claudeCodeAdapter.getParentSessionId!(ctx as any, {
      metadata: { user_id: JSON.stringify({ session_id: "root" }) },
    })).toBeUndefined()
  })

  it("falls back to fingerprinting when metadata is absent or malformed", () => {
    const ctx = { req: { header: () => undefined } }
    expect(claudeCodeAdapter.getSessionId(ctx as any, {})).toBeUndefined()
    expect(claudeCodeAdapter.getSessionId(ctx as any, {
      metadata: { user_id: "not-json" },
    })).toBeUndefined()
    expect(claudeCodeAdapter.getSessionId(ctx as any, {
      metadata: { user_id: JSON.stringify({ device_id: "device-1" }) },
    })).toBeUndefined()
  })

  it("ignores unrelated session headers", () => {
    const ctx = {
      req: {
        header: (name: string) =>
          name === "x-opencode-session" ? "sess-abc" : undefined,
      },
    }
    expect(claudeCodeAdapter.getSessionId(ctx as any, {})).toBeUndefined()
  })
})

describe("Claude Code subagent session keys", () => {
  const body = { metadata: { user_id: JSON.stringify({ session_id: "parent-sid" }) } }
  const withAgent = (agentId?: string): Context => {
    const ctx = { req: { header: (name: string) => (name === CLAUDE_CODE_AGENT_ID_HEADER ? agentId : undefined) } }
    return ctx as unknown as Context
  }

  it("keys the main conversation by its bare session id", () => {
    expect(claudeCodeAdapter.getSessionId(withAgent(), body)).toBe("parent-sid")
  })

  it("keys an Agent-tool subagent by session id and agent id", () => {
    expect(claudeCodeAdapter.getSessionId(withAgent("a4a81dc1bbf7ee837"), body))
      .toBe("parent-sid:agent:a4a81dc1bbf7ee837")
  })

  it("gives parallel subagents distinct keys", () => {
    const first = claudeCodeAdapter.getSessionId(withAgent("a9b1a8c1cf8639b90"), body)
    const second = claudeCodeAdapter.getSessionId(withAgent("a974a04cc37ab3ce8"), body)
    expect(first).not.toBe(second)
  })

  it("ignores a malformed or oversized agent id", () => {
    for (const agentId of ["", "has space", "a/b", "é", "x".repeat(129)]) {
      expect(claudeCodeAdapter.getSessionId(withAgent(agentId), body)).toBe("parent-sid")
    }
    expect(claudeCodeSessionKey("x".repeat(128), body)).toBe(`parent-sid:agent:${"x".repeat(128)}`)
  })

  it("never manufactures a key from an agent id alone", () => {
    expect(claudeCodeAdapter.getSessionId(withAgent("a4a81dc1bbf7ee837"), {})).toBeUndefined()
    expect(claudeCodeSessionKey("a4a81dc1bbf7ee837", { metadata: { user_id: "not-json" } })).toBeUndefined()
  })

  it("roots main and subagent requests at the bare session id", () => {
    expect(claudeCodeAdapter.getRootSessionId!(withAgent(), body)).toBe("parent-sid")
    expect(claudeCodeAdapter.getRootSessionId!(withAgent("a4a81dc1bbf7ee837"), body)).toBe("parent-sid")
  })

  it("declares no parent lineage for a subagent", () => {
    expect(claudeCodeAdapter.getParentSessionId!(withAgent("a4a81dc1bbf7ee837"), body)).toBeUndefined()
  })
})

describe("claudeCodeAdapter.extractWorkingDirectory", () => {
  it("always returns undefined so the SDK falls back to a valid host path", () => {
    expect(
      claudeCodeAdapter.extractWorkingDirectory({
        system:
          "# Environment\n - Primary working directory: /Users/alice/projects/app",
      })
    ).toBeUndefined()
  })

  it("returns undefined for array system prompts too", () => {
    expect(
      claudeCodeAdapter.extractWorkingDirectory({
        system: [
          { type: "text", text: "# Environment" },
          { type: "text", text: " - Primary working directory: /tmp/demo" },
        ],
      })
    ).toBeUndefined()
  })

  it("returns undefined when no system prompt is present", () => {
    expect(claudeCodeAdapter.extractWorkingDirectory({})).toBeUndefined()
  })
})

describe("claudeCodeAdapter.extractClientWorkingDirectory", () => {
  it("extracts CWD from a string system prompt", () => {
    const body = {
      system:
        "# Environment\nYou have been invoked in the following environment:\n - Primary working directory: /Users/alice/projects/app\n - Is directory a git repo: Yes",
    }
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!(body)
    ).toBe("/Users/alice/projects/app")
  })

  it("extracts CWD from an array system prompt", () => {
    const body = {
      system: [
        { type: "text", text: "# Environment" },
        { type: "text", text: " - Primary working directory: /tmp/my-repo" },
        { type: "text", text: " - Platform: linux" },
      ],
    }
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!(body)
    ).toBe("/tmp/my-repo")
  })

  it("is case-insensitive on the 'Primary working directory:' label", () => {
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!({
        system: "primary working directory: /home/user/project",
      })
    ).toBe("/home/user/project")
  })

  it("trims trailing whitespace from the captured path", () => {
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!({
        system: "Primary working directory:    /path/with/padding   \n",
      })
    ).toBe("/path/with/padding")
  })

  it("returns undefined when the system prompt is missing", () => {
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!({})
    ).toBeUndefined()
  })

  // Where Claude Code 2.1.290 sends its environment: a system turn among the
  // messages, or a reminder block opening the first user message.
  const environment = (cwd: string) =>
    `# Environment\nYou have been invoked in the following environment: \n - Primary working directory: ${cwd}\n - Is a git repository: false\n - Platform: darwin`
  const reminder = (text: string) => ({ type: "text", text: `<system-reminder>\n${text}\n</system-reminder>` })
  const cwdOf = (body: unknown) => claudeCodeAdapter.extractClientWorkingDirectory!(body)

  it("extracts CWD from a system turn among the messages", () => {
    expect(cwdOf({
      system: [{ type: "text", text: "You are an interactive agent." }],
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "system", content: [{ type: "text", text: environment("/Users/alice/projects/app"), cache_control: { type: "ephemeral" } }] },
      ],
    })).toBe("/Users/alice/projects/app")
  })

  it("extracts CWD from a system turn whose content is a string", () => {
    expect(cwdOf({ messages: [{ role: "user", content: "hi" }, { role: "system", content: environment("/srv/app") }] })).toBe("/srv/app")
  })

  it("extracts CWD from a reminder block opening the first user message", () => {
    expect(cwdOf({
      system: [{ type: "text", text: "You are an interactive agent." }],
      messages: [{ role: "user", content: [reminder(environment("/Users/alice/projects/app")), reminder("Today's date is 2026-10-05."), { type: "text", text: "hi" }] }],
    })).toBe("/Users/alice/projects/app")
  })

  it("keeps the directory the conversation started in when a later system turn names another", () => {
    // The SDK session is filed under the directory it was created in: a
    // conversation that changed it mid-way could not be resumed.
    expect(cwdOf({
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: environment("/Users/alice/projects/app") },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: "go on" },
        { role: "system", content: environment("/Users/alice/projects/app/.claude/worktrees/feature") },
      ],
    })).toBe("/Users/alice/projects/app")
  })

  it("prefers the system prompt's directory, where an older client sends it", () => {
    expect(cwdOf({
      system: "Primary working directory: /from/system/prompt",
      messages: [{ role: "user", content: "hi" }, { role: "system", content: environment("/from/system/turn") }],
    })).toBe("/from/system/prompt")
  })

  it("takes no directory from what the user wrote", () => {
    expect(cwdOf({ messages: [{ role: "user", content: environment("/etc") }] })).toBeUndefined()
    expect(cwdOf({ messages: [{ role: "user", content: [{ type: "text", text: environment("/etc") }] }] })).toBeUndefined()
  })

  it("takes none from a later user message, an assistant message or a tool result", () => {
    expect(cwdOf({
      messages: [
        { role: "user", content: [reminder("Today's date is 2026-10-05."), { type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: environment("/from/assistant") }, { type: "tool_use", id: "t1", name: "Read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [reminder(environment("/from/tool/result"))] }, reminder(environment("/from/later/user"))] },
      ],
    })).toBeUndefined()
  })

  it("returns undefined when the label is absent", () => {
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!({
        system: "You are a helpful assistant. No working directory line.",
      })
    ).toBeUndefined()
  })

  it("returns undefined for empty string system prompt", () => {
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!({ system: "" })
    ).toBeUndefined()
  })

  it("returns undefined for empty array system prompt", () => {
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!({ system: [] })
    ).toBeUndefined()
  })

  it("handles a system array with non-text blocks", () => {
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!({
        system: [
          { type: "image", source: {} },
          { type: "text", text: " - Primary working directory: /opt/app" },
        ],
      })
    ).toBe("/opt/app")
  })

  it("returns the first match when multiple Primary working directory lines exist", () => {
    const body = {
      system:
        "Primary working directory: /first\nsome other text\nPrimary working directory: /second",
    }
    expect(
      claudeCodeAdapter.extractClientWorkingDirectory!(body)
    ).toBe("/first")
  })
})

describe("claudeCodeAdapter — basic configuration surface", () => {
  it("exposes MCP config like the other passthrough-capable adapters", () => {
    expect(typeof claudeCodeAdapter.getMcpServerName()).toBe("string")
    expect(Array.isArray(claudeCodeAdapter.getAllowedMcpTools())).toBe(true)
    expect(Array.isArray(claudeCodeAdapter.getBlockedBuiltinTools())).toBe(true)
    expect(Array.isArray(claudeCodeAdapter.getAgentIncompatibleTools())).toBe(true)
  })

  it("lists Claude Code's PascalCase core tools so they're not deferred", () => {
    const core = claudeCodeAdapter.getCoreToolNames!()
    expect(core).toContain("Read")
    expect(core).toContain("Write")
    expect(core).toContain("Edit")
    expect(core).toContain("Bash")
  })

  it("defaults to passthrough mode and honors the disable flags", () => {
    const original = process.env.MERIDIAN_PASSTHROUGH
    try {
      delete process.env.MERIDIAN_PASSTHROUGH
      expect(claudeCodeAdapter.usesPassthrough!()).toBe(true)

      process.env.MERIDIAN_PASSTHROUGH = "0"
      expect(claudeCodeAdapter.usesPassthrough!()).toBe(false)

      process.env.MERIDIAN_PASSTHROUGH = "false"
      expect(claudeCodeAdapter.usesPassthrough!()).toBe(false)
    } finally {
      if (original === undefined) {
        delete process.env.MERIDIAN_PASSTHROUGH
      } else {
        process.env.MERIDIAN_PASSTHROUGH = original
      }
    }
  })

  it("skips meridian's synthetic file-change tracker (Claude Code shows its own edits)", () => {
    expect(claudeCodeAdapter.shouldTrackFileChanges!()).toBe(false)
  })

  it("declares concurrent turns per session key (#1043)", () => {
    // Headless Claude Code fires a session-start side request and the primary
    // turn concurrently under the same session id without per-flow headers.
    expect(claudeCodeAdapter.runsConcurrentTurnsPerSessionKey).toBe(true)
  })
})

describe("claudeCodeAdapter.extractFileChangesFromToolUse", () => {
  it("flags Write tool uses as 'wrote'", () => {
    const result = claudeCodeAdapter.extractFileChangesFromToolUse!("Write", {
      file_path: "/tmp/a.txt",
      content: "hi",
    })
    expect(result).toEqual([{ operation: "wrote", path: "/tmp/a.txt" }])
  })

  it("flags Edit and MultiEdit tool uses as 'edited'", () => {
    expect(
      claudeCodeAdapter.extractFileChangesFromToolUse!("Edit", {
        file_path: "/tmp/b.ts",
      })
    ).toEqual([{ operation: "edited", path: "/tmp/b.ts" }])

    expect(
      claudeCodeAdapter.extractFileChangesFromToolUse!("MultiEdit", {
        file_path: "/tmp/c.ts",
      })
    ).toEqual([{ operation: "edited", path: "/tmp/c.ts" }])
  })

  it("parses redirect writes from Bash commands", () => {
    const changes = claudeCodeAdapter.extractFileChangesFromToolUse!("Bash", {
      command: "echo hello > /tmp/out.txt",
    })
    expect(changes.length).toBeGreaterThan(0)
    expect(changes[0]!.path).toBe("/tmp/out.txt")
  })

  it("returns an empty array for tools it doesn't track", () => {
    expect(
      claudeCodeAdapter.extractFileChangesFromToolUse!("Grep", {
        pattern: "foo",
      })
    ).toEqual([])
  })
})

describe("isClaudeCodeAuxiliaryRequest", () => {
  // The auto-mode permission classifier: the conversation's own session id,
  // no tools, not streamed, and stop sequences closing its XML verdict.
  const classifier = {
    model: "claude-sonnet-4-6",
    max_tokens: 64,
    stream: false,
    stop_sequences: ["</block>"],
    messages: [
      { role: "user", content: "<transcript>…</transcript>" },
      { role: "user", content: "Classify the action." },
    ],
    metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
  }

  it("recognises the classifier's shape when the request-class header is absent", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, classifier)).toBe(true)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...classifier, stop_sequences: ["</severity>"] }))
      .toBe(true)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...classifier, tools: [] })).toBe(true)
  })

  it("lets an explicit request class decide when the client sends one", () => {
    expect(isClaudeCodeAuxiliaryRequest("auxiliary", { messages: [] })).toBe(true)
    for (const requestClass of ["main", "compaction", "subagent", "workflow", "future-class"]) {
      expect(isClaudeCodeAuxiliaryRequest(requestClass, classifier)).toBe(false)
    }
  })

  // Headless `claude -p` sends a tool-less session-start request alongside the
  // first turn. It streams, so it keeps normal session handling.
  it("leaves the streaming session-start side request alone", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...classifier, stream: true })).toBe(false)
  })

  it("never isolates a request that declares tools", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...classifier,
      tools: [{ name: "Read", input_schema: { type: "object" } }],
    })).toBe(false)
  })

  it("requires a verdict stop sequence or the transcript block the classifier opens with", () => {
    const { stop_sequences: _omitted, ...withoutStops } = classifier
    expect(isClaudeCodeAuxiliaryRequest(undefined, withoutStops)).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...classifier, stop_sequences: ["\n\nHuman:"] }))
      .toBe(false)
  })

  // CLI 2.1.294 in its fast classifier mode sets no stop sequence at all
  // (`...q!=="fast"&&{stop_sequences:[…]}`); the transcript still opens with a
  // block of its own. Live, 2026-10-09: read as turns, eight of these replaced
  // an 800-message conversation's mapping and it replayed in full each time.
  const fastCheck = {
    model: "claude-sonnet-5-5",
    max_tokens: 256,
    stream: false,
    messages: [
      { role: "user", content: [{ type: "text", text: "The following is the user's CLAUDE.md configuration.\n\n<user_claude_md>…</user_claude_md>" }] },
      { role: "user", content: [
        { type: "text", text: "<transcript>\n" },
        { type: "text", text: "{\"user\":\"run the tests\"}\n" },
        { type: "text", text: "</transcript>\n" },
        { type: "text", text: "Respond with <block>yes</block> or <block>no</block>." },
      ] },
    ],
    metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
  }

  it("recognises a check sent without a stop sequence by its transcript block", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, fastCheck)).toBe(true)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...fastCheck, messages: [fastCheck.messages[1]!] })).toBe(true)
  })

  it("does not take a turn that only mentions a transcript for a check", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...fastCheck, messages: [
      { role: "user", content: [{ type: "text", text: "Summarise this:\n<transcript>\nUser: hi\n</transcript>" }] },
    ] })).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...fastCheck, messages: [{ role: "user", content: "<transcript>\n" }] }))
      .toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...fastCheck, stream: true })).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...fastCheck, tools: [{ name: "Read", input_schema: { type: "object" } }] }))
      .toBe(false)
  })

  it("requires a Claude Code session key", () => {
    const { metadata: _omitted, ...unkeyed } = classifier
    expect(isClaudeCodeAuxiliaryRequest(undefined, unkeyed)).toBe(false)
  })

  it("rejects malformed shapes without throwing", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, undefined)).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, "not an object")).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...classifier, stop_sequences: "</block>" })).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...classifier, stop_sequences: [42, null] })).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...classifier, tools: null })).toBe(true)
  })
})

describe("isClaudeCodeAuxiliaryRequest — background agent progress summary", () => {
  // On a 30s timer the CLI forks a background subagent's transcript and asks for
  // a 3-5 word progress label (`agent_summary`). The fork keeps the subagent's
  // tools and streams, so nothing in the classifier's shape matches it. The
  // prompt below is the CLI's own, as captured from a live session.
  const summaryPrompt = [
    "Describe your most recent action in 3-5 words using present tense (-ing). Name the file or function, not the branch. Do not use tools.",
    "",
    "Previous: \"Searching trail parsers in body-token-scan.ts\" — say something NEW.",
    "",
    "Good: \"Reading runAgent.ts\"",
    "Bad (past tense): \"Analyzed the branch diff\"",
  ].join("\n")
  const toolUse = { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "a.ts" } }] }
  const toolResult = { type: "tool_result", tool_use_id: "toolu_1", content: "export const a = 1" }
  const subagentTurn = {
    model: "claude-opus-5-5",
    max_tokens: 32000,
    stream: true,
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: "Review the diff" },
      toolUse,
      { role: "user", content: [toolResult] },
    ],
    metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
  }
  // The transcript ends in a tool result, so the CLI merges its prompt into
  // that message as one more block rather than appending a message.
  const summaryFork = {
    ...subagentTurn,
    messages: [
      { role: "user", content: "Review the diff" },
      toolUse,
      { role: "user", content: [toolResult, { type: "text", text: summaryPrompt }] },
    ],
  }

  it("recognises the summary fork even though it declares tools and streams", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, summaryFork)).toBe(true)
  })

  it("recognises the prompt sent as a message of its own", () => {
    const history = [{ role: "user", content: "Review the diff" }, { role: "assistant", content: "Reviewing." }]
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [...history, { role: "user", content: summaryPrompt }],
    })).toBe(true)
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [...history, { role: "user", content: [{ type: "text", text: summaryPrompt }] }],
    })).toBe(true)
  })

  // Captured from CLI 2.1.289: with mid-conversation system messages on, the
  // subagent's reminders ride as `system` turns, and one can trail the message
  // that carries the prompt.
  it("recognises the fork when a mid-conversation system message trails it", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [
        { role: "user", content: "Review the diff" },
        { role: "system", content: "# Environment\nYou have been invoked in the following environment:" },
        toolUse,
        { role: "user", content: [toolResult, { type: "text", text: summaryPrompt }] },
        { role: "system", content: "Available agent types for the Agent tool:\n- claude: Catch-all" },
      ],
    })).toBe(true)
  })

  // The CLI attaches reminders to user messages, and nothing fixes their order
  // against the prompt: a block trailing it must not hide the fork.
  it("recognises the prompt when another block follows it", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [
        ...subagentTurn.messages.slice(0, 2),
        { role: "user", content: [
          toolResult,
          { type: "text", text: summaryPrompt },
          { type: "text", text: "<system-reminder>Stay on task.</system-reminder>" },
        ] },
      ],
    })).toBe(true)
  })

  it("leaves the subagent's own turns alone", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, subagentTurn)).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [
        ...subagentTurn.messages.slice(0, 2),
        { role: "user", content: [toolResult, { type: "text", text: "<system-reminder>Stay on task.</system-reminder>" }] },
      ],
    })).toBe(false)
  })

  it("ignores the prompt anywhere but the final user message", () => {
    // A turn that merely has the prompt in its history is still a turn.
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [
        ...summaryFork.messages,
        { role: "assistant", content: "Reading a.ts" },
        { role: "user", content: "Now review b.ts" },
      ],
    })).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [...subagentTurn.messages, { role: "assistant", content: summaryPrompt }],
    })).toBe(false)
    // Trailing system messages are skipped; an assistant turn after the prompt is not.
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [
        ...summaryFork.messages,
        { role: "assistant", content: "Reading a.ts" },
        { role: "system", content: "Available agent types for the Agent tool:" },
      ],
    })).toBe(false)
    // Quoting the prompt mid-sentence is not sending it.
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [{ role: "user", content: `What does this mean: ${summaryPrompt}` }],
    })).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, {
      ...subagentTurn,
      messages: [{ role: "user", content: [{ type: "text", text: `What does this mean: ${summaryPrompt}` }] }],
    })).toBe(false)
  })

  it("lets an explicit request class overrule the prompt", () => {
    expect(isClaudeCodeAuxiliaryRequest("subagent", summaryFork)).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest("auxiliary", summaryFork)).toBe(true)
  })

  it("requires a Claude Code session key", () => {
    const { metadata: _omitted, ...unkeyed } = summaryFork
    expect(isClaudeCodeAuxiliaryRequest(undefined, unkeyed)).toBe(false)
  })

  it("rejects malformed message shapes without throwing", () => {
    for (const messages of [undefined, null, "not an array", [], [null], [{ role: "user" }], [{ role: "user", content: 42 }],
      [{ role: "user", content: [null, 7, { type: "text" }, { type: "text", text: 42 }] }]]) {
      expect(isClaudeCodeAuxiliaryRequest(undefined, { ...summaryFork, messages })).toBe(false)
    }
  })
})

describe("agentSummaryReplayMessages — what a progress summary is answered from", () => {
  // A side call runs in a session of its own, so whatever it replays is sent,
  // and written to the prompt cache, for that one answer. A 3-5 word label
  // for the latest step does not need the conversation that led up to it.
  const summaryPrompt = [
    "Describe your most recent action in 3-5 words using present tense (-ing). Name the file or function, not the branch. Do not use tools.",
    "",
    "Previous: \"Reading a.ts\" — say something NEW.",
    "",
    "Good: \"Reading runAgent.ts\"",
  ].join("\n")
  const read = (id: string, file: string) =>
    ({ role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: { file_path: file } }] })
  const result = (id: string, content: unknown) => ({ type: "tool_result", tool_use_id: id, content })
  const fork = (messages: unknown[]) => ({
    model: "claude-opus-5-5",
    stream: true,
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    messages,
    metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
  })
  const latestCall = { role: "assistant", content: [
    { type: "text", text: "Now the second file." },
    { type: "tool_use", id: "toolu_b", name: "Read", input: { file_path: "b.ts" } },
  ] }
  const promptTurn = { role: "user", content: [result("toolu_b", "export const b = 2"), { type: "text", text: summaryPrompt }] }
  const threeRounds = [
    { role: "user", content: "Review the diff" },
    { role: "system", content: "# Environment\nYou have been invoked in the following environment:" },
    read("toolu_a", "a.ts"),
    { role: "user", content: [result("toolu_a", "export const a = 1")] },
    latestCall,
    promptTurn,
  ]

  it("keeps the latest assistant turn and the message carrying the prompt", () => {
    const replay = agentSummaryReplayMessages(fork(threeRounds))
    expect(replay?.slice(1)).toEqual([latestCall, promptTurn])
  })

  it("says how much it left out", () => {
    const replay = agentSummaryReplayMessages(fork(threeRounds))
    expect(replay?.[0]?.role).toBe("user")
    expect(replay?.[0]?.content).toContain("4 earlier messages")
  })

  // Captured from CLI 2.1.289: reminders ride as mid-conversation `system`
  // messages and one can trail the turn. A label has no use for them.
  it("drops system messages trailing the prompt", () => {
    const replay = agentSummaryReplayMessages(fork([
      ...threeRounds,
      { role: "system", content: "Available agent types for the Agent tool:\n- claude: Catch-all" },
    ]))
    expect(replay?.slice(1)).toEqual([latestCall, promptTurn])
  })

  it("keeps a prompt sent as a message of its own", () => {
    const narration = { role: "assistant", content: "Reviewing the second file." }
    const prompt = { role: "user", content: summaryPrompt }
    expect(agentSummaryReplayMessages(fork([...threeRounds.slice(0, 4), narration, prompt]))?.slice(1))
      .toEqual([narration, prompt])
  })

  it("clips a long tool result and a long tool input, never the prompt", () => {
    const written = "const x = 1\n".repeat(5_000)
    const output = "line of output\n".repeat(5_000)
    // Longer than any one clipped field: the instruction itself must survive whole.
    const longPrompt = `${summaryPrompt}\n${"Good: \"Reading runAgent.ts\"\n".repeat(120)}`
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(8_000) } }
    const messages = [
      ...threeRounds.slice(0, 4),
      { role: "assistant", content: [
        { type: "text", text: "Rewriting both files. ".repeat(500) },
        { type: "tool_use", id: "toolu_w", name: "Write", input: { file_path: "big.ts", content: written } },
        { type: "tool_use", id: "toolu_m", name: "MultiEdit", input: { file_path: "c.ts", edits: [{ old_string: "a", new_string: written }] } },
      ] },
      { role: "user", content: [
        result("toolu_w", output),
        result("toolu_m", [{ type: "text", text: output }, image]),
        { type: "text", text: longPrompt },
      ] },
    ]
    const before = JSON.stringify(messages)
    const replay = agentSummaryReplayMessages(fork(messages))
    const rendered = JSON.stringify(replay)
    expect(before.length).toBeGreaterThan(250_000)
    expect(rendered.length).toBeLessThan(26_000)
    // What the step was stays readable; only its bulk goes.
    expect(rendered).toContain("Rewriting both files.")
    expect(rendered).toContain("big.ts")
    expect(rendered).toContain("c.ts")
    expect(rendered).toContain("line of output")
    expect(rendered).toContain("more characters omitted")
    expect(longPrompt.length).toBeGreaterThan(3_000)
    expect(rendered).toContain(JSON.stringify(longPrompt).slice(1, -1))
    // Clipping an image's bytes would corrupt it.
    expect(rendered).toContain(JSON.stringify(image))
    // The request body still feeds lineage and logging: it must not change.
    expect(JSON.stringify(messages)).toBe(before)
  })

  it("replays the request as sent when there is nothing before the latest step", () => {
    expect(agentSummaryReplayMessages(fork([latestCall, promptTurn]))).toBeUndefined()
    expect(agentSummaryReplayMessages(fork([{ role: "user", content: "Review the diff" }, { role: "user", content: summaryPrompt }])))
      .toBeUndefined()
  })

  it("leaves every request that is not a progress summary alone", () => {
    // The subagent's own turn, and the same history with a reminder attached.
    expect(agentSummaryReplayMessages(fork(threeRounds.slice(0, 4)))).toBeUndefined()
    expect(agentSummaryReplayMessages(fork([
      ...threeRounds.slice(0, 5),
      { role: "user", content: [result("toolu_b", "export const b = 2"), { type: "text", text: "<system-reminder>Stay on task.</system-reminder>" }] },
    ]))).toBeUndefined()
    // The auto-mode classifier is a side call too, and needs its whole transcript.
    expect(agentSummaryReplayMessages({
      stream: false,
      stop_sequences: ["</block>"],
      messages: [{ role: "user", content: "<transcript>…</transcript>" }, { role: "assistant", content: "<block>" }],
      metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
    })).toBeUndefined()
  })

  it("rejects malformed shapes without throwing", () => {
    expect(agentSummaryReplayMessages(undefined)).toBeUndefined()
    expect(agentSummaryReplayMessages("not an object")).toBeUndefined()
    for (const messages of [undefined, null, "not an array", [], [null], [{ role: "user" }], [null, promptTurn],
      [{ role: "assistant", content: 42 }, promptTurn]]) {
      expect(() => agentSummaryReplayMessages(fork(messages as unknown[]))).not.toThrow()
    }
  })

  it("is what the adapter offers the proxy for an auxiliary request", () => {
    const ctx = { req: { header: () => undefined } } as unknown as Parameters<typeof claudeCodeAdapter.getSessionId>[0]
    expect(claudeCodeAdapter.getAuxiliaryReplayMessages?.(ctx, fork(threeRounds)))
      .toEqual(agentSummaryReplayMessages(fork(threeRounds)))
    expect(claudeCodeAdapter.getAuxiliaryReplayMessages?.(ctx, fork(threeRounds.slice(0, 4)))).toBeUndefined()
  })
})

// The CLI's main-thread forks, from the 2.1.294 binary: the recap shown to a
// user coming back (`away_summary`) and the next-prompt suggestion
// (`prompt_suggestion`). Each sends the conversation's session id, its whole
// history and one prompt. Read as turns, their prompt became the stored tail,
// and the user's reply after them replayed the main thread (live 2026-10-07/08:
// 58 replays of Opus main threads of 50-400 messages; stored digests
// a8b1dc5bfce7 and 336bcd9d1fa7 are these two prompts).
const AWAY_SUMMARY_PROMPT = "The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown. Lead with the overall goal and current task, then the one next action. Skip root-cause narrative, fix internals, secondary to-dos, and em-dash tangents."
const SUGGESTION_PROMPT = [
  "[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.]",
  "",
  "FIRST: Look at the user's recent messages and original request.",
  "",
  "Reply with ONLY the suggestion, no quotes or explanation.",
].join("\n")

describe("isClaudeCodeAuxiliaryRequest — the main thread's recap and next-prompt suggestion", () => {
  const history = [
    { role: "user", content: "Invoke the /sss-agents:sss-groom slash command for SSS-101" },
    { role: "assistant", content: [{ type: "text", text: "Phase 8 is waiting for you: reply 1 to approve, r to revise." }] },
  ]
  const main = (messages: unknown[]) => ({
    model: "claude-opus-5-5",
    stream: true,
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    messages,
    metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
  })

  it("recognises either fork by the prompt ending its history", () => {
    for (const prompt of [AWAY_SUMMARY_PROMPT, SUGGESTION_PROMPT]) {
      expect(isClaudeCodeAuxiliaryRequest(undefined, main([...history, { role: "user", content: prompt }]))).toBe(true)
      expect(isClaudeCodeAuxiliaryRequest(undefined, main([...history, { role: "user", content: [{ type: "text", text: prompt }] }]))).toBe(true)
      expect(isClaudeCodeAuxiliaryRequest(undefined, main([...history, { role: "user", content: prompt },
        { role: "system", content: "<total_tokens>900000 tokens left</total_tokens>" }]))).toBe(true)
    }
  })

  it("leaves the user's reply after either fork alone", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, main([...history, { role: "user", content: "r" }]))).toBe(false)
    expect(isClaudeCodeAuxiliaryRequest(undefined, main([...history,
      { role: "user", content: `What does this prompt do? ${AWAY_SUMMARY_PROMPT}` }]))).toBe(false)
  })

  it("requires a Claude Code session key", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, { ...main([...history, { role: "user", content: AWAY_SUMMARY_PROMPT }]), metadata: undefined }))
      .toBe(false)
  })
})

describe("sideForkReplayMessages — what a recap or a suggestion is answered from", () => {
  const read = (id: string) => ({ role: "assistant", content: [{ type: "tool_use", id, name: "Read", input: { file_path: `${id}.ts` } }] })
  const result = (id: string, content: string) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] })
  const fork = (messages: unknown[]) => ({
    model: "claude-opus-5-5",
    stream: true,
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    messages,
    metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
  })
  const opening = { role: "user", content: "Invoke the /sss-agents:sss-groom slash command for SSS-101" }
  const typed = { role: "user", content: [{ type: "text", text: "<system-reminder>Stay on task.</system-reminder>" }, { type: "text", text: "go on with phase 8" }] }
  const latest = { role: "assistant", content: [{ type: "text", text: "Phase 8 is waiting for you: reply 1 to approve, r to revise." }] }
  const conversation = [
    opening,
    { role: "system", content: "# Environment\nYou have been invoked in the following environment:" },
    read("a"), result("a", "export const a = 1"),
    typed,
    read("b"), result("b", "export const b = 2"),
    latest,
  ]

  it("keeps the opening message, the user's latest words and the latest step", () => {
    for (const prompt of [AWAY_SUMMARY_PROMPT, SUGGESTION_PROMPT]) {
      const replay = sideForkReplayMessages(fork([...conversation, { role: "user", content: prompt }]))
      expect(replay?.slice(1)).toEqual([opening, typed, latest, { role: "user", content: prompt }])
      expect(replay?.[0]?.role).toBe("user")
      expect(replay?.[0]?.content).toContain("5 earlier messages")
    }
  })

  it("clips a long message it keeps", () => {
    const longAnswer = { role: "assistant", content: [{ type: "text", text: "A long plan. ".repeat(2_000) }] }
    const rendered = JSON.stringify(sideForkReplayMessages(fork([...conversation.slice(0, -1), longAnswer, { role: "user", content: AWAY_SUMMARY_PROMPT }])))
    expect(rendered.length).toBeLessThan(6_000)
    expect(rendered).toContain("more characters omitted")
    expect(rendered).toContain(AWAY_SUMMARY_PROMPT)
  })

  it("replays the request as sent when it leaves nothing out", () => {
    expect(sideForkReplayMessages(fork([opening, latest, { role: "user", content: AWAY_SUMMARY_PROMPT }]))).toBeUndefined()
  })

  it("leaves every other request alone", () => {
    expect(sideForkReplayMessages(fork([...conversation, { role: "user", content: "r" }]))).toBeUndefined()
    expect(sideForkReplayMessages(fork([...conversation.slice(0, -1), { role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: "x" },
      { type: "text", text: "Describe your most recent action in 3-5 words using present tense (-ing)." }] }]))).toBeUndefined()
  })

  it("rejects malformed shapes without throwing", () => {
    expect(sideForkReplayMessages(undefined)).toBeUndefined()
    for (const messages of [undefined, null, "not an array", [], [null], [{ role: "user" }], [null, { role: "user", content: AWAY_SUMMARY_PROMPT }]]) {
      expect(() => sideForkReplayMessages(fork(messages as unknown[]))).not.toThrow()
    }
  })

  it("is what the adapter offers the proxy for an auxiliary request", () => {
    const ctx = { req: { header: () => undefined } } as unknown as Parameters<typeof claudeCodeAdapter.getSessionId>[0]
    const body = fork([...conversation, { role: "user", content: SUGGESTION_PROMPT }])
    expect(claudeCodeAdapter.getAuxiliaryReplayMessages?.(ctx, body)).toEqual(sideForkReplayMessages(body))
  })
})

describe("claudeCodeAdapter.isAuxiliaryRequest", () => {
  type AdapterContext = Parameters<typeof claudeCodeAdapter.getSessionId>[0]
  const contextWith = (headers: Record<string, string>): AdapterContext =>
    ({ req: { header: (name: string) => headers[name.toLowerCase()] } }) as unknown as AdapterContext
  const body = {
    stream: false,
    stop_sequences: ["</block>"],
    messages: [{ role: "user", content: "x" }],
    metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
  }

  it("reads the request-class header from the context", () => {
    expect(claudeCodeAdapter.isAuxiliaryRequest?.(contextWith({}), body)).toBe(true)
    expect(claudeCodeAdapter.isAuxiliaryRequest?.(
      contextWith({ "x-claude-code-request-class": "main" }), body,
    )).toBe(false)
  })
})

describe("claudeCodeAuxiliaryPromptGrows — which side calls only add to their prompt", () => {
  // The classifier re-sends the conversation's transcript on every check, with
  // what happened since appended and the same instruction closing it.
  const classifier = {
    model: "claude-sonnet-5",
    max_tokens: 64,
    stream: false,
    stop_sequences: ["</severity>"],
    messages: [
      { role: "user", content: [{ type: "text", text: "<user_claude_md>…</user_claude_md>" }] },
      { role: "user", content: [{ type: "text", text: "<transcript>\n" }, { type: "text", text: "</transcript>\n" }] },
    ],
    metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
  }
  const summaryFork = {
    model: "claude-opus-5-5",
    stream: true,
    tools: [{ name: "Read", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: "Review the diff" },
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "a.ts" } }] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "export const a = 1" },
        { type: "text", text: "Describe your most recent action in 3-5 words using present tense (-ing). Do not use tools." },
      ] },
    ],
    metadata: { user_id: JSON.stringify({ session_id: "conv-1" }) },
  }

  it("says so for the classifier, under either verdict tag", () => {
    expect(claudeCodeAuxiliaryPromptGrows(classifier)).toBe(true)
    expect(claudeCodeAuxiliaryPromptGrows({ ...classifier, stop_sequences: ["</block>"] })).toBe(true)
  })

  it("says so for the classifier sent without a stop sequence (CLI 2.1.294, fast mode)", () => {
    const { stop_sequences: _omitted, ...fast } = classifier
    expect(claudeCodeAuxiliaryPromptGrows({ ...fast, max_tokens: 256 })).toBe(true)
  })

  it("does not for the progress summary, which is answered from a different step each time", () => {
    expect(isClaudeCodeAuxiliaryRequest(undefined, summaryFork)).toBe(true)
    expect(claudeCodeAuxiliaryPromptGrows(summaryFork)).toBe(false)
  })

  it("does not for a side call it knows only by the client's request class", () => {
    const { stop_sequences: _omitted, ...rest } = classifier
    const classed = { ...rest, messages: [{ role: "user", content: [{ type: "text", text: "Name this conversation in five words." }] }] }
    expect(isClaudeCodeAuxiliaryRequest("auxiliary", classed)).toBe(true)
    expect(claudeCodeAuxiliaryPromptGrows(classed)).toBe(false)
  })

  it("rejects malformed shapes without throwing", () => {
    expect(claudeCodeAuxiliaryPromptGrows(undefined)).toBe(false)
    expect(claudeCodeAuxiliaryPromptGrows("not an object")).toBe(false)
    const untranscribed = { ...classifier, messages: [classifier.messages[0]!] }
    expect(claudeCodeAuxiliaryPromptGrows({ ...untranscribed, stop_sequences: "</severity>" })).toBe(false)
    for (const messages of ["<transcript>\n", [null], [{ role: "user", content: [null] }], [{ role: "user", content: "<transcript>\n" }]]) {
      const { stop_sequences: _omitted, ...unstopped } = classifier
      expect(claudeCodeAuxiliaryPromptGrows({ ...unstopped, messages })).toBe(false)
    }
  })

  it("is what the adapter tells the proxy", () => {
    const ctx = { req: { header: () => undefined } } as unknown as Parameters<typeof claudeCodeAdapter.getSessionId>[0]
    expect(claudeCodeAdapter.auxiliaryPromptGrows?.(ctx, classifier)).toBe(true)
    expect(claudeCodeAdapter.auxiliaryPromptGrows?.(ctx, summaryFork)).toBe(false)
  })
})
