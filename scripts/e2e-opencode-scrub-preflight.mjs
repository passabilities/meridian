#!/usr/bin/env bun
// Credentialless qualification of installed scrub loading and request hooks.
// Does not start a client, SDK query, server, or provider connection.
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {resolveOpenCodeScrub, configureOpenCodeScrub, verifyOpenCodeScrub} from './lib-opencode-scrub-preflight.mjs'
import {loadPlugins, getActiveTransforms} from '../src/proxy/plugins/loader.ts'
import {getPluginStats} from '../src/proxy/plugins/stats.ts'
import {createRequestContext, runTransformHook} from '../src/proxy/transform.ts'

const installation = resolveOpenCodeScrub(process.env.E2E_PLUGIN_PATH, process.env.E2E_SCRUB_VERSION)
const root = mkdtempSync(join(tmpdir(), 'opencode-scrub-load-proof-'))
try {
  const config = configureOpenCodeScrub(root, installation)
  const plugins = await loadPlugins(config.pluginDir, config.pluginConfigPath)
  const inventory = () => ({plugins: plugins.map(p => ({...p, stats:getPluginStats(p.name)}))})
  const loaded = verifyOpenCodeScrub(inventory(), installation)
  const text = 'You are powered by the model named Fixture.\nKeep the project instructions.'
  const request = createRequestContext({adapter:'opencode', body:{}, headers:new Headers(),
    model:'claude-opus-5-5', messages:[], systemContext:text, stream:false, workingDirectory:root})
  const result = runTransformHook(getActiveTransforms(plugins), 'onRequest', request, 'opencode')
  assert.notEqual(result.systemContext, text, 'Installed scrub did not remove the fixture fingerprint')
  assert(!result.systemContext.includes('You are powered by the model named'))
  assert(result.systemContext.includes('Keep the project instructions.'))
  const invoked = verifyOpenCodeScrub(inventory(), installation, true)
  console.log(JSON.stringify({result:'PASS', modelCalls:0, loaded, invoked}, null, 2))
} finally { rmSync(root, {recursive:true, force:true}) }
