"""Install user-wide Windows hooks without changing config.toml or trusting hooks."""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

EVENTS = ('SessionStart','UserPromptSubmit','PermissionRequest','PreToolUse',
          'PostToolUse','PostModelRequest','Stop','Interrupt','SessionEnd')
MATCHER = r'^(?:(?:functions\.)?(?:apply_patch|Bash|shell|shell_command|exec_command))$'
SENDER = Path('hooks/prompt_spider_sender.py')


def merge(document, command):
    result = copy.deepcopy(document)
    if not isinstance(result, dict) or not isinstance(result.get('hooks', {}), dict):
        raise ValueError('Invalid hooks.json structure; nothing changed')
    hooks = result.setdefault('hooks', {})
    for event in EVENTS:
        groups = hooks.setdefault(event, [])
        if not isinstance(groups, list):
            raise ValueError('Invalid hook event structure; nothing changed')
        handler = {'type':'command', 'command':'true', 'commandWindows':command,
                   'timeout':3, 'async': event != 'SessionEnd'}
        group = {'hooks':[handler]}
        if event in ('PreToolUse','PostToolUse'):
            group['matcher'] = MATCHER
        # Preserve all original indexes: Codex persists trust by group/handler index.
        if group not in groups:
            # Refuse to duplicate an older/different Prompt Spider installation.
            if any('prompt_spider_sender.py' in str(g.get('hooks', [])) for g in groups if isinstance(g, dict)):
                raise ValueError('Different Prompt Spider handler already exists; review manually')
            groups.append(group)
    return result


def digest(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.prompt-spider-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def install(home):
    home = Path(home).resolve()
    source = Path(__file__).with_name('prompt_spider_sender.py').read_bytes()
    target = home / SENDER
    if target.is_symlink() or (home/'hooks').is_symlink() or (home/'hooks.json').is_symlink():
        raise ValueError('Symlink configuration requires manual review')
    if target.exists() and target.read_bytes() != source:
        raise ValueError('Existing sender differs; refusing to overwrite it')
    original = (home/'hooks.json').read_bytes() if (home/'hooks.json').exists() else None
    # UTF-8 BOM is accepted; malformed JSON aborts before any write.
    doc = json.loads(original.decode('utf-8-sig')) if original is not None else {}
    exe = str(Path(sys.executable).resolve())
    script = str(target)
    if any(c in exe + script for c in '%!\r\n"'):
        raise ValueError('Path contains shell expansion characters; manual installation required')
    command = '"' + exe + '" "' + script + '"'
    merged = merge(doc, command)
    generated = (json.dumps(merged, ensure_ascii=False, indent=2)+'\n').encode('utf-8')
    home.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = home/'prompt-spider-backups'/stamp
    backup.mkdir(parents=True, exist_ok=False)
    before = {}
    for rel in ('hooks.json','config.toml',SENDER.as_posix()):
        path = home/rel
        data = path.read_bytes() if path.exists() else None
        before[rel] = digest(data)
        if data is not None:
            saved = backup/rel; saved.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(path,saved)
    after = {'hooks.json':digest(generated), SENDER.as_posix():digest(source)}
    manifest = {'home':str(home),'before':before,'after':after}
    (backup/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    try:
        if not target.exists(): atomic_write(target,source)
        # If another process edited hooks.json during preparation, do not overwrite it.
        current = (home/'hooks.json').read_bytes() if (home/'hooks.json').exists() else None
        if current != original:
            raise ValueError('hooks.json changed concurrently; close Codex before retrying')
        atomic_write(home/'hooks.json',generated)
    except Exception:
        if before[SENDER.as_posix()] is None and target.exists() and digest(target.read_bytes()) == after[SENDER.as_posix()]:
            target.unlink()
        raise
    assert json.loads((home/'hooks.json').read_text(encoding='utf-8')) == merged
    return backup


def rollback(home, backup):
    home, backup = Path(home).resolve(), Path(backup).resolve()
    manifest = json.loads((backup/'manifest.json').read_text(encoding='utf-8'))
    if manifest['home'] != str(home):
        raise ValueError('Backup belongs to a different Codex home')
    for rel, expected in manifest['after'].items():
        path = home/rel
        current = path.read_bytes() if path.exists() else None
        if digest(current) != expected:
            raise ValueError('Files changed after installation; refusing automatic rollback')
    restored = {}
    for rel in manifest['after']:
        if manifest['before'][rel] is not None:
            data = (backup/rel).read_bytes()
            if digest(data) != manifest['before'][rel]:
                raise ValueError('Backup integrity check failed')
            restored[rel] = data
    for rel in manifest['after']:
        path = home/rel
        if manifest['before'][rel] is None:
            path.unlink()
        else:
            atomic_write(path,restored[rel])
    # config.toml is never changed/restored automatically; preserve later trust edits.


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--codex-home', type=Path)
    parser.add_argument('--rollback', type=Path, help='Backup folder printed during install')
    args = parser.parse_args()
    if os.name != 'nt':
        parser.error('Run this installer on your Windows PC; cloud Linux is not the target')
    home = args.codex_home or Path(os.environ.get('CODEX_HOME') or (Path(os.environ['USERPROFILE'])/'.codex'))
    if args.rollback:
        rollback(home,args.rollback)
        print('Rolled back hooks.json and sender. config.toml was not changed.')
        return
    version = subprocess.run(['codex','--version'],capture_output=True,text=True,check=True,timeout=10)
    help_result = subprocess.run(['codex','--help'],capture_output=True,text=True,check=True,timeout=10)
    if '--dangerously-bypass-hook-trust' not in help_result.stdout:
        raise ValueError('This Codex build has not demonstrated lifecycle hook trust support; update and review first')
    print(version.stdout.strip())
    print('Codex home:',home)
    print('Existing hooks.json:',(home/'hooks.json').exists())
    print('Existing config.toml:',(home/'config.toml').exists())
    print('Existing hooks directory:',(home/'hooks').exists())
    from prompt_spider_sender import get_token
    print('SPIDER_INGEST_TOKEN:', 'present' if get_token() else 'missing')
    backup = install(home)
    print('Installed. Backup:',backup)
    print('No permission or trust settings changed. Review new hooks in Codex before use.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Never print arbitrary file content, commands, environment values or HTTP errors.
        print('Installation stopped:',type(exc).__name__,file=sys.stderr)
        sys.exit(1)
