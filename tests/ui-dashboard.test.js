import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { identity,filterItems,activityFrame,replayFrame } from '../web/app.js';
import { SessionStore } from '../vendor/prompt-spider-ui/lib/session-store.js';

test('dashboard distinguishes run source and project identities',()=>{
 assert.notEqual(identity({source:'cloud',project_id:'p',run_id:'r'}),identity({source:'windows',project_id:'p',run_id:'r'}));
 assert.notEqual(identity({source:'cloud',project_id:'p',run_id:'r'}),identity({source:'cloud',project_id:'q',run_id:'r'}));
 assert.equal(identity({id:'abc'}),'mcp:abc');
});
test('dashboard filters MCP context metadata and V1 run metadata without mixing sources',()=>{
 const items=[{id:'a',source:'cloud',context:{project_id:'p',node_id:'n'}},{source:'windows',project_id:'p',node_id:'n',run_id:'r'}];
 assert.deepEqual(filterItems(items,{source:'cloud',project:'p',node:'n'}),[items[0]]);
 assert.deepEqual(filterItems(items,{node:'missing'}),[]);
 assert.equal(filterItems(items,{}).length,2);
});
test('animation follows live recorded state and freezes offline, stale, waiting or complete',()=>{
 assert.ok(activityFrame({status:'live'},[{status:'running'}]).speed>0);
 for(const status of ['completed','failed','waiting','unknown','cancelled'])assert.equal(activityFrame({status}).speed,0);
 assert.equal(activityFrame({status:'live',connection_status:'disconnected'}).speed,0);
 assert.equal(activityFrame({status:'live'},[],false).speed,0);
 assert.equal(activityFrame(null).speed,0);
});
test('historical replay reconstructs updates and completion, including backward seek',()=>{
 let now=0;const store=new SessionStore({now:()=>now});const session=store.create({});
 now=1;store.updateEvents(session.id,[{id:'task',label:'Task',route:'code',status:'running'}]);
 now=2;store.updateEvents(session.id,[{id:'task',label:'Task',route:'code',status:'completed'}]);
 now=3;store.complete(session.id,'completed');const record=store.record(session.id);
 assert.equal(replayFrame(record,0).events.length,0);
 assert.equal(replayFrame(record,1).events[0].status,'running');
 assert.equal(replayFrame(record,2).events[0].status,'completed');
 assert.equal(replayFrame(record,2).status,'live');
 assert.equal(replayFrame(record,3).status,'completed');
 assert.equal(replayFrame(record,1).events[0].status,'running');
});
test('dashboard credentials use headers and memory; rendering avoids HTML injection and inline assets',async()=>{
 const script=await readFile(new URL('../web/app.js',import.meta.url),'utf8');const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
 assert.doesNotMatch(script,/localStorage|sessionStorage|innerHTML|insertAdjacentHTML|document\.write/);
 assert.match(script,/Authorization:`Bearer \$\{token\}`/);assert.match(script,/token=''/);
 assert.doesNotMatch(html,/\son\w+=|\sstyle=/);assert.match(html,/type="password"/);
 assert.match(script,/response.status===401\|\|response.status===403/);
 assert.match(script,/error.status!==404/);
});
