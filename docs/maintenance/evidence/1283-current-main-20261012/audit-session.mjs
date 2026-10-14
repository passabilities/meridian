import cp from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import {writeFileSync} from 'node:fs'
for(const name of ['spawn','exec','execFile','fork','spawnSync','execSync','execFileSync'])cp[name]=()=>{throw new Error('Read-only audit forbids subprocess execution')}
syncBuiltinESMExports()
globalThis.fetch=()=>{throw new Error('Read-only audit forbids network fetch')}
const root='/tmp/meridian-probe-proxy-ZgnwLK'
const {readSessionStoreSnapshot,setSessionStoreDir}=await import('../src/proxy/sessionStore.ts')
const {getSessionMessages}=await import('@anthropic-ai/claude-agent-sdk')
setSessionStoreDir(root+'/meridian-store')
const sessions=readSessionStoreSnapshot()
const report=[]
for(const [key,stored] of Object.entries(sessions)){
 if(!key.includes('probe-turns-stream-'))continue
 process.env.CLAUDE_CONFIG_DIR=stored.currentTranscript.configDir
 const messages=await getSessionMessages(stored.claudeSessionId,{dir:stored.currentTranscript.projectDir??root})
 report.push({key,session:stored.claudeSessionId,messages:messages.map(row=>({
   type:row.type,uuid:row.uuid,parent:row.parentUuid,timestamp:row.timestamp,
   model:row.message?.model,id:row.message?.id,role:row.message?.role,
   stopReason:row.message?.stop_reason,
   usage:row.message?.usage,
   contentTypes:Array.isArray(row.message?.content)?row.message.content.map(b=>b.type):typeof row.message?.content,
   toolIds:Array.isArray(row.message?.content)?row.message.content.filter(b=>b.type==='tool_use'||b.type==='tool_result').map(b=>({type:b.type,id:b.id??b.tool_use_id,name:b.name})):[],
 }))})
}
writeFileSync('/tmp/e41-supported-session-audit.json',JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({mode:'supported-api-read-only',sessions:report.length,rows:report.map(s=>s.messages.length)}))
