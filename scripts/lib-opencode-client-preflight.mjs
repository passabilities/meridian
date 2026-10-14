import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync, realpathSync} from 'node:fs'
import {dirname, isAbsolute, join} from 'node:path'
import {pathToFileURL} from 'node:url'

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')

// Import the bundled plugin that a fresh V1 setup installs, never a header imitation.
export function resolveOpenCodeClient(entrypoint, expectedVersion) {
  assert(typeof entrypoint === 'string' && isAbsolute(entrypoint),
    'E2E_CLIENT_PLUGIN_PATH must name the installed Meridian V1 index.js')
  const path = realpathSync(entrypoint)
  const pluginDirectory = dirname(path)
  const pluginPackage = JSON.parse(readFileSync(join(pluginDirectory, 'package.json'), 'utf8'))
  assert.equal(pluginPackage.name, '@rynfar/meridian-opencode-v1-plugin', 'Wrong client plugin package')
  const root = realpathSync(join(pluginDirectory, '../..'))
  assert.equal(path, join(root, 'dist/meridian/index.js'), 'Use the bundled installed client plugin')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.equal(pkg.name, '@rynfar/meridian', 'Wrong owning Meridian package')
  assert(typeof pkg.version === 'string' && pkg.version, 'Missing Meridian package version')
  if (expectedVersion) assert.equal(pkg.version, expectedVersion, 'Client package version mismatch')
  return {path, packageName:pkg.name, packageVersion:pkg.version, sha256:digest(path)}
}

export async function loadOpenCodeClient(installation, sessionID) {
  assert.equal(digest(installation.path), installation.sha256, 'Client plugin changed after resolution')
  const {default:plugin} = await import(pathToFileURL(installation.path).href)
  assert.equal(typeof plugin, 'function', 'Client plugin factory missing')
  // This protocol fixture owns exactly one root session. This is its host API,
  // not evidence that the OpenCode executable has run.
  const hooks = await plugin({client:{session:{get:async ({path}) => {
    assert.equal(path.id, sessionID, 'Plugin requested an unowned session')
    return {data:{id:sessionID}}
  }}}})
  assert.equal(typeof hooks?.['chat.headers'], 'function', 'Client header hook missing')
  await hooks.config?.({})
  const report = {...installation, invocations:0, errors:0, preflight:false}
  async function headers(message, base = {}) {
    try {
      assert.equal(digest(installation.path), installation.sha256, 'Client plugin changed during run')
      const output = {headers:{...base}}
      await hooks['chat.headers']({sessionID, agent:'build', model:{providerID:'anthropic'}, message}, output)
      for (const [name, value] of Object.entries({
        'x-opencode-session':sessionID, 'x-opencode-request':message.id,
        'x-opencode-agent-mode':'primary', 'x-opencode-agent-name':'build',
      })) assert.equal(output.headers[name], value, `Client plugin did not produce ${name}`)
      report.invocations++
      return output.headers
    } catch (error) { report.errors++; throw error }
  }
  // No timestamp: this credentialless shape check must not load an attestation key.
  await headers({id:'owned-plugin-preflight', sessionID})
  report.preflight = true
  report.invocations = 0
  return {headers, report}
}
