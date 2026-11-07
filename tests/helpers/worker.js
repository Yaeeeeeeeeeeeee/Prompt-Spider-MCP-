import {Miniflare} from 'miniflare';
import {readFile,readdir} from 'node:fs/promises';
export const credentials={SPIDER_READ_TOKEN:'test-reader-independent-00000000001',SPIDER_INGEST_TOKEN:'test-legacy-independent-00000000001',SPIDER_WINDOWS_TOKEN:'test-windows-independent-0000000001',SPIDER_CLOUD_TOKEN:'test-cloud-independent-000000000001',MCP_AUTH_TOKEN:'test-mcp-independent-0000000000001'};
export async function localWorker(extra={}){
 const mf=new Miniflare({modules:true,scriptPath:'.build/worker.js',compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'integration-test'},bindings:{...credentials,...extra}});
 const db=await mf.getD1Database('DB');
 await db.prepare('CREATE TABLE events(request_id TEXT PRIMARY KEY,event TEXT,project TEXT,received_at TEXT)').run();
 await db.prepare("INSERT INTO events VALUES ('old-1','ping','old-project','2026-11-01T00:00:00Z'),('old-2','ping','old-project','2026-11-01T00:00:01Z')").run();
 for(const f of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort()){
  const sql=(await readFile('migrations/'+f,'utf8')).replace(/--[^\n]*/g,'');
  for(const stmt of sql.split(';').filter(s=>s.trim()))await db.prepare(stmt).run();
 }
 const request=async(path,{role='reader',method='GET',body,headers={},redirect='manual'}={})=>mf.dispatchFetch('https://spider.test'+path,{method,redirect,headers:{...(role?{Authorization:'Bearer '+(credentials[{reader:'SPIDER_READ_TOKEN',legacy:'SPIDER_INGEST_TOKEN',windows:'SPIDER_WINDOWS_TOKEN',cloud:'SPIDER_CLOUD_TOKEN',mcp:'MCP_AUTH_TOKEN'}[role]]??role)}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
 return {mf,db,request,close:()=>mf.dispose()};
}
export function sample(over={}){return {version:1,event_id:crypto.randomUUID(),source:'windows',project_id:'p-opaque',run_id:'r-opaque',event_type:'task_started',status:'running',timestamp:new Date().toISOString(),simulated:true,...over};}
