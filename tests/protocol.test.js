import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvent,validateLegacy,ValidationError} from '../src/protocol.js';
import {projectRun} from '../src/state.js';
const sample=(over={})=>({version:1,event_id:'event-00000001',source:'windows',project_id:'p-opaque',run_id:'r-opaque',event_type:'task_started',status:'running',timestamp:'2026-11-06T00:00:00.000Z',...over});
test('strict protocol privacy allowlist, types, bounded opaque identities and enums',()=>{
 assert.equal(validateEvent(sample()).source,'windows');
 for(const over of [{prompt:'secret'},{command:'echo'},{project_id:'/secret/path'},{source:'legacy'},{status:'success'},{timestamp:'tomorrow'},{timestamp:'2026-02-30T00:00:00Z'},{sequence:-1},{version:2},{simulated:'true'},{run_id:''},{event_type:'task_happy'}])assert.throws(()=>validateEvent(sample(over)),ValidationError);
 assert.deepEqual(validateLegacy({event:'ping',project:'original'}),{event:'ping',project:'original'});
 assert.throws(()=>validateLegacy({event:'ping',project:'original',token:'x'}));
});
test('projection distinguishes tool/model/turn/session/task and never infers success',()=>{
 let id=0;const e=(event_type,sequence,status='completed')=>({...sample({event_type,sequence,status}),id:++id,received_at:'2026-11-06T00:00:00.000Z'});
 const now=Date.parse('2026-11-06T00:00:01.000Z');
 for(const name of ['code_edit_completed','command_completed','test_command_finished','model_request_completed'])assert.equal(projectRun([e(name,1)],now).status,'running');
 assert.equal(projectRun([e('turn_stopped',2,'stopped')],now).status,'stopped');
 assert.equal(projectRun([e('session_ended',2,'ended')],now).status,'ended');
 assert.equal(projectRun([e('task_completed',3),e('test_started',2,'running')],now).status,'completed');
 assert.equal(projectRun([e('task_failed',3,'failed'),e('command_completed',4)],now).status,'failed');
});
test('out of order, liveness receipt time and never auto-success',()=>{
 const t='2026-11-06T00:00:00.000Z';
 const events=[{...sample({sequence:2,event_type:'waiting_confirmation',status:'waiting'}),id:1,received_at:t},{...sample({sequence:1}),id:2,received_at:t}];
 assert.equal(projectRun(events,Date.parse(t)+1000).status,'waiting');
 assert.equal(projectRun(events,Date.parse(t)+121000).status,'disconnected');
 assert.equal(projectRun(events,Date.parse(t)+901000).status,'timed_out');
 const badClock=[{...sample({timestamp:'2099-01-01T00:00:00.000Z'}),id:1,received_at:t}];
 assert.equal(projectRun(badClock,Date.parse(t)+901000).status,'timed_out');
});
