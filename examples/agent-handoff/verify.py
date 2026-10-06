"""Run the installed adapter's tests and atomically publish the actual result."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

EDGE = 'edge_scene_action'

def verify(project):
    spec=(project/'connections'/EDGE/'SPEC.md').read_text()
    fingerprint=re.search(r'^Fingerprint: ([0-9a-f]{64})$',spec,re.M).group(1)
    test=project/'implementations'/EDGE/'test_adapter.py'
    result=subprocess.run([sys.executable,str(test)],capture_output=True,text=True,timeout=30)
    sys.stdout.write(result.stdout);sys.stderr.write(result.stderr)
    report=dict(fingerprint=fingerprint,status='verified' if result.returncode==0 else 'blocked',summary='観測CLI→座標変換→行動判断のテストが成功しました。' if result.returncode==0 else '接続テストに失敗しました。',files=[f'implementations/{EDGE}/adapter.py',f'implementations/{EDGE}/test_adapter.py'],checks=[f'python3 implementations/{EDGE}/test_adapter.py: exit {result.returncode}',result.stderr[-6000:]])
    destination=project/'reports'/f'{EDGE}.json';destination.parent.mkdir(parents=True,exist_ok=True)
    temporary=destination.with_suffix('.json.tmp');temporary.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');temporary.replace(destination)
    return result.returncode

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('project',type=Path)
    raise SystemExit(verify(parser.parse_args().project.resolve()))
