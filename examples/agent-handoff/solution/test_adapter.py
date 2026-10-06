"""Integration checks execute the real source and target; fault cases are isolated."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('adapter_under_test', HERE/'adapter.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

class IntegrationTests(unittest.TestCase):
    def call(self, content):
        with tempfile.TemporaryDirectory() as tmp:
            frame = Path(tmp)/'frame.json'
            frame.write_text(content if isinstance(content,str) else json.dumps(content))
            return subprocess.run([sys.executable,str(HERE/'adapter.py'),'--frame',str(frame)],capture_output=True,text=True,timeout=5)
    def frame(self, x=600, y=300):
        return {'screen':{'w':800,'h':600},'detections':[{'name':'goal','center':[x,y]}]}
    def test_right(self):
        p=self.call(self.frame());self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(json.loads(p.stdout),dict(action='turn_right',duration_ms=120,target_offset=[.5,0]))
    def test_left(self):
        p=self.call(self.frame(200));self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(json.loads(p.stdout)['action'],'turn_left')
    def test_centre(self):
        p=self.call(self.frame(400));self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(json.loads(p.stdout)['action'],'forward')
    def test_no_goal(self):
        f=self.frame();f['detections']=[];p=self.call(f);self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(json.loads(p.stdout)['action'],'noop')
    def test_first_goal(self):
        f=self.frame(200);f['detections'].append({'name':'goal','center':[600,300]});p=self.call(f);self.assertEqual(json.loads(p.stdout)['action'],'turn_left')
    def test_zero_dimension(self):
        f=self.frame();f['screen']['w']=0;p=self.call(f);self.assertNotEqual(p.returncode,0);self.assertIn('positive',p.stderr)
    def test_missing_fields(self):
        p=self.call({});self.assertNotEqual(p.returncode,0);self.assertIn('adapter error',p.stderr)
    def test_outside_screen(self):
        p=self.call(self.frame(900));self.assertNotEqual(p.returncode,0);self.assertIn('outside',p.stderr)
    def test_non_number(self):
        p=self.call(self.frame('600'));self.assertNotEqual(p.returncode,0);self.assertIn('finite',p.stderr)
    def test_nan(self):
        p=self.call(self.frame(float('nan')));self.assertNotEqual(p.returncode,0);self.assertIn('finite',p.stderr)
    def test_bad_json_source_failure(self):
        p=self.call('{bad');self.assertNotEqual(p.returncode,0);self.assertIn('scene source failed',p.stderr)
    def test_timeout(self):
        with patch.object(adapter.subprocess,'run',side_effect=subprocess.TimeoutExpired('source',2)):
            with self.assertRaisesRegex(ValueError,'timed out'):
                adapter.run(Path('unused.json'))
    def test_invalid_source_output(self):
        with patch.object(adapter.subprocess,'run',return_value=subprocess.CompletedProcess([],0,stdout='not-json')):
            with self.assertRaises(ValueError): adapter.run(Path('unused.json'))

if __name__=='__main__': unittest.main(verbosity=2)
