const taskTerminal={task_completed:'completed',task_failed:'failed',task_cancelled:'cancelled'};
export function projectRun(events, now=Date.now(), {disconnected=120,timeout=900}={}){
 if(!events.length)return null;
 // Sequences are authoritative only if every event has one; mixed clients use server order.
 const sequenced=events.every(e=>Number.isSafeInteger(e.sequence));
 const ordered=[...events].sort((a,b)=>sequenced?(a.sequence-b.sequence||a.id-b.id):(a.id-b.id));
 const latest=ordered.at(-1);
 const terminal=ordered.filter(e=>taskTerminal[e.event_type]).at(-1);
 const ended=ordered.some(e=>e.event_type==='session_ended');
 const received=events.map(e=>Date.parse(e.received_at)).filter(Number.isFinite);
 const last=Math.max(...received);
 let status=terminal?taskTerminal[terminal.event_type]:ended?'ended':latest.event_type==='waiting_confirmation'?'waiting':['turn_stopped','turn_interrupted'].includes(latest.event_type)?'stopped':'running';
 const age=Math.max(0,(now-last)/1000);
 if(!terminal&&!ended){if(age>timeout)status='timed_out';else if(age>disconnected)status='disconnected';}
 return {source:latest.source,project_id:latest.project_id,run_id:latest.run_id,node_id:latest.node_id??'default',status,last_activity:new Date(last).toISOString(),events_count:events.length,simulated:events.some(e=>Boolean(e.simulated))};
}
