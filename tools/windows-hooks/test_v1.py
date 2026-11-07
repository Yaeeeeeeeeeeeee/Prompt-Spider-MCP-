import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import prompt_spider_sender as s


class V1Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(os.environ, {'SPIDER_STATE_DIR':self.tmp.name})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_cold_git_timeout_reproduced_but_not_used_by_root_discovery(self):
        root = Path(self.tmp.name)/'private-project'
        child = root/'src'; child.mkdir(parents=True)
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        # Reproduce original failure mechanism: its exception fallback chooses src.
        with patch.object(s.subprocess, 'run', side_effect=subprocess.TimeoutExpired('git', .4)):
            try:
                s.subprocess.run(['git','-C',str(child),'rev-parse','--show-toplevel'], timeout=.4)
            except subprocess.SubprocessError:
                old_fallback = child.name
            self.assertEqual(old_fallback, 'src')
            self.assertEqual(s.project_root(child), root)
            self.assertEqual(s.project_name(child), 'private-project')
            self.assertEqual(s.make_payload({'hook_event_name':'Stop','cwd':str(child)})['project_id'],
                             s.make_payload({'hook_event_name':'Stop','cwd':str(root)})['project_id'])

    def test_worktree_marker_and_session_separation(self):
        root = Path(self.tmp.name)/'worktree'; root.mkdir()
        (root/'.git').write_text('gitdir: /private/path')
        child = root/'nested'; child.mkdir()
        self.assertEqual(s.project_root(child), root)
        a=s.make_payload({'hook_event_name':'Stop','session_id':'sensitive-session','cwd':str(child)})
        b=s.make_payload({'hook_event_name':'PostModelRequest','status':'completed','session_id':'sensitive-session','cwd':str(child)})
        self.assertEqual(a['run_id'],b['run_id'])
        self.assertNotEqual(a['event_id'],b['event_id'])
        self.assertEqual(b['status'],'running')
        self.assertNotIn('sensitive-session',json.dumps(a))
        self.assertNotEqual(a['run_id'],s.make_payload({'hook_event_name':'Stop','session_id':'other'})['run_id'])

    def test_outbox_durable_retry_same_id_and_no_sleep(self):
        payload=s.make_payload({'hook_event_name':'Stop'})
        path=s.enqueue(payload)
        seen=[]
        def fail(p): seen.append(p); return 'network_or_http_error'
        with patch.object(s,'send',side_effect=fail):
            s.deliver_file(path)
            s.flush(1)
        self.assertTrue(path.exists())
        self.assertEqual(seen,[payload,payload])
        with patch.object(s,'send',return_value='accepted'):
            s.flush(1)
        self.assertFalse(path.exists())

    def test_https_only_and_source_token_isolation(self):
        payload=s.make_payload({'hook_event_name':'Stop'})
        with patch.dict(os.environ,{'SPIDER_WINDOWS_TOKEN':'unit-only','SPIDER_ENDPOINT':'http://example.invalid/api/events'}), patch.object(s.urllib.request,'build_opener') as opener:
            self.assertEqual(s.send(payload),'invalid_endpoint')
            opener.assert_not_called()
        with patch.dict(os.environ,{'SPIDER_WINDOWS_TOKEN':'','SPIDER_INGEST_TOKEN':'legacy-only','SPIDER_CLOUD_TOKEN':'cloud-only'}):
            self.assertEqual(s.get_token(),'')

    def test_missing_endpoint_never_uses_legacy_worker(self):
        with patch.dict(os.environ, {'SPIDER_WINDOWS_TOKEN':'unit-only','SPIDER_ENDPOINT':''}), patch.object(s.urllib.request,'build_opener') as opener:
            self.assertEqual(s.send(s.make_payload({'hook_event_name':'Stop'})), 'invalid_endpoint')
            opener.assert_not_called()

    def test_submodule_marker_is_nearest_repository(self):
        outer=Path(self.tmp.name)/'outer'; outer.mkdir(); (outer/'.git').mkdir()
        sub=outer/'sub'; sub.mkdir(); (sub/'.git').write_text('gitdir: ../.git/modules/sub')
        child=sub/'src'; child.mkdir()
        self.assertEqual(s.project_root(child), sub)

    def test_original_attachment_git_root_assertion(self):
        import importlib.util
        import zipfile
        # Attachment belongs to parent workspace, outside distributed package.
        attachment=Path('/workspace/attachments/eeb3b357-207a-4270-994f-c92c5d4b1165/prompt-spider-windows.zip')
        if not attachment.exists():
            attachment=Path(__file__).resolve().parents[2]/'downloads'/'prompt-spider-windows.zip'
        if not attachment.exists(): self.skipTest('original attachment not distributed')
        original={}
        with zipfile.ZipFile(attachment) as archive:
            exec(compile(archive.read('prompt-spider-windows/prompt_spider_sender.py'), 'original_sender', 'exec'), original)
        root=Path(self.tmp.name)/'project'; child=root/'src'; child.mkdir(parents=True)
        subprocess.run(['git','init','-q',str(root)],check=True)
        self.assertEqual(original['project_name'](str(child)), 'project')
        self.assertEqual(s.project_name(str(child)), 'project')
