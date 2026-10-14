import {describe, expect, it} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveOpenCodeClient,loadOpenCodeClient} from '../../scripts/lib-opencode-client-preflight.mjs'

async function fixture(source, run) {
  const root=mkdtempSync(join(tmpdir(),'client-plugin-preflight-'))
  try {
    const dir=join(root,'dist/meridian');mkdirSync(dir,{recursive:true})
    writeFileSync(join(root,'package.json'),JSON.stringify({name:'@rynfar/meridian',version:'1.81.0',type:'module'}))
    writeFileSync(join(dir,'package.json'),JSON.stringify({name:'@rynfar/meridian-opencode-v1-plugin',type:'module'}))
    const path=join(dir,'index.js');writeFileSync(path,source)
    await run(path)
  } finally {rmSync(root,{recursive:true,force:true})}
}

describe('OpenCode installed client plugin admission',()=>{
  it('rejects missing paths and wrong owner identity before loading',async()=>{
    expect(()=>resolveOpenCodeClient()).toThrow('E2E_CLIENT_PLUGIN_PATH')
    expect(()=>resolveOpenCodeClient('relative')).toThrow('E2E_CLIENT_PLUGIN_PATH')
    await fixture('export default ()=>({})',async path=>{
      expect(()=>resolveOpenCodeClient(path,'0.0.0')).toThrow('version mismatch')
      writeFileSync(join(path,'../../../package.json'),JSON.stringify({name:'wrong',version:'1.81.0'}))
      expect(()=>resolveOpenCodeClient(path)).toThrow('Wrong owning')
    })
  })
  it('rejects missing and inert hooks',async()=>{
    for(const source of ['export default ()=>({})','export default ()=>({"chat.headers":async()=>{}})']) {
      await fixture(source,async path=>{
        await expect(loadOpenCodeClient(resolveOpenCodeClient(path),'owned')).rejects.toThrow()
      })
    }
  })
  it('executes the real source hook, replaces spoofed headers and prevents changed bytes',async()=>{
    const source=new URL('../../plugin/meridian.ts',import.meta.url).href
    await fixture(`export {default} from ${JSON.stringify(source)}`,async path=>{
      const client=await loadOpenCodeClient(resolveOpenCodeClient(path),'owned')
      expect(client.report.preflight).toBe(true)
      const headers=await client.headers({id:'human-1',sessionID:'owned'},{'x-opencode-session':'spoof'})
      expect(headers['x-opencode-session']).toBe('owned')
      expect(headers['x-opencode-request']).toBe('human-1')
      expect(headers['x-opencode-agent-name']).toBe('build')
      expect(client.report.invocations).toBe(1)
      writeFileSync(path,'export default ()=>({})')
      await expect(client.headers({id:'human-2'})).rejects.toThrow('changed during run')
      expect(client.report.errors).toBe(1)
    })
  })
})
