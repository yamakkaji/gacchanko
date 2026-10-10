import Foundation

enum Localization {
    static var defaults = UserDefaults.standard
    static var language: String {
        get { defaults.string(forKey: "gacchanko-language") == "en" ? "en" : "ja" }
        set { if ["ja", "en"].contains(newValue) { defaults.set(newValue, forKey: "gacchanko-language") } }
    }
    static let english: [String: String] = [
        "外部の設計変更が保護または形式の検査で拒否されました。GUIで差分を確認してください。": "External design changes failed protection or format checks. Review them in the app.",
        "がっちゃんこ を終了": "Quit gacchanko",
        "ノードとして追加": "Add as node",
        "グラフがありません。": "No graph was supplied.",
        "プロジェクトの保存先": "Save project",
        "プロジェクトフォルダ、または graph.json を選択": "Choose a project folder or graph.json",
        "開く": "Open",
        "保存": "Save",
        "先に保存してください。": "Save the project first.",
        "設計の保護を解除しますか？": "Unlock this design?",
        "解除は履歴に記録され、この要素を編集できるようになります。": "Unlocking will be recorded in history and allow this component to be edited.",
        "解除": "Unlock",
        "キャンセル": "Cancel",
        "未保存の編集があります。JSONを書き出して退避するか、外部提案を退避して先に保存してください。": "You have unsaved edits. Export JSON, or archive the external proposal and save first.",
        "プロジェクトを開いてください。": "Open a project first.",
        "未対応の操作: ": "Unsupported operation: ",
        "まだ保存されていない編集があります": "You have unsaved changes",
        "編集を続けて保存するか、未保存の変更を破棄して閉じてください。": "Continue editing and save your work, or discard the unsaved changes and close.",
        "編集を続ける": "Continue editing",
        "破棄して閉じる": "Discard and close",
        "未対応のグラフ形式です。schemaVersion は 1 にしてください。": "Unsupported graph format. Use schemaVersion 1.",
        "ノード数または接続数が上限を超えています。": "The node or edge limit has been exceeded.",
        "ノードIDが重複しているか、使用できない文字を含んでいます。": "Node IDs are duplicated or contain invalid characters.",
        "接続IDが不正です。": "Invalid edge ID.",
        "実装状態が不正です。": "Invalid implementation state.",
        "ノードの外観設定が不正です。": "Invalid node appearance settings.",
        "ノードの名前、位置、ポート名を確認してください。": "Check node names, positions and port names.",
        "エッジの外観設定が不正です。": "Invalid edge appearance settings.",
        "接続レイヤーが不正です。": "Invalid connection layer.",
        "非同期実行設定を確認してください。": "Check asynchronous execution settings.",
        "待機先の接続が見つかりません。": "A completion dependency refers to a missing edge.",
        "未接続の端点の位置が不正です。": "Invalid unconnected endpoint position.",
        "接続先またはポートが見つかりません。": "The connected node or port could not be found.",
        "接続の種類が不正です。": "Invalid connection type.",
        "完了待ちの依存関係が循環しています。反復はイベントで表し、停止条件を指定してください。": "Completion dependencies form a cycle. Use events for iteration and specify a stop condition.",
        "graph.json が大きすぎます。": "graph.json is too large.",
        "空のフォルダ、または新しい名前を選んでください。既存ファイルは上書きしません。": "Choose an empty folder or a new name. Existing files will not be overwritten.",
        "プロジェクト内の相対パスが必要です。": "A relative path within the project is required.",
        "プロジェクト外への書き込みはできません。": "Cannot write outside the project.",
        "保護された設計は変更できません。先に明示的に保護を解除してください。": "Protected designs cannot be changed. Explicitly unlock them first.",
        "保護された実装ファイルに外部変更があります。変更を戻すか、対象エッジを明示的に解除してください。": "Protected implementation files have external changes. Revert them or explicitly unlock the component.",
        "別のツールがグラフを更新しました。未保存の編集を JSON 書き出しで退避し、再読み込みしてください。": "Another tool changed the graph. Export unsaved edits as JSON, then reload.",
        "先にプロジェクトを保存してください。": "Save the project first.",
        "対象のノードが見つからないか、対象指定が重複しています。": "The target node is missing or multiple targets were specified.",
        "パスが見つかりません: ": "Path not found: ",
        "原型は200版までです。": "Up to 200 template versions are supported.",
        "原型のID・版・構成を確認してください。原型の中に派生参照は保存しません。": "Check template IDs, versions and members. Template members cannot contain variant references.",
        "policy は mutable / immutable / template のいずれかです。": "Policy must be mutable, immutable or template.",
        "原型の版または構成要素が見つかりません。": "The template version or member could not be found.",
        "履歴の保存先がプロジェクト外です。": "The history directory is outside the project.",
        "プロジェクトのGit履歴を読み込めません。": "Could not read the project's Git history.",
        "Git履歴を保存できません。": "Could not save Git history.",
        "履歴対象にシンボリックリンクは使えません: ": "History cannot include symbolic links: ",
        "履歴対象のファイルが20MBを超えています: ": "A history file exceeds 20 MB: ",
        "履歴対象は10000ファイルまでです。": "History supports up to 10,000 files.",
        "履歴の版が見つかりません。": "The history revision could not be found.",
        "提案が更新されました。比較を開き直してください。": "The proposal has changed. Open the comparison again.",
        "提案が大きすぎます。": "The proposal is too large.",
        "採用する変更を選択してください。": "Select changes to accept.",
        "選択した変更には保護対象が含まれます。解除せずに採用できません。": "The selected changes include protected components. Unlock them before accepting.",
        "解除対象が見つかりません。": "The component to unlock could not be found.",
        "外部の変更が進みました。差分を再確認してください。": "External changes have progressed. Review the differences again.",
        "リモートリポジトリ。まだローカルには取得していません。": "Remote repository. Not yet available locally."
    ]
    static let japanese = ["Edit": "編集", "Undo": "元に戻す", "Cut": "切り取り", "Copy": "コピー", "Paste": "ペースト", "Select All": "すべて選択"]
    static func text(_ source: String, language: String? = nil) -> String {
        guard (language ?? self.language) == "en" else { return japanese[source] ?? source }
        if let translated = english[source] { return translated }
        // Some application errors append paths or diagnostics. Translate only
        // the application-owned prefix, leaving diagnostic content untouched.
        for key in english.keys.sorted(by: { $0.count > $1.count }) where source.hasPrefix(key) {
            return english[key]! + source.dropFirst(key.count)
        }
        return source
    }
}
func L(_ source: String) -> String { Localization.text(source) }
