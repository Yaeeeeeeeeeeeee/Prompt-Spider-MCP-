import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('deployment guards reject unsafe targets, credentials, migrations and incomplete backups',()=>{
 const result=spawnSync('python3',['scripts/test_cloud.py'],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const count=/Ran (\d+) tests/.exec(result.stderr);
 assert.ok(count && Number(count[1])>=14, 'Expected all deployment guard tests to execute');
});
