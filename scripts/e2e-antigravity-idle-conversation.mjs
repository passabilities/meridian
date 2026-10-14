// Actual Pi + provider-specific Meridian retry plugin + official agy idle proof.
// Run separately against an unchanged server build and candidate. No auth mutation.
import assert from 'node:assert/strict'
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { once } from 'node:events'
const [serverPath, pluginPath, piPath, executable, reportPath, label] = process.argv.slice(2)
assert(reportPath && label, 'Expected server, plugin, Pi CLI, official agy, report, label')
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const nativeHash = await hash(executable)
assert.equal(nativeHash, '8c01ef82307dc01455418eb2e6e82f2989a3fa8b815c4b192efaaa89a55bef8d', 'Unqualified official executable')
const pluginHash = await hash(pluginPath)
const root = await mkdtemp(join(tmpdir(), 'meridian-agy-idle-live-'))
const model = 'gemini-3.8-flash-low', toolMs = 1000, idleMs = 10000, pauseMs = 1600
process.env.AGY_CLI_DISABLE_AUTO_UPDATE = 'true'
const localKey = randomUUID()
for (const key of Object.keys(process.env)) if (/^(MERIDIAN_|CLAUDE_|ANTHROPIC_|OPENAI_|OPENROUTER_|AZURE_OPENAI_|GOOGLE_API_KEY$|GEMINI_API_KEY$|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_GENAI_USE_|GOOGLE_GEMINI_BASE_URL$)/.test(key)) delete process.env[key]
process.env.MERIDIAN_API_KEY = localKey
const children = [], originalSpawn = cp.spawn
cp.spawn = function(...args) {
 const child = originalSpawn.apply(this,args)
 const fact = { pid: child.pid ?? null, close: false, stdoutEof: !child.stdout, stderrEof: !child.stderr }
 const closed = new Promise(resolve => child.once('close', (code, signal) => { Object.assign(fact,{close:true,code,signal}); resolve() }))
 child.stdout?.once('end', () => { fact.stdoutEof=true }); child.stderr?.once('end', () => { fact.stderrEof=true })
 children.push({child,closed,fact}); return child
}
syncBuiltinESMExports()
const { startProxyServer } = await import(pathToFileURL(serverPath).href)
const delay = ms => new Promise(resolve => setTimeout(resolve,ms))
async function within(promise, ms, message) {
 let timer
 try { return await Promise.race([promise,new Promise((_,reject) => {timer=setTimeout(()=>reject(new Error(message)),ms)})]) }
 finally {clearTimeout(timer)}
}
const report = { label, result:'INCOMPLETE', model, platform:process.platform, arch:process.arch, node:process.version, nativeHash, pluginHash, toolMs,idleMs,pauseMs, clientPreflight:false, metrics:[], requests:[], health:[], children:[], joined:false }
let proxy, relay, client, failure
async function startClient(url, name) {
 const project = join(root,name), config = join(project,'config')
 await mkdir(config,{recursive:true})
 await writeFile(join(config,'models.json'),JSON.stringify({providers:{'meridian-agy':{baseUrl:url,apiKey:localKey,api:'anthropic-messages',models:[{id:model,name:model,reasoning:false,input:['text'],contextWindow:128000,maxTokens:512,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}))
 await writeFile(join(config,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}))
 const env={...process.env,PI_CODING_AGENT_DIR:config,PI_OFFLINE:'1',PI_TELEMETRY:'0'}
 const child=cp.spawn(process.execPath,[piPath,'--provider','meridian-agy','--model',model,'--thinking','off','--mode','rpc','--no-session','--no-builtin-tools','--no-extensions','-e',pluginPath,'--no-skills','--no-context-files','--no-prompt-templates','--no-themes','--system-prompt','You are a test assistant. Answer briefly without using tools.'],{cwd:project,env,stdio:['pipe','pipe','pipe']})
 const events=[]; let buffer='',closed=false,parseError=false,stderrBytes=0
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8')
 child.stdout.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(line.trim())try{events.push(JSON.parse(line))}catch{parseError=true}}})
 child.stderr.on('data',chunk=>{stderrBytes+=Buffer.byteLength(chunk)})
 child.once('close',()=>{closed=true});child.on('error',()=>{closed=true})
 async function until(fn,name){const end=Date.now()+150000;while(Date.now()<end){assert(!parseError,'Malformed client RPC output');const result=fn();if(result)return result;assert(!closed,`Client closed during ${name}, stderr bytes ${stderrBytes}`);await delay(25)}throw new Error(`Client deadline: ${name}`)}
 async function command(type,fields={}){const id=randomUUID();child.stdin.write(JSON.stringify({id,type,...fields})+'\n');const reply=await until(()=>events.find(e=>e.type==='response'&&e.id===id),type);assert.equal(reply.success,true,`Client command failed: ${type}`);return reply.data}
 await command('get_state');await command('set_auto_retry',{enabled:false})
 return {child,async prompt(message){const start=events.length;await command('prompt',{message});const end=await until(()=>events.slice(start).find(e=>e.type==='agent_end'),'agent end');assert(!end.messages?.some(m=>m.stopReason==='error'),'Actual client returned a model error');assert(end.messages?.some(m=>m.role==='assistant'),'No assistant completion')},async close(){if(!closed)child.kill('SIGTERM');const owned=children.find(x=>x.child===child);let kill;try{kill=setTimeout(()=>{if(!closed)child.kill('SIGKILL')},1000);await within(owned.closed,10000,'Original Pi close missing')}finally{clearTimeout(kill)}}}
}
let fixtureRequests=0, malformedPlugin=false
try {
 relay=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk)
  const body=JSON.parse(Buffer.concat(chunks).toString())
  const qualified=typeof body.meridian_request_id==='string'&&/^[a-f\d-]{36}$/.test(body.meridian_request_id)
  if(!qualified){malformedPlugin=true;res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Required Meridian Antigravity plugin identity missing'}}));return}
  fixtureRequests++
  const frames=[{type:'message_start',message:{id:'msg_fixture',type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Fixture reply.'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:3}},{type:'message_stop'}]
  res.writeHead(200,{'content-type':'text/event-stream'});for(const frame of frames)res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);res.end()
 })
 await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve))
 client=await startClient(`http://127.0.0.1:${relay.address().port}`,'preflight')
 await client.prompt('Reply briefly.');assert(!malformedPlugin&&fixtureRequests===1,'Client plugin preflight failed')
 await client.close();client=undefined;await new Promise(resolve=>relay.close(resolve));relay=undefined
 report.clientPreflight=true
 if(process.env.E2E_PREFLIGHT_ONLY==='1'){report.result='PREFLIGHT_PASS'}else{
 const plugin={name:'idle-evidence',onRequest:({request})=>{assert(typeof request.meridian_request_id==='string','Required Antigravity client plugin missing before generation');report.requests.push({model:request.model,id:request.meridian_request_id,messageCount:request.messages.length});return request},onTelemetry:({metric})=>{report.metrics.push({model:metric.model,status:metric.status,continuation:metric.continuation,conversationId:metric.conversationId,inputTokens:metric.inputTokens,outputTokens:metric.outputTokens,observedAtMs:performance.now()})}}
 proxy=await startProxyServer({backend:'antigravity',port:0,silent:true,antigravity:{executable,allowToolBridge:true,pendingToolTimeoutMs:toolMs,idleConversationMs:idleMs,plugins:[plugin]}})
 if(!proxy.server.listening)await once(proxy.server,'listening')
 const url=`http://127.0.0.1:${proxy.server.address().port}`
 const headers={'x-api-key':localKey}
 const models=await fetch(url+'/v1/models',{headers});assert.equal(models.status,200,'Read-only model readiness failed');assert((await models.json()).data.some(x=>x.id===model),'Actual account model unavailable')
 const health=async()=>{const response=await fetch(url+'/health');assert.equal(response.status,200);const h=await response.json();return {processes:h.processes,active:h.activeProcesses,pending:h.pendingToolProcesses,reused:h.reused,completed:h.completed,failed:h.failed}}
 client=await startClient(url,'live')
 await client.prompt('Remember that this conversation is testing idle continuation. Reply briefly without tools.')
 assert.equal(report.metrics.length,1,'Initial terminal telemetry missing')
 const before=Date.now();await delay(pauseMs);report.actualPauseMs=Date.now()-before
 report.nextDispatchAfterCompletionMs=performance.now()-report.metrics[0].observedAtMs
 assert(report.nextDispatchAfterCompletionMs>toolMs&&report.nextDispatchAfterCompletionMs<idleMs-1000,'Pause did not isolate the tool and idle deadlines')
 await client.prompt('Continue our previous conversation with a brief acknowledgment, without tools.')
 await delay(100);report.health.push(await health())
 // Expire beyond the configured idle window, then verify a fresh conversation.
 await delay(idleMs+500);report.health.push(await health())
 await client.prompt('Acknowledge this final message briefly without tools.')
 await delay(100);report.health.push(await health())
 assert.equal(report.requests.length,3,'Unexpected generation/retry count')
 assert.equal(new Set(report.requests.map(x=>x.id)).size,3,'Distinct prompts must have distinct plugin IDs')
 assert.equal(report.metrics.length,3,'Missing terminal telemetry')
 assert(report.metrics.every(x=>x.status===200&&x.model===model),'Actual model/status mismatch')
 assert.equal(report.health[0].reused,1,'Second turn did not reuse the live native conversation')
 assert.equal(report.metrics[1].continuation,'live','Second turn replayed history')
 assert.equal(report.metrics[0].conversationId,report.metrics[1].conversationId,'Second turn changed native conversation')
 assert.equal(report.health[1].processes,0,'Configured idle expiry did not retire the native conversation')
 assert.notEqual(report.metrics[1].conversationId,report.metrics[2].conversationId,'Expired conversation was reused')
 report.result='PASS'
 }
} catch(error){failure=error;report.result='FAIL';report.error=error.message}
finally{
 try{await client?.close();if(proxy)await within(proxy.close(),20000,'Proxy shutdown did not join');if(relay)await new Promise(resolve=>relay.close(resolve));await within(Promise.all(children.map(x=>x.closed)),10000,'Original process close missing');report.joined=children.every(x=>x.fact.close&&x.fact.stdoutEof&&x.fact.stderrEof);assert(report.joined,'Original process pipes not joined');report.finalNativeHash=await hash(executable);assert.equal(report.finalNativeHash,nativeHash,'Official binary changed')}catch(error){failure??=error;report.result='FAIL';report.cleanupError=error.message}
 report.children=children.map(x=>x.fact);await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({result:report.result,label,clientPreflight:report.clientPreflight,joined:report.joined,error:report.error,cleanupError:report.cleanupError,reportPath}));if(failure)process.exitCode=1
}
