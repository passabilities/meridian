// Isolated real Polytoken -> installed Meridian -> SDK acceptance.
// E2E_ALLOW_LIVE_MODEL=1 E2E_POLYTOKEN_BIN=/absolute/polytoken
// E2E_LIVE_PROFILE_FILE=/private/access-only-profile.json node this-file
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.E2E_ALLOW_LIVE_MODEL, '1', 'Explicit live-model opt-in required');
const repo=resolve(process.env.E2E_MERIDIAN_ROOT ?? '.');
const binary=process.env.E2E_POLYTOKEN_BIN;
assert(binary && binary.startsWith('/'), 'Select an absolute actual Polytoken binary');
const clientModel=process.env.E2E_CLIENT_MODEL ?? 'claude-haiku-4-5';
const profiles=JSON.parse(readFileSync(process.env.E2E_LIVE_PROFILE_FILE,'utf8'));
assert.equal(profiles.length,1); assert(!profiles[0].refreshToken);
const root=mkdtempSync(join(tmpdir(),'meridian-polytoken-acceptance-'));
for(const key of Object.keys(process.env)) if(/^(ANTHROPIC_|CLAUDE_|MERIDIAN_)/.test(key)) delete process.env[key];
Object.assign(process.env,{HOME:join(root,'home'),MERIDIAN_CONFIG_DIR:join(root,'config'),MERIDIAN_SESSION_DIR:join(root,'sessions'),MERIDIAN_WORKDIR:join(root,'proxy-work'),MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_NO_UPDATE_CHECK:'1',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_CLAUDE_PATH:join(repo,'node_modules/@anthropic-ai/claude-code/bin/claude.exe')});
for(const d of ['home','config','sessions','proxy-work']) mkdirSync(join(root,d));
const actors=[];
const originalSpawn=childProcess.spawn;
childProcess.spawn=function(...args){const child=originalSpawn(...args);const row={pid:child.pid,command:String(args[0]),close:false,stdoutClose:!child.stdout,stderrClose:!child.stderr};actors.push(row);child.once('close',(code,signal)=>Object.assign(row,{close:true,code,signal}));child.stdout?.once('close',()=>row.stdoutClose=true);child.stderr?.once('close',()=>row.stderrClose=true);return child;};syncBuiltinESMExports();
const {startProxyServer}=await import(pathToFileURL(join(repo,'dist/server.js')));
const proxy=await startProxyServer({port:0,host:'127.0.0.1',silent:true,profiles,defaultProfile:profiles[0].id});
if(!proxy.server.listening)await once(proxy.server,'listening');
const port=proxy.server.address().port;
const ingress=[];
proxy.server.prependListener('request',(request,response)=>{
 if(!request.url?.startsWith('/v1/messages'))return;
 const requestId=`owned-${randomUUID()}`;
 request.headers['x-request-id']=requestId;
 request.rawHeaders.push('x-request-id',requestId);
 const row={requestId,kind:'unknown',responseClosed:false,responseFinished:false};ingress.push(row);
 // Observe events only when the application's consumer reads the stream.
 // Adding a data listener here would prematurely put IncomingMessage in flowing mode.
 const originalEmit=request.emit;
 let text='';
 request.emit=function(event,...args){
  if(event==='data')text+=args[0];
  if(event==='end'){
   try{
    const body=JSON.parse(text);
    row.kind=body.tools?.length===1 && body.tools[0].name==='_infer_title' && typeof body.system==='string' && body.system.startsWith('You summarize the conversation so far into a short session title.')?'native-title':'working';
    row.conversation=request.headers['x-polytoken-conversation'];
    row.tools=body.tools?.map(t=>t.name)??[];
   }catch(error){row.observationError=String(error)}
  }
  return originalEmit.call(this,event,...args);
 };
 response.once('finish',()=>row.responseFinished=true);response.once('close',()=>row.responseClosed=true);
});
let report={root,actors,ingress,result:'RUNNING',clientModel,node:process.version,platform:`${process.platform}/${process.arch}`};
console.log(JSON.stringify({root,port}));
try{
 const child=childProcess.spawn('/usr/bin/python3',[join(repo,'scripts/e2e-polytoken-conversations.py'),'--url',`http://127.0.0.1:${port}`,'--profile',profiles[0].id,'--model',clientModel,'--title-first'],{env:{...process.env,PATH:dirname(binary)+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',d=>{stdout+=d;process.stdout.write(d)});child.stderr.on('data',d=>{stderr+=d;process.stderr.write(d)});
 const [code]=await once(child,'close');report.clientExit=code;writeFileSync(join(root,'client.stdout'),stdout);writeFileSync(join(root,'client.stderr'),stderr);
 const rows=await(await fetch(`http://127.0.0.1:${port}/telemetry/requests?limit=200&hops=1`)).json();
 const diagnostics=await(await fetch(`http://127.0.0.1:${port}/telemetry/logs?category=error&limit=100`)).json();writeFileSync(join(root,'errors.json'),JSON.stringify(diagnostics,null,2));
 writeFileSync(join(root,'requests.json'),JSON.stringify(rows,null,2));report.rows=rows.map(r=>({status:r.status,model:r.model,sdkSessionId:r.sdkSessionId,lineage:r.lineageType,error:r.error}));
 assert.equal(code,0);assert(rows.length>0);
 const cancelledTitles=[];
 for(const row of rows){
  if(row.status===200)continue;
  const observed=ingress.find(item=>item.requestId===row.requestId);
  const cancelled=diagnostics.some(log=>log.requestId===row.requestId&&log.message.includes('abort=client_abort'));
  assert(observed?.kind==='native-title' && observed.responseClosed && !observed.responseFinished && cancelled,
   `Non-successful working request or unproven title cancellation: ${row.requestId}`);
  cancelledTitles.push(row.requestId);
 }
 const conversations=new Map();
 for(const row of rows){
  const observed=ingress.find(item=>item.requestId===row.requestId);
  assert(observed?.conversation, 'Every telemetry request must correlate to client ingress');
  const key=`${observed.kind}:${observed.conversation}`;
  const group=conversations.get(key)??{kind:observed.kind,requests:0,resumes:0,sdkSessions:new Set()};
  group.requests++;group.resumes+=Number(row.isResume);group.sdkSessions.add(row.sdkSessionId);
  conversations.set(key,group);
 }
 const groups=[...conversations.values()];
 const working=groups.filter(group=>group.kind==='working');
 assert.equal(working.length,6,'Two parent and four child conversations required');
 assert(working.every(group=>group.resumes>=2),'Each working conversation must actually resume');
 for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++)
  assert(![...groups[i].sdkSessions].some(id=>groups[j].sdkSessions.has(id)), 'Independent conversations shared an SDK session');
 report.conversations=groups.map(group=>({...group,sdkSessions:[...group.sdkSessions]}));
 report.cancelledTitles=cancelledTitles;report.result='PASS';
}catch(e){report.result='FAIL';report.failure=String(e)}finally{await proxy.close();report.joined=actors.every(a=>a.close&&a.stdoutClose&&a.stderrClose);if(!report.joined)report.result='FAIL';writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,result:report.result,clientExit:report.clientExit,joined:report.joined,failure:report.failure}));process.exitCode=report.result==='PASS'?0:1;}
