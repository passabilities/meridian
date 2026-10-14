#!/usr/bin/env node
// Actual OpenCode V1 -> installed Meridian/plugin -> real provider refusal.
// Stops the client at its first billing refusal; never enables paid usage.
// E2E_ALLOW_LIVE_MODEL=1 E2E_LIVE_PROFILE_FILE=<private access-only grant>
// E2E_PLUGIN_PATH=<absolute installed OpenCode scrub entrypoint>
// E2E_OPENCODE_BIN=<absolute binary> E2E_MERIDIAN_ROOT=<installed package>
import assert from 'node:assert/strict'
import {resolveOpenCodeScrub,configureOpenCodeScrub,verifyOpenCodeScrub} from './lib-opencode-scrub-preflight.mjs'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import {once} from 'node:events'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,statSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
assert(!process.versions.bun, 'Use native Node for original subprocess observation')
assert.equal(process.env.E2E_ALLOW_LIVE_MODEL,'1')
const repo=resolve(process.env.E2E_MERIDIAN_ROOT??'.'),client=process.env.E2E_OPENCODE_BIN
assert(client?.startsWith('/'))
const scrub=resolveOpenCodeScrub(process.env.E2E_PLUGIN_PATH,process.env.E2E_SCRUB_VERSION)
const grant=process.env.E2E_LIVE_PROFILE_FILE
assert.equal(statSync(grant).mode & 0o077,0)
const profiles=JSON.parse(readFileSync(grant,'utf8'))
assert(profiles.length===1 && profiles[0].type==='oauth-token' && !profiles[0].refreshToken)
const expected=process.env.E2E_EXPECT??'candidate',model='claude-opus-5-5',idleMs=15000
assert(['candidate','baseline'].includes(expected))
const root=mkdtempSync(join(tmpdir(),'meridian-extra-usage-opencode-'))
for(const name of ['home','project','client','meridian','sessions','config','data','cache','state'])mkdirSync(join(root,name))
const project=join(root,'project'),config=join(root,'client')
const scrubConfig=configureOpenCodeScrub(root,scrub)
for(const key of Object.keys(process.env))if(/^(MERIDIAN_|CLAUDE_|CLAUDE_PROXY_|ANTHROPIC_|OPENCODE_)/.test(key))delete process.env[key]
Object.assign(process.env,{HOME:join(root,'home'),MERIDIAN_CONFIG_DIR:join(root,'meridian'),MERIDIAN_SESSION_DIR:join(root,'sessions'),MERIDIAN_WORKDIR:project,MERIDIAN_PASSTHROUGH:'1',MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_NO_UPDATE_CHECK:'1',MERIDIAN_UPSTREAM_IDLE_MS:String(idleMs),MERIDIAN_CLAUDE_PATH:join(repo,'node_modules/@anthropic-ai/claude-code/bin/claude.exe')})
// npm normally hoists the native dependency beside the installed package.
if(process.env.E2E_NATIVE_BIN)process.env.MERIDIAN_CLAUDE_PATH=process.env.E2E_NATIVE_BIN
const actors=[],spawn=childProcess.spawn
childProcess.spawn=function(...args){const child=spawn.apply(this,args);const row={command:String(args[0]),pid:child.pid,close:false,stdoutClose:!child.stdout,stderrClose:!child.stderr};actors.push(row);child.once('close',(code,signal)=>Object.assign(row,{close:true,code,signal}));child.stdout?.once('close',()=>row.stdoutClose=true);child.stderr?.once('close',()=>row.stderrClose=true);return child}
syncBuiltinESMExports()
const clientEnv={...process.env,OPENCODE_CONFIG_DIR:config,OPENCODE_DISABLE_AUTOUPDATE:'1'}
for(const kind of ['CONFIG','DATA','CACHE','STATE'])clientEnv[`XDG_${kind}_HOME`]=join(root,kind.toLowerCase())
const report={result:'RUNNING',root,expected,model,idleMs,platform:`${process.platform}/${process.arch}`,node:process.version,environment:process.env.E2E_EXECUTION_ENVIRONMENT??'unspecified',actors,requests:[],harnessSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex')}
let proxy,activeClient
async function run(label,command,args,env=clientEnv){
 const child=childProcess.spawn(command,args,{cwd:project,env,stdio:['ignore','pipe','pipe']});activeClient=child
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c)
 const timer=setTimeout(()=>child.kill('SIGKILL'),240000)
 const [code]=await once(child,'close').finally(()=>{clearTimeout(timer);activeClient=undefined})
 writeFileSync(join(root,label+'.stdout'),stdout,{mode:0o600});writeFileSync(join(root,label+'.stderr'),stderr,{mode:0o600})
 return {code,stdout}
}
try{
 const version=await run('version',client,['--version']);assert.equal(version.code,0);report.client=version.stdout.trim()
 const {startProxyServer}=await import(pathToFileURL(join(repo,'dist/server.js')))
 proxy=await startProxyServer({port:0,host:'127.0.0.1',silent:true,profiles,defaultProfile:profiles[0].id,...scrubConfig})
 if(!proxy.server.listening)await once(proxy.server,'listening')
 const url=`http://127.0.0.1:${proxy.server.address().port}`
 report.scrubPreflight=verifyOpenCodeScrub(await(await fetch(`${url}/plugins/list`)).json(),scrub)
 proxy.server.prependListener('request',(request,response)=>{
  if(!request.url?.endsWith('/messages'))return
  const row={session:request.headers['x-opencode-session'],agent:request.headers['x-opencode-agent-name'],source:request.headers['x-meridian-source']};report.requests.push(row)
  const emit=request.emit;let body=''
  request.emit=function(event,...args){if(event==='data')body+=args[0];if(event==='end'){try{const parsed=JSON.parse(body);row.model=parsed.model;row.hasToolResult=JSON.stringify(parsed.messages).includes('"tool_result"')}catch(error){row.parseError=String(error)}}return emit.call(this,event,...args)}
  let buffer=''
  const observe=chunk=>{
   if(chunk==null)return
   buffer+=Buffer.from(chunk).toString();let end
   while((end=buffer.indexOf('\n\n'))>=0){
    const block=buffer.slice(0,end);buffer=buffer.slice(end+2)
    for(const line of block.split('\n'))if(line.startsWith('data: ')){
     let event;try{event=JSON.parse(line.slice(6))}catch{continue}
     if(event.type==='error'){
      row.error=event.error?.type;row.message=event.error?.message
      if(['billing_error','authentication_error','rate_limit_error'].includes(row.error)){
       report.providerRefusal=row.error
       // Give the real client time to record its error before stopping retries.
       setTimeout(()=>activeClient?.kill('SIGTERM'),1000).unref()
      }
     }
    }
   }
  }
  const write=response.write,end=response.end
  response.write=function(chunk,...args){observe(chunk);return write.call(this,chunk,...args)}
  response.end=function(chunk,...args){if(typeof chunk!=='function')observe(chunk);return end.call(this,chunk,...args)}
  response.once('close',()=>row.status=response.statusCode)
 })
 writeFileSync(join(config,'opencode.json'),JSON.stringify({model:`anthropic/${model}`,small_model:`anthropic/${model}`,share:'disabled',permission:'allow',provider:{anthropic:{options:{apiKey:'owned-loopback',baseURL:url},models:{[model]:{name:model,limit:{context:1000000,output:20000}}}}}}))
 const setup=await run('setup',process.execPath,[join(repo,'dist/cli.js'),'setup','--v1']);assert.equal(setup.code,0)
 const configured=JSON.parse(readFileSync(join(config,'opencode.json'),'utf8'))
 const expectedPlugin=realpathSync(join(repo,'dist/meridian'))
 assert.deepEqual(configured.plugin.map(p=>realpathSync(p)),[expectedPlugin]);report.plugin=expectedPlugin
 const marker=`OWNED_LONG_WRITE_${randomUUID()}`
 const first=await run('write',client,['run','--format','json',`Call write exactly once to create ${join(project,'inventory.py')}. Its content must be a complete Python inventory module of at least 600 lines, with dataclasses, validation, docstrings, and a unittest suite. Include ${marker} in a comment. Generate the entire file in one write call, without bash or other tools. After the tool succeeds, reply DONE.`])
 report.clientExit=first.code
 report.scrubRequest=verifyOpenCodeScrub(await(await fetch(`${url}/plugins/list`)).json(),scrub,true)
 const rows=await(await fetch(`${url}/telemetry/requests?limit=200`)).json();writeFileSync(join(root,'telemetry.json'),JSON.stringify(rows,null,2))
 const diagnostics=await(await fetch(`${url}/telemetry/logs?category=error&limit=100`)).json();writeFileSync(join(root,'errors.json'),JSON.stringify(diagnostics,null,2))
 assert(report.requests.some(r=>r.session&&r.agent==='build'),'Missing plugin-generated primary session/agent witness')
 const refusal=report.requests.find(r=>r.agent==='build'&&r.error==='billing_error')
 assert(refusal,'No real provider billing refusal observed')
 assert(rows.some(r=>r.status===402&&r.error==='billing_error'),'Billing status/type changed')
 const native=diagnostics.find(r=>r.message?.includes("You're out of extra usage"))
 assert(native,'Real native refusal diagnostic missing; do not substitute a synthetic error')
 report.nativeRefusalObserved=true
 if(expected==='baseline')assert(refusal.message.includes('Claude Max subscription issue'))
 else{
  assert(refusal.message.includes('Claude returned an Extra Usage refusal:'))
  assert(refusal.message.includes("You're out of extra usage"))
  assert(!refusal.message.includes('subscription issue'))
  assert(!refusal.message.includes('Claude Code returned an error result'))
 }
 const clientLogPath=join(root,'data/opencode/log/opencode.log')
 const clientLog=existsSync(clientLogPath)?readFileSync(clientLogPath,'utf8'):''
 const quoted=JSON.stringify(refusal.message).slice(1,-1)
 report.clientRecordedRefusal=[first.stdout,clientLog].some(text=>text.includes(refusal.message)||text.includes(quoted))
 report.clientWitness=clientLog.includes(quoted)?'actual OpenCode persistent error log':'actual OpenCode stdout'
 assert(report.clientRecordedRefusal,'Real client did not record the provider refusal')
 report.result='PASS'
}catch(error){report.result='FAIL';report.failure=String(error)}finally{
 await proxy?.close();report.joined=actors.every(a=>a.close&&a.stdoutClose&&a.stderrClose);if(!report.joined)report.result='FAIL'
 writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,result:report.result,joined:report.joined,failure:report.failure}));process.exitCode=report.result==='PASS'?0:1
}
