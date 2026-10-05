/**
 * Cache layout for a prompt that grows from one request to the next.
 */
import { describe, expect, it } from "bun:test"
import {
  layoutGrowingPrompt,
  CACHE_LAYOUT_CHUNK_CHARS,
  CACHE_LAYOUT_TAIL_CHARS,
  type CacheLayoutBlock,
} from "../proxy/promptCacheLayout"

const CHUNK = 400
const TAIL = 80

const entry = (index: number) => `{"entry":${index},"text":"${"x".repeat(30 + (index % 7))}"}\n`
const entries = (count: number) => Array.from({ length: count }, (_, index) => entry(index)).join("")
const HISTORY = `<conversation_history>\n${"config line\n".repeat(60)}\n</conversation_history>\n\nThe above is a replay.\n\n`
const SUFFIX = "</transcript>\nRespond with <severity>N</severity> ONLY."
const live = (count: number, suffix = SUFFIX) => `<transcript>\n${entries(count)}${suffix}`

const layout = (segments: string[]) => layoutGrowingPrompt(segments, { chunkChars: CHUNK, tailChars: TAIL })

function required(blocks: CacheLayoutBlock[] | undefined): CacheLayoutBlock[] {
  if (!blocks) throw new Error("expected a cache layout")
  return blocks
}

function textOf(blocks: CacheLayoutBlock[]): string {
  return blocks.map(block => block.text).join("")
}

/** The text through the end of every block, in order. */
function boundaries(blocks: CacheLayoutBlock[]): string[] {
  let text = ""
  return blocks.map(block => (text += block.text))
}

/** The text each cache breakpoint covers. */
function breakpoints(blocks: CacheLayoutBlock[]): string[] {
  const ends = boundaries(blocks)
  return blocks.flatMap((block, index) => block.cache_control ? [ends[index]!] : [])
}

/**
 * The prompt cache as the API documents it: an entry is written at each
 * breakpoint, and a request reads the longest entry that ends at one of the
 * 20 block boundaries at or before one of its own breakpoints.
 */
function readFromCache(written: Set<string>, blocks: CacheLayoutBlock[]): string {
  const ends = boundaries(blocks)
  let best = ""
  blocks.forEach((block, index) => {
    if (!block.cache_control) return
    for (let back = index; back >= Math.max(0, index - 20); back--) {
      const prefix = ends[back]!
      if (written.has(prefix) && prefix.length > best.length) best = prefix
    }
  })
  return best
}

describe("layoutGrowingPrompt", () => {
  it("hands back the same text, only split into blocks", () => {
    const segments = [HISTORY, live(60)]
    expect(textOf(required(layout(segments)))).toBe(segments.join(""))
    expect(textOf(required(layout([live(60)])))).toBe(live(60))
  })

  it("leaves alone a prompt with nothing stable enough to cache", () => {
    expect(layout([live(3)])).toBeUndefined()
    expect(layout([])).toBeUndefined()
    expect(layout(["", ""])).toBeUndefined()
  })

  it("puts a breakpoint where the history ends, so every conversation sharing it reads it back", () => {
    const blocks = required(layout([HISTORY, live(60)]))
    expect(breakpoints(blocks)[0]).toBe(HISTORY)
    const other = required(layout([HISTORY, `<transcript>\n${"another conversation entirely\n".repeat(20)}${SUFFIX}`]))
    expect(breakpoints(other)[0]).toBe(HISTORY)
  })

  it("puts the last breakpoint on the last full chunk, with the tail that changes left after it", () => {
    const prompt = live(60)
    const blocks = required(layout([prompt]))
    const marked = breakpoints(blocks)
    expect(marked).toHaveLength(1)
    const covered = marked[0]!.length
    expect(covered).toBeLessThanOrEqual(prompt.length - TAIL)
    expect(covered).toBeGreaterThan(prompt.length - TAIL - 2 * CHUNK)
    expect(blocks.at(-1)!.cache_control).toBeUndefined()
    expect(blocks.at(-1)!.text.endsWith(SUFFIX)).toBe(true)
  })

  it("keeps every earlier breakpoint at a block boundary when the prompt grows", () => {
    const before = required(layout([HISTORY, live(40)]))
    const after = required(layout([HISTORY, live(47)]))
    const ends = boundaries(after)
    for (const prefix of breakpoints(before)) expect(ends).toContain(prefix)
    const deepBefore = breakpoints(before).at(-1)!
    const deepAfter = after.findLastIndex(block => block.cache_control !== undefined)
    expect(deepAfter - ends.indexOf(deepBefore)).toBeLessThanOrEqual(20)
    expect(deepAfter - ends.indexOf(deepBefore)).toBeGreaterThanOrEqual(0)
  })

  it("keeps its breakpoints at a block boundary whatever length the prompt was when it grew", () => {
    // Every length puts the last chunk's end somewhere else against the tail,
    // including where the tail itself would have decided the cut.
    const tails = [SUFFIX, "</transcript>\nA.", `</transcript>\n${"one more line of instruction\n".repeat(2)}`]
    for (let count = 8; count < 90; count++) {
      const before = required(layout([HISTORY, live(count, tails[count % 3])]))
      const after = boundaries(required(layout([HISTORY, live(count + 1 + (count % 4), tails[(count + 1) % 3])])))
      for (const prefix of breakpoints(before)) expect(after).toContain(prefix)
    }
  })

  it("writes every breakpoint for the lifetime it is asked for, the same for all of them", () => {
    const segments = [HISTORY, live(60)]
    const short = required(layoutGrowingPrompt(segments, { chunkChars: CHUNK, tailChars: TAIL }))
    const long = required(layoutGrowingPrompt(segments, { chunkChars: CHUNK, tailChars: TAIL, ttl: "1h" }))
    expect(short.flatMap(block => block.cache_control ? [block.cache_control] : []))
      .toEqual([{ type: "ephemeral" }, { type: "ephemeral" }])
    expect(long.flatMap(block => block.cache_control ? [block.cache_control] : []))
      .toEqual([{ type: "ephemeral", ttl: "1h" }, { type: "ephemeral", ttl: "1h" }])
    expect(long.map(block => block.text)).toEqual(short.map(block => block.text))
  })

  it("lets each request read back what the one before it wrote", () => {
    const written = new Set<string>()
    let count = 30
    let previousDeep = ""
    const unread: number[] = []
    for (let step = 0; step < 40; step++) {
      // Stage 1 and stage 2 of one check share a transcript and differ in the tail.
      const suffix = step % 5 === 4 ? "</transcript>\nUse <thinking> first, then respond." : SUFFIX
      const prompt = [HISTORY, live(count, suffix)]
      const blocks = required(layout(prompt))
      const read = readFromCache(written, blocks)
      if (step > 0) {
        expect(read).toBe(previousDeep)
        unread.push(prompt.join("").length - read.length)
      }
      for (const prefix of breakpoints(blocks)) written.add(prefix)
      previousDeep = breakpoints(blocks).at(-1)!
      count += 1 + (step * 7) % 23
    }
    // What a request pays for in full is what was added since, plus at most two chunks and the tail.
    const added = (1 + 22) * entry(0).length * 1.3
    expect(Math.max(...unread)).toBeLessThan(added + 2 * CHUNK + TAIL)
  })

  it("does not let a different tail move an earlier cut", () => {
    const short = required(layout([HISTORY, live(60, "</transcript>\nA.")]))
    const long = required(layout([HISTORY, live(60, `</transcript>\n${"B".repeat(TAIL - 20)}`)]))
    expect(breakpoints(short)[0]).toBe(breakpoints(long)[0]!)
    const shared = breakpoints(short).at(-1)!
    expect(boundaries(long)).toContain(shared)
  })

  it("cuts at line ends", () => {
    const blocks = required(layout([HISTORY, live(60)]))
    for (const block of blocks.slice(0, -1)) expect(block.text.endsWith("\n")).toBe(true)
    for (const block of blocks) expect(block.text.length).toBeLessThanOrEqual(CHUNK + TAIL + CHUNK)
  })

  it("cuts a line longer than a chunk at the chunk size", () => {
    const prompt = "y".repeat(5 * CHUNK + 37)
    const blocks = required(layout([prompt]))
    expect(textOf(blocks)).toBe(prompt)
    for (const block of blocks.slice(0, -1)) expect(block.text).toHaveLength(CHUNK)
  })

  it("never marks more blocks than a request may carry, and never an empty one", () => {
    for (const segments of [[HISTORY, live(200)], [live(200)], [HISTORY, HISTORY, live(200)]]) {
      const blocks = required(layout(segments))
      expect(blocks.filter(block => block.cache_control).length).toBeLessThanOrEqual(2)
      for (const block of blocks) {
        expect(block.type).toBe("text")
        expect(block.text.trim()).not.toBe("")
        if (block.cache_control) expect(block.cache_control).toEqual({ type: "ephemeral" })
      }
    }
  })

  it("gives up rather than send a block of nothing but whitespace", () => {
    expect(layout([HISTORY, `${" ".repeat(3 * CHUNK)}\n${live(60)}`])).toBeUndefined()
  })

  it("does not mark the end of a first part that is itself still growing", () => {
    // A client that sends each transcript entry as a message of its own: the
    // history is what grows, and the live message is only the instruction.
    const growing = (count: number) => [`<conversation_history>\n${entries(count)}\n</conversation_history>\n\n`, "Respond with <severity>N</severity> ONLY."]
    const before = required(layout(growing(40)))
    const after = required(layout(growing(47)))
    expect(breakpoints(before)).toHaveLength(1)
    expect(boundaries(after)).toContain(breakpoints(before)[0]!)
  })

  it("defaults to chunks and a tail sized for real prompts", () => {
    expect(CACHE_LAYOUT_CHUNK_CHARS).toBeGreaterThanOrEqual(8_000)
    expect(CACHE_LAYOUT_TAIL_CHARS).toBeGreaterThanOrEqual(1_000)
    const prompt = `${"line of transcript text\n".repeat(4_000)}tail`
    const blocks = required(layoutGrowingPrompt([prompt]))
    expect(textOf(blocks)).toBe(prompt)
    expect(blocks.length).toBeLessThan(20)
    expect(blocks.filter(block => block.cache_control).map(block => block.cache_control)).toEqual([{ type: "ephemeral" }])
  })
})
