#!/usr/bin/env bun
// Actual HTTP app/pages/settings persistence with controlled auth/account
// probes. No real credentials, SDK/model generation or provider subprocesses.
// E2E_BASELINE_ROOT=<unchanged tree> E2E_PORT=42233 bun scripts/e2e-hostname-header.mjs
// Native browser: /fixture/frame?width=375&path=/settings, then evaluate the
// maintained e2e-hostname-header-browser.js expression inside the owned frame.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spyOn } from 'bun:test'
const baseline = process.env.E2E_BASELINE_ROOT
const port = Number(process.env.E2E_PORT || 42233)
const root = mkdtempSync(join(tmpdir(), 'meridian-hostname-ui-'))
for (const key of Object.keys(process.env)) if (/^(MERIDIAN_|CLAUDE_|CLAUDE_PROXY_|ANTHROPIC_|OPENAI_)/.test(key)) delete process.env[key]
Object.assign(process.env, { MERIDIAN_CONFIG_DIR: root, MERIDIAN_SESSION_DIR: join(root, 'sessions'),
  CLAUDE_CONFIG_DIR: join(root, 'unlinked-default'), MERIDIAN_CREDENTIALS_READONLY: '1',
  MERIDIAN_NO_UPDATE_CHECK: '1', MERIDIAN_TELEMETRY_PERSIST: '0' })
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { mode: 0o700 })
const models = await import('../src/proxy/models.ts')
const sdk = await import('@anthropic-ai/claude-agent-sdk')
let modelCalls = 0
const sdkSpy = spyOn(sdk, 'query').mockImplementation(() => { modelCalls++; throw new Error('Hostname UI fixture forbids SDK queries') })
const authSpy = spyOn(models, 'getClaudeAuthStatusAsync').mockImplementation(async () => ({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }))
const executableSpy = spyOn(models, 'resolveClaudeExecutableAsync').mockImplementation(async () => 'owned-fixture-no-cli')
const { createProxyServer } = await import('../src/proxy/server.ts')
const { createAntigravityServer } = await import('../src/proxy/backends/antigravity.ts')
const { AntigravityRuntime } = await import('../src/proxy/backends/antigravityRuntime.ts')
const { DEFAULT_PROXY_CONFIG } = await import('../src/proxy/types.ts')
const { headerSettingsState } = await import('../src/headerSettings.ts')
const profiles = [{ id: 'owned-hostname-fixture', type: 'api', apiKey: 'synthetic-only' }]
const { app } = createProxyServer({ profiles, defaultProfile: profiles[0].id, silent: true, version: '1.79.0' })
const runtime = new AntigravityRuntime()
runtime.initialize = async () => {}
runtime.verifyAccount = async () => {}
runtime.providerFacts = () => ({ quota: { fetchedAt: Date.now(), windows: [] },
  models: ['owned-fixture-no-generation'], error: undefined, loading: false })
const standalone = createAntigravityServer({ ...DEFAULT_PROXY_CONFIG, backend: 'antigravity', silent: true, version: '1.79.0' }, runtime)
let before = {}
if (baseline) {
  before = {
    home: (await import(pathToFileURL(join(baseline, 'src/telemetry/landing.ts')).href)).landingHtml,
    settings: (await import(pathToFileURL(join(baseline, 'src/telemetry/settingsPage.ts')).href)).settingsPageHtml,
    providers: (await import(pathToFileURL(join(baseline, 'src/telemetry/providerPage.ts')).href)).providerPageHtml,
  }
}
const paths = ['/', '/settings', '/providers', '/fixture/provider', '/fixture/before/', '/fixture/before/settings', '/fixture/before/providers']
const server = Bun.serve({ hostname: '127.0.0.1', port, async fetch(request) {
  const url = new URL(request.url)
  if (url.pathname === '/fixture/state') return Response.json({ fixture: 'hostname-contract', syntheticAuth: true,
    ...headerSettingsState(), modelCalls, standaloneProvider: true, baseline: baseline || null })
  if (url.pathname === '/fixture/frame') {
    const width = Number(url.searchParams.get('width') || 1280), path = url.searchParams.get('path') || '/settings'
    if (!Number.isInteger(width) || width < 320 || width > 2560 || !paths.includes(path)) return new Response('Invalid fixture viewport', { status: 400 })
    return new Response(`<meta charset="utf-8"><iframe id="fixtureViewport" data-owned-fixture="hostname-contract" title="Owned Meridian hostname viewport" style="border:0;width:${width}px;height:1000px" src="${path}"></iframe>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  }
  if (url.pathname.startsWith('/fixture/before/')) {
    const page = url.pathname.endsWith('settings') ? before.settings : url.pathname.endsWith('providers') ? before.providers : before.home
    return page ? new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }) : new Response('Set E2E_BASELINE_ROOT', { status: 404 })
  }
  assert(!['/v1/messages', '/messages', '/v1/responses', '/v1/chat/completions'].includes(url.pathname), 'This UI fixture must not call a model')
  if (url.pathname === '/fixture/provider') return standalone.app.fetch(new Request(new URL('/providers', request.url), request))
  const referrer = request.headers.get('referer')
  if (referrer && ['/fixture/provider', '/fixture/before/providers'].includes(new URL(referrer).pathname)) {
    return standalone.app.fetch(request)
  }
  return app.fetch(request)
} })
console.log(JSON.stringify({ ready: true, port: server.port, ownedRoot: root, syntheticAuth: true, modelCalls, baseline: baseline || null }))
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  server.stop(true)
  await standalone.closeBackend()
  sdkSpy.mockRestore(); authSpy.mockRestore(); executableSpy.mockRestore()
  rmSync(root, { recursive: true, force: true })
  process.exit(0)
})
