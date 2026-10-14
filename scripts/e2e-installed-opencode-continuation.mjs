#!/usr/bin/env node
// Installed actual OpenCode V1 read/result/continuation -> Meridian -> native Opus.
// E2E_ALLOW_LIVE_MODEL=1 E2E_LIVE_PROFILE_FILE=<private access-only grant>
// E2E_PLUGIN_PATH=<absolute installed OpenCode scrub entrypoint>
// E2E_OPENCODE_BIN=<absolute binary> E2E_MERIDIAN_ROOT=<installed package>
import assert from 'node:assert/strict'
import {resolveOpenCodeScrub,configureOpenCodeScrub,verifyOpenCodeScrub} from './lib-opencode-scrub-preflight.mjs'
import childProcess from 'node:child_process'
import {createRequire,syncBuiltinESMExports} from 'node:module'
import {once} from 'node:events'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,realpathSync,statSync} from 'node:fs'
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
const expected='candidate',model='claude-opus-5-5',idleMs=15000
const root=mkdtempSync(join(tmpdir(),'meridian-installed-opencode-'))
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
  const row={session:request.headers['x-opencode-session'],agent:request.headers['x-opencode-agent-name'],source:request.headers['x-meridian-source'],toolChars:0,toolDeltas:0,maxGapMs:0,toolDurationMs:0};report.requests.push(row)
  const emit=request.emit;let body=''
  request.emit=function(event,...args){if(event==='data')body+=args[0];if(event==='end'){try{const parsed=JSON.parse(body);row.model=parsed.model;row.hasToolResult=JSON.stringify(parsed.messages).includes('"tool_result"')}catch(error){row.parseError=String(error)}}return emit.call(this,event,...args)}
  let buffer='',toolIndex,started,last
  const observe=chunk=>{if(chunk==null)return;buffer+=Buffer.from(chunk).toString();let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);for(const line of block.split('\n'))if(line.startsWith('data: ')){let event;try{event=JSON.parse(line.slice(6))}catch{continue}const now=performance.now();if(event.type==='content_block_start'&&event.content_block?.type==='tool_use'){toolIndex=event.index;started=last=now;row.tool=event.content_block.name}if(event.type==='content_block_delta'&&event.index===toolIndex&&event.delta?.type==='input_json_delta'){row.toolChars+=event.delta.partial_json.length;row.toolDeltas++;row.maxGapMs=Math.max(row.maxGapMs,now-last);last=now}if(event.type==='content_block_stop'&&event.index===toolIndex){row.toolDurationMs=now-started;toolIndex=undefined}if(event.type==='error'){row.error=event.error?.type;if(['billing_error','authentication_error','rate_limit_error'].includes(row.error)||event.error?.message?.includes('Failed to authenticate:'))report.providerRefusal=row.error;/* One observed error is enough for this probe: never let the client retry it. */setTimeout(()=>activeClient?.kill('SIGTERM'),1000).unref()}}}}
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
 const marker=`OWNED_READ_${randomUUID()}`
 const file=join(project,'owned-receipt.txt');writeFileSync(file,marker+'\n')
 const first=await run('read',client,['run','--format','json',`Use read exactly once on ${file}. Then repeat the receipt from that file. Do not use another tool.`])
 report.clientExit=first.code
 report.scrubRequest=verifyOpenCodeScrub(await(await fetch(`${url}/plugins/list`)).json(),scrub,true)
 const rows=await(await fetch(`${url}/telemetry/requests?limit=200`)).json()
 assert(!report.providerRefusal,'Required model refused')
 assert.equal(first.code,0)
 assert(first.stdout.includes(marker),'Actual read did not return the owned receipt')
 const primary=report.requests.filter(r=>r.session&&r.agent==='build')
 assert(primary.some(r=>r.hasToolResult),'Missing actual client result round trip')
 assert(primary.every(r=>r.model===model&&r.status===200),'Wrong model or unsuccessful primary request')
 const session=primary[0].session
 const resumed=await run('resume',client,['run','--format','json','--session',session,'Without tools, repeat the OWNED_READ receipt from the previous turn.'])
 assert.equal(resumed.code,0);assert(resumed.stdout.includes(marker),'Actual client continuation lost receipt');report.continued=true
 const require=createRequire(join(repo,'package.json'))
 const sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href)
 process.env.CLAUDE_CONFIG_DIR=join(root,'meridian','profiles',profiles[0].id)
 const observed=new Set()
 for(const id of new Set(rows.map(r=>r.sdkSessionId).filter(Boolean)))for(const row of await sdk.getSessionMessages(id,{dir:project}))if(row.type==='assistant'&&typeof row.message?.model==='string')observed.add(row.message.model)
 report.observedModels=[...observed]
 assert(observed.size&&report.observedModels.every(m=>m===model),'Actual SDK model differs')
 report.scrubFinal=verifyOpenCodeScrub(await(await fetch(`${url}/plugins/list`)).json(),scrub,true)
 report.result='PASS'
}catch(error){report.result='FAIL';report.failure=String(error)}finally{
 await proxy?.close();report.joined=actors.every(a=>a.close&&a.stdoutClose&&a.stderrClose);if(!report.joined)report.result='FAIL'
 writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,result:report.result,joined:report.joined,failure:report.failure}));process.exitCode=report.result==='PASS'?0:1
}
