import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [clientRoot, meridianRoot] = process.argv.slice(2);
if (!clientRoot || !meridianRoot) throw new Error('Usage: bun probe.ts <opencodex-source-root> <meridian-source-root>');
const { fetchProviderModels } = await import(pathToFileURL(resolve(clientRoot, 'src/codex/catalog/provider-fetch.ts')).href);
const { buildModelList } = await import(pathToFileURL(resolve(meridianRoot, 'src/proxy/openai.ts')).href);
const requests: string[] = [];
let compatible = false;
const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch(request) {
 const url=new URL(request.url); requests.push(`${request.method} ${url.pathname}`);
 if(request.method!=='GET'||url.pathname!=='/v1/models')return new Response('catalog only',{status:405});
 const data=buildModelList(false,0).map(row=>compatible?{...row,context_length:row.context_window}:row);
 return Response.json({object:'list',data});
}});
try {
 const provider={adapter:'openai-chat',baseUrl:`http://127.0.0.1:${server.port}/v1`,authMode:'key' as const,allowPrivateNetwork:true,apiKey:'local-catalog-fixture',models:[]};
 const baseline=await fetchProviderModels('meridian-catalog-before',provider,0);
 compatible=true;
 const control=await fetchProviderModels('meridian-catalog-control',provider,0);
 const before=baseline.find(row=>row.id==='claude-opus-5-5');
 const after=control.find(row=>row.id==='claude-opus-5-5');
 assert(before);assert(after);
 assert.equal(before.contextWindow,undefined);assert.equal(after.contextWindow,1000000);
 assert.deepEqual(requests,['GET /v1/models','GET /v1/models']);
 console.log(JSON.stringify({kind:'actual-source-http-discovery',before:before.contextWindow??null,positiveControl:after.contextWindow,requests,scope:'local HTTP discovery only; no auth, inference, Codex app or installed-client claim'}));
} finally { await server.stop(true); }
