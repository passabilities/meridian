import type { Transform, RequestContext } from "../transform"
import { extractFileChangesFromBash, type FileChange } from "../fileChanges"
import { BLOCKED_BUILTIN_TOOLS, CLAUDE_CODE_ONLY_TOOLS, ALLOWED_MCP_TOOLS } from "../tools"
import { resolvePassthrough } from "../../env"

/**
 * The tools of its own that Claude Code defers when its tool search is on:
 * the model is given their names and loads a definition with ToolSearch.
 *
 * NOTE: agent-specific (claude-code). Behind a base URL that is not
 * Anthropic's the client keeps its tool search off and sends every one of
 * them loaded, so the proxy's deferral takes out what the client's would
 * have. The names are the client's own record of what it deferred
 * (`deferred_tools_delta` in the transcripts of 2.1.290 connected directly,
 * 2026-10-05: a `-p` main thread, its general-purpose subagent and an
 * interactive session).
 *
 * A list, because the client's rule cannot be read out of a request. A tool
 * missing from it stays loaded, which costs prompt and breaks nothing; one
 * the client has stopped deferring costs a ToolSearch round the first time a
 * session uses it. EnterPlanMode and ExitPlanMode are left out on purpose:
 * the client loads those up front or not by the mode the session is in.
 */
export const CLAUDE_CODE_DEFERRED_TOOLS: readonly string[] = [
  "ArtifactComments", "ArtifactData", "CronCreate", "CronDelete", "CronList", "DesignSync", "EndConversation",
  "EnterWorktree", "ExitWorktree", "LSP", "ListMcpResourcesTool", "Monitor", "NotebookEdit", "PushNotification",
  "ReadMcpResourceDirTool", "ReadMcpResourceTool", "RemoteTrigger", "SendMessage", "TaskCreate", "TaskGet", "TaskList",
  "TaskStop", "TaskUpdate", "WebFetch", "WebSearch",
]

/**
 * Claude Code transform — supplies the SDK tool config at request time.
 *
 * server.ts reads `pipelineCtx.*`, never the adapter methods, so without an
 * entry here a Claude Code client gets the createRequestContext defaults:
 * `blockedTools: []` and `passthrough: undefined`. That means the SDK
 * subprocess runs the client's task with its own built-in Read/Write/Bash on
 * the proxy host while the client executes the same tool calls locally —
 * every side effect happens twice (#546, same failure mode as OpenCode's).
 *
 * Values mirror claudeCodeAdapter (adapters/claudecode.ts); the parity tests
 * hold the two in sync. Core tool names are PascalCase here — Claude Code's
 * toolkit is Read/Write/Edit/Bash/Glob/Grep, not OpenCode's lowercase names.
 */
export const claudeCodeTransforms: Transform[] = [
  {
    name: "claudecode-core",
    adapters: ["claude-code"],

    onRequest(ctx: RequestContext): RequestContext {
      const extractFileChangesFromToolUse = (toolName: string, toolInput: unknown): FileChange[] => {
        const input = toolInput as Record<string, unknown> | null | undefined
        const filePath = input?.file_path ?? input?.filePath ?? input?.path
        const lowerName = toolName.toLowerCase()
        if (lowerName === "write" && filePath) {
          return [{ operation: "wrote", path: String(filePath) }]
        }
        if ((lowerName === "edit" || lowerName === "multiedit") && filePath) {
          return [{ operation: "edited", path: String(filePath) }]
        }
        if (lowerName === "bash" && input?.command) {
          return extractFileChangesFromBash(String(input.command))
        }
        return []
      }

      return {
        ...ctx,
        blockedTools: BLOCKED_BUILTIN_TOOLS,
        incompatibleTools: CLAUDE_CODE_ONLY_TOOLS,
        allowedMcpTools: ALLOWED_MCP_TOOLS,
        coreToolNames: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        // What Claude Code defers itself when its tool search is on: the
        // tools of the client's MCP servers, and the ones of its own listed
        // above. The rest of its own stay loaded: the set changes from release
        // to release, and on one live roster of 215 tools the 180 from MCP
        // servers were 73% of the definitions by size while all 323 calls in
        // that proxy's SDK transcripts went to the client's own, 14 of them
        // to tools outside the core list above (E2E.md E76).
        deferrableToolPrefixes: ["mcp__"],
        deferrableToolNames: CLAUDE_CODE_DEFERRED_TOOLS,
        // And at any count. The client's own tool search, in the mode it runs
        // in unless ENABLE_TOOL_SEARCH says `auto`, defers every one of them
        // however few there are. Under the default threshold of 15 a session
        // without MCP servers (11 of them on a `claude -p` main thread, 7 on a
        // general-purpose subagent) kept them all loaded: the API received
        // 54,399 characters of tool definitions for such a main thread, and
        // receives 26,078 with them deferred (the real client against a
        // scripted API, 2026-10-05).
        autoDeferThreshold: 0,
        // Claude Code's own tools are not MCP tools on a direct connection,
        // and several describe themselves at more than the 2,048 characters
        // the SDK child allows one: of the 21 a `claude -p` session sent on
        // 2026-10-05 six were cut (Workflow at 3,480 characters, SendMessage
        // at 4,259, ScheduleWakeup, CronCreate, DesignSync, EnterWorktree),
        // each losing the rules its description ends on. The tools of the
        // client's MCP servers arrive already cut to that length by the
        // client, as they do on a direct connection.
        wholeToolDescriptions: true,
        // Named where the client names them, in its turns. Its MCP servers
        // often connect after a session's first request (on one machine, 72
        // times in 33 sessions over four days), and the SDK child sends the
        // system prompt it recorded on a session's first request for as long
        // as the session lasts (the CLI's systemPromptSnapshot), so a list
        // there never named a tool that connected later and went on naming
        // ones that had gone.
        deferredToolsInTurns: true,
        // Claude Code names a scratchpad directory of its own and runs its
        // own tools, which may write there. The counter-instruction told the
        // model to keep off it. The child, its preset off, names none: a
        // subscription profile's child sent no scratchpad line (CLI 2.1.284,
        // a scripted API, 2026-10-06).
        scratchpadCounterInstruction: false,
        // Claude Code owns tool execution client-side. Mirrors
        // claudeCodeAdapter.usesPassthrough().
        passthrough: resolvePassthrough(true),
        supportsThinking: true,
        // Claude Code surfaces its own file edits; don't duplicate them.
        shouldTrackFileChanges: false,
        extractFileChangesFromToolUse,
      }
    },
  },
]
