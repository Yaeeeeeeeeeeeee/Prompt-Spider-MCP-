import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import report
import transport

class ReporterTests(unittest.TestCase):
    def test_explicit_completion_and_stable_run(self):
        with tempfile.TemporaryDirectory() as td, patch.dict(os.environ, {'SPIDER_STATE_DIR':td}):
            args=['--run-file',str(Path(td)/'run'),'--project',td,'--dry-run']
            results=[]
            for event in ['task_started','task_completed']:
                output=io.StringIO()
                with contextlib.redirect_stdout(output), patch.object(transport,'send',side_effect=AssertionError('network')):
                    self.assertEqual(report.main([event,*args]),0)
                results.append(json.loads(output.getvalue()))
            self.assertEqual(results[0]['run_id'],results[1]['run_id'])
            self.assertNotEqual(results[0]['event_id'],results[1]['event_id'])
            self.assertEqual(results[1]['status'],'completed')
            self.assertNotIn(td,json.dumps(results))

    def test_endpoint_and_source_token_isolation(self):
        with patch.dict(os.environ, {'SPIDER_CLOUD_TOKEN':'unit-only','SPIDER_ENDPOINT':''}), patch.object(transport.urllib.request,'build_opener') as opener:
            self.assertEqual(transport.send({}), 'invalid_endpoint'); opener.assert_not_called()
        with patch.dict(os.environ, {'SPIDER_CLOUD_TOKEN':'','SPIDER_WINDOWS_TOKEN':'other','SPIDER_INGEST_TOKEN':'legacy'}):
            self.assertEqual(transport.get_token(),'')

if __name__=='__main__': unittest.main()
