# デスクトップ環境から独立した設計

がっちゃんこ gacchanko はローカルで動くスタンドアロンのデスクトップアプリとして開発する。現行は Swift / AppKit / WKWebView。将来 Tauri へ移行するときも、グラフの編集画面とエージェントとのファイル連携を継続利用する。

## 責任の分担

| 部分 | 現行の実装 | Tauri へ移行する場合 |
|---|---|---|
| ノード・エッジ編集、選択、パン、ズーム、Undo、インスペクター | `web/app.js`、HTML、CSS | 画面側は継続利用 |
| エッジの表示設定・描画 | `web/appearance.js`、WebView の localStorage | 共通描画を継続利用。保存領域の移行時は設定キーも移行 |
| ホストとの通信 | `web/bridge.js` 内の Swift アダプター | 同じインターフェースの Tauri アダプターへ置換 |
| ウィンドウ、ファイルダイアログ、クリップボード、ドロップ、終了確認 | `Sources/main.swift` | Tauri / Rust 側で実装 |
| グラフ検証、保存、競合検知、仕様書生成、レポートの読み込み | `Sources/Project.swift` | Rust の独立した保存ロジックへ移植 |
| エージェントとの受け渡し | `graph.json`、`AGENT_BRIEF.md`、接続仕様、実装、レポート | 同じファイル形式を使用 |

画面は `window.gacchankoHost` のみを使用する。WebKit、AppKit、Tauri、ファイルシステムを画面から直接呼び出さない。今後のネイティブ機能もこの境界へ追加する。

## ホストのインターフェース

```ts
interface GacchankoPlatform {
  kind: string;
  request(command: string, args: Record<string, unknown>): Promise<unknown>;
  on(event: 'drop' | 'error', listener: (payload: unknown) => void):
    (() => void) | Promise<() => void>;
}
```

異なるデスクトップ環境は `bridge.js` より先に `window.gacchankoPlatform` を設定する。`bridge.js` はエラーを Error に正規化し、画面向けに `available`、`platform`、`request`、`on` を公開する。注入がなければ現行の Swift アダプターを使う。ネイティブ環境がなければ、ファイル操作を行えないブラウザプレビューとなる。

主なコマンドは以下の通り。入出力は JSON に変換できる値に限る。

| コマンド | 引数 | 戻り値 / 意味 |
|---|---|---|
| `state` | `{}` | ProjectSnapshot。開いていなければ `{project:null}` |
| `dirty` | `{value:boolean}` | 未保存状態をホストへ伝達。終了時に使用 |
| `inspect` | `{path:string}` | 参照先の name、path、kind、description、files |
| `chooseNodes` | `{}` | 選択したパスの配列。キャンセル時 `[]` |
| `newProject` | `{graph}` | 保存先を選択し ProjectSnapshot を返す。キャンセル時 `null` |
| `openProject` | `{}` | 読み込んだ ProjectSnapshot。キャンセル時 `null` |
| `save` | `{graph,revision}` | 現在のリビジョンを検査して保存。ProjectSnapshot を返す |
| `poll` | `{}` | ProjectSnapshot または `{externalChange:true,diskRevision:string}` |
| `reload` | `{}` | ディスクから再読み込みした ProjectSnapshot |
| `copyPrompt` | `{edgeID?:string}` | 依頼文をコピーし、その文字列を返す |
| `copy` | `{text:string}` | クリップボードへコピー |
| `reveal` | `{}` | OS のファイルマネージャーでプロジェクトを表示 |
| `exportJSON` | `{graph}` | 退避先を選択して保存し、パスを返す。キャンセル時 `null` |

ProjectSnapshot は `{project,root,revision,reports,fingerprints}`。`project` は schemaVersion 1 のグラフ。テスト専用コマンドは製品の移植対象に含めなくてよい。

`drop` イベントの payload は `{paths:string[],x:number,y:number}`。座標は **WebView の表示領域を基準とする CSS ピクセル**。Tauri 側の物理ピクセルをそのまま渡さず、表示倍率を考慮して変換する。`error` イベントは表示する文字列を渡す。

## Tauri 2 用アダプターの接続例

これは将来の接続例であり、Tauri 実行環境と Rust バックエンドはまだ実装していない。

```js
// bridge.js より先に読み込む。
// tauri.conf.json の app.withGlobalTauri = true が必要。
window.gacchankoPlatform = {
  kind: 'tauri',
  request(command, args) {
    return window.__TAURI__.core.invoke('gacchanko_rpc', {command, args});
  },
  on(event, listener) {
    return window.__TAURI__.event.listen(
      `gacchanko://${event}`,
      message => listener(message.payload)
    );
  }
};
```

Rust 側に `gacchanko_rpc` を登録し、上記のコマンドを実装する。OS 操作と保存処理を Rust 内でも分離する。ファイル操作の権限はアプリの必要な範囲で構成する。グラフを開くだけで外部のプログラムやモデルを実行しないという現行の挙動を保つ。

Tauri の公式リファレンス

- https://v2.tauri.app/ja/develop/calling-rust/
- https://v2.tauri.app/develop/calling-frontend/

移行には通信アダプターだけでなく、Swift の保存処理の Rust 移植、OS ごとのダイアログとドロップ、終了時の未保存確認、CSP・権限設定、配布用ビルドの検証が必要。現行版を Tauri でラップするだけで完了するとは扱わない。

保存するグラフ形式は維持し、Rust での fingerprint と revision の算出方法も既存の Swift 実装に合わせる。既存レポートの互換性を保証するため、共通のテストデータで比較する。JSON の数値や文字列の正規化が言語間で異なる場合は、明示的な形式更新と移行処理を用意する。
