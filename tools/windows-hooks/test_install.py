import json
from pathlib import Path
import tempfile
import unittest

class InstallTests(unittest.TestCase):
    def test_merge_preserves_every_old_group_and_is_repeatable(self):
        import install_windows as i
        original={'description':'keep','hooks':{'Stop':[{'hooks':[{'type':'command','command':'old-command','timeout':7}]}],'PreCompact':[{'hooks':[]} ]}}
        merged=i.merge(original,'"C:\\Python\\python.exe" "C:\\User\\hooks\\prompt_spider_sender.py"')
        self.assertEqual(merged['hooks']['Stop'][0], original['hooks']['Stop'][0])
        self.assertEqual(merged['hooks']['PreCompact'],original['hooks']['PreCompact'])
        self.assertEqual(merged['description'],'keep')
        self.assertEqual(len(merged['hooks']['Stop']),2)
        self.assertEqual(i.merge(merged,'"C:\\Python\\python.exe" "C:\\User\\hooks\\prompt_spider_sender.py"'),merged)
        self.assertFalse(merged['hooks']['SessionEnd'][0]['hooks'][0]['async'])
        self.assertTrue(merged['hooks']['Stop'][-1]['hooks'][0]['async'])

    def test_install_backs_up_original_bytes_and_rollback(self):
        import install_windows as i
        with tempfile.TemporaryDirectory() as td:
            home=Path(td)
            old=b'{"hooks":{"Stop":[{"hooks":[]}]}}\n'
            (home/'hooks.json').write_bytes(old)
            config=b'# keep me\n'
            (home/'config.toml').write_bytes(config)
            backup=i.install(home)
            self.assertEqual((backup/'hooks.json').read_bytes(),old)
            self.assertEqual((backup/'config.toml').read_bytes(),config)
            self.assertEqual((home/'config.toml').read_bytes(),config)
            self.assertTrue((home/'hooks'/'prompt_spider_sender.py').exists())
            result=json.loads((home/'hooks.json').read_text())
            self.assertEqual(result['hooks']['Stop'][0],{'hooks':[]})
            i.rollback(home,backup)
            self.assertEqual((home/'hooks.json').read_bytes(),old)
            self.assertFalse((home/'hooks'/'prompt_spider_sender.py').exists())

    def test_existing_sender_is_not_overwritten(self):
        import install_windows as i
        with tempfile.TemporaryDirectory() as td:
            home=Path(td); (home/'hooks').mkdir()
            p=home/'hooks'/'prompt_spider_sender.py'; p.write_text('# user file')
            with self.assertRaises(ValueError): i.install(home)
            self.assertEqual(p.read_text(),'# user file')

    def test_malformed_config_and_changed_rollback_fail_without_overwriting(self):
        import install_windows as i
        with tempfile.TemporaryDirectory() as td:
            home=Path(td); p=home/'hooks.json'; p.write_text('not-json')
            with self.assertRaises(ValueError): i.install(home)
            self.assertEqual(p.read_text(),'not-json')
            p.write_text('{"hooks":{}}')
            backup=i.install(home)
            p.write_text('{"hooks":{},"description":"later user edit"}')
            with self.assertRaises(ValueError): i.rollback(home,backup)
            self.assertIn('later user edit',p.read_text())

if __name__=='__main__': unittest.main()
