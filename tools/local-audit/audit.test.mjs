import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {audit,sanitizeRemote} from './audit.mjs';
test('remote credential/query/fragment removal',()=>{
 assert.equal(sanitizeRemote('https://name:PRIVATE_TOKEN@github.com/owner/repo.git?token=PRIVATE_QUERY#PRIVATE_FRAGMENT'),'https://github.com/owner/repo.git');
 assert.equal(sanitizeRemote('git@github.com:owner/repo.git'),'github.com:owner/repo.git');
 assert.equal(sanitizeRemote('file:///private/secret'),'[local filesystem remote]');
});
test('audits true metadata and modified source without changing files or dumping source',()=>{
 const root=mkdtempSync(join(tmpdir(),'spider-audit-'));
 try {
  const git=args=>{const r=spawnSync('git',['-C',root,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;};
  git(['init','-q']);git(['config','user.name','Audit Test']);git(['config','user.email','audit@example.invalid']);
  mkdirSync(join(root,'mcp'));writeFileSync(join(root,'mcp/server.mjs'),'// ORIGINAL_PRIVATE_SOURCE\n');git(['add','.']);git(['commit','-qm','fixture']);git(['remote','add','origin','https://name:PRIVATE_TOKEN@github.com/owner/repo.git?token=PRIVATE_QUERY']);
  writeFileSync(join(root,'mcp/server.mjs'),'// MODIFIED_PRIVATE_SOURCE\n');writeFileSync(join(root,'.env'),'PRIVATE_ENV_VALUE');
  const before=readFileSync(join(root,'.git/index'));const head=git(['rev-parse','HEAD']).trim();const result=audit(root);
  assert.equal(result.head,head);assert.equal(result.worktree_clean,false);assert.ok(result.changes.find(x=>x.path==='mcp/server.mjs'));
  const text=JSON.stringify(result);for(const secret of ['PRIVATE_TOKEN','PRIVATE_QUERY','PRIVATE_ENV_VALUE','MODIFIED_PRIVATE_SOURCE','ORIGINAL_PRIVATE_SOURCE'])assert.ok(!text.includes(secret));
  assert.deepEqual(readFileSync(join(root,'.git/index')),before);assert.equal(readFileSync(join(root,'mcp/server.mjs'),'utf8'),'// MODIFIED_PRIVATE_SOURCE\n');assert.equal(git(['rev-parse','HEAD']).trim(),head);
  assert.throws(()=>audit(join(root,'mcp')),/not its actual Git root/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('ZIP checkout honestly reports unavailable Git metadata and hashes only allowed source',()=>{
 const root=mkdtempSync(join(tmpdir(),'spider-no-git-'));
 try {
  mkdirSync(join(root,'mcp'));writeFileSync(join(root,'mcp/server.mjs'),'// SOURCE_ONLY\n');writeFileSync(join(root,'mcp/secrets.json'),'{"token":"PRIVATE_FILE_VALUE"}');
  const result=audit(root);assert.equal(result.is_git_checkout,false);assert.equal(result.head,null);assert.equal(result.branch,null);assert.equal(result.worktree_clean,null);assert.ok(result.source_files.find(x=>x.path==='mcp/server.mjs'));assert.ok(!result.source_files.find(x=>x.path==='mcp/secrets.json'));assert.ok(!JSON.stringify(result).includes('PRIVATE_FILE_VALUE'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
