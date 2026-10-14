import assert from 'node:assert/strict'
import cp from 'node:child_process'
import {syncBuiltinESMExports,createRequire} from 'node:module'
import {once} from 'node:events'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomBytes} from 'node:crypto'
import {resolveOpenCodeScrub,configureOpenCodeScrub,verifyOpenCodeScrub} from '/Users/rynfar/repos/meridian-opencode-system-delta-1301-20261012/scripts/lib-opencode-scrub-preflight.mjs'
const repo='/tmp/meridian-1301-candidate-installed-20261012/node_modules/@rynfar/meridian'
const scrub=resolveOpenCodeScrub('/tmp/meridian-scrub-preflight-package-20261012/node_modules/@rynfar/meridian-plugin-opencode-scrub/dist/index.js','0.2.3')
const grant='/tmp/meridian-1354-e42-live-20261012/grant.json';assert.equal(statSync(grant).mode&0o077,0);const profiles=JSON.parse(readFileSync(grant));assert(profiles.length===1&&!profiles[0].refreshToken)
const root=mkdtempSync(join(tmpdir(),'meridian-qualified-e42-'));for(const dir of ['home','config','sessions','project'])mkdirSync(join(root,dir))
for(const key of Object.keys(process.env))if(/^(MERIDIAN_|CLAUDE_|ANTHROPIC_|OPENCODE_)/.test(key))delete process.env[key]
const key=randomBytes(32).toString('base64url')
Object.assign(process.env,{HOME:join(root,'home'),PWD:join(root,'project'),INIT_CWD:join(root,'project'),MERIDIAN_CONFIG_DIR:join(root,'config'),MERIDIAN_SESSION_DIR:join(root,'sessions'),MERIDIAN_WORKDIR:join(root,'project'),MERIDIAN_PASSTHROUGH:'1',MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_NO_UPDATE_CHECK:'1',MERIDIAN_OPENCODE_ATTESTATION_KEY:key,MERIDIAN_CLAUDE_PATH:'/Users/rynfar/.local/bin/claude'})
process.chdir(join(root,'project'))
const actors=[],original=cp.spawn;cp.spawn=function(...args){const child=original.apply(this,args),row={pid:child.pid,command:String(args[0]),close:false,stdoutClose:!child.stdout,stderrClose:!child.stderr};actors.push(row);child.once('close',(code,signal)=>Object.assign(row,{close:true,code,signal}));child.stdout?.once('close',()=>row.stdoutClose=true);child.stderr?.once('close',()=>row.stderrClose=true);return child};syncBuiltinESMExports()
let proxy;const report={root,result:'RUNNING',actors,client:'2.0.16',model:'claude-haiku-5-5',scope:'Installed stable E42 with external access-only proxy and verified server scrub'}
try{
 const {startProxyServer}=await import(pathToFileURL(join(repo,'dist/server.js')))
 proxy=await startProxyServer({port:0,host:'127.0.0.1',silent:true,profiles,defaultProfile:profiles[0].id,...configureOpenCodeScrub(root,scrub)})
 if(!proxy.server.listening)await once(proxy.server,'listening');const url=`http://127.0.0.1:${proxy.server.address().port}`
 report.scrubPreflight=verifyOpenCodeScrub(await(await fetch(url+'/plugins/list')).json(),scrub)
 const env={PATH:process.env.PATH,HOME:process.env.HOME,E2E_PROXY_URL:url,E2E_ATTESTATION_KEY:key,E2E_MODEL:report.model,E2E_MERIDIAN_ROOT:repo,E2E_OPENCODE_BIN:'/tmp/meridian-1354-oc2016-20261012/node_modules/.bin/opencode'}
 const child=cp.spawn('bun',['/Users/rynfar/repos/meridian-opencode-system-delta-1301-20261012/scripts/e2e-opencode-v2-stable-live.mjs'],{cwd:join(root,'project'),env,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);const [code]=await once(child,'close');writeFileSync(join(root,'client.stdout'),out,{mode:0o600});writeFileSync(join(root,'client.stderr'),err,{mode:0o600});report.exit=code
 const results=out.split('\n').filter(x=>x.startsWith('{')).map(x=>{try{return JSON.parse(x)}catch{return null}});report.clientResult=results.find(x=>x?.result==='PASS')
 report.scrubFinal=verifyOpenCodeScrub(await(await fetch(url+'/plugins/list')).json(),scrub,true)
 assert.equal(code,0,'Actual stable E42 harness failed; retain original stdout/stderr');assert(report.clientResult)
 const rows=await(await fetch(url+'/telemetry/requests?limit=200')).json();const require=createRequire(join(repo,'package.json'));const sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')));process.env.CLAUDE_CONFIG_DIR=join(root,'config/profiles',profiles[0].id);const models=new Set();for(const id of new Set(rows.map(r=>r.sdkSessionId).filter(Boolean)))for(const row of await sdk.getSessionMessages(id,{dir:join(root,'project')}))if(row.type==='assistant'&&typeof row.message?.model==='string')models.add(row.message.model);report.observedModels=[...models];assert(models.has('claude-haiku-5-5'));report.result='PASS'
}catch(error){report.result='FAIL';report.failure=String(error)}finally{await proxy?.close();report.joined=actors.every(x=>x.close&&x.stdoutClose&&x.stderrClose);if(!report.joined)report.result='FAIL';writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,result:report.result,joined:report.joined,failure:report.failure}));process.exitCode=report.result==='PASS'?0:1}
