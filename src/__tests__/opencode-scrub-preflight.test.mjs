import {describe, expect, it} from 'bun:test'
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveOpenCodeScrub, configureOpenCodeScrub, verifyOpenCodeScrub} from '../../scripts/lib-opencode-scrub-preflight.mjs'

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'scrub-preflight-'))
  try {
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({name:'@rynfar/meridian-plugin-opencode-scrub',version:'0.2.3'}))
    const entry = join(root, 'dist/index.js')
    writeFileSync(entry, 'export default {}')
    run(root, entry)
  } finally { rmSync(root, {recursive:true, force:true}) }
}

describe('live OpenCode scrub preflight', () => {
  it('refuses absent, relative and wrong-package paths before live access', () => {
    expect(() => resolveOpenCodeScrub(undefined)).toThrow('E2E_PLUGIN_PATH')
    expect(() => resolveOpenCodeScrub('relative.js')).toThrow('E2E_PLUGIN_PATH')
    fixture((root, entry) => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({name:'unrelated',version:'0.2.3'}))
      expect(() => resolveOpenCodeScrub(entry)).toThrow('Wrong scrub package')
    })
  })
  it('pins installed identity and writes isolated enabled configuration', () => fixture((root, entry) => {
    const installation = resolveOpenCodeScrub(entry, '0.2.3')
    expect(installation.sha256).toHaveLength(64)
    expect(() => resolveOpenCodeScrub(entry, 'other')).toThrow('Scrub version mismatch')
    const config = configureOpenCodeScrub(root, installation)
    expect(JSON.parse(readFileSync(config.pluginConfigPath, 'utf8'))).toEqual({plugins:[{path:installation.path,enabled:true}]})
    expect(config.pluginDir).toBe(join(root,'isolated-server-plugins'))
  }))
  it('requires exact loaded path, active request hook and invocation evidence', () => fixture((root, entry) => {
    const installation = resolveOpenCodeScrub(entry)
    const active = {name:'opencode-scrub',path:entry,status:'active',hooks:['onRequest'],version:'0.2.3',stats:{hooks:{onRequest:{invocations:1,errors:0}}}}
    expect(verifyOpenCodeScrub({plugins:[active]},installation,true).invocations).toBe(1)
    const other = join(root, 'other.js')
    writeFileSync(other, 'export default {}')
    expect(() => verifyOpenCodeScrub({plugins:[{...active,path:other}]},installation)).toThrow('Wrong scrub entrypoint')
    for (const plugins of [[], [active,active], [{...active,status:'error'}], [{...active,hooks:[]}], [{...active,name:'wrong'}]]) {
      expect(() => verifyOpenCodeScrub({plugins},installation)).toThrow()
    }
    expect(() => verifyOpenCodeScrub({plugins:[{...active,stats:{hooks:{onRequest:{invocations:0,errors:0}}}}]},installation,true)).toThrow('did not process')
    expect(() => verifyOpenCodeScrub({plugins:[{...active,stats:{hooks:{onRequest:{invocations:1,errors:1}}}}]},installation,true)).toThrow('hook failed')
  }))
})
