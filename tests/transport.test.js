import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {localWorker,credentials} from './helpers/worker.js';

test('actual SDK over local HTTP connects both simulated producers to durable shared MCP without altering old events',async()=>{
 const w=await localWorker();const client=new Client({name:'SIMULATED-sdk-smoke',version:'1'});
 try{
  const before=(await w.db.prepare('SELECT * FROM events ORDER BY request_id').all()).results;
  const endpoint=new URL('/mcp',await w.mf.ready);
  await client.connect(new StreamableHTTPClientTransport(endpoint,{requestInit:{headers:{Authorization:'Bearer '+credentials.MCP_AUTH_TOKEN}}}));
  assert.equal((await client.listTools()).tools.length,11);
  const resources=await client.listResources();assert.ok(resources.resources.some(r=>r.uri==='spider://config'));
  assert.ok((await client.readResource({uri:'spider://guide'})).contents[0].text.includes('D1'));
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
  for(const source of ['windows','cloud']){
   const created=await call('spider_create_session',{context:{source,project_id:'simulated-project',run_id:'simulated-'+source,simulated:true}});
   const sessionId=created.id;
   const events=[{id:'stable-step',label:'SIMULATED test step',route:'code',status:'running'}];
   await call('spider_update_events',{sessionId,events});
   await call('spider_update_events',{sessionId,events});
   let session=await call('spider_get_session',{sessionId});assert.equal(session.totalEvents,1);assert.equal(session.context.source,source);assert.equal(session.context.simulated,true);assert.equal(session.status,'live');
   await call('spider_configure_session',{sessionId,config:{layout:'landscape'}});
   await call('spider_update_events',{sessionId,events:[{id:'stable-step',status:'completed'}]});
   session=await call('spider_get_session',{sessionId});assert.equal(session.status,'live'); // A tool completing is not a task completing.
   await call('spider_complete_session',{sessionId,status:'completed'});
   await call('spider_control_playback',{sessionId,command:{action:'seek',position:0}});
   const exported=await call('spider_export_session',{sessionId});
   const artifactUrl=new URL(exported.downloadUrl);assert.ok(!artifactUrl.search);assert.ok(!artifactUrl.href.includes(credentials.MCP_AUTH_TOKEN));
   const downloaded=await fetch(artifactUrl,{headers:{Authorization:'Bearer '+credentials.MCP_AUTH_TOKEN}});assert.equal(downloaded.status,200);
   assert.equal((await fetch(artifactUrl)).status,401);
   const imported=await call('spider_import_session',{filename:exported.filename});assert.ok(imported.id!==sessionId);
   const project=await call('spider_export_project',{sessionId,name:'simulated-'+source,includeMcp:true,includeReplay:true});assert.equal(project.format,'prompt-spider-project-files/v1');
   const page=await(await w.request('/api/sessions')).json();assert.ok(page.sessions.find(s=>s.id===sessionId));
   const record=await(await w.request('/api/replay?id='+sessionId)).json();assert.equal(record.record.events.length,1);
   await call('spider_close_session',{sessionId:imported.id});
  }
  assert.deepEqual((await w.db.prepare('SELECT * FROM events ORDER BY request_id').all()).results,before);
 }finally{await client.close();await w.close();}
});

test('Worker OAuth boundary accepts issued access only, rejects approval/write/read tokens and denies unsafe origins',async()=>{
 const approval='oauth-approval-fixture-not-real-'+'0'.repeat(32);
 const w=await localWorker({MCP_OAUTH_ORIGIN:'https://spider.test',MCP_OAUTH_APPROVAL_TOKEN:approval,MCP_OAUTH_REDIRECT_URIS:'["https://client.test/callback"]'});
 try{
  const post=(path,body,headers={})=>w.request(path,{role:null,method:'POST',body,headers});
  const registered=await post('/oauth/register',{redirect_uris:['https://client.test/callback']});assert.equal(registered.status,201);const {client_id}=await registered.json();
  const verifier='x'.repeat(43),code_challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
  const params=new URLSearchParams({client_id,redirect_uri:'https://client.test/callback',response_type:'code',code_challenge_method:'S256',code_challenge,resource:'https://spider.test/mcp',state:'state-test'});
  const page=await w.request('/oauth/authorize?'+params,{role:null});assert.equal(page.status,200);const nonce=(await page.text()).match(/name="nonce" value="([^"]+)"/)[1];
  const approved=await post('/oauth/authorize',{nonce,approval},{Origin:'https://spider.test'});assert.equal(approved.status,302);
  const code=new URL(approved.headers.get('location')).searchParams.get('code');
  const r=await post('/oauth/token',{grant_type:'authorization_code',client_id,redirect_uri:'https://client.test/callback',code,code_verifier:verifier,resource:'https://spider.test/mcp'});assert.equal(r.status,200);assert.notEqual(r.headers.get('Access-Control-Allow-Origin'),'*');const tokens=await r.json();
  const rpc={jsonrpc:'2.0',id:1,method:'tools/list',params:{}};
  const requestRpc=role=>w.request('/mcp',{role,method:'POST',headers:{Accept:'application/json, text/event-stream'},body:rpc});
  assert.equal((await requestRpc(tokens.access_token)).status,200);
  assert.equal((await requestRpc(approval)).status,401);
  assert.equal((await w.request('/api/sessions',{role:approval})).status,401);
  assert.equal((await w.request('/api/sessions',{role:tokens.access_token})).status,401);
  assert.equal((await w.request('/mcp',{role:tokens.access_token,method:'POST',headers:{Origin:'https://evil.test',Accept:'application/json, text/event-stream'},body:rpc})).status,403);
  await w.db.prepare('DELETE FROM oauth_tokens').run();assert.equal((await requestRpc(tokens.access_token)).status,401);
 }finally{await w.close();}
});
