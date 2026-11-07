import { SessionStore } from '../vendor/prompt-spider-ui/lib/session-store.js';

const bytes = value => new TextEncoder().encode(value).length;
const encode = session => JSON.stringify({...session, byId: undefined, listeners: undefined});
function decode(text) {
 const session = JSON.parse(text);
 session.byId = new Map(session.events.map(event => [event.id, event]));
 session.listeners = new Set();
 return session;
}
export class DurableSessionStore {
 constructor(db) { if (!db) throw new Error('D1 binding DB is required'); this.db = db; }
 memory() { return new SessionStore({now: () => Date.now()/1000, maxEvents:1000, maxLogBytes:700*1024, maxSessions:20}); }
 async create(config,context) { return this.insert(store => store.create(config),context); }
 async importRecord(record) { return this.insert(store => store.importRecord(record)); }
 async insert(operation,context={}) {
  const store = this.memory(), result = operation(store), state = encode(store._session(result.id));
  if(bytes(state)>900*1024) throw new Error('Session exceeds cloud storage limit');
  const saved = await this.db.prepare('INSERT INTO mcp_sessions (id,revision,closed,state,context,updated_at) SELECT ?,0,0,?,?,? WHERE (SELECT COUNT(*) FROM mcp_sessions WHERE closed=0)<20').bind(result.id,state,JSON.stringify({source:'unknown',...context}),Date.now()).run();
  if(!saved.meta.changes) throw new Error('At most 20 open sessions are allowed');
  return metadata(result,{context:JSON.stringify({source:'unknown',...context}),updated_at:Date.now()});
 }
 async invoke(id, method, args=[], mutate=false) {
  for(let attempt=0;attempt<5;attempt++) {
   const row = await this.db.prepare('SELECT revision,state,closed,context,updated_at FROM mcp_sessions WHERE id=?').bind(id).first();
   if(!row || row.closed) throw new Error('Session not found or closed');
   const store=this.memory();store.sessions.set(id,decode(row.state));
   const result=store[method](id,...args);
   if(!mutate) return method==='record'?result:metadata(result,row);
   const state=encode(store._session(id));
   if(bytes(state)>900*1024) throw new Error('Session exceeds cloud storage limit');
   const saved=await this.db.prepare('UPDATE mcp_sessions SET state=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND closed=0').bind(state,Date.now(),id,row.revision).run();
   if(saved.meta.changes) return metadata(result,{...row,updated_at:Date.now()});
  }
  throw new Error('Concurrent session update conflict; retry request');
 }
 get(id,options) { return this.invoke(id,'get',[options]); }
 record(id) { return this.invoke(id,'record'); }
 configure(id,config) { return this.invoke(id,'configure',[config],true); }
 updateEvents(id,events) { return this.invoke(id,'updateEvents',[events],true); }
 complete(id,status) { return this.invoke(id,'complete',[status],true); }
 control(id,command) { return this.invoke(id,'control',[command],true); }
 async close(id) {
  const result=await this.db.prepare('UPDATE mcp_sessions SET closed=1,revision=revision+1,updated_at=? WHERE id=? AND closed=0').bind(Date.now(),id).run();
  if(!result.meta.changes) throw new Error('Session not found or closed');
  return {id,closed:true,retained:true};
 }
 async list() {
  const rows=await this.db.prepare('SELECT state,context,updated_at FROM mcp_sessions WHERE closed=0 ORDER BY updated_at DESC LIMIT 20').all();
  const store=this.memory(), byId=new Map();
  for(const row of rows.results) { const session=decode(row.state);store.sessions.set(session.id,session);byId.set(session.id,row); }
  return store.list().map(item=>metadata(item,byId.get(item.id)));
 }
}

function metadata(result,row) {
 const context=JSON.parse(row.context||'{"source":"unknown"}');
 const age=Math.max(0,Date.now()-row.updated_at);
 const connection_status=result.status==='live'?(age>=300000?'timed_out':age>=60000?'disconnected':'connected'):'inactive';
 return {...result,session_kind:result.source,source:context.source||'unknown',context,last_received_at:new Date(row.updated_at).toISOString(),connection_status};
}
