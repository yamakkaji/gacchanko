# エージェント受け渡しの実装試験

形式が異なる独立した2つのプログラムを接続する、再現可能な試験です。
`scene-source` は保存された画面情報を JSON として出力し、`action-policy` は
専用の dataclass を受け取ります。LLM、外部API、実際のキーボード操作は使いません。
研究用リポジトリそのものの統合を検証した例ではありません。

## 空の接続プロジェクトを作る

リポジトリのルートで実行します。macOS、Python 3.10 以降、ビルド済みのアプリが必要です。

```sh
./build.sh
python3 examples/agent-handoff/prepare.py .build/handoff-demo.gacchanko
```

作ったフォルダをアプリの「開く」から選び、線を選択して「この接続をエージェントに渡す」を押します。
依頼文を Codex / Claude Code / ローカルファイルを読める ChatGPT に渡してください。
元パッケージのパスは、そのマシンの絶対パスとして作成されます。

## 今回の実装結果を試す

`solution` は、この試験で生成された依頼文・仕様書と両方のソースを読み、エージェントが実装した結果です。
先に作った空のプロジェクトに配置します。自分でエージェントに実装させた場合は、このコピーは不要です。

```sh
mkdir -p .build/handoff-demo.gacchanko/implementations/edge_scene_action
cp examples/agent-handoff/solution/*.py .build/handoff-demo.gacchanko/implementations/edge_scene_action/
python3 examples/agent-handoff/verify.py .build/handoff-demo.gacchanko
```

実際のテストに成功すると、その時の SPEC.md の fingerprint を使って
`reports/edge_scene_action.json` を書き、アプリで「検証済」と表示します。
13テストのうち11件は実プロセスでラッパーと参照先を実行します。
残り2件はタイムアウトと不正な標準出力を注入して、エラー処理を確認します。
既存の生成コード・レポートを含むディレクトリへ prepare.py を再実行すると停止します。

| 保存先 | 内容 |
|---|---|
| `graph.json` | 元のプログラムへの参照と接続意図 |
| `AGENT_BRIEF.md` / `connections/edge_scene_action/SPEC.md` | アプリが生成する依頼仕様 |
| `implementations/edge_scene_action/adapter.py` | 接続のための変換・呼び出し処理 |
| `implementations/edge_scene_action/test_adapter.py` | 実行検証 |
| `reports/edge_scene_action.json` | エージェント側が書く検証結果 |

## 試して分かったこと

- エッジIDを単位に成果物が配置されるため、元パッケージは編集せずに接続できます。
- CLI の JSON を Python の型へ変換するだけでも、座標系、欠落値、タイムアウト、応答の形式を決める必要があります。今回はその条件をエッジの意図に書きました。
- 「この接続だけ」の依頼と全体指示書の対象範囲が紛らわしかったため、単一エッジを指定されたらその接続だけを実装する文言に修正しました。
- 長いテストログで生成物の保存先が埋もれたため、確認記録を折りたたみ表示にしました。
- GUI はコードを実行するランナーではありません。テスト実行とレポート作成は依頼されたエージェントが行います。
- レポートをディスクから読み直して「実装済→検証済」を表示できました。仕様を変更すると実際の Swift fingerprint が一致しなくなり「要更新」になります。
- ネイティブアプリの画面操作は承認されなかったため、画面のドラッグ操作はブラウザプレビューで、報告反映は実際の Swift 保存処理と画面の DOM を組み合わせて確認しました。

開発者用の再検証（jsdom はアプリ本体には不要）:

```sh
xcrun swiftc -module-cache-path .build/module-cache Sources/Project.swift tests/store-driver/main.swift -o .build/store-driver
NODE_PATH="$PWD/.qa/node_modules" node tests/handoff-roundtrip.cjs .build/handoff-demo.gacchanko
```
