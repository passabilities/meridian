#!/usr/bin/env node
// Actual Pi sessions, SDK input inspection through supported APIs, and pi-scrub.
// Each new Pi session replays the preceding actual client history with a fresh
// affinity. Its real read tool returns the same owned image, reproducing read-back
// accumulation without asking a model to discover private SDK attachment files.
import assert from 'node:assert/strict'
import cp from 'node:child_process'
import {createRequire,syncBuiltinESMExports} from 'node:module'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
import {deflateSync} from 'node:zlib'
import {once} from 'node:events'
import {resolvePiScrub,configurePiScrub,verifyPiScrub} from './lib-pi-scrub-preflight.mjs'
import {observeChildClosure,stopAndJoinChild} from './lib/e2eProcessCustody.mjs'
assert(!process.versions.bun,'Use native Node for original child observation')
assert.equal(process.env.E2E_ALLOW_LIVE_MODEL,'1','Explicit live opt-in required')
const scrub=resolvePiScrub(process.env.E2E_PLUGIN_PATH,process.env.E2E_SCRUB_VERSION)
const repo=resolve(process.env.E2E_MERIDIAN_ROOT??'.'),piDir=process.env.E2E_PI_PACKAGE,native=process.env.E2E_NATIVE_BIN
assert(piDir?.startsWith('/')&&native?.startsWith('/'),'Select installed Pi and native CLI')
const metadata=JSON.parse(readFileSync(join(piDir,'package.json'),'utf8'))
assert.equal(metadata.name,'@earendil-works/pi-coding-agent')
const grant=process.env.E2E_LIVE_PROFILE_FILE
assert(grant,'Explicit access-only grant required')
assert.equal(statSync(grant).mode&0o077,0)
const profiles=JSON.parse(readFileSync(grant,'utf8'))
assert(profiles.length===1&&profiles[0].type==='oauth-token'&&typeof profiles[0].oauthToken==='string'&&profiles[0].oauthToken&&!profiles[0].refreshToken)
assert(/^[a-z0-9_-]+$/i.test(profiles[0].id))
const root=mkdtempSync(join(tmpdir(),'meridian-pi-image-dedup-')),project=join(root,'project'),config=join(root,'meridian','profiles',profiles[0].id)
for(const p of [project,config,join(root,'home')])mkdirSync(p,{recursive:true,mode:0o700})
for(const key of Object.keys(process.env))if(/^(MERIDIAN_|CLAUDE_|CLAUDE_PROXY_|ANTHROPIC_|PI_)/.test(key))delete process.env[key]
Object.assign(process.env,{HOME:join(root,'home'),MERIDIAN_CONFIG_DIR:join(root,'meridian'),MERIDIAN_SESSION_DIR:join(root,'store'),MERIDIAN_WORKDIR:project,MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_NO_UPDATE_CHECK:'1',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_PASSTHROUGH:'1',MERIDIAN_CLAUDE_PATH:native,CLAUDE_CONFIG_DIR:config})
const modelId='claude-opus-5-5',expected=process.env.E2E_EXPECT??'candidate'
assert(['candidate','baseline'].includes(expected))
const actors=[],spawn=cp.spawn
cp.spawn=function(...args){const child=Reflect.apply(spawn,this,args);actors.push({child,witness:observeChildClosure(child)});return child}
syncBuiltinESMExports()
const report={root,result:'RUNNING',expected,model:modelId,pi:metadata.version,platform:`${process.platform}/${process.arch}`,rounds:[],scope:'Actual Pi read-back of an owned same-byte image; SDK input inspected through supported APIs, not private attachment-file discovery',harnessSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex')}
let proxy,session,runtime,timer
const bounded=async(promise,ms,label)=>{let t;try{return await Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(new Error(label)),ms)})])}finally{clearTimeout(t)}}
function solidImage(red, green, blue) {
  function chunk(type, data) {
    const bytes = Buffer.concat([Buffer.from(type), data])
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([size, bytes, checksum])
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(48); header.writeUInt32BE(48, 4); header[8] = 8; header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 48 }, () => [red, green, blue]).flat())])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 48 }, () => row)))), chunk("IEND", Buffer.alloc(0))]).toString("base64")
}
try{
  const probe=cp.spawn(native,['--version'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:config,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},stdio:['ignore','pipe','pipe']})
  let nativeVersion='';probe.stdout.on('data',chunk=>nativeVersion+=chunk);probe.stderr.resume()
  const [versionExit]=await bounded(once(probe,'close'),12000,'Native version probe deadline')
  assert.equal(versionExit,0);report.nativeVersion=nativeVersion.trim()
  assert(/^2\.1\.296\b/.test(report.nativeVersion),'Use the qualified 2.1.296 native CLI')
  const pi=await import(pathToFileURL(join(piDir,metadata.exports['.'].import)).href)
  const require=createRequire(join(repo,'package.json')),sdkEntry=require.resolve('@anthropic-ai/claude-agent-sdk')
  const sdk=await import(pathToFileURL(sdkEntry).href)
  report.sdk=JSON.parse(readFileSync(join(dirname(sdkEntry),'package.json'),'utf8')).version
  const {startProxyServer}=await import(pathToFileURL(join(repo,'dist/server.js')).href)
  proxy=await startProxyServer({port:0,host:'127.0.0.1',silent:true,profiles,defaultProfile:profiles[0].id,...configurePiScrub(root,scrub)})
  if(!proxy.server.listening)await once(proxy.server,'listening')
  const baseUrl=`http://127.0.0.1:${proxy.server.address().port}`
  report.scrubPreflight=verifyPiScrub(await(await fetch(`${baseUrl}/plugins/list`)).json(),scrub)
  const blue=solidImage(0,0,255),red=solidImage(255,0,0),file=join(project,'owned-blue.png')
  writeFileSync(file,Buffer.from(blue,'base64'))
  const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}
  let history=[{role:'user',content:[{type:'image',data:blue,mimeType:'image/png'},{type:'text',text:'Historical blue image.'}],timestamp:Date.now()},
    {role:'assistant',content:[{type:'text',text:'The earlier image was blue.'}],api:'anthropic-messages',provider:'owned-meridian',model:modelId,usage,stopReason:'stop',timestamp:Date.now()}]
  const counts=[]
  for(let round=0;round<4;round++){
    const current=round===3,agentDir=join(root,`pi-${round}`),affinity=`image-${randomUUID()}`
    mkdirSync(agentDir)
    const authPath=join(agentDir,'auth.json'),modelsPath=join(agentDir,'models.json')
    writeFileSync(authPath,'{}',{mode:0o600})
    writeFileSync(modelsPath,JSON.stringify({providers:{'owned-meridian':{api:'anthropic-messages',baseUrl,apiKey:'owned-loopback',headers:{'x-meridian-agent':'pi','x-meridian-profile':profiles[0].id,'x-session-affinity':affinity,'user-agent':`pi-coding-agent/${metadata.version}`},models:[{id:modelId,name:'Owned image replay probe',reasoning:false,input:['text','image'],contextWindow:1000000,maxTokens:1024,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}),{mode:0o600})
    runtime=await pi.ModelRuntime.create({authPath,modelsPath,allowModelNetwork:false})
    const model=runtime.getModel('owned-meridian',modelId);assert.equal(model.baseUrl,baseUrl)
    const manager=pi.SessionManager.inMemory(project)
    for(const message of history)manager.appendMessage(message)
    let reads=0
    const read=pi.createReadToolDefinition(project,{autoResizeImages:false,operations:{access:async path=>assert.equal(path,file),readFile:async path=>{assert.equal(path,file);reads++;return readFileSync(path)},detectImageMimeType:async path=>{assert.equal(path,file);return 'image/png'}}})
    const loader={getExtensions:()=>({extensions:[],errors:[],runtime:pi.createExtensionRuntime()}),getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>({agentsFiles:[]}),getSystemPrompt:()=>undefined,getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources:()=>{},reload:async()=>{}}
    const before=await(await fetch(`${baseUrl}/telemetry/requests?limit=100&hops=1`)).json()
    const seen=new Set(before.map(r=>r.requestId))
    session=(await pi.createAgentSession({cwd:project,agentDir,modelRuntime:runtime,model,thinkingLevel:'off',resourceLoader:loader,sessionManager:manager,settingsManager:pi.SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false,provider:{maxRetries:0}},cacheWarming:'off',enableInstallTelemetry:false}),tools:current?[]:['read'],customTools:current?[]:[read]})).session
    const marker=`CURRENT_IMAGE_ROUND_${round}_${randomUUID()}`
    timer=setTimeout(()=>{void session.abort()},120000)
    await bounded(session.prompt(current?`Without tools, briefly describe the new image. ${marker}`:`Use read exactly once on ${file}, then briefly describe it. Do not use another tool. ${marker}`,current?{images:[{type:'image',data:red,mimeType:'image/png'}]}:undefined),130000,'Pi turn deadline')
    clearTimeout(timer);await session.waitForIdle()
    const last=session.messages.filter(m=>m.role==='assistant').at(-1)
    assert(last&&!['error','aborted'].includes(last.stopReason),'Pi request did not complete')
    if(!current)assert.equal(reads,1,'Require exactly one actual client read')
    const rows=(await(await fetch(`${baseUrl}/telemetry/requests?limit=100&hops=1`)).json()).filter(r=>!seen.has(r.requestId)).sort((a,b)=>a.timestamp-b.timestamp)
    report.requestWitnesses??=[]
    report.requestWitnesses.push(rows.map(r=>({status:r.status,adapter:r.adapter,requestModel:r.requestModel,model:r.model,lineageType:r.lineageType})))
    // resolvedModel is the Haiku-tier pin, not a general served-model field.
    // Requested Opus identity is checked here; actual identity is established
    // below from supported SDK assistant history before the next cycle.
    assert(rows.length&&rows.every(r=>r.status===200&&r.adapter==='pi'&&r.requestModel===modelId),'Wrong route/model or failed request')
    assert.equal(rows[0].lineageType,'new','Each cycle must use fresh replay')
    const sdkHistory=await sdk.getSessionMessages(rows[0].sdkSessionId,{dir:project})
    const blocks=sdkHistory.find(r=>r.type==='user')?.message?.content
    assert(Array.isArray(blocks),'Missing supported SDK structured input')
    const images=blocks.filter(b=>b.type==='image')
    const oldCount=images.filter(b=>b.source?.data===blue).length,newCount=images.filter(b=>b.source?.data===red).length
    const observed=new Set()
    for(const id of new Set(rows.map(r=>r.sdkSessionId).filter(Boolean)))for(const row of await sdk.getSessionMessages(id,{dir:project}))if(row.type==='assistant'&&row.message?.model)observed.add(row.message.model)
    assert(observed.size&&[...observed].every(m=>m===modelId),'Actual SDK model differs')
    report.rounds.push({round,current,reads,historicalImages:oldCount,currentImages:newCount,observedModels:[...observed],requests:rows.length})
    if(!current)counts.push(oldCount)
    history=structuredClone(session.messages)
    session.dispose();session=undefined;await runtime.dispose?.();runtime=undefined
    if(expected==='baseline'&&round===1){assert(oldCount>1,'Baseline did not reproduce duplicate SDK images');report.reproduced=true;break}
    assert.equal(oldCount,1,'Historical image amplified at SDK input')
    assert.equal(newCount,Number(current),'Current image was altered or lost')
    const close=blocks.findIndex(b=>b.type==='text'&&b.text?.includes('</conversation_history>'))
    assert(images.length===oldCount+newCount&&close>=0,'Unexpected media or missing history boundary')
    assert(blocks.findIndex(b=>b.type==='image'&&b.source?.data===blue)<close)
    if(current)assert(blocks.findIndex(b=>b.type==='image'&&b.source?.data===red)>close)
  }
  report.counts=counts
  report.scrubFinal=verifyPiScrub(await(await fetch(`${baseUrl}/plugins/list`)).json(),scrub,true)
  report.result='PASS'
}catch(error){report.result='FAIL';report.failure=String(error).replaceAll(profiles[0].oauthToken,'[redacted]')}
finally{
  clearTimeout(timer)
  try{if(session){await bounded(session.abort(),15000,'Pi abort deadline');await bounded(session.waitForIdle(),15000,'Pi idle deadline');session.dispose()}await bounded(proxy?.close(),25000,'Proxy close deadline');await runtime?.dispose?.()}catch(error){report.result='FAIL';report.cleanupFailure=String(error).replaceAll(profiles[0].oauthToken,'[redacted]')}
  report.actors=[]
  for(const actor of actors)report.actors.push(await stopAndJoinChild(actor.child,actor.witness))
  report.joined=actors.length>0&&report.actors.every(a=>a.joined)
  if(!report.joined)report.result='FAIL'
  cp.spawn=spawn;syncBuiltinESMExports()
  writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2),{mode:0o600})
  console.log(JSON.stringify({root,result:report.result,joined:report.joined,failure:report.failure}))
  process.exitCode=report.result==='PASS'?0:1
}
