import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {handleOAuth,validateOAuthBearer} from '../src/oauth.js';

test('OAuth PKCE approval, resource binding, replay prevention and refresh rotation',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-01',d1Databases:{DB:'oauth-test'}});
 try {
 const DB=await mf.getD1Database('DB');
 for(const sql of (await readFile(new URL('../migrations/0003_oauth.sql',import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await DB.prepare(sql).run();
 const env={DB,MCP_OAUTH_ORIGIN:'https://mcp.example',MCP_OAUTH_APPROVAL_TOKEN:'a'.repeat(40),MCP_OAUTH_REDIRECT_URIS:'["https://client.example/callback"]'};
 const get=path=>handleOAuth(new Request('https://mcp.example'+path),env);
 const post=(path,data,origin)=>handleOAuth(new Request('https://mcp.example'+path,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(data)}),env);
 const metadata=await get('/.well-known/oauth-authorization-server');
 assert.equal(metadata.status,200);assert.equal(metadata.headers.get('access-control-allow-origin'),null);
 const preflight=origin=>handleOAuth(new Request('https://mcp.example/oauth/token',{method:'OPTIONS',headers:{origin}}),env);
 const allowed=await preflight('https://client.example');assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://client.example');
 const denied=await preflight('https://evil.example');assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
 const hostile=await handleOAuth(new Request('https://mcp.example/.well-known/oauth-authorization-server',{headers:{origin:'https://evil.example'}}),env);assert.equal(hostile.headers.get('access-control-allow-origin'),null);
 await DB.batch(Array.from({length:105},(_,i)=>DB.prepare('INSERT INTO oauth_clients VALUES(?,?,?)').bind('expired-'+i,'[]',0)));
 await post('/oauth/register',{redirect_uris:['https://client.example/callback']});
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM oauth_clients WHERE expires=0').first()).n,5);
 assert.equal((await post('/oauth/register',{redirect_uris:['https://evil.example/']})).status,400);
 const client=await(await post('/oauth/register',{redirect_uris:['https://client.example/callback']})).json();
 const verifier='v'.repeat(43), challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
 const query=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://client.example/callback',response_type:'code',code_challenge_method:'S256',code_challenge:challenge,resource:'https://mcp.example/mcp',state:'safe-state'});
 const page=await get('/oauth/authorize?'+query);assert.equal(page.status,200);
 const html=await page.text();assert.ok(!html.includes(env.MCP_OAUTH_APPROVAL_TOKEN));const nonce=html.match(/name="nonce" value="([^"]+)"/)[1];
 assert.equal((await post('/oauth/authorize',{nonce,approval:env.MCP_OAUTH_APPROVAL_TOKEN},'https://evil.example')).status,403);
 const approved=await post('/oauth/authorize',{nonce,approval:env.MCP_OAUTH_APPROVAL_TOKEN},env.MCP_OAUTH_ORIGIN);assert.equal(approved.status,302);
 const callback=new URL(approved.headers.get('location'));assert.equal(callback.searchParams.get('state'),'safe-state');
 assert.equal((await post('/oauth/authorize',{nonce,approval:env.MCP_OAUTH_APPROVAL_TOKEN},env.MCP_OAUTH_ORIGIN)).status,403);
 const exchange={grant_type:'authorization_code',client_id:client.client_id,code:callback.searchParams.get('code'),redirect_uri:'https://client.example/callback',resource:'https://mcp.example/mcp',code_verifier:verifier};
 assert.equal((await post('/oauth/token',{...exchange,code_verifier:'x'.repeat(43)})).status,400);
 const responses=await Promise.all([post('/oauth/token',exchange),post('/oauth/token',exchange)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
 const tokens=await responses.find(r=>r.status===200).json();assert.equal(await validateOAuthBearer(tokens.access_token,env,env.MCP_OAUTH_ORIGIN),true);assert.equal(await validateOAuthBearer(tokens.access_token,env,'https://evil.example'),false);
 const refresh={grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,resource:'https://mcp.example/mcp'};
 assert.equal((await post('/oauth/token',{...refresh,resource:'https://evil.example/mcp'})).status,400);
 assert.equal((await post('/oauth/token',{...refresh,scope:'admin'})).status,400);
 const deadline=Math.floor(Date.now()/1000)+120;
 await DB.prepare("UPDATE oauth_tokens SET grant_expires=? WHERE kind='refresh'").bind(deadline).run();
 const rotatedResponse=await post('/oauth/token',refresh);assert.equal(rotatedResponse.status,200);
 const rotated=await rotatedResponse.json();assert.ok(rotated.expires_in>0&&rotated.expires_in<=120);
 assert.equal((await post('/oauth/token',refresh)).status,400);
 const deadlines=await DB.prepare("SELECT grant_expires,expires FROM oauth_tokens WHERE kind='refresh'").all();
 assert.equal(deadlines.results.length,1);assert.equal(deadlines.results[0].grant_expires,deadline);assert.equal(deadlines.results[0].expires,deadline);
 await DB.prepare("UPDATE oauth_tokens SET grant_expires=0 WHERE kind='refresh'").run();
 assert.equal((await post('/oauth/token',{...refresh,refresh_token:rotated.refresh_token})).status,400);
 // Administrator revocation invalidates all issued access credentials immediately.
 await DB.prepare('DELETE FROM oauth_tokens').run();
 assert.equal(await validateOAuthBearer(tokens.access_token,env,env.MCP_OAUTH_ORIGIN),false);
 assert.equal((await post('/oauth/register',{x:'x'.repeat(17000)})).status,400);
 assert.equal((await handleOAuth(new Request('https://mcp.example/.well-known/oauth-authorization-server'),{...env,MCP_OAUTH_APPROVAL_TOKEN:''})).status,503);
 await DB.prepare("UPDATE oauth_tokens SET expires=0 WHERE kind='access'").run();
 assert.equal(await validateOAuthBearer(tokens.access_token,env,env.MCP_OAUTH_ORIGIN),false);
 const rateResults=[];
 for(let i=0;i<31;i++)rateResults.push((await post('/oauth/register',{redirect_uris:['https://client.example/callback']})).status);
 assert.ok(rateResults.includes(429));
 const rates=await DB.prepare('SELECT id FROM oauth_rates').all();
 assert.ok(rates.results.every(row=>/^[A-Za-z0-9_-]{43}$/.test(row.id)));

 } finally {await mf.dispose();}
});
