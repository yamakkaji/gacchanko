"""Create a fresh integration project using this checkout's absolute paths."""
import argparse
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

def prepare(destination):
    destination = destination.resolve()
    if destination.exists() and any(destination.iterdir()):
        raise SystemExit('Choose an empty or new project directory.')
    destination.mkdir(parents=True, exist_ok=True)
    def node(id, name, path, x):
        return dict(id=id, name=name, path=str(path), kind='directory', description='', command='', inputs=['in'], outputs=['out'], x=x, y=120)
    graph = dict(schemaVersion=1, name='Agent handoff trial', description='保存された画面観測を行動判断へ渡す。実際のPC操作やLLMの呼び出しは行わない。', nodes=[node('capture','Scene source',HERE/'scene-source',40),node('policy','Action policy',HERE/'action-policy',470)], edges=[dict(id='edge_scene_action',source='capture',target='policy',sourcePort='out',targetPort='in',label='Observation → decision',mode='request',intent='source の CLI にフレーム JSON のパスを渡し、capture.v1 の observation を target の SceneView に変換して choose を呼ぶ。name が goal の最初の detection の中心を画面中央基準の [-1,1] 座標に正規化する。goal がなければ None。Decision を JSON で返す CLI adapter.py を実装し、--frame を必須引数にする。元の2パッケージは変更しない。入力の欠落・非数・画面寸法が0以下・範囲外の座標・不正な JSON・CLI 失敗を明確なエラーにする。source のタイムアウトは2秒。右・左・中央・goalなし・不正入力を実行テストする。モデルやネットワークは使用しない。')])
    (destination/'graph.json').write_text(json.dumps(graph,ensure_ascii=False,indent=2)+'\n')
    binary=REPO/'dist/gacchanko.app/Contents/MacOS/gacchanko'
    subprocess.run([str(binary),'--refresh',str(destination)],check=True)
    return destination

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination',type=Path)
    print(prepare(parser.parse_args().destination))
