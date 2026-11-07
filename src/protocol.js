export class ValidationError extends Error { constructor(message='invalid_event') {super(message);this.name='ValidationError';} }
const kinds = new Set(['session_started','session_resumed','session_ended','prompt_submitted','waiting_confirmation','code_edit_started','code_edit_completed','command_started','command_completed','test_started','test_command_finished','model_request_completed','model_request_failed','model_request_cancelled','turn_stopped','turn_interrupted','task_started','task_completed','task_failed','task_cancelled','heartbeat']);
const statuses = new Set(['running','waiting','completed','failed','cancelled','stopped','ended','unknown']);
const keys=new Set(['version','event_id','source','project_id','run_id','event_type','status','timestamp','sequence','node_id','simulated']);
export const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function opaque(value,min=1,max=128){return typeof value==='string'&&value.length>=min&&value.length<=max&&/^[A-Za-z0-9_.:-]+$/.test(value);}
export function validateEvent(data){
 if(!isObject(data)||Object.keys(data).some(k=>!keys.has(k)))throw new ValidationError('unknown_fields');
 if(data.version!==1||!opaque(data.event_id,8)||!['windows','cloud'].includes(data.source)||!opaque(data.project_id)||!opaque(data.run_id)||!kinds.has(data.event_type)||!statuses.has(data.status))throw new ValidationError();
 if(typeof data.timestamp!=='string'||data.timestamp.length>30||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(data.timestamp)||!Number.isFinite(Date.parse(data.timestamp)))throw new ValidationError('invalid_timestamp');
 const normalized=data.timestamp.replace(/(?:\.(\d{1,3}))?Z$/,(_,ms)=>'.'+(ms??'').padEnd(3,'0')+'Z');
 if(new Date(data.timestamp).toISOString()!==normalized)throw new ValidationError('invalid_calendar_date');
 if(data.sequence!==undefined&&(!Number.isSafeInteger(data.sequence)||data.sequence<0))throw new ValidationError('invalid_sequence');
 if(data.node_id!==undefined&&!opaque(data.node_id))throw new ValidationError('invalid_node');
 if(data.simulated!==undefined&&typeof data.simulated!=='boolean')throw new ValidationError('invalid_simulated');
 const terminals={task_completed:'completed',task_failed:'failed',task_cancelled:'cancelled'};
 if(terminals[data.event_type]&&terminals[data.event_type]!==data.status)throw new ValidationError('inconsistent_terminal_status');
 return {...data,node_id:data.node_id??'default',simulated:data.simulated??false};
}
export function validateLegacy(data){
 if(!isObject(data)||Object.keys(data).some(k=>!['event','project'].includes(k)))throw new ValidationError('unknown_fields');
 if(typeof data.event!=='string'||typeof data.project!=='string'||data.event.length<1||data.event.length>128||data.project.length<1||data.project.length>160||/[\u0000-\u001f]/.test(data.event+data.project))throw new ValidationError('invalid_legacy');
 return {event:data.event,project:data.project};
}
export function canonicalEvent(data){const keys=Object.keys(data).sort();return JSON.stringify(Object.fromEntries(keys.map(k=>[k,data[k]])));}
