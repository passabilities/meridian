import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
const target = process.env.E2E_MERIDIAN_ROOT
assert(target)
const root = mkdtempSync(join(tmpdir(), 'haiku55-pack-smoke-'))
for (const key of Object.keys(process.env)) if (/^(MERIDIAN_|CLAUDE_|ANTHROPIC_)/.test(key)) delete process.env[key]
Object.assign(process.env, { HOME: root, CLAUDE_CONFIG_DIR: join(root,'claude'), MERIDIAN_CONFIG_DIR: join(root,'meridian'),
 MERIDIAN_SESSION_DIR: join(root,'sessions'), MERIDIAN_WORKDIR: root, MERIDIAN_TELEMETRY_PERSIST: '0', MERIDIAN_CREDENTIALS_READONLY: '1', MERIDIAN_NO_UPDATE_CHECK: '1' })
for (const dir of ['claude','meridian','sessions']) mkdirSync(join(root,dir),{mode:0o700})
const report = {scope:'independent installed package HTTP discovery/refusal and native version; NO model/client acceptance', modelAcceptance:false,
 package:JSON.parse(readFileSync(join(target,'package.json'),'utf8')).version, requests:[]}
let proxy
try {
 const {startProxyServer} = await import(pathToFileURL(join(target,'dist/server.js')).href)
 proxy = await startProxyServer({port:0,host:'127.0.0.1',silent:true,profiles:[{id:'owned-api',type:'api',apiKey:'owned-no-provider-key',baseUrl:'http://127.0.0.1:9'}],defaultProfile:'owned-api'})
 if (!proxy.server.listening) await once(proxy.server,'listening')
 const base = `http://127.0.0.1:${proxy.server.address().port}`
 const catalog = await (await fetch(`${base}/v1/models`)).json()
 const model = catalog.data.find(m=>m.id==='claude-haiku-5-5')
 assert.equal(model.context_window,1000000)
 assert.equal(model.capabilities.thinking.types.adaptive.supported,true)
 assert.equal(model.capabilities.thinking.types.enabled.supported,false)
 assert.equal(catalog.data.find(m=>m.id==='claude-haiku-4-5').context_window,200000)
 for (const stream of [false,true]) for(const thinking of [{type:'disabled'},{type:'adaptive',display:'omitted'}]) {
  const res = await fetch(`${base}/v1/messages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'claude-haiku-5-5',stream,max_tokens:32,messages:[{role:'user',content:'owned fixture'}],thinking})})
  const body=await res.json()
  assert.equal(res.status,400)
  assert.equal(body.error.type,'invalid_request_error')
  assert.match(body.error.message,/cannot reliably honor/)
  report.requests.push({stream,thinking,status:res.status,error:body.error})
 }
 const child=spawn(process.env.E2E_NATIVE_BIN,['--version'],{env:{HOME:root,CLAUDE_CONFIG_DIR:join(root,'claude'),PATH:process.env.PATH},stdio:['ignore','pipe','pipe']})
 let stdout='',outClosed=false,errClosed=false
 child.stdout.on('data',data=>{stdout+=data});child.stderr.resume()
 child.stdout.once('close',()=>{outClosed=true});child.stderr.once('close',()=>{errClosed=true})
 const deadline=setTimeout(()=>child.kill('SIGKILL'),10000)
 try {const [code]=await once(child,'close');assert.equal(code,0);assert(outClosed&&errClosed)} finally {clearTimeout(deadline)}
 report.native=stdout.trim();assert.match(stdout,/2\.1\.296/)
 report.nativeProbeJoined=true;report.result='PASS'
} finally {
 if(proxy)await proxy.close()
 writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({...report,artifacts:root}))
}
