# Swift版とTauri版の互換性

グラフ編集画面は同じ `web/` を使用します。両Mac版ともWebKitで表示しますが、ウィンドウ・ファイル選択・メニュー・ブリッジと保存処理は別実装です。完全に同一の動作を保証するものではありません。

## 自動確認

- 既存UIの回帰テスト：接続・付け替え・未接続エッジ・自己ループ、レイヤー、複数／範囲選択、移動、Undo/Redo、外観、Inspector、言語、チュートリアル。
- Rust保存処理の13テスト：検証・保護・提案・履歴・レポート・パス・テンプレート指示。
- `tests/tauri-compat.cjs`：Swiftで保存したサンプル2種類をRustで開き、再びSwiftで開く。fingerprintと履歴の互換性を比較。
- `tests/store-parity.cjs`：実際のSwift/Rust保存処理に同じ42操作を与えて比較。保存・再起動、レポートのverified/stale/blocked、保護・解除、コード保持、提案の部分採用・却下、壊れたJSON、未接続エッジ、原型の版固定を対象とする。

比較対象はグラフ、fingerprint、レポート状態と内容、変更フィールド、変更ファイル一覧、保護違反、履歴件数、操作の成功／拒否。プロジェクトの絶対パス、JSONの整形方法に依存するrevision、コミットID・日時・メッセージ、エラー文言は一致条件に含めません。

Macで保存処理を直接比較するコマンド：

```sh
mkdir -p .build/module-cache
xcrun swiftc -module-cache-path .build/module-cache Sources/Localization.swift Sources/Project.swift tests/parity-driver/main.swift -o .build/parity-driver
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features --example parity-driver
node tests/store-parity.cjs
```

## 実ウィンドウでの自動テスト

```sh
npm run test:native
```

デバッグビルドの専用ウィンドウで、Swift版と共通の `tests/ui-smoke.js` を実行します。WebView内の接続・選択・移動・Undo・設定操作に加え、実際のRust保存・履歴・クリップボード・レポート読み込みを通します。ユーザーのプロジェクトは開かず、一時フォルダと非永続WebViewを使います。結果JSONと一時プロジェクトの場所をターミナルへ出力します。失敗・タイムアウトは非ゼロ終了になります。

このテストはOSのファイル選択画面やFinderからのドラッグを操作しません。Macでのビルドと保存処理／DOMテストは確認済みですが、開発エージェントの実行環境ではGUI起動に失敗し、実WebViewの自動テスト完了は未確認です。

## 残る差分と実機確認

- Tauriの追加ダイアログはフォルダ選択。個別ファイルはドロップかパス指定で追加できます。Swift版のダイアログはファイルとフォルダを同時に選択できます。
- Tauriの「開く」はプロジェクトフォルダを選択します。Swift版では `graph.json` も選択できます。
- 一部のRustエラー文言は日本語設定でも英語です。エージェント向け依頼文とアプリのメニュー・画面は日英に対応します。
- アプリ設定の保存領域は別なので、Swift版の外観・言語設定は自動移行されません。
- Swift版のCLIオプション `--project` / `--refresh` はTauri版では未実装です。
- Tauriは生成ファイルの経路上のシンボリックリンクをすべて拒否します。Swift版のプロジェクト外へのリンク拒否より厳しい扱いです。

手動で残るのは、ファイル選択での保存／開く、Finderからのドロップ位置、未保存で閉じる／終了するときの確認です。これらは上記の自動テスト成功だけでは保証できません。
