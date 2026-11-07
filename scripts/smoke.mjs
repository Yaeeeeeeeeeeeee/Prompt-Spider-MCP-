// Explicitly writes SIMULATED sessions; never call without deployment authorization.
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const endpoint=new URL(process.env.MCP_SMOKE_URL||'');
assert.equal(endpoint.protocol,'https:'); assert.equal(endpoint.pathname,'/mcp');
const token=process.env.MCP_AUTH_TOKEN; assert.ok(token);
for(const bad of ['',process.env.SPIDER_READ_TOKEN,process.env.SPIDER_WINDOWS_TOKEN,process.env.SPIDER_CLOUD_TOKEN].filter(x=>x!==undefined)) {
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream',...(bad?{Authorization:`Bearer ${bad}`}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
 assert.ok([401,403,503].includes(response.status));
}
const client=new Client({name:'SIMULATED-deployment-smoke',version:'1'});
try {
 await client.connect(new StreamableHTTPClientTransport(endpoint,{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
 assert.equal((await client.listTools()).tools.length,11);
 const resources=await client.listResources(); assert.ok(resources.resources.length>=3);
 assert.ok((await client.readResource({uri:'spider://guide'})).contents.length);
 async function call(name,args={}) { const result=await client.callTool({name,arguments:args}); assert.ok(!result.isError,`${name} failed`); return result.structuredContent||JSON.parse(result.content[0].text); }
 for(const source of ['windows','cloud']) {
  const created=await call('spider_create_session',{context:{source,project_id:'SIMULATED',run_id:`smoke_${Date.now()}`,simulated:true}});
  const sessionId=created.id; assert.ok(sessionId);
  const events=[{id:'SIMULATED-event',label:'SIMULATED',route:'code',status:'running'}];
  await call('spider_update_events',{sessionId,events});
  const first=await call('spider_get_session',{sessionId});
  await call('spider_update_events',{sessionId,events});
  const second=await call('spider_get_session',{sessionId});
  assert.deepEqual(second.counts,first.counts);
  await call('spider_complete_session',{sessionId,status:'completed'});
  await call('spider_control_playback',{sessionId,command:{action:'seek',position:0}});
  const artifact=await call('spider_export_session',{sessionId});
  const download=await fetch(artifact.downloadUrl,{headers:{Authorization:`Bearer ${token}`}}); assert.equal(download.status,200);
  const imported=await call('spider_import_session',{filename:artifact.filename}); assert.ok(imported.id);
  await call('spider_export_project',{sessionId,name:`SIMULATED_${source}_${Date.now()}`,includeReplay:true});
  await call('spider_close_session',{sessionId}); await call('spider_close_session',{sessionId:imported.id});
 }
 console.log('SIMULATED remote MCP smoke passed. Native Hooks were not tested.');
} catch { console.error('Remote smoke failed; response details suppressed to protect credentials.'); process.exitCode=1; }
finally { await client.close(); }
