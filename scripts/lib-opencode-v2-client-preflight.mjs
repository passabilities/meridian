import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync, realpathSync} from 'node:fs'
import {dirname, isAbsolute, join} from 'node:path'
import {pathToFileURL} from 'node:url'

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
export function resolveOpenCodeV2Client(entrypoint) {
  assert(typeof entrypoint === 'string' && isAbsolute(entrypoint), 'E2E_CLIENT_PLUGIN_PATH must name an installed V2 index.js')
  const path = realpathSync(entrypoint)
  const directory = dirname(path)
  assert.equal(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name, '@rynfar/meridian-opencode-v2-plugin')
  const root = realpathSync(join(directory, '../..'))
  assert.equal(path, join(root, 'dist/meridian-v2/index.js'))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.name, '@rynfar/meridian')
  return {path, packageVersion: pkg.version, sha256: digest(path)}
}

// Executes the installed plugin in an owned stable-V2 host fixture. This is
// protocol qualification, not evidence that an OpenCode executable ran.
export async function loadOpenCodeV2Client(installation, sessionID) {
  assert.equal(digest(installation.path), installation.sha256)
  const {default: plugin} = await import(pathToFileURL(installation.path).href)
  assert.equal(plugin.id, 'meridian')
  const hooks = new Map()
  const dispose = async () => {}
  const cleanup = await plugin.setup({
    model: {transform: async () => ({dispose}), reload: async () => {}},
    provider: {get: async () => undefined},
    event: {subscribe: () => (async function* () {})()},
    agent: {get: async () => ({mode: 'primary', hidden: false})},
    session: {
      get: async input => { assert.equal(input.sessionID, sessionID); return {id: sessionID} },
      // No human timestamp: this protocol fixture must not read an ambient attestation key.
      context: async () => [],
      hook: async (name, callback, options) => {
        const key = `${options.providerID}:${name}`
        hooks.set(key, callback)
        return {dispose: async () => { hooks.delete(key) }}
      },
    },
  })
  const report = {...installation, invocations: 0, errors: 0, preflight: false}
  async function headers(base = {}) {
    try {
      assert.equal(digest(installation.path), installation.sha256)
      const request = new Request('http://127.0.0.1/v1/messages', {headers: base})
      const hook = hooks.get('anthropic:http.request')
      assert.equal(typeof hook, 'function')
      await hook({sessionID, agent: 'build', kind: 'primary', model: {providerID: 'anthropic'}, request})
      assert.equal(request.headers.get('x-opencode-session'), sessionID)
      assert.equal(request.headers.get('x-opencode-agent-mode'), 'primary')
      assert.equal(request.headers.get('x-opencode-agent-name'), 'build')
      report.invocations++
      return Object.fromEntries(request.headers)
    } catch (error) { report.errors++; throw error }
  }
  try { await headers(); report.preflight = true; report.invocations = 0 }
  catch (error) { await cleanup(); throw error }
  return {headers, report, cleanup}
}
