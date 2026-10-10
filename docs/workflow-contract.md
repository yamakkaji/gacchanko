# 実装状態と実行仕様

schemaVersion 1に任意フィールドを追加しています。旧ファイルはそのまま開けます。

Inspectorは `not implemented` / `implemented` の2択です。変更するとそれぞれ `planned` / `existing` を保存します。旧値は表示だけでは書き換えず、`unspecified` は未実装側、`verified` は実装済み側に表示します。

ノードの `implementationState` は `unspecified`（省略時）、`planned`、`existing`、`verified`。ユーザーの申告であり、検証レポートとは別です。既存実装の指定には参照先を記入してください。

接続の `layer` は `data`（省略時）、`control`、`event`。dataは値の受け渡し、controlはソース完了後の対象起動、eventはイベントごとの対象起動です。従来の `mode` は片方向／リクエスト応答という通信形式として保持します。リクエスト応答の返り値は同じエッジに含みます。

```json
{
  "layer": "event",
  "execution": {
    "dispatch": "async",
    "join": "all",
    "after": ["edge_prepare"],
    "maxConcurrency": 2,
    "timeoutMs": 30000,
    "bufferSize": 32,
    "overflow": "block",
    "onError": "stop"
  }
}
```

- `after` は同じ `run_id`・`iteration_id` 内で完了を待つ接続IDです。起動入力に加え、この条件を満たして起動します。`all` はすべて、`any` は最初の完了で一度だけ起動し、後着結果で二重起動しません。空なら入力・開始・イベントが起動契機です。
- `sync` は呼び出し元が完了を待ちます。並列数は1。`async` はキューへ送り呼び出し元が先へ進みます。
- `maxConcurrency` はエッジごとの実行中タスク数の上限（1–64）。`bufferSize` は待機項目数の上限（1–10000）。
- `overflow` は `block`（送信側を待機）、`dropOldest`（最古の待機項目を破棄）、`dropNewest`（新しい項目を破棄）。実行中のタスクを勝手に破棄しません。
- `timeoutMs` は依存待ち・キュー待ちを含むタスク期限（1–3600000）。`onError` は `stop`（実行全体を停止）、`continue`（エラー結果を返して継続）。失敗した依存を無期限に待たせないでください。
- キャンセル、再試行、重複排除、開始・終了条件は意図・設計指示に記述します。副作用のある操作を自動再試行してはいけません。
- 完了待ちの循環は保存時に拒否します。観測→行動→観測のような反復は、新しい反復IDでイベントとして起動し、停止条件を明記してください。

`execution` の省略は未確定を意味します。Inspectorに表示する初期値は「この実行設定を確定」または設定の変更で保存されます。依存IDは原型からのvariant生成時にも新IDへ変換します。原型の選択範囲外への完了待ちは含まれません。

これらは生成コードに対する契約です。がっちゃんこ自体がモデルや接続コードを起動・実行することはありません。設計チェックのOKも実行時の成功を保証しません。
