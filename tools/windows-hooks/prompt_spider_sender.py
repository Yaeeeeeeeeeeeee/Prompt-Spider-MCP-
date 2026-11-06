"""Observation-only Codex hook. Never emits hook control output or raw inputs."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import urllib.error
import urllib.request

ENDPOINT = 'https://prompt-spider-api.tohsakarin2018.workers.dev/api/events'
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


def project_name(cwd):
    folder = Path(cwd or os.getcwd())
    try:
        result = subprocess.run(['git', '-C', str(folder), 'rev-parse', '--show-toplevel'],
                                capture_output=True, text=True, timeout=0.4,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode == 0 and result.stdout.strip():
            folder = Path(result.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    # Only a basename can leave this machine.
    name = folder.resolve().name
    return ''.join(c for c in name if c.isprintable())[:160] or 'unknown-project'


def make_payload(data):
    if not isinstance(data, dict):
        return None
    event = classify(data)
    if event is None:
        return None
    cwd = data.get('cwd')
    if not isinstance(cwd, str):
        cwd = None
    return {'event': event, 'project': project_name(cwd)}


def get_token():
    value = os.environ.get('SPIDER_INGEST_TOKEN', '')
    if not value and os.name == 'nt':
        # Freshly configured user variables may not yet be in the Codex process snapshot.
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as key:
                value, _ = winreg.QueryValueEx(key, 'SPIDER_INGEST_TOKEN')
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
    body = json.dumps({'event': payload['event'], 'project': payload['project']}).encode('utf-8')
    request = urllib.request.Request(ENDPOINT, data=body, method='POST', headers={
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=TIMEOUT) as response:
            return 'accepted' if response.status == 202 else 'unexpected_status'
    except Exception:
        # No raw exception, URL, response, command, path, or credential logging.
        return 'network_or_http_error'


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Print only the two safe fields; no network')
    parser.add_argument('--check-token', action='store_true', help='Print presence only; no network')
    parser.add_argument('--probe', action='store_true', help='Send stdin event and show a safe delivery status')
    args = parser.parse_args(argv)
    if args.check_token:
        print('SPIDER_INGEST_TOKEN: ' + ('present' if get_token() else 'missing'))
        return 0
    try:
        if hasattr(sys.stdin, 'reconfigure'):
            sys.stdin.reconfigure(encoding='utf-8')
        text = sys.stdin.read(2 * 1024 * 1024 + 1)
        if len(text) > 2 * 1024 * 1024:
            return 0
        payload = make_payload(json.loads(text))
        if payload is None:
            return 0
        if args.dry_run:
            print(json.dumps(payload, ensure_ascii=False))
        else:
            status = send(payload)
            if args.probe:
                print(json.dumps({'delivery': status}))
                return 0 if status == 'accepted' else 1
    except Exception:
        if args.probe:
            print('{"delivery":"invalid_input_or_local_error"}')
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
