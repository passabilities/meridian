/**
 * Under Bun the proxy is never told of a client that goes away before the
 * first byte of its response, so the model runs on (E87). Startup says so.
 */
import { describe, it, expect } from "bun:test"
import { runtimeCancelWarning } from "../proxy/runtimeCancelWarning"

describe("runtimeCancelWarning", () => {
  it("names the cost and the way out under Bun", () => {
    const warning = runtimeCancelWarning({ ...process.versions, bun: "1.3.14" })
    expect(warning).toContain("Bun 1.3.14")
    expect(warning).toContain("runs on to the end of its turn")
    expect(warning).toContain("npm run build && npm run start")
  })

  it("says nothing under Node", () => {
    const { bun: _bun, ...node } = process.versions
    expect(runtimeCancelWarning(node)).toBeUndefined()
  })
})
