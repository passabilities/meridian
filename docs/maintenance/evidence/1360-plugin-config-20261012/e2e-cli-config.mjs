// Credentialless real CLI config acceptance; no SDK/client/model acceptance claim.
// node e2e-cli-config.mjs <runtime> <absolute-cli-entry> <fresh-scratch-root>
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const [runtime,entry,scratch]=process.argv.slice(2);
assert.equal(process.platform,'darwin','Run this fenced probe on macOS');
assert.ok(runtime&&entry&&scratch,'Supply runtime, entry, new scratch root');
const root=resolve(scratch), cli=resolve(entry), children=[], cases=[];
await mkdir(root,{mode:0o700});
await mkdir(join(root,'claude'),{mode:0o700});
const q=JSON.stringify;
await writeFile(join(root,'fence.sb'),`(version 1)
(allow default)
(deny network*)
(deny file-read-data ${['.claude','.codex','.config','Library/Keychains'].map(p=>`(subpath ${q(join(homedir(),p))})`).join(' ')})
(deny file-write* (subpath ${q(homedir())}))
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))
(allow network* (local unix-socket) (remote unix-socket))
(allow process-exec (literal "/bin/ps") (with no-sandbox))
`);
// CLI preflight only: this fixture supplies no credentials and rejects every
// command other than auth status. No model request is made by this probe.
const authFixture=join(root,'auth-status-fixture');
await writeFile(authFixture,'#!/bin/sh\nif [ "$1" = auth ] && [ "$2" = status ]; then printf \'{"loggedIn":true,"subscriptionType":"max"}\\n\'; else exit 91; fi\n',{mode:0o700});
const base=Object.fromEntries(['PATH','HOME','TMPDIR','USER','LOGNAME'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(base,{CLAUDE_CONFIG_DIR:join(root,'claude'),MERIDIAN_CLAUDE_PATH:authFixture,MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_HOST:'127.0.0.1',MERIDIAN_PROFILES:JSON.stringify([{id:'offline-fixture',type:'api',apiKey:'offline-fixture-not-a-key',baseUrl:'http://127.0.0.1:1'}])});
for(const name of ['a','b']){
 const config=join(root,name); await mkdir(join(config,'plugins'),{recursive:true,mode:0o700});
 await writeFile(join(config,'plugins','package.json'),'{"type":"module"}');
 await writeFile(join(config,'plugins','marker.js'),`export default {name:'discovery-${name}',onRequest(ctx){return ctx}}`);
 const external=join(root,`external-${name}.js`);
 await writeFile(external,`export default {name:'manifest-${name}',onRequest(ctx){return ctx}}`);
 await writeFile(join(config,'plugins.json'),JSON.stringify({plugins:[{path:external,enabled:true}]}));
}
await writeFile(join(root,'package.json'),'{"type":"module"}');
await writeFile(join(root,'override.json'),JSON.stringify({plugins:[{path:'marker.js',enabled:false}]}));
async function launch(name,overrides={}){
 const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));
 const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn('/usr/bin/sandbox-exec',['-f',join(root,'fence.sb'),runtime,cli],{cwd:root,env:{...base,MERIDIAN_CONFIG_DIR:join(root,name),MERIDIAN_PORT:String(port),...overrides},stdio:['ignore','pipe','pipe']});
 const state={child,port,output:'',closed:false,code:null,signal:null};
 state.joined=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{state.closed=true;state.code=code;state.signal=signal;resolve();});});
 // Always observe failures while the readiness assertion is pending.
 state.joined.catch(()=>{}); children.push(state);
 for(const pipe of [child.stdout,child.stderr])pipe.on('data',chunk=>{state.output=(state.output+chunk.toString()).slice(-32768)});
 const deadline=Date.now()+25000;
 while(Date.now()<deadline){
  assert.equal(state.closed,false,`CLI exited before readiness: ${state.output}`);
  try{const response=await fetch(`http://127.0.0.1:${port}/readyz`,{signal:AbortSignal.timeout(500)});if(response.status===200)return state;}catch(error){if(!(error instanceof Error))throw error;}
  await delay(100);
 }
 throw new Error(`CLI readiness deadline: ${state.output}`);
}
async function list(state){const response=await fetch(`http://127.0.0.1:${state.port}/plugins/list`,{signal:AbortSignal.timeout(2000)});assert.equal(response.status,200);return (await response.json()).plugins.map(({name,status})=>({name,status}));}
let failure;
try{
 const a=await launch('a'),b=await launch('b');
 for(const [name,state] of [['a',a],['b',b]]){
  const plugins=await list(state);assert.deepEqual(plugins,[{name:`manifest-${name}`,status:'active'},{name:`discovery-${name}`,status:'active'}]);cases.push({case:`config-${name}`,pass:true,plugins});
 }
 const override=await launch('b',{MERIDIAN_PLUGIN_DIR:join(root,'a','plugins'),MERIDIAN_PLUGIN_CONFIG:join(root,'override.json')});
 const plugins=await list(override);assert.deepEqual(plugins,[{name:'marker.js',status:'disabled'}]);cases.push({case:'explicit-path-precedence',pass:true,plugins});
 assert.deepEqual(await list(a),cases[0].plugins);cases.push({case:'first-instance-retained',pass:true});
}catch(error){failure=String(error);}
finally{
 for(const state of children){
  if(!state.closed)state.child.kill('SIGTERM');
  try{await Promise.race([state.joined,delay(10000).then(()=>{if(!state.closed)throw new Error('CLI failed to join after SIGTERM')})]);}
  catch(error){failure??=String(error);if(!state.closed){state.child.kill('SIGKILL');await state.joined;}}
  if(state.code!==0)failure??=`CLI cleanup exit ${state.code}/${state.signal}`;
 }
 const receipt={pass:!failure,failure,cli,runtime,platform:process.platform,arch:process.arch,entrySha256:createHash('sha256').update(await readFile(cli)).digest('hex'),cases,processes:children.map(({closed,code,signal})=>({joined:closed,code,signal})),scope:'Real foreground CLI, discovery/manifest config isolation and explicit overrides; loopback-only network fence, denied host credential directories, dummy API profile and auth-status-only fixture. GET readiness/plugins only; no SDK inference or actual client/model/plugin acceptance claim.'};
 await writeFile(join(root,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}
if(failure)process.exitCode=1;
