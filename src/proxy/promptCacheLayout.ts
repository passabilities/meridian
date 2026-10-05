/** Cache layout for a prompt that grows from one request to the next. Pure. */

/** One text block of a prompt laid out for the prompt cache. */
export interface CacheLayoutBlock {
  type: "text"
  text: string
  cache_control?: { type: "ephemeral"; ttl?: "1h" }
}

export interface CacheLayoutOptions {
  chunkChars?: number
  tailChars?: number
  /**
   * How long the breakpoints' entries live. The API's default is five
   * minutes; every breakpoint of a request gets the same lifetime, because the
   * API refuses a longer-lived one placed after a shorter-lived one.
   */
  ttl?: "1h"
}

/** Long enough that a 300K-character prompt stays inside the cache's 20-block lookback. */
export const CACHE_LAYOUT_CHUNK_CHARS = 16_384

/**
 * How much of the end of a prompt is taken to differ in the next request: the
 * closing tags and the instruction that follow a transcript. Several times
 * the longest one measured (203 characters), because a guess that is too
 * short costs one wasted cache write and one that is too long costs nothing
 * but these characters at the uncached rate.
 */
export const CACHE_LAYOUT_TAIL_CHARS = 2_048

/** After the last line end in the second half of the chunk, or at its end. */
function cutPoint(text: string, start: number, chunkChars: number): number {
  const limit = start + chunkChars
  const lineEnd = text.lastIndexOf("\n", limit - 1)
  return lineEnd >= start + Math.floor(chunkChars / 2) ? lineEnd + 1 : limit
}

/**
 * Lay out a prompt that only grows, so each request reads back from the
 * prompt cache what the request before it wrote.
 *
 * The cache matches whole blocks: a request reads an entry only when one of
 * its block boundaries ends exactly where an earlier request placed a
 * breakpoint. A prompt sent as one block has one boundary, its end, which the
 * next, longer prompt never shares — so every request writes the whole prompt
 * and reads none of it.
 *
 * Cuts are made front to back, each from the text before it alone, so the
 * same text is cut at the same places however much is appended later. The
 * joins between `segments` are cuts too. A cut counts as stable only when
 * everything that decided it lies before the last `tailChars`, the part
 * taken to change. The last stable cut gets a breakpoint; so does the end of
 * the first segment when it is stable and others follow it, which is where
 * requests that share only their opening (one user's instructions, in
 * different conversations) meet.
 *
 * The blocks join back into exactly the text given. Undefined when no cut is
 * stable, or when a block would be nothing but whitespace, which the API
 * refuses to cache: the caller then sends the prompt as it always has.
 */
export function layoutGrowingPrompt(
  segments: readonly string[],
  options: CacheLayoutOptions = {},
): CacheLayoutBlock[] | undefined {
  const { chunkChars = CACHE_LAYOUT_CHUNK_CHARS, tailChars = CACHE_LAYOUT_TAIL_CHARS, ttl } = options
  const parts = segments.filter(segment => segment.length > 0)
  const stableEnd = parts.reduce((total, part) => total + part.length, 0) - tailChars
  const blocks: Array<{ text: string; stable: boolean; first: boolean }> = []
  let offset = 0
  parts.forEach((part, index) => {
    let start = 0
    while (start + chunkChars <= part.length && offset + start + chunkChars <= stableEnd) {
      const end = cutPoint(part, start, chunkChars)
      blocks.push({ text: part.slice(start, end), stable: true, first: index === 0 })
      start = end
    }
    if (start < part.length) {
      blocks.push({ text: part.slice(start), stable: offset + part.length <= stableEnd, first: index === 0 })
    }
    offset += part.length
  })
  if (blocks.some(block => block.text.trim() === "")) return undefined
  const last = blocks.findLastIndex(block => block.stable)
  if (last < 0) return undefined
  const opening = parts.length > 1 ? blocks.findLastIndex(block => block.first) : -1
  const shared = opening >= 0 && blocks[opening]?.stable ? opening : -1
  return blocks.map((block, index) => index === last || index === shared
    ? { type: "text", text: block.text, cache_control: ttl ? { type: "ephemeral", ttl } : { type: "ephemeral" } }
    : { type: "text", text: block.text })
}
