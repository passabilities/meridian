import { describe, expect, it, spyOn } from "bun:test"
import { profileList } from "../proxy/profileCli"
import type { ProfileConfig } from "../proxy/profiles"

describe("profile list executable resolution", () => {
  for (const resolved of [{ path: "/owned/claude", source: "path-lookup" as const }, null]) {
    it(`resolves once for multiple browser profiles, including ${resolved ? "success" : "a miss"}`, () => {
      let resolves = 0
      const checked: Array<{ directory: string; path: string | null | undefined }> = []
      const profiles: ProfileConfig[] = Array.from({ length: 14 }, (_, index) => ({
        id: `profile-${index}`, type: "claude-max", claudeConfigDir: `/owned/profile-${index}`,
      }))
      const log = spyOn(console, "log").mockImplementation(() => {})
      try {
        profileList({
          loadProfiles: () => profiles,
          resolveExecutable: () => { resolves++; return resolved },
          authStatus: (directory, executable) => {
            checked.push({ directory, path: executable === null ? null : executable?.path })
            return { loggedIn: false }
          },
        })
      } finally { log.mockRestore() }
      expect(resolves).toBe(1)
      expect(checked).toEqual(profiles.map(profile => ({
        directory: profile.claudeConfigDir ?? "", path: resolved?.path ?? null,
      })))
    })
  }

  it("does not probe an executable for token-only profiles", () => {
    let resolves = 0
    let checks = 0
    const log = spyOn(console, "log").mockImplementation(() => {})
    try {
      profileList({
        loadProfiles: () => [{ id: "token", type: "oauth-token", oauthToken: "owned-fixture" }],
        resolveExecutable: () => { resolves++; return null },
        authStatus: () => { checks++; return { loggedIn: false } },
      })
    } finally { log.mockRestore() }
    expect(resolves).toBe(0)
    expect(checks).toBe(0)
  })
})
