import assets from './assets.generated.js';
import {validateEvent,validateLegacy,ValidationError,canonicalEvent,opaque} from './protocol.js';
import {projectRun} from './state.js';
import {handleMcp,listMcpSessions} from './mcp.js';
import {DurableSessionStore} from './mcp-store.js';
import {handleOAuth,validateOAuthBearer} from './oauth.js';
const MAX_BODY=128*1024;
const commonHeaders={
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
export function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{...commonHeaders,'Content-Type':'application/json; charset=utf-8',...extra}});}
async function digest(s){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return new Uint8Array(bytes);}
async function equal(a,b){if(typeof a!=='string'||!a||typeof b!=='string'||!b)return false;const [x,y]=await Promise.all([digest(a),digest(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0;}
const token=request=>/^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization')??'')?.[1]??'';
const credentialKeys=['SPIDER_READ_TOKEN','SPIDER_INGEST_TOKEN','SPIDER_WINDOWS_TOKEN','SPIDER_CLOUD_TOKEN','MCP_AUTH_TOKEN','MCP_OAUTH_APPROVAL_TOKEN'];
function validCredentialConfig(env){const configured=credentialKeys.map(k=>env[k]).filter(Boolean);return configured.every(v=>typeof v==='string'&&v.length>=16)&&new Set(configured).size===configured.length;}
async function authenticate(request,env,role){
 if(!validCredentialConfig(env))return {error:json({error:'credential_configuration_error'},503)};
 if(role==='reader'||role==='mcp'){
  const expected=env[role==='reader'?'SPIDER_READ_TOKEN':'MCP_AUTH_TOKEN'];
  if(role==='mcp') {
   if(await equal(token(request),expected)||await validateOAuthBearer(token(request),env,new URL(request.url).origin))return {principal:role};
   if(!expected&&!env.MCP_OAUTH_APPROVAL_TOKEN)return {error:json({error:'authentication_unconfigured'},503)};
   return {error:json({error:'unauthorized'},401,{'WWW-Authenticate':'Bearer resource_metadata="'+new URL(request.url).origin+'/.well-known/oauth-protected-resource"'})};
  }
  if(!expected)return {error:json({error:'authentication_unconfigured'},503)};
  if(!await equal(token(request),expected))return {error:json({error:'unauthorized'},401,{'WWW-Authenticate':'Bearer'})};
  return {principal:role};
 }
 for(const [key,principal]of [['SPIDER_WINDOWS_TOKEN','windows'],['SPIDER_CLOUD_TOKEN','cloud'],['SPIDER_INGEST_TOKEN','legacy']])if(await equal(token(request),env[key]))return {principal};
 return {error:json({error:'unauthorized'},401,{'WWW-Authenticate':'Bearer'})};
}
async function boundedBody(request,limit){
 const length=request.headers.get('Content-Length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))throw Object.assign(new Error('body_too_large'),{httpStatus:413});
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw Object.assign(new Error('body_too_large'),{httpStatus:413});}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
async function rateLimit(env,principal,limit){
 if(!env.DB)throw Object.assign(new Error('storage_unconfigured'),{httpStatus:503});
 const minute=Math.floor(Date.now()/60000);
 const result=await env.DB.prepare(`INSERT INTO spider_rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=CASE WHEN spider_rate_limits.window_start=excluded.window_start THEN spider_rate_limits.count+1 ELSE 1 END RETURNING count`).bind(principal,minute).first();
 return result.count<=limit;
}
function filterQuery(url){
 const filters=[],values=[];
 for(const key of ['source','project_id','run_id']){
  const value=url.searchParams.get(key);if(value===null||value==='')continue;
  if(key==='source'?!['windows','cloud'].includes(value):!opaque(value))throw new ValidationError('invalid_filter');
  filters.push(`${key}=?`);values.push(value);
 }
 return {where:filters.length?' WHERE '+filters.join(' AND '):'',values};
}
function boundedLimit(url,max=200){const s=url.searchParams.get('limit');if(s===null)return Math.min(max,100);if(!/^\d+$/.test(s)||Number(s)<1||Number(s)>max)throw new ValidationError('invalid_limit');return Number(s);}
async function ingest(request,env,principal){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')??''))return json({error:'unsupported_media_type'},415);
 let data;try{data=JSON.parse(await boundedBody(request,MAX_BODY));}catch(e){if(e.httpStatus)throw e;return json({error:'invalid_json'},400);}
 if(principal==='legacy'){
  const event=validateLegacy(data);const id=crypto.randomUUID(),at=new Date().toISOString();
  await env.DB.prepare('INSERT INTO events(request_id,event,project,received_at) VALUES(?,?,?,?)').bind(id,event.event,event.project,at).run();
  return json({request_id:id,persisted:true},202);
 }
 const event=validateEvent(data);
 if(event.source!==principal)return json({error:'source_forbidden'},403);
 const hash=Array.from(await digest(canonicalEvent(event)),b=>b.toString(16).padStart(2,'0')).join('');
 const at=new Date().toISOString();
 const inserted=await env.DB.prepare('INSERT INTO spider_events_v1(event_id,version,source,project_id,run_id,event_type,status,timestamp,received_at,sequence,node_id,simulated,payload_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING RETURNING event_id').bind(event.event_id,1,event.source,event.project_id,event.run_id,event.event_type,event.status,event.timestamp,at,event.sequence??null,event.node_id,event.simulated?1:0,hash).first();
 if(!inserted){const existing=await env.DB.prepare('SELECT payload_hash FROM spider_events_v1 WHERE event_id=?').bind(event.event_id).first();if(!existing||existing.payload_hash!==hash)return json({error:'event_id_conflict'},409);}
 return json({event_id:event.event_id,persisted:true,duplicate:!inserted},202);
}
async function readApi(request,env,url){
 const server_time=new Date().toISOString();
 if(url.pathname==='/api/sessions')return json({sessions:await listMcpSessions(env),server_time});
 if(url.pathname==='/api/session'||url.pathname==='/api/replay'){
  const id=url.searchParams.get('id');if(!opaque(id))throw new ValidationError('invalid_session_id');
  const store=new DurableSessionStore(env.DB);
  try{return url.pathname==='/api/session'?json({session:await store.get(id,{limit:200}),server_time}):json({record:await store.record(id),server_time});}
  catch(error){if(error.message==='Session not found or closed')return json({error:'not_found'},404);throw error;}
 }
 if(url.pathname==='/api/legacy'){
  const limit=boundedLimit(url);const result=await env.DB.prepare('SELECT request_id,event,project,received_at FROM events ORDER BY received_at DESC,request_id DESC LIMIT ?').bind(limit).all();return json({events:result.results,server_time});
 }
 const {where,values}=filterQuery(url);
 if(url.pathname==='/api/events'){
  const limit=boundedLimit(url);const before=url.searchParams.get('before');
  if(before!==null&&(!/^\d+$/.test(before)||!Number.isSafeInteger(Number(before))))throw new ValidationError('invalid_cursor');
  const clause=before===null?where:where+(where?' AND ':' WHERE ')+'id < ?';
  const args=before===null?values:[...values,Number(before)];
  const result=await env.DB.prepare(`SELECT * FROM spider_events_v1${clause} ORDER BY id DESC LIMIT ?`).bind(...args,limit).all();
  const events=result.results.map(({payload_hash,...e})=>({...e,simulated:Boolean(e.simulated)}));
  return json({events,next_cursor:events.length===limit?events.at(-1).id:null,server_time});
 }
 if(url.pathname==='/api/runs'){
  const limit=boundedLimit(url,40);
  const groups=await env.DB.prepare(`SELECT source,project_id,run_id,MAX(id) AS last_id,COUNT(*) AS events_count FROM spider_events_v1${where} GROUP BY source,project_id,run_id ORDER BY last_id DESC LIMIT ?`).bind(...values,limit).all();
  const runs=[];
  for(const group of groups.results){
   const history=await env.DB.prepare('SELECT * FROM spider_events_v1 WHERE source=? AND project_id=? AND run_id=? ORDER BY id DESC LIMIT 1000').bind(group.source,group.project_id,group.run_id).all();
   const run=projectRun(history.results,Date.now(),{disconnected:Number(env.RUN_DISCONNECTED_SECONDS)||120,timeout:Number(env.RUN_TIMEOUT_SECONDS)||900});
   // Explicit terminal state may precede the bounded timeline; retain it even after 1000 heartbeats.
   const terminal=await env.DB.prepare("SELECT event_type FROM spider_events_v1 WHERE source=? AND project_id=? AND run_id=? AND event_type IN ('task_completed','task_failed','task_cancelled','session_ended') ORDER BY CASE WHEN event_type='session_ended' THEN 0 ELSE 1 END DESC,COALESCE(sequence,id) DESC,id DESC LIMIT 1").bind(group.source,group.project_id,group.run_id).first();
   if(terminal)run.status=({task_completed:'completed',task_failed:'failed',task_cancelled:'cancelled',session_ended:'ended'})[terminal.event_type];
   runs.push({...run,events_count:group.events_count,timeline_truncated:group.events_count>history.results.length});
  }
  return json({runs,server_time});
 }
 return json({error:'not_found'},404);
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  try{
   if(url.pathname.startsWith('/oauth/')||url.pathname.startsWith('/.well-known/oauth-')){
    if(!validCredentialConfig(env))return json({error:'credential_configuration_error'},503);
    const oauth=await handleOAuth(request,env);if(oauth)return oauth;
    return json({error:'not_found'},404);
   }
   if(url.pathname==='/health')return json({ok:true,service:'prompt-spider-mcp',protocol:'streamable-http',version:1});
   const isMcp=url.pathname==='/mcp'||url.pathname.startsWith('/mcp/');
   const isRead=url.pathname.startsWith('/api/')&&request.method==='GET';
   const isIngest=url.pathname==='/api/events'&&request.method==='POST';
   if(isMcp||isRead||isIngest){
    const origin=request.headers.get('Origin');
    if(origin&&origin!==url.origin)return json({error:'origin_forbidden'},403);
    const auth=await authenticate(request,env,isMcp?'mcp':isRead?'reader':'writer');if(auth.error)return auth.error;
    if(!await rateLimit(env,auth.principal,isMcp?120:isRead?120:120))return json({error:'rate_limited'},429,{'Retry-After':'60'});
    if(isMcp){
     let safeRequest=request;
     if(request.method==='POST'){
      const body=await boundedBody(request,MAX_BODY);
      safeRequest=new Request(request.url,{method:request.method,headers:request.headers,body});
     }
     return await handleMcp(safeRequest,env,{authenticated:true});
    }
    if(isIngest)return await ingest(request,env,auth.principal);
    return await readApi(request,env,url);
   }
   if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'method_not_allowed'},405,{'Allow':'GET, HEAD'});
   const name=url.pathname==='/'?'/index.html':url.pathname;
   const asset=assets[name];
   if(!asset)return json({error:'not_found'},404);
   return new Response(request.method==='HEAD'?null:asset.body,{headers:{...commonHeaders,'Content-Type':asset.type}});
  }catch(error){
   if(error instanceof ValidationError)return json({error:error.message},400);
   if(error.httpStatus)return json({error:error.message},error.httpStatus);
   // Never reflect database errors, request bodies, authorization or environment values.
   return json({error:'service_unavailable'},503);
  }
 }
};
