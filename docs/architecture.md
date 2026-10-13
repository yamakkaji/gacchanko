# デスクトップ環境から独立した設計

がっちゃんこ gacchanko はローカルで動くスタンドアロンのデスクトップアプリとして開発する。現行のクロスプラットフォーム版はTauri 2 / Rust。従来のSwift / AppKit / WKWebView版も互換確認用に保持している。画面とエージェントとのファイル連携形式は共通。

## 責任の分担

| 部分 | Swift版 | Tauri版 |
|---|---|---|
| ノード・エッジ編集、選択、パン、ズーム、Undo、インスペクター | `web/app.js`、HTML、CSS | 画面側は継続利用 |
| エッジの表示設定・描画 | `web/appearance.js`、WebView の localStorage | 共通描画を継続利用。保存領域の移行時は設定キーも移行 |
| ホストとの通信 | `web/bridge.js` 内の Swift アダプター | `web/tauri.js` の同一インターフェース |
| ウィンドウ、ファイルダイアログ、クリップボード、ドロップ、終了確認 | `Sources/main.swift` | `src-tauri/src/main.rs` |
| グラフ検証、保存、競合検知、仕様書生成、レポートの読み込み | `Sources/Project.swift` | `src-tauri/src/store.rs`、`graph.rs`、`history.rs` |
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
| `adoptExternal` | `{diskRevision, selections: ["node:id", "edge:id", "template:id:version", "project:project"]}` | 検証・選択採用した ProjectSnapshot |
| `reload` | `{}` | ディスクから再読み込みした ProjectSnapshot |
| `copyPrompt` | `{edgeID?:string,nodeID?:string}` | 依頼文をコピーし、その文字列を返す |
| `copy` | `{text:string}` | クリップボードへコピー |
| `reveal` | `{}` | OS のファイルマネージャーでプロジェクトを表示 |
| `exportJSON` | `{graph}` | 退避先を選択して保存し、パスを返す。キャンセル時 `null` |

ProjectSnapshot は `{project,root,revision,reports,fingerprints,nodeReports,nodeFingerprints}`。`copyPrompt`はedgeIDとnodeIDの同時指定を拒否し、nodeID指定時はそのノードだけの依頼文を生成します。ノードのレポートとfingerprintはエッジと別のマップで扱います。`project` は schemaVersion 1 のグラフ。テスト専用コマンドは製品の移植対象に含めなくてよい。

`drop` イベントの payload は `{paths:string[],x:number,y:number}`。座標は **WebView の表示領域を基準とする CSS ピクセル**。Tauri 側の物理ピクセルをそのまま渡さず、表示倍率を考慮して変換する。`error` イベントは表示する文字列を渡す。

## Tauri 2 用アダプター

`web/tauri.js` が実際のTauri実行環境を検出し、次のアダプターを登録する。ブラウザプレビューとSwift版では何もしない。

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

Rust側の `gacchanko_rpc` が上記のコマンドを実装する。OS 操作と保存処理を Rust 内でも分離する。ファイル操作の権限はアプリの必要な範囲で構成する。グラフを開くだけで外部のプログラムやモデルを実行しないという現行の挙動を保つ。

Tauri の公式リファレンス

- https://v2.tauri.app/ja/develop/calling-rust/
- https://v2.tauri.app/develop/calling-frontend/

Tauri版は独立したRustの保存処理とlibgit2を使い、Swift実行ファイルや外部Gitに依存しない。ネイティブダイアログはイベントスレッドを塞がないスレッドで開く。終了とウィンドウ閉鎖の両方で未保存確認を行う。CSPで外部スクリプトを拒否し、ナビゲーションをアプリのローカルoriginへ制限する。フロントエンドには汎用ファイル書き込み・シェル実行の権限を与えない。

保存するグラフ形式は維持し、Rust での fingerprint と revision の算出方法も既存の Swift 実装に合わせる。既存レポートの互換性を保証するため、`tests/tauri-compat.cjs` で両ホストを実行して比較する。JSON の数値や文字列の正規化が言語間で異なる場合は、明示的な形式更新と移行処理を用意する。


## Versioned design bridge

The host snapshot includes `history` (head, commits, per-member changes, changed files, protectedFiles) and optionally `pendingExternal`. The graph keeps optional `policy`, `designInstructions`, `derivedFrom` on nodes/edges, and `templates` at the root. See [design-versioning.md](design-versioning.md).

- `historyDetail {id}` returns parent-to-commit design changes and the Git patch. Only full hexadecimal commit IDs are accepted.
- `unlock {kind, id, revision}` requires a native user confirmation, then records a dedicated policy change. Normal `save` cannot unlock protected members.
- `rejectExternal {diskRevision}` archives the candidate JSON and restores the last accepted graph, with optimistic concurrency validation.
- `poll` returns pending changes and protection violations instead of accepting them. A valid external edit is adopted by `reload` only when the frontend has no local draft.

`web/design.js` contains pure graph diff, protection, subgraph capture and variant operations. Both Swift and Rust stores independently enforce policy at the persistence boundary; disabling a frontend control alone is insufficient.

## 未接続のエッジ

エッジは独立したコンポーネントなので、付け替えで空白に離しても削除しない。未接続側の `source` / `target` と対応する `sourcePort` / `targetPort` は空文字とし、`sourcePosition` / `targetPosition` にキャンバス座標 `{x, y}` を保存する。接続済みの側には位置フィールドを持たせない。既存の完全接続の形式は変更しない。存在しないノードID・ポートは引き続き不正として拒否する。

端点の座標は実装fingerprintに含めず、接続・切断は含める。未接続エッジもSPECとMermaidへ出力し、設計チェックとエージェント向け仕様書で未接続であることを明記する。ID・意味内容・実装ファイル・レポートは保持する。原型に含まれる未接続エッジも派生時に保持し、端点の位置をノードと同じ量だけ移動する。

新規の線を空白で離す操作は、追加先の座標・接続方向・レイヤーをノード追加画面に渡す。追加を確定した時だけノードとエッジを一括変更として記録する。追加画面のキャンセル・Esc・キャンバス外へのドロップでは既存の設計を変更しない。

## 言語設定とチュートリアル

`web/i18n.js` はアプリが所有する文字列だけを翻訳する。静的なHTMLはアプリ起動前にテキストと属性を記録し、動的なUIは `i18n.t` と `i18n.html` を使う。タグ付きテンプレートの補間値は翻訳しない。ノード名・説明・パス・エージェントのレポートを翻訳辞書に渡さない。

設定は `gacchanko-language` としてlocalStorageへ保存する。Swift版ではネイティブのUserDefaultsにも保存する。Tauri版は起動時にlocalStorageの値をネイティブメニューへ同期する。WebKit初期化時に保存済み言語を注入し、`setLanguage({language: 'ja' | 'en'})` でアプリメニューも更新する。言語設定はgraph.jsonやfingerprintに含めない。macOS標準のファイル選択画面の一部はOSの言語に従う。

`web/tutorial.js` は日英の6ステップの閲覧専用画面を提供する。ステップ移動と表示言語の変更は設計・選択・Undo履歴を変更しない。回帰確認は `tests/language-test.cjs`、ネイティブのローカライズと依頼文は `Sources/SelfTest.swift` で行う。

## ビルドと配布

`npm run dev` と `npm run build` がTauriの標準入口。依存関係は `package-lock.json` と `src-tauri/Cargo.lock` で固定する。Macでもビルド時にはCommand Line Toolsが必要だが、配布アプリの利用者には不要。Git履歴はlibgit2で生成し、既存の `.gacchanko/history.git` と互換。

`.github/workflows/desktop.yml` はMacのarm64 / x64とWindows x64でビルドし、インストーラーをArtifactsへ保存する。vタグでは下書きReleaseへ添付する。Mac実機以外の動作検証、署名・公証は別途必要。

Tauriのノード追加ダイアログはフォルダ選択。個別ファイルはドラッグ＆ドロップまたはパス指定で追加できる。プロジェクトはフォルダを選択して開く。ドロップ座標はRust側で表示倍率を除算してCSSピクセルへ変換する。Windowsの保存・開く・UndoはCtrlキーにも対応する。
