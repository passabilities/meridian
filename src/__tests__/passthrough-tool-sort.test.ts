import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"

import { installSdkMock } from "./sdkMock"
// Provide a minimal SDK mock so createPassthroughMcpServer can register tools
// without hitting the real SDK (which may not be available in CI or may have
// been mocked differently by a sibling test file).
let registeredTools: Array<{ name: string; config: any }> = []
installSdkMock(() => ({
  createSdkMcpServer: (options: {
    tools?: Array<{
      name: string
      description: string
      inputSchema: unknown
      _meta?: Record<string, unknown>
    }>
  }) => {
    for (const definition of options.tools ?? []) {
      registeredTools.push({
        name: definition.name,
        config: {
          description: definition.description,
          inputSchema: definition.inputSchema,
          _meta: definition._meta,
        },
      })
    }
    return {
      type: "sdk",
      name: "test",
      instance: { tool: () => {}, registerTool: () => ({}) },
    }
  },
}), "passthrough-tool-sort.test.ts")

import { autoDeferrableToolNames, createPassthroughMcpServer, getAutoDeferThreshold } from "../proxy/passthroughTools"

// Generate N tools for threshold testing
function makeTools(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${String(i).padStart(2, "0")}`,
    description: `Tool ${i}`,
  }))
}

const CORE_TOOLS = ["read", "write", "edit", "bash", "glob", "grep"]

let savedThreshold: string | undefined

beforeEach(() => {
  registeredTools = []
  savedThreshold = process.env.MERIDIAN_DEFER_TOOL_THRESHOLD
  delete process.env.MERIDIAN_DEFER_TOOL_THRESHOLD
})

afterEach(() => {
  if (savedThreshold !== undefined) process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = savedThreshold
  else delete process.env.MERIDIAN_DEFER_TOOL_THRESHOLD
})

describe("createPassthroughMcpServer tool ordering", () => {
  it("produces the same toolNames regardless of input order", () => {
    const toolsA = [
      { name: "write", description: "Write a file" },
      { name: "bash", description: "Run a command" },
      { name: "read", description: "Read a file" },
    ]
    const toolsB = [
      { name: "read", description: "Read a file" },
      { name: "write", description: "Write a file" },
      { name: "bash", description: "Run a command" },
    ]

    const resultA = createPassthroughMcpServer(toolsA)
    const resultB = createPassthroughMcpServer(toolsB)

    expect(resultA.toolNames).toEqual(resultB.toolNames)
    expect(resultA.toolNames).toEqual([
      "mcp__oc__bash",
      "mcp__oc__read",
      "mcp__oc__write",
    ])
  })

  it("returns hasDeferredTools=true when any tool has defer_loading", () => {
    const tools = [
      { name: "read", description: "Read a file" },
      { name: "custom", description: "Custom tool", defer_loading: true },
    ]
    const result = createPassthroughMcpServer(tools)
    expect(result.hasDeferredTools).toBe(true)
  })

  it("returns hasDeferredTools=false when no tools have defer_loading", () => {
    const tools = [
      { name: "read", description: "Read a file" },
      { name: "write", description: "Write a file" },
    ]
    const result = createPassthroughMcpServer(tools)
    expect(result.hasDeferredTools).toBe(false)
  })
})

describe("auto-defer: threshold-based tool deferral", () => {
  it("does not auto-defer when tool count is at or below threshold", () => {
    const tools = makeTools(15) // exactly at default threshold
    const result = createPassthroughMcpServer(tools, CORE_TOOLS)
    expect(result.hasDeferredTools).toBe(false)
    // No tool should have alwaysLoad
    for (const t of registeredTools) {
      expect(t.config._meta).toBeUndefined()
    }
  })

  it("auto-defers non-core tools when count exceeds threshold", () => {
    // 16 generic tools + 6 core tools = 22 total, above threshold of 15
    const tools = [
      ...CORE_TOOLS.map(name => ({ name, description: `${name} tool` })),
      ...makeTools(16),
    ]
    const result = createPassthroughMcpServer(tools, CORE_TOOLS)
    expect(result.hasDeferredTools).toBe(true)

    // Core tools should have alwaysLoad
    for (const name of CORE_TOOLS) {
      const reg = registeredTools.find(t => t.name === name)
      expect(reg).toBeDefined()
      expect(reg!.config._meta?.["anthropic/alwaysLoad"]).toBe(true)
    }

    // Non-core tools should NOT have alwaysLoad
    for (const reg of registeredTools) {
      if (CORE_TOOLS.includes(reg.name)) continue
      expect(reg.config._meta?.["anthropic/alwaysLoad"]).toBeUndefined()
    }
  })

  it("does not auto-defer when coreToolNames is not provided", () => {
    const tools = makeTools(20) // above threshold
    const result = createPassthroughMcpServer(tools) // no coreToolNames
    expect(result.hasDeferredTools).toBe(false)
  })

  it("respects MERIDIAN_DEFER_TOOL_THRESHOLD env var", () => {
    process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = "5"
    const tools = [
      ...CORE_TOOLS.slice(0, 3).map(name => ({ name, description: `${name} tool` })),
      ...makeTools(6),
    ]
    // 6 tools to defer > threshold of 5
    const result = createPassthroughMcpServer(tools, CORE_TOOLS)
    expect(result.hasDeferredTools).toBe(true)
  })

  // Deferring is worth a ToolSearch round only when it takes enough out of
  // the prompt, so the threshold counts what would leave it. Counting the
  // whole set deferred a stock client's handful of everyday tools.
  it("counts the tools it would defer, not the whole set", () => {
    const core = CORE_TOOLS.map(name => ({ name, description: `${name} tool` }))
    expect(createPassthroughMcpServer([...core, ...makeTools(15)], CORE_TOOLS).hasDeferredTools).toBe(false)
    expect(createPassthroughMcpServer([...core, ...makeTools(16)], CORE_TOOLS).hasDeferredTools).toBe(true)
  })

  it("disables auto-defer when threshold is 0", () => {
    process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = "0"
    const tools = makeTools(100) // huge number
    const result = createPassthroughMcpServer(tools, CORE_TOOLS)
    expect(result.hasDeferredTools).toBe(false)
  })

  it("core tool matching is case-insensitive", () => {
    const tools = [
      { name: "Read", description: "Read a file" },
      { name: "WRITE", description: "Write a file" },
      ...makeTools(20),
    ]
    createPassthroughMcpServer(tools, CORE_TOOLS)

    const readReg = registeredTools.find(t => t.name === "Read")
    const writeReg = registeredTools.find(t => t.name === "WRITE")
    expect(readReg!.config._meta?.["anthropic/alwaysLoad"]).toBe(true)
    expect(writeReg!.config._meta?.["anthropic/alwaysLoad"]).toBe(true)
  })

  it("client defer_loading=true overrides auto-defer alwaysLoad", () => {
    const tools = [
      { name: "read", description: "Read", defer_loading: true }, // explicitly deferred even though core
      ...makeTools(20),
    ]
    const result = createPassthroughMcpServer(tools, CORE_TOOLS)
    expect(result.hasDeferredTools).toBe(true)

    const readReg = registeredTools.find(t => t.name === "read")
    // defer_loading=true should override core status — NOT alwaysLoad
    expect(readReg!.config._meta?.["anthropic/alwaysLoad"]).toBeUndefined()
  })
})

describe("auto-defer limited to a name prefix", () => {
  const own = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `Own${i}`, description: "client tool" }))
  const mcp = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `mcp__srv__tool_${String(i).padStart(2, "0")}`, description: "server tool" }))
  const CORE = ["Read", "Write", "Edit", "Bash"]

  it("leaves a large set alone when few of its tools carry the prefix", () => {
    const result = createPassthroughMcpServer([...own(30), ...mcp(3)], CORE, undefined, undefined, ["mcp__"])
    expect(result.hasDeferredTools).toBe(false)
    expect(result.deferredToolNames).toEqual([])
  })

  it("defers the tools with the prefix and keeps every other tool loaded", () => {
    const result = createPassthroughMcpServer([...own(5), ...mcp(16)], CORE, undefined, undefined, ["mcp__"])
    expect(result.hasDeferredTools).toBe(true)
    for (const reg of registeredTools) {
      const loaded = reg.config._meta?.["anthropic/alwaysLoad"] === true
      expect(loaded).toBe(!reg.name.startsWith("mcp__srv__"))
    }
  })

  it("names the deferred tools as the SDK registers them", () => {
    const result = createPassthroughMcpServer([...own(2), ...mcp(16)], CORE, undefined, undefined, ["mcp__"])
    expect(result.deferredToolNames).toHaveLength(16)
    expect(result.deferredToolNames[0]).toBe("mcp__oc__mcp__srv__tool_00")
    expect(result.deferredToolNames.every(name => result.toolNames.includes(name))).toBe(true)
  })

  it("defers a tool the client flagged whatever its name", () => {
    const result = createPassthroughMcpServer(
      [...own(2), { name: "Flagged", description: "client says defer", defer_loading: true }],
      CORE, undefined, undefined, ["mcp__"],
    )
    expect(result.hasDeferredTools).toBe(true)
    expect(result.deferredToolNames).toEqual(["mcp__oc__Flagged"])
  })
})

describe("auto-defer limited to a name prefix and to tools listed by name", () => {
  const tool = (name: string) => ({ name, description: "client tool" })
  const own = ["Agent", "Skill", "Workflow"].map(tool)
  const LISTED = ["WebFetch", "WebSearch", "NotebookEdit"]
  const mcp = (count: number) => Array.from({ length: count }, (_, i) => tool(`mcp__srv__tool_${String(i).padStart(2, "0")}`))
  const CORE = ["Read", "Write", "Edit", "Bash"]
  const server = (tools: Array<{ name: string; description: string }>) =>
    createPassthroughMcpServer(tools, CORE, undefined, undefined, ["mcp__"], LISTED)

  it("counts a listed tool toward the threshold", () => {
    expect(server([...own, ...LISTED.map(tool), ...mcp(12)]).hasDeferredTools).toBe(false)
    expect(server([...own, ...LISTED.map(tool), ...mcp(13)]).hasDeferredTools).toBe(true)
  })

  it("defers the listed tools with the prefixed ones and keeps every other tool loaded", () => {
    const result = server([...own, ...LISTED.map(tool), ...mcp(13)])
    expect(result.deferredToolNames).toHaveLength(16)
    expect(result.deferredToolNames).toContain("mcp__oc__WebFetch")
    expect(result.deferredToolNames).toContain("mcp__oc__mcp__srv__tool_00")
    for (const reg of registeredTools) {
      const loaded = reg.config._meta?.["anthropic/alwaysLoad"] === true
      expect(loaded).toBe(own.some(candidate => candidate.name === reg.name))
    }
  })

  it("leaves a listed tool loaded while too few tools would leave the prompt", () => {
    const result = server([...own, ...LISTED.map(tool), ...mcp(3)])
    expect(result.hasDeferredTools).toBe(false)
    expect(result.deferredToolNames).toEqual([])
  })

  it("is narrowed by a list of names alone as well", () => {
    const many = Array.from({ length: 16 }, (_, i) => `Listed${i}`)
    const result = createPassthroughMcpServer([...own, ...many.map(tool), ...mcp(4)], CORE, undefined, undefined, undefined, many)
    expect(result.deferredToolNames).toHaveLength(16)
    expect(result.deferredToolNames.every(name => name.startsWith("mcp__oc__Listed"))).toBe(true)
  })

  it("matches a listed name exactly", () => {
    const result = server([...own, tool("WebFetcher"), tool("webfetch"), ...mcp(16)])
    expect(result.deferredToolNames).not.toContain("mcp__oc__WebFetcher")
    expect(result.deferredToolNames).not.toContain("mcp__oc__webfetch")
  })
})

describe("deferredToolNames", () => {
  it("is every tool outside the core set when no prefix narrows it", () => {
    const tools = [
      ...CORE_TOOLS.map(name => ({ name, description: `${name} tool` })),
      ...makeTools(16),
    ]
    const result = createPassthroughMcpServer(tools, CORE_TOOLS)
    expect(result.deferredToolNames).toHaveLength(16)
    expect(result.deferredToolNames).not.toContain("mcp__oc__read")
  })

  it("is empty when nothing is deferred", () => {
    expect(createPassthroughMcpServer(makeTools(3), CORE_TOOLS).deferredToolNames).toEqual([])
  })
})

describe("autoDeferrableToolNames", () => {
  const tools = [{ name: "Read" }, { name: "Agent" }, { name: "mcp__a__x" }, { name: "mcp__b__y" }]

  it("is every tool outside the core set", () => {
    expect(autoDeferrableToolNames(tools, ["read"])).toEqual(["Agent", "mcp__a__x", "mcp__b__y"])
  })

  it("is narrowed to the prefixes when the adapter gives any", () => {
    expect(autoDeferrableToolNames(tools, ["read"], ["mcp__"])).toEqual(["mcp__a__x", "mcp__b__y"])
  })

  it("never includes a core tool, prefix or not", () => {
    expect(autoDeferrableToolNames(tools, ["mcp__a__x"], ["mcp__"])).toEqual(["mcp__b__y"])
  })

  it("includes the tools the adapter lists by name beside the prefixed ones", () => {
    expect(autoDeferrableToolNames(tools, ["read"], ["mcp__"], ["Agent"])).toEqual(["Agent", "mcp__a__x", "mcp__b__y"])
    expect(autoDeferrableToolNames(tools, ["read"], undefined, ["Agent"])).toEqual(["Agent"])
  })

  it("never includes a core tool, listed or not", () => {
    expect(autoDeferrableToolNames(tools, ["read"], ["mcp__"], ["Read"])).toEqual(["mcp__a__x", "mcp__b__y"])
  })

  it("is empty without a core set, which is how an adapter opts out", () => {
    expect(autoDeferrableToolNames(tools, undefined)).toEqual([])
    expect(autoDeferrableToolNames(tools, [])).toEqual([])
  })
})

describe("getAutoDeferThreshold", () => {
  it("returns default 15 when env var not set", () => {
    expect(getAutoDeferThreshold()).toBe(15)
  })

  it("returns env var value when set", () => {
    process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = "25"
    expect(getAutoDeferThreshold()).toBe(25)
  })

  it("is null when set to 0, which switches auto-defer off", () => {
    process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = "0"
    expect(getAutoDeferThreshold()).toBeNull()
    expect(getAutoDeferThreshold(0)).toBeNull()
  })

  it("returns default for invalid values", () => {
    process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = "abc"
    expect(getAutoDeferThreshold()).toBe(15)
  })

  it("is the client's own where the operator has set none", () => {
    expect(getAutoDeferThreshold(0)).toBe(0)
    process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = "abc"
    expect(getAutoDeferThreshold(0)).toBe(0)
  })

  it("is the operator's over the client's", () => {
    process.env.MERIDIAN_DEFER_TOOL_THRESHOLD = "25"
    expect(getAutoDeferThreshold(0)).toBe(25)
  })
})
