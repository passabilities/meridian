#!/usr/bin/env bun
// Actual OpenCode + real SDK/CLI, controlled local API (not a live model).
// E2E_OPENCODE_BIN=opencode [E2E_EXPECT_ERROR=1] bun this-file
//
// OpenCode's roster is past the auto-defer threshold. Until 2026-10-05 that
// lifted the turn cap to 4 and this harness asserted the four-turn shape: the
// bare call rejected, a registered-name retry reaching the hook, more
// rejections, error_max_turns. Deferred tools are held to one turn now (E2E.md
// E75), so the rejected call is the only Messages call of the turn and the
// handoff has to work from that alone.
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawn,spawnSync} from 'node:child_process'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {spyOn} from 'bun:test'
import * as sdk from '@anthropic-ai/claude-agent-sdk'
import {writeUnusedToolRoster} from './lib/opencode-tool-roster.mjs'
const root=mkdtempSync(join(tmpdir(),'opencode-deferred-refusal-'))
const config=join(root,'config'),project=join(root,'project'),proxyConfig=join(root,'proxy')
for(const dir of [config,project,proxyConfig])mkdirSync(dir)
const receipt='CLIENT-READ-'+randomUUID(),file=join(project,'receipt.txt')
writeFileSync(file,receipt)
const bin=process.env.E2E_OPENCODE_BIN||'opencode',expectError=process.env.E2E_EXPECT_ERROR==='1'
const version=spawnSync(bin,['--version'],{encoding:'utf8'});assert.equal(version.status,0)
for(const key of Object.keys(process.env))if(/^(MERIDIAN_|CLAUDE_PROXY_)/.test(key))delete process.env[key]
Object.assign(process.env,{MERIDIAN_CONFIG_DIR:proxyConfig,MERIDIAN_SESSION_DIR:join(root,'sessions'),MERIDIAN_PASSTHROUGH:'1',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_NO_UPDATE_CHECK:'1'})
const mcp=join(root,'roster.cjs')
writeUnusedToolRoster(mcp)
let phase='cap',calls=0;const requests=[],queries=[],rejections=[],hooks=[],results=[]
const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 if(!new URL(req.url).pathname.endsWith('/messages'))return Response.json({input_tokens:100})
 const body=await req.json(),registered=body.tools?.find(t=>t.name==='mcp__oc__read')?.name
 if(!registered)return new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
 const cap=phase==='cap';if(cap)calls++
 const block=cap?{type:'tool_use',id:'toolu_refusal_'+calls,name:calls===2?registered:'read',input:{filePath:file}}:{type:'text',text:'Read receipt acknowledged.'}
 const events=[{type:'message_start',message:{id:'msg_'+randomUUID(),type:'message',role:'assistant',content:[],model:body.model,stop_reason:null,stop_sequence:null,usage:{input_tokens:100,output_tokens:0}}},
 {type:'content_block_start',index:0,content_block:block.type==='text'?{type:'text',text:''}:{...block,input:{}}},
 {type:'content_block_delta',index:0,delta:block.type==='text'?{type:'text_delta',text:block.text}:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}},
 {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:cap?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:20}},{type:'message_stop'}]
 if(!cap)assert(JSON.stringify(body.messages).includes(receipt),'Fresh SDK replay lost actual client receipt')
 return new Response(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}})
}})
const real=sdk.query
const spy=spyOn(sdk,'query').mockImplementation(input=>{
 const current=phase;queries.push({phase:current,maxTurns:input.options?.maxTurns,resume:!!input.options?.resume,tools:input.options?.allowedTools?.length||0,deferred:input.options?.env?.ENABLE_TOOL_SEARCH==='true'})
 const actualHooks=input.options?.hooks
 const actual=real({...input,options:{...input.options,hooks:{...actualHooks,PreToolUse:actualHooks?.PreToolUse?.map(m=>({...m,hooks:m.hooks.map(h=>async(...args)=>{hooks.push({phase:current,id:args[0].tool_use_id});return h(...args)})}))}}})
 return new Proxy(actual,{get(target,key){if(key===Symbol.asyncIterator)return async function*(){for await(const m of actual){
  if(m.type==='result')results.push({phase:current,subtype:m.subtype})
  if(m.type==='user')for(const b of m.message?.content||[])if(b.type==='tool_result'&&JSON.stringify(b.content).includes('No such tool available:'))rejections.push(b.tool_use_id)
  yield m
 }};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})
})
globalThis.__refusalObserve=ctx=>{const receiptSeen=JSON.stringify((ctx.messages||[]).filter(m=>m.role==='user')).includes(receipt);requests.push({adapter:ctx.adapter,tools:ctx.tools?.length||0,receipt:receiptSeen});if(receiptSeen)phase='followup';return ctx}
const plugin=join(root,'observer.js');writeFileSync(plugin,"export default {name:'refusal-observer',onRequest(ctx){return globalThis.__refusalObserve(ctx)}}")
const pluginConfigPath=join(root,'plugins.json');writeFileSync(pluginConfigPath,JSON.stringify({plugins:[{path:plugin,enabled:true}]}))
const {startProxyServer}=await import('../src/proxy/server.ts')
let proxy
try{
 proxy=await startProxyServer({port:0,host:'127.0.0.1',silent:true,pluginConfigPath,profiles:[{id:'fixture',type:'api',apiKey:'local-fixture',baseUrl:`http://127.0.0.1:${upstream.port}`}]})
 if(!proxy.server.listening)await once(proxy.server,'listening')
 const url=`http://127.0.0.1:${proxy.server.address().port}`
 writeFileSync(join(config,'opencode.json'),JSON.stringify({$schema:'https://opencode.ai/config.json',plugin:[resolve('dist/meridian')],model:'anthropic/claude-opus-5-5',small_model:'anthropic/claude-opus-5-5',share:'disabled',permission:'allow',mcp:{roster:{type:'local',command:[process.execPath,mcp],enabled:true}},provider:{anthropic:{options:{apiKey:'local-fixture',baseURL:url},models:{'claude-opus-5-5':{name:'Opus fixture identifier',limit:{context:200000,output:1024},reasoning:false,tool_call:true,modalities:{input:['text'],output:['text']}}}}}}))
 const env={...process.env,OPENCODE_CONFIG_DIR:config,OPENCODE_DISABLE_AUTOUPDATE:'1'}
 for(const kind of ['CONFIG','DATA','CACHE','STATE'])env['XDG_'+kind+'_HOME']=join(root,kind.toLowerCase())
 for(const key of Object.keys(env))if(/^(MERIDIAN_|CLAUDE_PROXY_|CLAUDE_|ANTHROPIC_|OPENAI_)/.test(key))delete env[key]
 const child=spawn(bin,['run','--format','json',`Read ${file} with read and acknowledge.`],{cwd:project,env,stdio:['ignore','pipe','pipe']})
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c)
 const timer=setTimeout(()=>child.kill('SIGKILL'),120000)
 const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});clearTimeout(timer)
 writeFileSync(join(root,'client.stdout'),stdout,{mode:0o600});writeFileSync(join(root,'client.stderr'),stderr,{mode:0o600})
 const events=stdout.split('\n').filter(Boolean).flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}})
 const errors=events.filter(e=>e.type==='error'),toolEnds=events.filter(e=>e.type==='tool_use')
 assert(requests.some(r=>r.adapter==='opencode'&&r.tools>80),'Real client did not declare a large tool roster')
 console.log(JSON.stringify({stage:'observed',queries,requests,results,errors:errors.length,toolEnds:toolEnds.length}))
 const roster=queries.filter(q=>q.phase==='cap'&&q.tools>80)
 assert.equal(roster.length,1,'Expected one SDK query for the roster request');assert(roster[0].deferred,'Roster request was not counted as deferred')
 assert.equal(roster[0].maxTurns,1,'Deferred roster request was not held to one turn');assert(results.some(r=>r.phase==='cap'&&r.subtype==='error_max_turns'))
 assert(rejections.includes('toolu_refusal_1'));assert(!hooks.some(h=>h.id==='toolu_refusal_1'),'Rejected call ran in SDK')
 assert.equal(calls,1,'The capped turn asked the model again after the rejection');assert.equal(hooks.filter(h=>h.phase==='cap').length,0,'A digest retry reached the hook')
 if(expectError){assert(errors.length>0,'Baseline did not expose max-turn error');assert(!requests.some(r=>r.receipt),'Baseline unexpectedly completed result handoff')}
 else{assert.equal(exit,0);assert.equal(errors.length,0);assert.equal(toolEnds.length,1);assert(requests.some(r=>r.receipt));assert(queries.some(q=>q.phase==='followup'&&!q.resume),'Rejected SDK session reused')}
 console.log(JSON.stringify({result:'PASS',expectError,platform:`${process.platform}/${process.arch}`,opencode:version.stdout.trim(),exit,errors:errors.length,toolEnds:toolEnds.length,queries,requests,results,rejections,hooks,privateArtifacts:root,upstream:'controlled-local-API-not-live-model'}))
}finally{await proxy?.close();upstream.stop(true);spy.mockRestore()}
