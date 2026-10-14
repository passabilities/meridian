// Synthetic, isolated GC metadata probe; no SDK, auth, client or transcript calls.
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, platform, arch } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
const source='/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/probe-source';
for (const key of Object.keys(process.env)) if (/^(MERIDIAN_|CLAUDE_|CLAUDE_PROXY_|ANTHROPIC_)/.test(key)) delete process.env[key];
process.env.MERIDIAN_CREDENTIALS_READONLY='1';
const mod=(p:string)=>import(pathToFileURL(join(source,p)).href);
const {initializeSessionBookkeeping,withBookkeepingWrite,withBookkeepingWriteAsync}=await mod('src/proxy/session/bookkeeping/database.ts');
if(process.argv[2]==='--writer') {
  const directory=process.argv[3]!, marker=process.argv[4]!;
  process.env.MERIDIAN_CONFIG_DIR=directory;
  const handle=initializeSessionBookkeeping(directory);
  console.log(JSON.stringify({kind:'ready'}));
  while(!existsSync(marker)) await new Promise(r=>setTimeout(r,1));
  const start=performance.now(); let result;
  try { await withBookkeepingWriteAsync(directory,{lockWaitMs:25,lockRetryMs:2},()=>true); result={status:'committed'}; }
  catch(e) {result={status:'rejected',name:e instanceof Error?e.name:'unknown',message:e instanceof Error?e.message:String(e)};}
  console.log(JSON.stringify({kind:'writer',elapsedMs:performance.now()-start,...result}));
  handle.close();
} else {
  const {canonicalizeLocator,resourceKey}=await mod('src/proxy/session/bookkeeping/locator.ts');
  const {importResource}=await mod('src/proxy/session/bookkeeping/resourceImport.ts');
  const {writeMappingRow}=await mod('src/proxy/session/bookkeeping/mappings.ts');
  const {runDeletionPhase}=await mod('src/proxy/session/bookkeeping/lifecycleDeletionSql.ts');
  const root=mkdtempSync(join(tmpdir(),'meridian-1219-gc-synthetic-'));chmodSync(root,0o700);
  const results:any[]=[];const children:any[]=[];
  try {
    for(const count of [1,4096]) {
      const directory=join(root,`ledger-${count}`),configDir=join(root,`config-${count}`),marker=join(root,`start-${count}`);
      mkdirSync(directory,{mode:0o700});mkdirSync(configDir,{mode:0o700});
      process.env.MERIDIAN_CONFIG_DIR=configDir;
      let armed=false,claimMs=0,begin=0;
      const handle=initializeSessionBookkeeping(directory,{executeTransaction(db:any,sql:string){
        if(armed&&sql==='BEGIN IMMEDIATE'){db.exec(sql);begin=performance.now();writeFileSync(marker,'synthetic',{mode:0o600});return;}
        db.exec(sql);if(armed&&sql==='COMMIT'&&begin){claimMs+=performance.now()-begin;begin=0;}
      }});
      try {
        withBookkeepingWrite(directory,{},(tx:any)=>{
          for(let i=0;i<count;i++) {
            const locator=canonicalizeLocator({configDir,sessionId:`synthetic-${i.toString().padStart(6,'0')}`});
            const key=resourceKey(locator),generation=`r:${key}:1`;
            importResource(tx,{key,generation,locator:{...locator,lifecycleGeneration:generation},rowVersion:1,state:'retired',createdAt:1,updatedAt:1,attempts:0});
            writeMappingRow(tx,`mapping-${i}`,{claudeSessionId:locator.sessionId,createdAt:1,lastUsedAt:1,messageCount:0,generationId:`synthetic-map-${i}`,currentTranscript:locator});
          }
        });
        const child=spawn(process.execPath,[import.meta.path,'--writer',directory,marker],{env:{...process.env,MERIDIAN_CONFIG_DIR:configDir},stdio:['ignore','pipe','pipe']});children.push(child);
        let buffer='',writer:any,stderr='';
        const ready=new Promise<void>((resolve,reject)=>{
          child.stdout!.on('data',(chunk:any)=>{buffer+=String(chunk);let end;while((end=buffer.indexOf('\n'))>=0){const row=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(row.kind==='ready')resolve();if(row.kind==='writer')writer=row;}});
          child.on('error',reject);child.on('exit',(code:number)=>{if(code!==0)reject(new Error(`synthetic writer exit ${code}`));});
        });child.stderr!.on('data',(chunk:any)=>stderr+=String(chunk));
        const watchdog=setTimeout(()=>child.kill('SIGKILL'),20_000);
        await ready;
        let timerAt:number|undefined,deletes=0;const started=performance.now();
        const timer=setTimeout(()=>{timerAt=performance.now()},1);
        armed=true;
        const outcome=await runDeletionPhase([],{storeDir:directory,now:()=>1000,maxDeletesPerRun:1,runTimeoutMs:5,deleter:async()=>{deletes++;throw new Error('negative control: deletion forbidden')}});
        armed=false;
        const elapsedMs=performance.now()-started;
        await new Promise(r=>setTimeout(r,2));clearTimeout(timer);
        if(child.exitCode===null)await once(child,'exit');clearTimeout(watchdog);
        if(child.exitCode!==0||stderr||!writer)throw new Error(`writer incomplete exit=${child.exitCode} stderr=${stderr}`);
        const states=handle.reader.all('SELECT state,count(*) AS count FROM resources GROUP BY state');
        if(deletes!==0||states.length!==1||states[0].state!=='retired'||states[0].count!==count||outcome.deferred!==0)throw new Error('synthetic authority/deletion negative control failed');
        results.push({count,kind:'retired imported rows with durable NULL-generation pins',maxDeletesPerRun:1,runTimeoutMs:5,timerBudgetMs:1,writerBudgetMs:25,elapsedMs,claimTransactionMs:claimMs,timerFiredAfterMs:timerAt!-started,writer,deletes,outcome,states});
      } finally {handle.close();}
    }
    const hashes=Object.fromEntries(['lifecycleDeletionSql.ts','resources.ts','resourceImport.ts','transaction.ts','connection.ts'].map(name=>[name,createHash('sha256').update(readFileSync(join(source,'src/proxy/session/bookkeeping',name))).digest('hex')]));
    console.log(JSON.stringify({sourceHead:'0bf16b0d83f2fcc8c9b55df06bf20f97d763a23f',bun:Bun.version,node:process.versions.node,platform:platform(),arch:arch(),libsql:JSON.parse(readFileSync(join(source,'node_modules/libsql/package.json'),'utf8')).version,hashes,results},null,2));
  }finally{for(const child of children)if(child.exitCode===null){child.kill('SIGKILL');await once(child,'exit')}rmSync(root,{recursive:true,force:true})}
}
