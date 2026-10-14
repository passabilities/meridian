// Synthetic header states only. Run with Bun; inspect through the shared preview.
// Actual build certification/server behavior is verified separately by e2e-build-provenance.mjs.
import { profileBarCss, profileBarHtml, profileBarJs, themeCss } from "../src/telemetry/profileBar"

const version = "1.79.0"
const sha = "e3fa58208c536932c871e764d390112a45f92e7c"
const artifact = { version, releaseVersion: version, source: "local", kind: "artifact", counter: 5,
  branch: "header-verification", sha, dirty: true, certification: "verified",
  branchUrl: "https://github.com/rynfar/meridian/tree/main", commitUrl: `https://github.com/rynfar/meridian/commit/${sha}` }
let scenario = "current"
let observations = 0
const allowed = new Set(["current", "behind", "rollback", "source-changed", "invalid", "unknown", "failure", "npm"])
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.E2E_HEADER_PORT ?? 42213), fetch(request) {
  const url = new URL(request.url)
  if (url.pathname === "/health") return Response.json({ status: "healthy", build: scenario === "npm"
    ? { version, source: "npm" } : scenario === "source-changed" ? { ...artifact, kind: "source", counter: undefined } : artifact })
  if (url.pathname === "/profiles/list") return Response.json({ profiles: [] })
  if (url.pathname === "/build-status") {
    observations++
    if (scenario === "failure") return new Response("Fixture unavailable", { status: 503 })
    return Response.json({ state: scenario, runtime: artifact, latest: { ...artifact, counter: scenario === "rollback" ? 2 : 8 },
      ...(scenario === "behind" ? { buildsBehind: 3 } : {}) })
  }
  if (url.pathname === "/fixture-observations") return Response.json({ observations, scenario })
  if (!["/", "/telemetry", "/settings"].includes(url.pathname)) return new Response("", { status: 404 })
  const selected = url.searchParams.get("state") ?? "current"
  if (!allowed.has(selected)) return new Response("Unknown fixture state", { status: 400 })
  scenario = selected
  observations = 0
  // Reproduce #1262's before-code paint while keeping all other header markup,
  // responsive fitting and link behavior identical to the current source.
  const beforeSeparator = url.searchParams.get("separator") === "before"
  const headerCss = beforeSeparator
    ? profileBarCss.replace('content: "·"; display: inline-block;', 'content: "·";')
    : profileBarCss
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Meridian build header fixture</title><style>${themeCss}${headerCss}</style></head><body>${profileBarHtml}<main style="padding:24px;color:var(--text);font-family:system-ui"><h1>Build header verification</h1><p>Synthetic ${scenario} state; ${beforeSeparator ? "before-code" : "current"} separators; no credentials or model calls.</p></main><script>${profileBarJs}</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } })
} })
console.log(JSON.stringify({ fixture: "build-header", port: server.port, synthetic: true }))
