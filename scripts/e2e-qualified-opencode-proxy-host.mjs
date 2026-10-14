// Owned proxy subprocess for live OpenCode gates, including real process restart.
import assert from 'node:assert/strict'
import * as cp from 'node:child_process'
import {spyOn} from 'bun:test'
import {readFileSync,statSync,mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {resolveOpenCodeScrub,configureOpenCodeScrub,verifyOpenCodeScrub} from './lib-opencode-scrub-preflight.mjs'
import {observeChildClosure,stopAndJoinChild} from './lib/e2eProcessCustody.mjs'
assert.equal(process.env.E2E_ALLOW_LIVE_MODEL,'1')
const scrub=resolveOpenCodeScrub(process.env.E2E_PLUGIN_PATH,process.env.E2E_SCRUB_VERSION)
const grant=process.env.E2E_LIVE_PROFILE_FILE
assert.equal(statSync(grant).mode&0o077,0,'Access-only grant must be private')
const profiles=JSON.parse(readFileSync(grant,'utf8'))
assert(Array.isArray(profiles)&&profiles.length===1&&profiles[0].type==='oauth-token'&&typeof profiles[0].oauthToken==='string'&&!profiles[0].refreshToken)
assert(process.env.MERIDIAN_CONFIG_DIR&&process.env.MERIDIAN_WORKDIR&&process.env.E2E_PROXY_REPORT_DIR)
mkdirSync(process.env.MERIDIAN_CONFIG_DIR,{recursive:true})
mkdirSync(process.env.E2E_PROXY_REPORT_DIR,{recursive:true})
process.env.MERIDIAN_CREDENTIALS_READONLY='1'
if(process.env.E2E_NATIVE_BIN)process.env.MERIDIAN_CLAUDE_PATH=process.env.E2E_NATIVE_BIN
process.chdir(process.env.MERIDIAN_WORKDIR)
const actors=[],spies=[]
for(const name of ['spawn','execFile']){const original=cp[name];spies.push(spyOn(cp,name).mockImplementation((...args)=>{const child=Reflect.apply(original,cp,args);actors.push({child,witness:observeChildClosure(child)});return child}))}
const report={pid:process.pid,result:'RUNNING',children:[]}
const {startProxyServer}=await import(process.env.E2E_PROXY_MODULE)
const proxy=await startProxyServer({port:0,host:'127.0.0.1',silent:true,profiles,defaultProfile:profiles[0].id,...configureOpenCodeScrub(process.env.MERIDIAN_CONFIG_DIR,scrub)})
const url=`http://127.0.0.1:${proxy.server.address().port}`
report.scrubPreflight=verifyOpenCodeScrub(await(await fetch(url+'/plugins/list')).json(),scrub)
process.send({port:proxy.server.address().port,pid:process.pid})
let closing=false
async function close(){
 if(closing)return;closing=true
 try{
 const rows=await(await fetch(url+'/telemetry/requests?limit=500')).json()
 const require=createRequire(process.env.E2E_PROXY_MODULE);const sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href)
 process.env.CLAUDE_CONFIG_DIR=join(process.env.MERIDIAN_CONFIG_DIR,'profiles',profiles[0].id)
 const models=new Set();for(const id of new Set(rows.map(row=>row.sdkSessionId).filter(Boolean)))for(const row of await sdk.getSessionMessages(id,{dir:process.env.MERIDIAN_WORKDIR}))if(row.type==='assistant'&&typeof row.message?.model==='string')models.add(row.message.model)
 report.observedModels=[...models];if(process.env.E2E_EXPECT_MODEL)assert(models.has(process.env.E2E_EXPECT_MODEL),'Expected actual SDK model missing')
 report.scrubFinal=verifyOpenCodeScrub(await(await fetch(url+'/plugins/list')).json(),scrub);report.result='PASS'}catch(error){report.result='FAIL';report.failure=error?.name??'UnknownError'}
 try{await proxy.close()}catch(error){report.result='FAIL';report.closeFailure=error?.name??'UnknownError'}
 for(const actor of actors)report.children.push(await stopAndJoinChild(actor.child,actor.witness))
 report.joined=report.children.every(row=>row.joined);if(!report.joined)report.result='FAIL'
 for(const spy of spies.reverse())spy.mockRestore()
 writeFileSync(join(process.env.E2E_PROXY_REPORT_DIR,`proxy-${process.pid}.json`),JSON.stringify(report,null,2)+'\n',{mode:0o600})
 process.exit(report.result==='PASS'?0:1)
}
process.on('SIGTERM',()=>void close())
process.on('SIGINT',()=>void close())
