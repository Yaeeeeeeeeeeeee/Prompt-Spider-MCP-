import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('cloud',Path(__file__).with_name('cloud.py'))
cloud=importlib.util.module_from_spec(spec);spec.loader.exec_module(cloud)
class Guards(unittest.TestCase):
 def test_actual_migrations_additive(self):
  for name in cloud.MIGRATIONS: cloud.additive((cloud.ROOT/'migrations'/name).read_text())
 def test_destructive_rejected(self):
  for sql in ['DROP TABLE events;', 'DELETE FROM events;', 'CREATE TABLE x(id);']:
   with self.assertRaises(ValueError): cloud.additive(sql)
 def test_independent_token(self):
  with patch.dict(os.environ,{'MCP_AUTH_TOKEN':'same','SPIDER_READ_TOKEN':'same'},clear=True):
   with self.assertRaises(ValueError): cloud.credentials()
 def test_worker_backup_uses_supported_source_download_route(self):
  import tempfile
  calls=[]
  class StopAfterSource(Exception): pass
  def request(path,*args,**kwargs):
   calls.append(path)
   raise StopAfterSource()
  with tempfile.TemporaryDirectory() as directory:
   target=Path(directory)/'private'
   with patch.object(cloud,'identity',return_value=('a','b','prompt-spider-mcp')), patch.object(cloud,'check_schema',return_value=[]), patch.object(cloud,'api',side_effect=request):
    with self.assertRaises(StopAfterSource): cloud.backup(target)
  self.assertEqual(calls[0],'/accounts/a/workers/scripts/prompt-spider-api/content/v2')
 def test_short_new_credentials_rejected(self):
  with patch.dict(os.environ,{'MCP_AUTH_TOKEN':'short','SPIDER_READ_TOKEN':'r'*32},clear=True):
   with self.assertRaises(ValueError): cloud.credentials()
 def test_old_worker_rejected(self):
  with patch.dict(os.environ,{'CLOUDFLARE_ACCOUNT_ID':'a'*32,'SPIDER_D1_DATABASE_ID':'00000000-0000-4000-8000-000000000001','SPIDER_WORKER_NAME':'prompt-spider-api','SPIDER_D1_DATABASE_NAME':'prompt-spider-db'},clear=True):
   with self.assertRaises(ValueError): cloud.identity()
 def test_backup_tamper_rejected(self):
  import tempfile
  with tempfile.TemporaryDirectory() as directory:
   os.chmod(directory,0o700)
   cloud.save(Path(directory),'manifest.json',{'account':'a','database':'b','worker':'c','files':{}})
   with patch.object(cloud,'identity',return_value=('a','b','c')):
    with self.assertRaises(ValueError): cloud.validate_backup(directory)
 def test_restore_verifies_records_and_integrity(self):
  sql="CREATE TABLE events(request_id TEXT,event TEXT,project TEXT,received_at TEXT); INSERT INTO events VALUES ('a','start','old','2026');"
  expected=cloud.row_fingerprint([{'request_id':'a','event':'start','project':'old','received_at':'2026'}])
  result=cloud.validate_export(sql,expected)
  self.assertEqual(result['integrity'],['ok'])
  self.assertEqual(result['schema'][0]['name'],'events')
  with self.assertRaises(ValueError): cloud.validate_export(sql,cloud.row_fingerprint([]))
 def test_restore_blocks_host_filesystem(self):
  expected=cloud.row_fingerprint([])
  for attack in ["ATTACH DATABASE '/tmp/spider-forbidden.sqlite' AS host;", "VACUUM INTO '/tmp/spider-forbidden.sqlite';", "SELECT load_extension('anything');", "SELECT writefile('/tmp/spider-forbidden','bad');", "PRAGMA temp_store_directory='/tmp';"]:
   with self.assertRaises(ValueError): cloud.validate_export(attack,expected)
  self.assertFalse(Path('/tmp/spider-forbidden.sqlite').exists())
 def test_credentials_require_reader_and_pair_sources(self):
  with patch.dict(os.environ,{'MCP_AUTH_TOKEN':'mcp'},clear=True):
   with self.assertRaises(ValueError): cloud.credentials()
  with patch.dict(os.environ,{'MCP_AUTH_TOKEN':'mcp','SPIDER_READ_TOKEN':'read','SPIDER_WINDOWS_TOKEN':'windows'},clear=True):
   with self.assertRaises(ValueError): cloud.credentials()
  with patch.dict(os.environ,{'MCP_AUTH_TOKEN':'m'*32,'SPIDER_READ_TOKEN':'r'*32,'SPIDER_INGEST_TOKEN':'legacy'},clear=True):
   self.assertNotIn('SPIDER_INGEST_TOKEN',cloud.credentials())
 def test_verification_failure_stops_before_remote_queries(self):
  manifest={'history':{},'files':{}}
  with patch.object(cloud,'credentials'),patch.object(cloud,'validate_backup',return_value=manifest),patch.object(cloud,'verification',side_effect=RuntimeError('failed')),patch.object(cloud,'query') as query:
   with self.assertRaises(RuntimeError): cloud.deploy('/private')
   query.assert_not_called()
 def test_first_rollback_requires_explicit_disable(self):
  import tempfile
  with tempfile.TemporaryDirectory() as directory:
   Path(directory,'mcp-deployments.json').write_text('{"deployments":[]}')
   with patch.object(cloud,'validate_backup'),patch.object(cloud,'identity',return_value=('a','b','prompt-spider-mcp')),patch.object(cloud,'api') as api:
    with self.assertRaises(ValueError): cloud.rollback(directory)
    api.assert_not_called()
 def test_schema_accepts_first_install_and_repeated_migrations(self):
  import sqlite3
  connection=sqlite3.connect(':memory:')
  connection.row_factory=sqlite3.Row
  connection.execute('CREATE TABLE events(request_id TEXT,event TEXT,project TEXT,received_at TEXT)')
  def inspect():
   return [dict(row) for row in connection.execute("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")]
  def read(sql): return [dict(row) for row in connection.execute(sql)]
  cloud.check_schema(inspect(),read)
  for _ in range(2):
   for name in cloud.MIGRATIONS: connection.executescript((cloud.ROOT/'migrations'/name).read_text())
   cloud.check_schema(inspect(),read)
  connection.close()
 def test_schema_rejects_generic_table_collision(self):
  expected=cloud.expected_tables()
  legacy=[{'name':name} for name in ('request_id','event','project','received_at')]
  objects=[{'type':'table','name':'events'},{'type':'table','name':'mcp_sessions'}]
  def read(sql): return legacy if '"events"' in sql else [dict(expected['mcp_sessions'][0],type='INTEGER')]
  with self.assertRaises(ValueError): cloud.check_schema(objects,read)
  objects[1]['type']='view'
  with self.assertRaises(ValueError): cloud.check_schema(objects,read)
 def test_schema_rejects_missing_legacy_columns(self):
  with self.assertRaises(ValueError): cloud.check_schema([{'type':'table','name':'events'}],lambda sql:[{'name':'event'}])
if __name__=='__main__': unittest.main()
