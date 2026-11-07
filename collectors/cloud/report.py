"""Explicit opt-in cloud reporting; not a global Codex hook."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import uuid
import transport

EVENTS = {'task_started':'running', 'task_completed':'completed',
          'task_failed':'failed', 'task_cancelled':'cancelled', 'heartbeat':'running',
          'waiting_confirmation':'waiting', 'session_ended':'ended'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('event', choices=EVENTS, nargs='?')
    parser.add_argument('--run-file', type=Path)
    parser.add_argument('--project', type=Path, default=Path.cwd())
    parser.add_argument('--flush', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    if args.flush:
        return 0 if all(x == 'accepted' for x in transport.flush()) else 1
    if not args.event or not args.run_file:
        parser.error('event and --run-file are required')
    # A fresh file explicitly begins a new task; reuse it for that task only.
    if args.run_file.exists():
        run_id = args.run_file.read_text().strip()
        if len(run_id) != 32 or any(c not in '0123456789abcdef' for c in run_id):
            parser.error('invalid run file')
    else:
        run_id = uuid.uuid4().hex
        args.run_file.parent.mkdir(parents=True, exist_ok=True)
        with args.run_file.open('x') as stream:
            stream.write(run_id)
        args.run_file.chmod(0o600)
    payload = {'version':1, 'source':'cloud', 'event_id':uuid.uuid4().hex,
               'project_id':transport.opaque('project', str(transport.project_root(args.project))),
               'run_id':run_id, 'event_type':args.event, 'status':EVENTS[args.event],
               'timestamp':datetime.now(timezone.utc).isoformat().replace('+00:00','Z')}
    if args.dry_run:
        print(json.dumps(payload))
        return 0
    path = transport.enqueue(payload)
    return 0 if transport.deliver_file(path) == 'accepted' else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError):
        raise SystemExit(1)
