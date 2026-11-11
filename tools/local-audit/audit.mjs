#!/usr/bin/env node
// Read-only local checkout audit. No network, install, fetch, patch, or source-content output.
import {spawnSync} from 'node:child_process';
import {realpathSync,existsSync,readFileSync,lstatSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function sanitizeRemote(raw) {
 try {
  const value=new URL(raw);
  if(['http:','https:','ssh:','git:'].includes(value.protocol))return `${value.protocol}//${value.hostname}${value.port?':'+value.port:''}${value.pathname}`;
  if(value.protocol==='file:')return '[local filesystem remote]';
 } catch {}
 const scp=/^(?:[^@\s]+@)?([A-Za-z0-9.-]+):([^\s?#]+)(?:[?#].*)?$/.exec(raw);
 return scp?`${scp[1]}:${scp[2]}`:'[unrecognized remote; value omitted]';
}
export function audit(directory) {
 const root=realpathSync(resolve(directory));
 function git(args,optional=false) {
  const r=spawnSync('git',['--no-optional-locks','-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'},maxBuffer:8*1024*1024});
  if(r.error&&r.status!==0)throw new Error('Git execution unavailable');
  if(r.status!==0&&!optional)throw new Error('Read-only Git command failed: '+args[0]);
  return {ok:r.status===0,text:r.stdout||''};
 }
 const top=git(['rev-parse','--show-toplevel']).text.trim();
 if(realpathSync(top)!==root)throw new Error('Requested directory is not its actual Git root');
 const head=git(['rev-parse','--verify','HEAD^{commit}']).text.trim();
 if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head))throw new Error('Invalid or unavailable full Git commit');
 const branch=git(['symbolic-ref','--quiet','--short','HEAD'],true);
 const remotes=git(['remote']).text.trim().split(/\r?\n/).filter(Boolean).map(name=>({name,fetch_urls:git(['config','--get-all',`remote.${name}.url`],true).text.trim().split(/\r?\n/).filter(Boolean).map(sanitizeRemote)}));
 const rawStatus=git(['status','--porcelain=v1','-z','--untracked-files=all']).text.split('\0');
 const changes=[];
 for(let i=0;i<rawStatus.length;i++) {
  const line=rawStatus[i];if(!line)continue;
  const entry={status:line.slice(0,2),path:line.slice(3)};
  if(/[RC]/.test(entry.status)){entry.previous_path=rawStatus[++i];}
  changes.push(entry);
 }
 const paths=git(['ls-files','-z','--','app','lib','mcp','server.mjs','package.json','LICENSE']).text.split('\0').filter(Boolean);
 const source=[];
 for(const name of paths) {
  if(name.split('/').some(p=>['node_modules','.git','exports'].includes(p))||! /\.(?:m?js|json|html|css|svg)$/.test(name)&&name!=='LICENSE')continue;
  const file=join(root,name),rel=relative(root,file);
  if(rel.startsWith('..')||isAbsolute(rel)||!existsSync(file)||lstatSync(file).isSymbolicLink()||!lstatSync(file).isFile())continue;
  const data=readFileSync(file);
  const original=git(['rev-parse',`HEAD:${name}`],true);
  source.push({path:name,bytes:data.length,working_sha256:createHash('sha256').update(data).digest('hex'),head_blob:original.ok?original.text.trim():null});
 }
 return {format:'prompt-spider-local-baseline/v1',root,head,branch:branch.ok?branch.text.trim():null,detached:!branch.ok,remotes,worktree_clean:changes.length===0,changes,diff_stat:git(['diff','--no-ext-diff','--no-textconv','--stat','HEAD','--','app','lib','mcp','server.mjs','package.json'],true).text.trim(),source_files:source,limitations:['No ChatGPT Desktop version or platform lifecycle hooks are inferred.','No source text, environment variables, prompts, histories or export data are included.','Working hashes use raw bytes; line-ending differences do not prove logic changes.','This audit does not install or modify Prompt Spider.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {if(process.argv.length!==3)throw new Error('Usage: node audit.mjs D:\\prompt-spider-ui');console.log(JSON.stringify(audit(process.argv[2]),null,2));}
 catch(error){console.error('Audit stopped:',error.message);process.exitCode=1;}
}
