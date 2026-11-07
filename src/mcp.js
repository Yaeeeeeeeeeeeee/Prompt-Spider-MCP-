import { PROJECT_FILES } from './project-files.js';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { DEFAULT_CONFIG, normalizeConfig } from '../vendor/prompt-spider-ui/lib/config.js';
import { DurableSessionStore } from './mcp-store.js';
const route = z.enum(['code', 'model', 'you']);
const terminal = z.enum(['completed', 'failed', 'cancelled']);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const routeConfig = z.object({ label: z.string().min(1).max(40).optional(), color: color.optional() }).strict();
const config = z.object({
  title: z.string().min(1).max(80).optional(), subtitle: z.string().max(160).optional(), modelName: z.string().min(1).max(80).optional(),
  layout: z.enum(['portrait', 'landscape', 'square']).optional(), unit: z.enum(['task', 'word']).optional(), prompt: z.string().max(12000).optional(),
  expectedTotal: z.number().int().min(0).max(10000).nullable().optional(),
  routes: z.object({ code: routeConfig.optional(), model: routeConfig.optional(), you: routeConfig.optional() }).strict().optional(),
  theme: z.object(Object.fromEntries(Object.keys(DEFAULT_CONFIG.theme).map(key => [key, color.optional()]))).strict().optional()
}).strict();
const event = z.object({
  id: z.string().min(1).max(120).describe('Stable task ID. Reuse it to update a task without increasing counts.'),
  label: z.string().min(1).max(200).optional().describe('Required for a new ID.'), route: route.optional().describe('Required for a new ID: deterministic code, model work, or human action.'),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(), score: z.number().min(0).max(1).nullable().optional(),
  detail: z.string().max(4000).optional(), tokenIndex: z.number().int().min(0).nullable().optional().describe('Required zero-based whitespace token index for word mode.'),
  occurredAt: z.string().max(120).nullable().optional()
}).strict();
const command = z.object({
  action: z.enum(['play', 'pause', 'seek', 'restart', 'follow_live']).optional(), position: z.number().min(0).optional(), speed: z.number().min(0.5).max(4).optional(),
  loop: z.boolean().optional(), routeFilter: z.enum(['all', 'code', 'model', 'you']).optional(), page: z.number().int().min(0).optional()
}).strict();
const sessionId = z.string().uuid().describe('id returned by spider_create_session or spider_import_session');
const object = fields => z.object(fields).strict();
const resultSchema = z.record(z.string(), z.unknown());
const guide = `Remote Prompt Spider MCP uses authenticated HTTPS Streamable HTTP at /mcp. Sessions persist in D1, independently of transport initialization. All 11 upstream tool names are retained. Default privacy replaces event and context IDs, export filenames and project names with SHA-256 opaque identifiers, labels with task numbers, rejects prompt/detail/occurredAt and custom text configuration. Set MCP_ALLOW_PUBLIC_LABELS=true only for explicitly public-safe labels and configuration. Never send credentials, commands, code, or private reasoning. Export returns an authenticated artifact download URL without credentials, not a disk path. Import accepts records or previously returned artifact filenames. Project export returns a portable project file map JSON, not a directory. Close hides a session and retains its stored data. Cloud limits: 20 open sessions, 1000 events, 700 KiB history, 900 KiB serialized session. Unfinished imported sessions are frozen replays. Playback positions are seconds. Read spider://replay-format for details.`;
export function createMcpServer(runtime) {
  const { store, hub, exporter, projectConfig } = runtime;
  const server = new McpServer({ name: 'prompt-spider-ui', version: '1.1.0' });
  function tool(name, description, inputSchema, handler, { readOnlyHint = false, destructiveHint = false, idempotentHint = false } = {}) {
    server.registerTool(name, { description, inputSchema, outputSchema: resultSchema, annotations: { readOnlyHint, destructiveHint, idempotentHint, openWorldHint: false } }, async args => {
      try {
        const data = await handler(await privacyArgs(name, args, runtime.env));
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (error) { return { isError: true, content: [{ type: 'text', text: safeToolError(error) }] }; }
    });
  }
  const preview = result => ({ ...result, previewUrl: hub.previewUrl(result.id) });
  tool('spider_create_session', 'Create a durable task visualization and return its previewUrl. Open the URL manually. UI does not automatically instrument your Agent.', object({ config: config.optional(), context: z.object({ source: z.enum(['windows','cloud']).optional(), project_id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(), run_id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(), node_id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(), simulated: z.boolean().optional() }).strict().optional() }), async args => {
    await hub.start();
    return preview(await store.create(normalizeConfig(args.config || {}, normalizeConfig(projectConfig)), args.context));
  });
  tool('spider_get_session', 'Get current session metadata and a page of latest events; no full history. Use offset and limit for large sessions.', object({ sessionId, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200).optional() }), async args => preview(await store.get(args.sessionId, { offset: args.offset, limit: args.limit })), { readOnlyHint: true, idempotentHint: true });
  tool('spider_list_sessions', 'List open sessions with summary counts, configuration and playback state; no event histories.', object({}), async () => ({ sessions: (await store.list()).map(preview) }), { readOnlyHint: true, idempotentHint: true });
  tool('spider_close_session', 'Soft-close a durable session, hiding it while retaining its stored data.', object({ sessionId }), args => store.close(args.sessionId), { destructiveHint: true });
  tool('spider_update_events', 'Report 1–100 real task events. A new ID needs label and route. Reusing an ID updates it without double counting. Missing score stays unknown.', object({ sessionId, events: z.array(event).min(1).max(100) }), args => store.updateEvents(args.sessionId, args.events), { idempotentHint: true });
  tool('spider_complete_session', 'Mark a live session completed, failed or cancelled. Freeze duration and keep history for export or looping replay; this does not close it.', object({ sessionId, status: terminal.optional() }), args => store.complete(args.sessionId, args.status), { idempotentHint: true });
  tool('spider_configure_session', 'Merge title, modelName, route labels/colors, theme or portrait/landscape/square layout. Prompt and unit cannot change after events arrive.', object({ sessionId, config }), args => store.configure(args.sessionId, args.config), { idempotentHint: true });
  tool('spider_control_playback', 'Play, pause, seek in seconds, restart or follow_live. Ingestion continues while paused. Looping needs a completed or imported session.', object({ sessionId, command }), args => store.control(args.sessionId, args.command));
  tool('spider_export_session', 'Create an authenticated portable replay download artifact. No filesystem paths or bearer tokens appear in the URL.', object({ sessionId, filename: z.string().optional() }), async args => {
    const saved = await exporter.exportSession(await store.record(args.sessionId), args.filename);
    return saved;
  });
  tool('spider_import_session', 'Restore a portable record or a .json filename from the export root into a new read-only replay session. Supply exactly one of record or filename.', object({ record: z.record(z.string(), z.unknown()).optional(), filename: z.string().optional() }), async args => {
    if (Number(args.record !== undefined) + Number(args.filename !== undefined) !== 1) throw new Error('Supply exactly one of record or filename');
    const record = args.record ?? await exporter.importSession(args.filename);
    const restored = await store.importRecord(record);
    await hub.start();
    return preview(await store.get(restored.id));
  });
  tool('spider_export_project', 'Export an editable project as a portable JSON file map artifact. includeMcp defaults true; includeReplay defaults false and requires sessionId. No credentials are copied.', object({ sessionId: sessionId.optional(), name: z.string().min(1).max(100), config: config.optional(), includeMcp: z.boolean().optional(), includeReplay: z.boolean().optional() }), async args => {
    const record = args.sessionId ? await store.record(args.sessionId) : undefined;
    const merged = normalizeConfig(args.config || {}, record?.config || normalizeConfig(projectConfig));
    return exporter.exportProject({ name: args.name, config: merged, record, includeMcp: args.includeMcp ?? true, includeReplay: args.includeReplay ?? false });
  });
  const resource = (name, uri, mimeType, text) => server.registerResource(name, uri, { mimeType, description: name }, async url => ({ contents: [{ uri: url.href, mimeType, text }] }));
  resource('Agent integration guide', 'spider://guide', 'text/markdown', guide);
  resource('Configuration defaults and schema', 'spider://config', 'application/json', JSON.stringify({ defaults: DEFAULT_CONFIG, schema: z.toJSONSchema(config) }, null, 2));
  resource('Portable replay format', 'spider://replay-format', 'text/markdown', '# prompt-spider-session/v1\n\nversion: 1; id; createdAt; initialConfig; config; status (live/completed/failed/cancelled); duration (relative seconds); revision; events (latest normalized events); log (monotonic revision/at/type, full events or config or completion status); counts; statusCounts; playback. Logs preserve event and theme/config updates. Import validates and rebuilds aggregates instead of trusting them. Control positions are seconds. An unfinished saved live session imports as a frozen read-only replay. No preview token or local paths are part of this format.\n');
  server.registerPrompt('spider_report_task', { description: 'Guide an Agent to visualize a real task with stable IDs and honest progress.', argsSchema: object({ task: z.string().min(1).max(4000) }) }, ({ task }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Visualize this task with Prompt Spider UI: ${task}\nCreate a session, return its previewUrl, then report public-safe task steps with stable IDs through spider_update_events. Use code for deterministic tool or rule work, model for model work, you for human action. Report only steps you actually perform, never invent scores or totals. Do not report secrets or private reasoning. Update existing IDs for progress, complete the session at the end, and offer replay or independent project export if requested. Read spider://guide before using unfamiliar tools.` } }] }));
  return server;
}



const encoder = new TextEncoder();
async function opaque(value) {
 const digest=await crypto.subtle.digest('SHA-256',encoder.encode(value));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function checkConfig(config, allow) {
 if(!config) return;
 if(config.prompt) throw new Error('Prompt text is disabled in the cloud service');
 if(config.unit==='word') throw new Error('Word mode requires prompt text and is disabled in the cloud service');
 if(!allow && (['title','subtitle','modelName'].some(key=>key in config) || Object.values(config.routes||{}).some(route=>'label' in route))) throw new Error('Custom text requires MCP_ALLOW_PUBLIC_LABELS=true');
}
async function privacyArgs(name, input, env) {
 const args=structuredClone(input), allow=env.MCP_ALLOW_PUBLIC_LABELS==='true';
 checkConfig(args.config,allow);
 if(!allow && args.context) for(const key of ['project_id','run_id','node_id']) {
  if(args.context[key]!==undefined) args.context[key]=await opaque(args.context[key]);
 }
 if(!allow && name==='spider_export_session' && args.filename!==undefined) args.filename=await opaque(args.filename)+'.json';
 if(!allow && name==='spider_export_project') args.name=/^[a-f0-9]{64}$/.test(args.name)?args.name:await opaque(args.name);
 if(args.events) args.events=await Promise.all(args.events.map(async (event,index)=>{
  if(event.detail || event.occurredAt) throw new Error('Event detail and occurredAt text are disabled in the cloud service');
  if(!allow) { event.id=await opaque(event.id); if(event.label!==undefined) event.label='Task '+event.id.slice(0,12); }
  return event;
 }));
 if(args.record) {
  // Import validates the original replay before privacy normalization. Reject arbitrary
  // strings rather than changing historical records and invalidating replay invariants.
  const text=JSON.stringify(args.record);
  if(encoder.encode(text).length>900*1024) throw new Error('Import exceeds cloud storage limit');
  function safeConfig(config) {
   checkConfig(config,true);
   if(!allow) {
    for(const key of ['title','subtitle','modelName']) if(config?.[key]!==DEFAULT_CONFIG[key]) throw new Error('Imported configuration contains custom text');
    for(const key of ['code','model','you']) if(config?.routes?.[key]?.label!==DEFAULT_CONFIG.routes[key].label) throw new Error('Imported route contains custom text');
   }
  }
  function safeEvents(events) {
   for(const event of events||[]) {
    if(event.detail || event.occurredAt) throw new Error('Imported detail and timestamps are disabled');
    if(!allow && (!/^[a-f0-9]{64}$/.test(event.id)||event.label!=='Task '+event.id.slice(0,12))) throw new Error('Default import accepts only cloud-redacted task identifiers and labels');
   }
  }
  safeConfig(args.record.config);safeConfig(args.record.initialConfig);safeEvents(args.record.events);
  if(!z.string().uuid().safeParse(args.record.id).success) throw new Error('Imported recording requires an opaque UUID');
  if(args.record.events?.some(event=>event.detail || event.occurredAt)) throw new Error('Imported event detail and timestamps are disabled');
  for(const entry of args.record.log||[]) {
   if(entry.config) safeConfig(entry.config);safeEvents(entry.events);
   if(entry.events?.some(event=>event.detail || event.occurredAt)) throw new Error('Imported history contains disabled detail or timestamps');
  }
 }
 return args;
}
function filename(value, fallback) {
 const name=value||fallback;
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\.json$/.test(name)) throw new Error('filename must be a simple .json basename');
 return name;
}
function runtime(env,origin) {
 const store=new DurableSessionStore(env.DB);
 async function save(body,name) {
  const text=JSON.stringify(body);
  if(encoder.encode(text).length>900*1024) throw new Error('Artifact exceeds 900 KiB cloud limit');
  const existing=await env.DB.prepare('SELECT id FROM mcp_artifacts WHERE filename=?').bind(name).first();
  if(existing) throw new Error('Artifact filename already exists; choose another filename');
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO mcp_artifacts (id,filename,body,created_at) VALUES (?,?,?,?)').bind(id,name,text,Date.now()).run();
  return {artifactId:id,filename:name,downloadUrl:origin+'/mcp/artifacts/'+id,authentication:'Authorization: Bearer <MCP_AUTH_TOKEN>',bytes:encoder.encode(text).length};
 }
 const exporter={
  async exportSession(record,name) { return {...await save(record,filename(name,(env.MCP_ALLOW_PUBLIC_LABELS==='true'?record.id:await opaque(record.id))+'.json')),eventCount:record.events.length,format:record.format}; },
  async importSession(name) {
   filename(name,'invalid');
   const row=await env.DB.prepare('SELECT body FROM mcp_artifacts WHERE filename=? ORDER BY created_at DESC LIMIT 1').bind(name).first();
   if(!row) throw new Error('Export artifact not found');
   const record=JSON.parse(row.body);
   await privacyArgs('spider_import_session',{record},env);
   return record;
  },
  async exportProject({name,config,record,includeMcp,includeReplay}) {
   if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) throw new Error('Project name must be a simple safe basename');
   if(includeReplay&&!record) throw new Error('includeReplay requires sessionId');
   const files=Object.fromEntries(Object.entries(PROJECT_FILES).filter(([path])=>includeMcp||!path.startsWith('mcp/')));
   files['project-config.json']=JSON.stringify({...config,...(includeReplay?{replayFile:'recording.json'}:{})},null,2);
   if(includeReplay) files['recording.json']=JSON.stringify(record);
   const artifact={format:'prompt-spider-project-files/v1',name,files};
   return {...await save(artifact,name+'.json'),format:artifact.format,includeMcp,includeReplay,instructions:'Unpack the files map under a new directory, preserving relative paths, then run node server.mjs. Install MCP dependencies separately if included.'};
  }
 };
 return {env,store,exporter,projectConfig:{},hub:{start:async()=>{},previewUrl:id=>origin+'/?session='+encodeURIComponent(id)}};
}
export async function listMcpSessions(env) { return new DurableSessionStore(env.DB).list(); }
export async function handleMcp(request,env,{authenticated=false}={}) {
 // Defense in depth: the Worker also authenticates and rate limits this route.
 if(!authenticated && (!env.MCP_AUTH_TOKEN || request.headers.get('authorization')!=='Bearer '+env.MCP_AUTH_TOKEN)) return new Response('Unauthorized',{status:401});
 const url=new URL(request.url);
 if(url.pathname.startsWith('/mcp/artifacts/')) {
  if(request.method!=='GET') return new Response('Method not allowed',{status:405});
  const id=url.pathname.slice('/mcp/artifacts/'.length);
  const row=await env.DB.prepare('SELECT filename,body FROM mcp_artifacts WHERE id=?').bind(id).first();
  if(!row) return new Response('Not found',{status:404});
  return new Response(row.body,{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="'+row.filename+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 const server=createMcpServer(runtime(env,url.origin));
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 await server.connect(transport);
 return transport.handleRequest(request);
}

function safeToolError(error) {
 const safe = new Set([
  'Session not found or closed', 'Session exceeds cloud storage limit',
  'At most 20 open sessions are allowed', 'Concurrent session update conflict; retry request',
  'Prompt text is disabled in the cloud service', 'Word mode requires prompt text and is disabled in the cloud service',
  'Custom text requires MCP_ALLOW_PUBLIC_LABELS=true', 'Event detail and occurredAt text are disabled in the cloud service',
  'Import exceeds cloud storage limit', 'Imported configuration contains custom text', 'Imported route contains custom text',
  'Imported detail and timestamps are disabled', 'Default import accepts only cloud-redacted task identifiers and labels',
  'Imported recording requires an opaque UUID', 'Imported event detail and timestamps are disabled',
  'Imported history contains disabled detail or timestamps', 'filename must be a simple .json basename',
  'Artifact exceeds 900 KiB cloud limit', 'Artifact filename already exists; choose another filename',
  'Export artifact not found', 'Project name must be a simple safe basename', 'includeReplay requires sessionId',
  'Supply exactly one of record or filename',
  'This session is a completed or imported replay; create a new live session to report events.',
  'Prompt and data unit cannot change after events arrive. Create another session.',
  'Session is already completed.', 'seek needs position in seconds.',
  'Loop playback is available after a session completes.', 'An imported replay has no live producer.'
 ]);
 return safe.has(error?.message) ? error.message : 'Tool operation failed. Check the input and service limits, then retry.';
}
