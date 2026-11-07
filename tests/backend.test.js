import test from 'node:test';
import assert from 'node:assert/strict';
import {localWorker,sample,credentials} from './helpers/worker.js';

test('real Worker+D1 migration preserves history; authenticated legacy, scoped events, dedup and safe projection',async()=>{
 const w=await localWorker();try{
  assert.equal((await w.request('/health',{role:null})).status,200);
  assert.equal((await w.db.prepare('SELECT COUNT(*) AS n FROM events').first()).n,2);
  assert.equal((await w.request('/api/events',{role:null})).status,401);
  assert.equal((await w.request('/api/events',{role:'windows'})).status,401);
  assert.equal((await w.request('/api/events',{role:'mcp'})).status,401);
  assert.equal((await w.request('/api/events',{method:'POST',role:'reader',body:sample()})).status,401);
  assert.equal((await w.request('/api/events',{method:'POST',role:'legacy',body:{event:'ping',project:'old-client'}})).status,202);
  assert.equal((await w.request('/api/events',{method:'POST',role:'legacy',body:sample()})).status,400);
  assert.equal((await w.request('/api/events',{method:'POST',role:'cloud',body:sample()})).status,403);
  const e=sample({sequence:3,event_type:'task_completed',status:'completed'});
  let r=await w.request('/api/events',{method:'POST',role:'windows',body:e});assert.equal(r.status,202);assert.equal((await r.json()).persisted,true);
  r=await w.request('/api/events',{method:'POST',role:'windows',body:e});assert.equal((await r.json()).duplicate,true);
  assert.equal((await w.request('/api/events',{method:'POST',role:'windows',body:{...e,status:'failed'}})).status,400);
  assert.equal((await w.request('/api/events',{method:'POST',role:'windows',body:{...e,run_id:'different'}})).status,409);
  await w.request('/api/events',{method:'POST',role:'windows',body:sample({sequence:2,event_type:'command_completed',status:'completed'})});
  const cloud=sample({source:'cloud',run_id:'cloud-run',event_type:'model_request_completed',status:'completed'});
  assert.equal((await w.request('/api/events',{method:'POST',role:'cloud',body:cloud})).status,202);
  const runs=(await (await w.request('/api/runs')).json()).runs;
  assert.equal(runs.find(x=>x.source==='windows').status,'completed');
  assert.equal(runs.find(x=>x.source==='cloud').status,'running');
  const events=await (await w.request('/api/events?source=windows&limit=1')).json();assert.equal(events.events.length,1);assert.ok(events.next_cursor);assert.ok(!('payload_hash' in events.events[0]));
  assert.equal((await w.request('/api/events?project_id=%27%20OR%201%3D1')).status,400);
  const legacy=await (await w.request('/api/legacy')).json();assert.equal(legacy.events.length,3);assert.ok(legacy.events.find(x=>x.request_id==='old-1'));
 }finally{await w.close();}
});
test('privacy, body caps, origin rejection and shared-storage rate limit',async()=>{
 const w=await localWorker();try{
  for(const extra of [{prompt:'secret'},{tool_input:{cmd:'secret'}},{project_id:'C:/secret/path'}])assert.equal((await w.request('/api/events',{role:'windows',method:'POST',body:sample(extra)})).status,400);
  assert.equal((await w.request('/api/events',{role:'windows',method:'POST',body:'x'.repeat(131073)})).status,413);
  assert.equal((await w.request('/api/events',{headers:{Origin:'https://evil.test'}})).status,403);
  await w.db.prepare("INSERT INTO spider_rate_limits VALUES ('windows',?,120) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=120").bind(Math.floor(Date.now()/60000)).run();
  const limited=await w.request('/api/events',{role:'windows',method:'POST',body:sample()});assert.equal(limited.status,429);assert.equal(limited.headers.get('Retry-After'),'60');
  const response=await w.request('/',{role:null});assert.equal(response.status,200);assert.ok(response.headers.get('Content-Security-Policy').includes("script-src 'self'"));assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
 }finally{await w.close();}
});
test('credential overlap fails closed and separate Worker MCP entrypoint lists actual 11 tools',async()=>{
 const bad=await localWorker({MCP_AUTH_TOKEN:credentials.SPIDER_INGEST_TOKEN});try{assert.equal((await bad.request('/mcp',{role:'mcp',method:'POST',body:{}})).status,503);}finally{await bad.close();}
 const w=await localWorker();try{
  const headers={accept:'application/json, text/event-stream'};
  assert.equal((await w.request('/mcp',{role:'windows',method:'POST',headers,body:{jsonrpc:'2.0',id:1,method:'tools/list'}})).status,401);
  const r=await w.request('/mcp',{role:'mcp',method:'POST',headers,body:{jsonrpc:'2.0',id:2,method:'tools/list',params:{}}});
  assert.equal(r.status,200);const data=await r.json();assert.equal(data.result.tools.length,11);
  const create=await w.request('/mcp',{role:'mcp',method:'POST',headers,body:{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'spider_create_session',arguments:{context:{source:'cloud',project_id:'p-1',run_id:'run-mcp',simulated:true}}}}});
  const result=await create.json();assert.ok(!result.result?.isError,JSON.stringify(result));
  assert.equal((await w.request('/api/sessions',{role:'windows'})).status,401);
  const sessions=await(await w.request('/api/sessions')).json();assert.equal(sessions.sessions.length,1);assert.equal(sessions.sessions[0].context?.source??sessions.sessions[0].source,'cloud');
 }finally{await w.close();}
});
