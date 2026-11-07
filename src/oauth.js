const enc = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const hash = async value => b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))));
const now = () => Math.floor(Date.now()/1000);
const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const error = (code='invalid_request',status=400) => json({error:code},status);
function config(env) {
 try {
  const origin=new URL(env.MCP_OAUTH_ORIGIN);
  if(origin.origin!==env.MCP_OAUTH_ORIGIN || (origin.protocol!=='https:' && !(env.MCP_OAUTH_ALLOW_LOCAL_HTTP==='true' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname) && origin.protocol==='http:'))) return null;
  const redirects=JSON.parse(env.MCP_OAUTH_REDIRECT_URIS);
  if(!env.DB || typeof env.MCP_OAUTH_APPROVAL_TOKEN!=='string' || env.MCP_OAUTH_APPROVAL_TOKEN.length<32 || !Array.isArray(redirects) || !redirects.length || redirects.length>30) return null;
  for(const redirect of redirects) { const u=new URL(redirect); if(u.hash || u.username || u.password || u.protocol!=='https:') return null; }
  if([env.MCP_AUTH_TOKEN,env.SPIDER_INGEST_TOKEN,env.SPIDER_READ_TOKEN,env.SPIDER_WRITE_TOKEN].filter(Boolean).includes(env.MCP_OAUTH_APPROVAL_TOKEN)) return null;
  return {origin:origin.origin,resource:origin.origin+'/mcp',redirects};
 } catch { return null; }
}
async function body(request) {
 if(Number(request.headers.get('content-length')||0)>16384) throw new Error();
 const reader=request.body?.getReader(); let total=0, chunks=[];
 if(reader) while(true) {const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>16384){await reader.cancel();throw new Error();}chunks.push(value);}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const text=new TextDecoder().decode(bytes);
 if(request.headers.get('content-type')?.split(';')[0]==='application/json') return JSON.parse(text);
 return Object.fromEntries(new URLSearchParams(text));
}
async function limited(request,env,path) {
 // Cloudflare supplies this trusted header; missing headers share a restrictive bucket.
 const id=await hash((env.MCP_OAUTH_APPROVAL_TOKEN||'')+'|'+(request.headers.get('cf-connecting-ip')||'unknown')+'|'+path+'|'+Math.floor(now()/60));
 const row=await env.DB.prepare('INSERT INTO oauth_rates(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(id,now()+120).first();
 return row.count>30;
}
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function consume(db,table,id) { return db.prepare(`DELETE FROM ${table} WHERE id=? AND expires>? RETURNING *`).bind(await hash(id),now()).first(); }
async function issue(env,c,client,grantExpires=now()+2592000) {
 const access=random(),refresh=random(),time=now(),expiresIn=Math.min(3600,grantExpires-time);
 if(expiresIn<=0)return error('invalid_grant');
 await env.DB.batch([
  env.DB.prepare('INSERT INTO oauth_tokens(id,kind,client,resource,expires,grant_expires) VALUES(?,?,?,?,?,?)').bind(await hash(access),'access',client,c.resource,time+expiresIn,grantExpires),
  env.DB.prepare('INSERT INTO oauth_tokens(id,kind,client,resource,expires,grant_expires) VALUES(?,?,?,?,?,?)').bind(await hash(refresh),'refresh',client,c.resource,grantExpires,grantExpires)
 ]);
 return json({access_token:access,token_type:'Bearer',expires_in:expiresIn,refresh_token:refresh,scope:'mcp'});
}
export async function validateOAuthBearer(token,env,requestOrigin) {
 const c=config(env);if(!c || c.origin!==requestOrigin || typeof token!=='string' || token.length>128)return false;
 try { return !!await env.DB.prepare("SELECT id FROM oauth_tokens WHERE id=? AND kind='access' AND resource=? AND expires>?").bind(await hash(token),c.resource,now()).first(); } catch {return false;}
}
async function dispatchOAuth(request,env) {
 const url=new URL(request.url),path=url.pathname;
 if(!['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp','/.well-known/oauth-authorization-server','/oauth/register','/oauth/authorize','/oauth/token'].includes(path))return null;
 const c=config(env);if(!c)return error('temporarily_unavailable',503);
 if(url.origin!==c.origin)return error();
 try {
  if(request.method==='OPTIONS') {
   if(![c.origin,...c.redirects.map(value=>new URL(value).origin)].includes(request.headers.get('origin')))return error('access_denied',403);
   return new Response(null,{status:204,headers:{'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type'}});
  }
  if(path.startsWith('/.well-known/') && request.method==='GET') {
   if(path.includes('oauth-protected-resource'))return json({resource:c.resource,authorization_servers:[c.origin],scopes_supported:['mcp'],bearer_methods_supported:['header']});
   return json({issuer:c.origin,authorization_endpoint:c.origin+'/oauth/authorize',token_endpoint:c.origin+'/oauth/token',registration_endpoint:c.origin+'/oauth/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:['mcp']});
  }
  if(await limited(request,env,path))return error('slow_down',429);
  // Bounded garbage collection keeps attacker-generated public state short lived.
  await env.DB.batch(['oauth_clients','oauth_forms','oauth_codes','oauth_tokens','oauth_rates'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE expires<? ORDER BY expires LIMIT 100)`).bind(now())));
  if(path==='/oauth/register' && request.method==='POST') {
   const data=await body(request),redirects=data.redirect_uris;
   if(!Array.isArray(redirects)||!redirects.length||redirects.length>10||redirects.some(r=>!c.redirects.includes(r))||(data.token_endpoint_auth_method && data.token_endpoint_auth_method!=='none')||(data.grant_types && (!Array.isArray(data.grant_types)||data.grant_types.some(g=>!['authorization_code','refresh_token'].includes(g)))))return error('invalid_client_metadata');
   const id=random();await env.DB.prepare('INSERT INTO oauth_clients VALUES(?,?,?)').bind(id,JSON.stringify(redirects),now()+2592000).run();
   return json({client_id:id,redirect_uris:redirects,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},201);
  }
  if(path==='/oauth/authorize' && request.method==='GET') {
   const d=Object.fromEntries(url.searchParams),client=await env.DB.prepare('SELECT redirects FROM oauth_clients WHERE id=? AND expires>?').bind(d.client_id||'',now()).first();
   if(!client||!JSON.parse(client.redirects).includes(d.redirect_uri)||!c.redirects.includes(d.redirect_uri)||d.response_type!=='code'||d.code_challenge_method!=='S256'||! /^[A-Za-z0-9_-]{43}$/.test(d.code_challenge||'')||d.resource!==c.resource||(d.scope && d.scope!=='mcp')||(d.state||'').length>2048)return error();
   const nonce=random();const safe={client_id:d.client_id,redirect_uri:d.redirect_uri,code_challenge:d.code_challenge,resource:c.resource,state:d.state||''};
   await env.DB.prepare('INSERT INTO oauth_forms VALUES(?,?,?)').bind(await hash(nonce),JSON.stringify(safe),now()+300).run();
   return new Response(`<!doctype html><meta charset="utf-8"><title>Approve MCP access</title><h1>Approve MCP access</h1><p>Grant this client access to all Prompt Spider MCP tools for 30 days.</p><p>Callback: ${escape(d.redirect_uri)}</p><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${nonce}"><label>Approval secret <input type="password" name="approval" autocomplete="off" required></label><button>Approve access</button></form>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
  }
  if(path==='/oauth/authorize' && request.method==='POST') {
   if(request.headers.get('origin')!==c.origin)return error('access_denied',403);
   const d=await body(request);if(typeof d.nonce!=='string'||d.nonce.length>128)return error();
   const form=await consume(env.DB,'oauth_forms',d.nonce);if(!form)return error('access_denied',403);
   if(typeof d.approval!=='string'||await hash(d.approval)!==await hash(env.MCP_OAUTH_APPROVAL_TOKEN))return error('access_denied',403);
   const safe=JSON.parse(form.data);if(!c.redirects.includes(safe.redirect_uri))return error();
   const code=random();await env.DB.prepare('INSERT INTO oauth_codes VALUES(?,?,?)').bind(await hash(code),form.data,now()+60).run();
   const redirect=new URL(safe.redirect_uri);redirect.searchParams.set('code',code);if(safe.state)redirect.searchParams.set('state',safe.state);
   return new Response(null,{status:302,headers:{location:redirect.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
  }
  if(path==='/oauth/token' && request.method==='POST') {
   const d=await body(request);if(d.resource!==c.resource)return error('invalid_target');
   if(d.scope!==undefined && d.scope!=='mcp')return error('invalid_scope');
   if(d.grant_type==='authorization_code') {
    if(typeof d.code!=='string'||d.code.length>128||! /^[A-Za-z0-9._~-]{43,128}$/.test(d.code_verifier||''))return error('invalid_grant');
    const row=await env.DB.prepare('SELECT data FROM oauth_codes WHERE id=? AND expires>?').bind(await hash(d.code),now()).first();if(!row)return error('invalid_grant');
    const safe=JSON.parse(row.data);if(safe.client_id!==d.client_id||safe.redirect_uri!==d.redirect_uri||!c.redirects.includes(d.redirect_uri)||safe.code_challenge!==await hash(d.code_verifier))return error('invalid_grant');
    if(!await consume(env.DB,'oauth_codes',d.code))return error('invalid_grant');
    return issue(env,c,d.client_id);
   }
   if(d.grant_type==='refresh_token') {
    if(typeof d.refresh_token!=='string'||d.refresh_token.length>128)return error('invalid_grant');
    const row=await env.DB.prepare("DELETE FROM oauth_tokens WHERE id=? AND kind='refresh' AND client=? AND resource=? AND expires>? AND grant_expires>? RETURNING grant_expires").bind(await hash(d.refresh_token),d.client_id||'',c.resource,now(),now()).first();
    if(!row)return error('invalid_grant');return issue(env,c,d.client_id,row.grant_expires);
   }
   return error('unsupported_grant_type');
  }
  return error('invalid_request',405);
 } catch {return error('invalid_request');}
}

// Browser access is limited to canonical and explicitly configured callback origins.
export async function handleOAuth(request,env) {
 const response=await dispatchOAuth(request,env);
 if(!response)return null;
 const origin=request.headers.get('origin'),c=config(env);
 if(origin && c && [c.origin,...c.redirects.map(value=>new URL(value).origin)].includes(origin)) {
  response.headers.set('access-control-allow-origin',origin);
  response.headers.set('vary','Origin');
 }
 return response;
}
