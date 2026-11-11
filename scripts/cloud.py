#!/usr/bin/env python3
"""Private Cloudflare backup and guarded deployment. Credentials only from environment."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
import urllib.error
import uuid

ROOT = Path(__file__).resolve().parents[1]
API = 'https://api.cloudflare.com/client/v4'
SECRETS = ('MCP_AUTH_TOKEN', 'SPIDER_READ_TOKEN')
MIGRATIONS = ('0001_v1.sql', '0002_mcp.sql', '0003_oauth.sql')


def require_env(name):
    value = os.environ.get(name, '')
    if not value:
        raise ValueError('Missing environment variable: ' + name)
    return value


def credentials():
    values = {key: require_env(key) for key in SECRETS}
    other = [value for key, value in os.environ.items() if key.startswith('SPIDER_') and key.endswith('_TOKEN') and value]
    all_tokens = list(values.values()) + [value for key, value in os.environ.items() if key.startswith('SPIDER_') and key.endswith('_TOKEN') and key not in values and value]
    if len(set(all_tokens)) != len(all_tokens):
        raise ValueError('All MCP, reader, source and legacy credentials must be independent')
    sources = ('SPIDER_WINDOWS_TOKEN', 'SPIDER_CLOUD_TOKEN')
    if any(os.environ.get(key) for key in sources):
        values.update({key: require_env(key) for key in sources})
    if any(len(value) < 32 for value in values.values()):
        raise ValueError('New MCP, reader and source credentials must contain at least 32 characters')
    approval = os.environ.get('MCP_OAUTH_APPROVAL_TOKEN')
    if approval:
        from urllib.parse import urlsplit
        origin = require_env('MCP_OAUTH_ORIGIN')
        parsed = urlsplit(origin)
        redirects = json.loads(require_env('MCP_OAUTH_REDIRECT_URIS'))
        if len(approval) < 32 or approval in [*values.values(), *other]:
            raise ValueError('OAuth approval credential must be independent and at least 32 characters')
        if parsed.scheme != 'https' or not parsed.netloc or origin != 'https://' + parsed.netloc:
            raise ValueError('OAuth origin must be an exact HTTPS origin')
        if not isinstance(redirects, list) or not redirects or any(not isinstance(uri, str) or '*' in uri or urlsplit(uri).scheme != 'https' or not urlsplit(uri).netloc or urlsplit(uri).fragment for uri in redirects):
            raise ValueError('OAuth callbacks must be an explicit HTTPS URI list')
        values['MCP_OAUTH_APPROVAL_TOKEN'] = approval
    return values


def api(path, method='GET', body=None, raw=False):
    req = urllib.request.Request(API + path, method=method,
        headers={'Authorization': 'Bearer ' + require_env('CLOUDFLARE_API_TOKEN'), 'Content-Type': 'application/json'},
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError('Cloudflare API request failed: HTTP ' + str(error.code)) from None
    if raw:
        return data
    result = json.loads(data)
    if not result.get('success'):
        raise RuntimeError('Cloudflare API reported failure; inspect account permissions privately')
    return result['result']


def identity():
    account = require_env('CLOUDFLARE_ACCOUNT_ID')
    database = str(uuid.UUID(require_env('SPIDER_D1_DATABASE_ID')))
    if uuid.UUID(database).int == 0:
        raise ValueError('A real existing D1 database UUID is required')
    worker = 'prompt-spider-mcp'
    if os.environ.get('SPIDER_WORKER_NAME', worker) != worker:
        raise ValueError('Only the independent prompt-spider-mcp Worker may be deployed')
    if require_env('SPIDER_D1_DATABASE_NAME') != 'prompt-spider-db':
        raise ValueError('Expected the existing prompt-spider-db database')
    if not re.fullmatch(r'[a-fA-F0-9]{32}', account) or not re.fullmatch(r'[a-zA-Z0-9_-]+', worker):
        raise ValueError('Invalid account or Worker name')
    return account, database, worker


def query(sql):
    account, database, _ = identity()
    result = api(f'/accounts/{account}/d1/database/{database}/query', 'POST', {'sql': sql})
    if any(not part.get('success', True) for part in result):
        raise RuntimeError('D1 query failed')
    return result[0]['results']


def history():
    # Preserve values, not merely an assumed number of rows; order independent.
    return row_fingerprint(query('SELECT * FROM events'))


def row_fingerprint(rows):
    encoded = sorted(json.dumps(row, sort_keys=True, separators=(',', ':')) for row in rows)
    return {'count': len(rows), 'sha256': hashlib.sha256('\n'.join(encoded).encode()).hexdigest()}


def schema():
    return query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")


def expected_tables():
    connection = sqlite3.connect(':memory:')
    connection.row_factory = sqlite3.Row
    try:
        for name in MIGRATIONS:
            sql = (ROOT/'migrations'/name).read_text()
            additive(sql)
            connection.executescript(sql)
        names = [row['name'] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {name: [dict(row) for row in connection.execute('PRAGMA table_info("' + name + '")')] for name in names}
    finally:
        connection.close()


def check_schema(existing_schema=None, read_query=None):
    existing_schema = schema() if existing_schema is None else existing_schema
    read_query = query if read_query is None else read_query
    objects = {row['name']: row['type'] for row in existing_schema}
    if objects.get('events') != 'table':
        raise ValueError('Original events table is missing')
    original = read_query('PRAGMA table_info("events")')
    if not {'request_id', 'event', 'project', 'received_at'} <= {row['name'] for row in original}:
        raise ValueError('Original events table is missing required legacy columns')
    def signature(rows):
        return [(row['name'], row['type'].strip().upper(), int(row['notnull']), int(row['pk'])) for row in rows]
    for name, expected in expected_tables().items():
        if name not in objects:
            continue
        if objects[name] != 'table' or signature(read_query('PRAGMA table_info("' + name + '")')) != signature(expected):
            raise ValueError('Existing database object conflicts with audited migration schema: ' + name)
    return existing_schema


def validate_export(sql, expected_history):
    # Restore only inside SQLite memory; authorizer prevents export-controlled host I/O.
    connection = sqlite3.connect(':memory:')
    connection.enable_load_extension(False)
    def authorize(action, first, second, database, trigger):
        if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and str(second).lower() in ('load_extension', 'readfile', 'writefile'):
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_PRAGMA and str(first).lower() not in ('foreign_keys', 'defer_foreign_keys', 'integrity_check'):
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK
    connection.set_authorizer(authorize)
    try:
        connection.executescript(sql.decode('utf-8') if isinstance(sql, bytes) else sql)
        integrity = [row[0] for row in connection.execute('PRAGMA integrity_check')]
        if integrity != ['ok']:
            raise ValueError('Restored D1 export failed integrity check')
        connection.row_factory = sqlite3.Row
        restored = row_fingerprint([dict(row) for row in connection.execute('SELECT * FROM events')])
        if restored != expected_history:
            raise ValueError('Restored D1 export does not preserve original records')
        tables = [dict(row) for row in connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")]
        return {'integrity': integrity, 'history': restored, 'schema': tables}
    except sqlite3.Error:
        raise ValueError('D1 export restore failed; unsafe or invalid SQL rejected') from None
    finally:
        connection.close()


def migration_checksums():
    return {name: hashlib.sha256((ROOT/'migrations'/name).read_bytes()).hexdigest() for name in MIGRATIONS}


def verification():
    for command in (['npm', 'run', 'build'], ['npm', 'test'], ['npm', 'run', 'test:python'], [sys.executable, 'scripts/test_cloud.py']):
        result = subprocess.run(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            raise RuntimeError('Local build/test verification failed; deployment stopped before mutation')


def private_dir(path, create=False):
    path = Path(path).expanduser().resolve()
    if path == ROOT or ROOT in path.parents:
        raise ValueError('Backups must be outside the repository')
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=False)
    if not path.is_dir() or path.stat().st_mode & 0o077:
        raise ValueError('Backup directory must exist with mode 0700')
    return path


def save(directory, name, data):
    data = data if isinstance(data, bytes) else json.dumps(data, indent=2).encode()
    path = directory / name
    with path.open('xb') as stream:
        os.chmod(path, 0o600)
        stream.write(data)


def backup(path):
    account, database, worker = identity()
    inspected_schema = check_schema()
    directory = private_dir(path, True)
    prefix = f'/accounts/{account}/workers/scripts/prompt-spider-api'
    save(directory, 'worker-content.bin', api(prefix + '/content/v2', raw=True))
    save(directory, 'worker-settings.json', api(prefix + '/settings'))
    deployments = api(prefix + '/deployments')
    save(directory, 'worker-deployments.json', deployments)
    save(directory, 'worker-versions.json', api(prefix + '/versions'))
    # A new service may not exist yet; 404 is the only accepted absence.
    try:
        prior = api(f'/accounts/{account}/workers/scripts/{worker}/deployments')
    except RuntimeError as error:
        if str(error) != 'Cloudflare API request failed: HTTP 404':
            raise
        prior = {'deployments': []}
    save(directory, 'mcp-deployments.json', prior)
    save(directory, 'schema.json', inspected_schema)
    before = history()
    # D1 export is asynchronous. No mutation is permitted until a complete download exists.
    result = api(f'/accounts/{account}/d1/database/{database}/export', 'POST', {'output_format': 'polling'})
    for _ in range(120):
        if result.get('status') == 'complete':
            break
        bookmark = result.get('at_bookmark')
        if not bookmark:
            raise RuntimeError('D1 export did not supply a polling bookmark')
        import time
        time.sleep(1)
        result = api(f'/accounts/{account}/d1/database/{database}/export', 'POST', {'output_format':'polling','current_bookmark':bookmark})
    else:
        raise RuntimeError('D1 export timeout; backup incomplete')
    url = result.get('result', {}).get('signed_url')
    if not url or not url.startswith('https://'):
        raise RuntimeError('D1 export missing HTTPS signed URL')
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            exported = response.read()
    except (urllib.error.URLError, OSError):
        raise RuntimeError('Private D1 download failed; signed URL suppressed') from None
    if not exported.strip():
        raise RuntimeError('D1 export was empty')
    save(directory, 'd1.sql', exported)
    if history() != before:
        raise RuntimeError('Legacy history changed during backup; rerun in a quiet window')
    restored = validate_export(exported, before)
    save(directory, 'restore-validation.json', restored)
    files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir()}
    save(directory, 'manifest.json', {'account':account,'database':database,'worker':worker,'history':before,'files':files,'migrations':migration_checksums(),'restore':restored})
    print('Private backup complete; no secret plaintext was requested.')


def validate_backup(path):
    directory = private_dir(path)
    manifest = json.loads((directory / 'manifest.json').read_text())
    account, database, worker = identity()
    if (account,database,worker) != (manifest['account'],manifest['database'],manifest['worker']):
        raise ValueError('Backup belongs to another target')
    required = {'worker-content.bin','worker-settings.json','worker-deployments.json','schema.json','d1.sql','worker-versions.json','mcp-deployments.json','restore-validation.json'}
    if not required <= manifest['files'].keys():
        raise ValueError('Incomplete backup')
    for name, digest in manifest['files'].items():
        if Path(name).name != name:
            raise ValueError('Invalid backup filename')
        p = directory / name
        if p.stat().st_mode & 0o077 or hashlib.sha256(p.read_bytes()).hexdigest() != digest:
            raise ValueError('Backup permissions or integrity failed')
    restored = validate_export((directory/'d1.sql').read_bytes(), manifest['history'])
    if restored != manifest['restore'] or restored != json.loads((directory/'restore-validation.json').read_text()):
        raise ValueError('Restored backup validation changed')
    if manifest['migrations'] != migration_checksums():
        raise ValueError('Migration SQL changed since reviewed backup snapshot')
    return manifest


def additive(sql):
    # Deliberately narrow: migration must contain CREATE TABLE/INDEX IF NOT EXISTS only.
    stripped = re.sub(r'--[^\n]*', '', sql)
    statements = [s.strip() for s in stripped.split(';') if s.strip()]
    if not statements or any(not re.match(r'^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\s+', s, re.I) for s in statements):
        raise ValueError('Migration must only create tables/indexes with IF NOT EXISTS')
    if any(re.search(r'\b(?:DROP|DELETE|UPDATE|INSERT|ALTER|REPLACE|TRIGGER)\b', s, re.I) for s in statements):
        raise ValueError('Migration contains a forbidden statement')


def wrangler(args, config, stdin=None):
    executable = ROOT / 'node_modules' / '.bin' / 'wrangler'
    if not executable.is_file():
        raise ValueError('Install the pinned root Wrangler dependency with npm ci first')
    # Output may contain private settings. Never echo it into shared logs.
    result = subprocess.run([str(executable), *args, '--config', str(config)], cwd=ROOT,
        input=stdin, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Wrangler command failed; output suppressed to protect credentials')


def deploy(path, migration=None):
    credentials()
    manifest = validate_backup(path)
    verification()
    check_schema()
    if history() != manifest['history'] or schema() != json.loads((Path(path) / 'schema.json').read_text()):
        raise ValueError('Database drift since backup; create a fresh backup')
    if migration:
        raise ValueError('Custom migrations are disabled; use the audited migration set')
    migrations = {name: (ROOT/'migrations'/name).read_text() for name in MIGRATIONS}
    for sql in migrations.values():
        additive(sql)
    account,database,worker = identity()
    with tempfile.TemporaryDirectory(prefix='spider-deploy-') as temp:
        config = Path(temp) / 'wrangler.json'
        config.write_text(json.dumps({'name':worker,'account_id':account,'main':str(ROOT/'src/worker.js'),
            'compatibility_date':'2026-06-01','compatibility_flags':['nodejs_compat'],'vars':{key:os.environ[key] for key in ('MCP_OAUTH_ORIGIN','MCP_OAUTH_REDIRECT_URIS') if os.environ.get(key)},'d1_databases':[{'binding':'DB','database_name':require_env('SPIDER_D1_DATABASE_NAME'),'database_id':database}]}))
        os.chmod(config, 0o600)
        save(private_dir(path), 'applied-migrations.json', {name: hashlib.sha256(sql.encode()).hexdigest() for name, sql in migrations.items()})
        for sql in migrations.values():
            query(sql)
        if history() != manifest['history']:
            raise RuntimeError('History changed after migration; deployment stopped')
        wrangler(['deploy'],config)
        wrangler(['secret','bulk'],config,json.dumps(credentials()))
    if history() != manifest['history']:
        raise RuntimeError('Legacy history changed; investigate before continuing')
    save(private_dir(path), 'mcp-deployed.json', api(f'/accounts/{account}/workers/scripts/{worker}/deployments'))
    print('Deployment completed. Run authenticated smoke checks before declaring production ready.')


def rollback(path, disable_new=False):
    validate_backup(path)
    account,_,worker = identity()
    deployments = json.loads((Path(path)/'mcp-deployments.json').read_text())
    items = deployments.get('deployments', [])
    if not items or not items[0].get('versions'):
        if not disable_new:
            raise ValueError('First deployment has no previous version; explicit --disable-new required to delete only the new MCP Worker')
        receipt = private_dir(path)/'mcp-deployed.json'
        if not receipt.is_file() or receipt.stat().st_mode & 0o077:
            raise ValueError('No private successful deployment receipt; automatic deletion refused')
        current = api(f'/accounts/{account}/workers/scripts/{worker}/deployments')
        saved = json.loads(receipt.read_text())
        if not current.get('deployments') or current['deployments'][0] != saved.get('deployments', [None])[0]:
            raise ValueError('New Worker changed after deployment; automatic deletion refused')
        api(f'/accounts/{account}/workers/scripts/{worker}', 'DELETE')
        print('New MCP Worker disabled by explicit deletion; old Worker and D1 retained.')
        return
    versions = items[0]['versions']
    if len(versions) != 1 or versions[0].get('percentage') != 100:
        raise ValueError('Previous deployment was split; manual version restoration required')
    api(f'/accounts/{account}/workers/scripts/{worker}/deployments','POST',
        {'strategy':'percentage','versions':[{'version_id':versions[0]['version_id'],'percentage':100}]})
    print('Previous Worker version restored. D1 tables/history retained; verify credentials and smoke separately.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['preflight','backup','deploy','rollback'])
    parser.add_argument('--backup-dir')
    parser.add_argument('--disable-new', action='store_true', help='Explicitly delete only the new MCP Worker when backup confirms no previous deployment')
    parser.add_argument('--migration', help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.command == 'preflight':
            identity(); credentials()
            check_schema(); history()
            print('Target, credentials, schema and legacy history accessible; no mutation performed.')
        else:
            if not args.backup_dir:
                raise ValueError('--backup-dir required')
            if args.command == 'backup': backup(args.backup_dir)
            elif args.command == 'deploy': deploy(args.backup_dir,args.migration)
            else: rollback(args.backup_dir,args.disable_new)
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print('Stopped: ' + (str(error) if isinstance(error, (ValueError, RuntimeError)) else 'Private operation failed; details suppressed'),file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
