import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

class SenderTests(unittest.TestCase):
    def setUp(self):
        import prompt_spider_sender as sender
        self.s = sender

    def test_lifecycle_and_model_request_scope(self):
        cases = [('SessionStart', {'source':'startup'}, 'session_started'),
                 ('SessionStart', {'source':'resume'}, 'session_resumed'),
                 ('SessionStart', {'source':'unknown'}, None),
                 ('UserPromptSubmit', {}, 'prompt_submitted'),
                 ('PermissionRequest', {}, 'waiting_confirmation'),
                 ('Stop', {}, 'turn_stopped'), ('Interrupt', {}, 'turn_interrupted'),
                 ('SessionEnd', {}, 'session_ended')]
        for hook, extra, expected in cases:
            with self.subTest(hook=hook, extra=extra):
                self.assertEqual(self.s.classify(dict(hook_event_name=hook, **extra)), expected)
        for status in ['completed','failed','cancelled']:
            self.assertEqual(self.s.classify({'hook_event_name':'PostModelRequest','status':status}), 'model_request_'+status)
        self.assertIsNone(self.s.classify({'hook_event_name':'PostModelRequest','status':'other'}))

    def test_tool_classification_does_not_infer_success(self):
        for pre, edit, command, test in [('PreToolUse','code_edit_started','command_started','test_started'),('PostToolUse','code_edit_completed','command_completed','test_command_finished')]:
            for name in ['apply_patch','functions.apply_patch']:
                self.assertEqual(self.s.classify({'hook_event_name':pre,'tool_name':name}), edit)
            for cmd in ['pytest -q','npm test','npx vitest run','cargo test','python -m pytest']:
                self.assertEqual(self.s.classify({'hook_event_name':pre,'tool_name':'Bash','tool_input':{'command':cmd}}),test)
            for cmd in ['echo pytest','echo npm test','git status','cat secrets.txt']:
                self.assertEqual(self.s.classify({'hook_event_name':pre,'tool_name':'exec_command','tool_input':{'cmd':cmd}}),command)
        self.assertIsNone(self.s.classify({'hook_event_name':'PreToolUse','tool_name':'read_file'}))

    def test_payload_privacy_and_git_root(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)/'project'; root.mkdir()
            subprocess.run(['git','init','-q',str(root)],check=True)
            child=root/'src';child.mkdir()
            payload=self.s.make_payload({'hook_event_name':'UserPromptSubmit','cwd':str(child),'prompt':'DO NOT SEND','transcript_path':'secret','tool_input':{'command':'secret'}})
            self.assertEqual(payload,{'event':'prompt_submitted','project':'project'})
        self.assertEqual(set(payload),{'event','project'})

    def test_transport_exact_body_and_header_no_redirect(self):
        class Response:
            status=202
            def __enter__(self): return self
            def __exit__(self,*a): pass
        class Opener:
            def open(inner, request, timeout):
                self.assertEqual(json.loads(request.data),{'event':'turn_stopped','project':'demo'})
                self.assertEqual(request.get_header('Authorization'),'Bearer dummy-unit-test')
                self.assertLessEqual(timeout,1.5)
                self.assertEqual(request.full_url,self.s.ENDPOINT)
                return Response()
        with patch.dict(os.environ,{'SPIDER_INGEST_TOKEN':'dummy-unit-test'}), patch.object(self.s.urllib.request,'build_opener',return_value=Opener()):
            self.assertEqual(self.s.send({'event':'turn_stopped','project':'demo'}),'accepted')

    def test_missing_token_and_network_errors_never_block(self):
        with patch.dict(os.environ,{},clear=True):
            self.assertEqual(self.s.send({'event':'turn_stopped','project':'demo'}),'missing_token')
        for text in ['not JSON','[]','{}','{"hook_event_name":"Stop","cwd":null}']:
            out=io.StringIO()
            with patch('sys.stdin',io.StringIO(text)),contextlib.redirect_stdout(out),patch.object(self.s,'send',side_effect=OSError('secret-network-detail')):
                self.assertEqual(self.s.main([]),0)
            self.assertEqual(out.getvalue(),'')

    def test_transport_failure_and_redirect_are_safe(self):
        import urllib.error
        with patch.dict(os.environ, {'SPIDER_INGEST_TOKEN':'dummy-unit-test'}), patch.object(self.s.urllib.request,'build_opener',side_effect=urllib.error.URLError('offline')):
            self.assertEqual(self.s.send({'event':'turn_stopped','project':'demo'}),'network_or_http_error')
        self.assertIsNone(self.s.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://other.example/'))

    def test_dry_run_never_sends(self):
        out=io.StringIO()
        with patch('sys.stdin',io.StringIO('{"hook_event_name":"Stop"}')),contextlib.redirect_stdout(out),patch.object(self.s,'send',side_effect=AssertionError('unexpected network')):
            self.assertEqual(self.s.main(['--dry-run']),0)
        self.assertEqual(json.loads(out.getvalue())['event'],'turn_stopped')

if __name__=='__main__': unittest.main()
