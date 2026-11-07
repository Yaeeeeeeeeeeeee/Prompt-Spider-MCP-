"""Observation-only Codex hook. Never emits hook control output or raw inputs."""
import argparse
from datetime import datetime, timezone
import hashlib
import hmac
import uuid
import tempfile
import ssl
import time
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import urllib.error
import urllib.request

ENDPOINT = ''  # V1 requires an explicit endpoint for the independent Worker.
TIMEOUT = 1.2
TOOLS = {'Bash', 'shell', 'shell_command', 'exec_command'}


def classify(data):
    event = data.get('hook_event_name')
    if event == 'SessionStart':
        return {'startup': 'session_started', 'resume': 'session_resumed',
                'clear': 'session_started', 'compact': 'session_resumed'}.get(data.get('source'))
    simple = {'UserPromptSubmit': 'prompt_submitted',
              'PermissionRequest': 'waiting_confirmation', 'Stop': 'turn_stopped',
              'Interrupt': 'turn_interrupted', 'SessionEnd': 'session_ended'}
    if event in simple:
        return simple[event]
    if event == 'PostModelRequest':
        status = data.get('status')
        # This describes ONE model request, never a whole task.
        return 'model_request_' + status if status in ('completed', 'failed', 'cancelled') else None
    if event not in ('PreToolUse', 'PostToolUse'):
        return None
    name = data.get('tool_name', '').rsplit('.', 1)[-1]
    before = event == 'PreToolUse'
    if name == 'apply_patch':
        return 'code_edit_started' if before else 'code_edit_completed'
    if name not in TOOLS:
        return None
    args = data.get('tool_input')
    args = args if isinstance(args, dict) else {}
    command = args.get('command', args.get('cmd', ''))
    test = is_test(command)
    return ('test_started' if before else 'test_command_finished') if test else ('command_started' if before else 'command_completed')


def is_test(command):
    if isinstance(command, list):
        words = command
    elif isinstance(command, str):
        try:
            words = shlex.split(command, posix=False)
        except ValueError:
            return False
    else:
        return False
    if not words or not all(isinstance(w, str) for w in words):
        return False
    # Only inspect the leading invocation. Do not scan echoed strings or shell bodies.
    first = re.split(r'[/\\]', words[0].strip('"\''))[-1].lower()
    first = re.sub(r'\.(exe|cmd|bat)$', '', first)
    tail = words[1:]
    if first in ('pytest', 'vitest', 'jest'):
        return True
    if first in ('python', 'python3', 'py'):
        return tail[:2] == ['-m', 'pytest']
    if first in ('npm', 'pnpm', 'yarn', 'bun') and (tail[:1] == ['test'] or tail[:2] == ['run', 'test']):
        return True
    if first in ('npx', 'pnpm', 'bun') and tail[:1] in (['vitest'], ['jest'], ['pytest']):
        return True
    return first in ('cargo', 'go', 'dotnet') and tail[:1] == ['test']


def project_root(cwd):
    """Find Git markers without spawning Git (cold startup can exceed hook budgets)."""
    folder = Path(cwd or os.getcwd()).resolve()
    for parent in (folder, *folder.parents):
        if (parent / '.git').is_dir() or (parent / '.git').is_file():
            return parent
    return folder


def project_name(cwd):
    # Compatibility helper only; V1 never transmits this value.
    return project_root(cwd).name


def state_dir():
    path = Path(os.environ.get('SPIDER_STATE_DIR') or
                (Path.home() / '.prompt-spider'))
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def identity_key():
    path = state_dir() / 'identity.key'
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return path.read_bytes()
    with os.fdopen(fd, 'wb') as stream:
        key = os.urandom(32)
        stream.write(key)
    return key


def opaque(namespace, value):
    return hmac.new(identity_key(), (namespace + ':' + str(value)).encode(), hashlib.sha256).hexdigest()


def make_payload(data):
    if not isinstance(data, dict):
        return None
    event = classify(data)
    if event is None:
        return None
    cwd = data.get('cwd') if isinstance(data.get('cwd'), str) else None
    session = data.get('session_id')
    # No session identity means no reliable cross-hook run correlation.
    run = opaque('session', session) if isinstance(session, str) and session else uuid.uuid4().hex
    status = {'waiting_confirmation':'waiting', 'session_ended':'ended',
              'turn_stopped':'stopped', 'turn_interrupted':'stopped'}.get(event, 'running')
    return {'version':1, 'event_id':uuid.uuid4().hex, 'source':'windows',
            'project_id':opaque('project', os.path.normcase(str(project_root(cwd)))),
            'run_id':run, 'event_type':event, 'status':status,
            'timestamp':datetime.now(timezone.utc).isoformat().replace('+00:00','Z')}


def get_token():
    value = os.environ.get('SPIDER_WINDOWS_TOKEN', '')
    if not value and os.name == 'nt':
        # Freshly configured user variables may not yet be in the Codex process snapshot.
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
                value, _ = winreg.QueryValueEx(key, 'SPIDER_WINDOWS_TOKEN')
        except OSError:
            return ''
    return value.strip() if isinstance(value, str) else ''


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the bearer token to a redirect destination.
        return None


def send(payload):
    token = get_token()
    if not token:
        return 'missing_token'
    # Explicit allowlist: no extra input fields can enter the HTTP body.
    body = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    endpoint = os.environ.get('SPIDER_ENDPOINT', ENDPOINT)
    from urllib.parse import urlsplit
    parsed = urlsplit(endpoint)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return 'invalid_endpoint'
    request = urllib.request.Request(endpoint, data=body, method='POST', headers={
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=TIMEOUT) as response:
            return 'accepted' if response.status == 202 else 'unexpected_status'
    except Exception:
        # No raw exception, URL, response, command, path, or credential logging.
        return 'network_or_http_error'


def enqueue(payload):
    folder = state_dir() / 'outbox'
    folder.mkdir(mode=0o700, exist_ok=True)
    path = folder / (payload['event_id'] + '.json')
    # Exclusive immutable event files preserve IDs through all retries.
    with path.open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(payload, stream, separators=(',', ':'))
        stream.flush()
        os.fsync(stream.fileno())
    return path


def deliver_file(path):
    payload = json.loads(path.read_text(encoding='utf-8'))
    status = send(payload)
    if status == 'accepted':
        path.unlink(missing_ok=True)
    return status


def flush(limit=10):
    # Manual/scheduled bounded drain, never sleeps in a lifecycle hook.
    paths = sorted((state_dir() / 'outbox').glob('*.json'))[:max(0, min(limit, 100))]
    return [deliver_file(path) for path in paths]


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--check-token', action='store_true')
    parser.add_argument('--probe', action='store_true')
    parser.add_argument('--flush', action='store_true')
    args = parser.parse_args(argv)
    if args.check_token:
        print('SPIDER_WINDOWS_TOKEN: ' + ('present' if get_token() else 'missing'))
        return 0
    try:
        if args.flush:
            statuses = flush()
            return 0 if all(s == 'accepted' for s in statuses) else 1
        text = sys.stdin.read(2 * 1024 * 1024 + 1)
        if len(text) > 2 * 1024 * 1024:
            return 0
        payload = make_payload(json.loads(text))
        if payload is None:
            return 0
        if args.dry_run:
            print(json.dumps(payload))
        else:
            status = deliver_file(enqueue(payload))
            if args.probe:
                print(json.dumps({'delivery':status}))
                return 0 if status == 'accepted' else 1
    except Exception:
        if args.probe:
            print('{"delivery":"invalid_input_or_local_error"}')
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
