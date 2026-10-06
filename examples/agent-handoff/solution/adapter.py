"""capture.v1 CLI -> SceneView -> Decision JSON. One frame per invocation."""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys

EDGE_ID = 'edge_scene_action'
PROJECT = Path(__file__).resolve().parents[2]

def finite_number(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('coordinates and dimensions must be finite numbers')
    return value

def target_offset(payload):
    if not isinstance(payload, dict) or payload.get('schema') != 'capture.v1':
        raise ValueError('expected capture.v1')
    observation = payload['observation']
    width = finite_number(observation['screen']['w'])
    height = finite_number(observation['screen']['h'])
    if width <= 0 or height <= 0:
        raise ValueError('screen dimensions must be positive')
    detections = observation['detections']
    if not isinstance(detections, list):
        raise ValueError('detections must be a list')
    result = None
    for detection in detections:
        if not isinstance(detection, dict) or not isinstance(detection.get('name'), str):
            raise ValueError('each detection needs a name')
        centre = detection['center']
        if not isinstance(centre, list) or len(centre) != 2:
            raise ValueError('center must contain two coordinates')
        x, y = map(finite_number, centre)
        if not 0 <= x <= width or not 0 <= y <= height:
            raise ValueError('center is outside the screen')
        if detection['name'] == 'goal' and result is None:
            result = (2*x/width-1, 2*y/height-1)
    return result

def run(frame):
    graph = json.loads((PROJECT/'graph.json').read_text())
    edge = next(e for e in graph['edges'] if e['id'] == EDGE_ID)
    nodes = {n['id']: n for n in graph['nodes']}
    source = Path(nodes[edge['source']]['path'])/'observe.py'
    target = Path(nodes[edge['target']]['path'])/'policy.py'
    try:
        captured = subprocess.run([sys.executable, str(source), '--frame', str(frame.resolve())], check=True, capture_output=True, text=True, timeout=2)
    except subprocess.TimeoutExpired as exc:
        raise ValueError('scene source timed out after 2 seconds') from exc
    except subprocess.CalledProcessError as exc:
        raise ValueError('scene source failed: '+exc.stderr.strip()[-500:]) from exc
    offset = target_offset(json.loads(captured.stdout))
    spec = importlib.util.spec_from_file_location('gacchanko_action_policy', target)
    if spec is None or spec.loader is None:
        raise ValueError('cannot load action policy')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    decision = module.choose(module.SceneView(target_offset=offset))
    return {'action': decision.key, 'duration_ms': decision.duration_ms, 'target_offset': offset}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frame', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.frame), allow_nan=False))
    except (OSError, ValueError, KeyError, TypeError, StopIteration) as exc:
        print('adapter error: '+str(exc), file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
