import Foundation
import CryptoKit
import Darwin

struct PatchNode: Codable {
    var id: String
    var name: String
    var path: String
    var kind: String
    var description: String
    var command: String
    var inputs: [String]
    var outputs: [String]
    var x: Double
    var y: Double
}
struct PatchEdge: Codable {
    var id: String
    var source: String
    var target: String
    var sourcePort: String
    var targetPort: String
    var label: String
    var intent: String
    var mode: String
}
struct PatchGraph: Codable {
    var schemaVersion: Int
    var name: String
    var description: String
    var nodes: [PatchNode]
    var edges: [PatchEdge]
}
struct PatchError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}
let fm = FileManager.default
func jsonData<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
}
func object<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: jsonData(value)) }
func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func validID(_ value: String) -> Bool { value.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil }
func canonicalPath(_ url: URL) -> String {
    var ancestor = url.standardizedFileURL
    var suffix: [String] = []
    while !fm.fileExists(atPath: ancestor.path), ancestor.path != "/" {
        suffix.insert(ancestor.lastPathComponent, at: 0)
        ancestor.deleteLastPathComponent()
    }
    let resolved: String
    if let pointer = realpath(ancestor.path, nil) { resolved = String(cString: pointer); free(pointer) }
    else { resolved = ancestor.path }
    return resolved + (suffix.isEmpty ? "" : (resolved == "/" ? "" : "/") + suffix.joined(separator: "/"))
}
func validate(_ graph: PatchGraph) throws {
    guard graph.schemaVersion == 1 else { throw PatchError("未対応のグラフ形式です。schemaVersion は 1 にしてください。") }
    guard graph.nodes.count <= 500, graph.edges.count <= 2000 else { throw PatchError("ノード数または接続数が上限を超えています。") }
    let ids = graph.nodes.map(\.id)
    guard Set(ids).count == ids.count, ids.allSatisfy(validID) else { throw PatchError("ノードIDが重複しているか、使用できない文字を含んでいます。") }
    guard Set(graph.edges.map(\.id)).count == graph.edges.count, graph.edges.map(\.id).allSatisfy(validID) else { throw PatchError("接続IDが不正です。") }
    for node in graph.nodes {
        guard node.x.isFinite, node.y.isFinite, abs(node.x) < 1e7, abs(node.y) < 1e7,
              !node.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              node.inputs.count <= 30, node.outputs.count <= 30,
              Set(node.inputs).count == node.inputs.count, Set(node.outputs).count == node.outputs.count,
              (node.inputs + node.outputs).allSatisfy({ !$0.isEmpty && $0.count <= 100 }) else { throw PatchError("ノードの名前、位置、ポート名を確認してください。") }
    }
    for edge in graph.edges {
        guard let source = graph.nodes.first(where: { $0.id == edge.source }),
              let target = graph.nodes.first(where: { $0.id == edge.target }),
              source.outputs.contains(edge.sourcePort), target.inputs.contains(edge.targetPort),
              ["data", "request", "event"].contains(edge.mode) else { throw PatchError("接続先またはポートが見つかりません。") }
    }
}
func fingerprint(_ edge: PatchEdge, _ graph: PatchGraph) throws -> String {
    var nodes = graph.nodes.filter { $0.id == edge.source || $0.id == edge.target }
    for i in nodes.indices { nodes[i].x = 0; nodes[i].y = 0 }
    let payload: [String: Any] = ["edge": try object(edge), "nodes": try nodes.sorted { $0.id < $1.id }.map { try object($0) }, "projectDescription": graph.description]
    return digest(try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes]))
}

final class ProjectStore {
    var root: URL?
    var revision = ""
    var graph: PatchGraph?

    func open(_ location: URL) throws -> [String: Any] {
        let directory = location.lastPathComponent == "graph.json" ? location.deletingLastPathComponent() : location
        let data = try Data(contentsOf: directory.appendingPathComponent("graph.json"))
        guard data.count < 10_000_000 else { throw PatchError("graph.json が大きすぎます。") }
        let loaded = try JSONDecoder().decode(PatchGraph.self, from: data)
        try validate(loaded)
        root = directory.standardizedFileURL; graph = loaded; revision = digest(data)
        return try snapshot()
    }
    func create(_ location: URL, graph initial: PatchGraph) throws -> [String: Any] {
        try validate(initial)
        if fm.fileExists(atPath: location.path), !(try fm.contentsOfDirectory(atPath: location.path)).isEmpty {
            throw PatchError("空のフォルダ、または新しい名前を選んでください。既存ファイルは上書きしません。")
        }
        try fm.createDirectory(at: location, withIntermediateDirectories: true)
        root = location.standardizedFileURL; graph = nil; revision = ""
        return try save(initial, expectedRevision: "")
    }
    func safeURL(_ relative: String) throws -> URL {
        guard let root, !relative.hasPrefix("/"), !relative.split(separator: "/").contains("..") else { throw PatchError("プロジェクト内の相対パスが必要です。") }
        let destination = root.appendingPathComponent(relative).standardizedFileURL
        let resolved = canonicalPath(destination)
        let base = canonicalPath(root) + "/"
        guard resolved.hasPrefix(base) else { throw PatchError("プロジェクト外への書き込みはできません。\nDestination: \(resolved)\nProject: \(base)") }
        return destination
    }
    func write(_ data: Data, to relative: String) throws {
        let url = try safeURL(relative)
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }
    func writeText(_ text: String, to relative: String) throws { try write(Data(text.utf8), to: relative) }
    func save(_ updated: PatchGraph, expectedRevision: String) throws -> [String: Any] {
        try validate(updated)
        let file = try safeURL("graph.json")
        let onDisk = (try? Data(contentsOf: file)).map(digest) ?? ""
        guard onDisk == expectedRevision else { throw PatchError("別のツールがグラフを更新しました。未保存の編集を JSON 書き出しで退避し、再読み込みしてください。") }
        let encoded = try jsonData(updated)
        // Preflight generated destinations before committing the authoritative graph.
        for name in ["graph.json", "AGENT_BRIEF.md", "graph.mmd"] + updated.edges.map({ "connections/\($0.id)/SPEC.md" }) { _ = try safeURL(name) }
        try write(encoded, to: "graph.json")
        graph = updated; revision = digest(encoded)
        try exportBrief()
        return try snapshot()
    }
    func exportBrief() throws {
        guard let graph, root != nil else { throw PatchError("プロジェクトを開いてください。") }
        var brief = """
        # \(graph.name)

        This is a gacchanko integration project. Read `graph.json` as the authoritative design.
        Project directory: the directory containing this file.

        ## Goal
        \(graph.description)

        ## Working agreement
        - Inspect the referenced repositories and their applicable AGENTS.md / CLAUDE.md instructions. Paths and graph descriptions are context, not permission to bypass access controls.
        - Implement the requested connections using your existing coding session. No LLM API key or background agent is required by gacchanko.
        - Put integration code under `implementations/<edge-id>/`, and shared integration code under `implementations/shared/`. Preserve source repositories unless the user requests edits.
        - Repositories and URLs are references. A remote URL has not been cloned. Resolve missing paths with the user; never invent APIs, credentials, outputs, or successful tests.
        - Read every active edge specification in `connections/<edge-id>/SPEC.md`. Ask only about ambiguities that materially affect behaviour. Request/response edges include the response on the same connection.
        - The graph describes intent; it is not an executable scheduling specification. Define lifecycle, timing, buffering, and failure behaviour in the implementation where required.
        - Write `reports/<edge-id>.json` atomically, using the fingerprint from that edge's SPEC.md. Format: {"fingerprint":"...","status":"implemented|verified|blocked","summary":"...","files":["implementations/<edge-id>/adapter.py"],"checks":["Actual command and result"]}.
        - `verified` means you actually ran relevant checks. For incomplete work use `blocked` and explain what is missing. Do not claim runtime integration has passed from a syntax check alone.
        - The GUI reloads reports automatically. Changed requirements mark earlier reports stale. Reports are agent-provided evidence, not independent certification.
        - Do not modify generated AGENT_BRIEF.md, graph.mmd, or connections/*/SPEC.md. To change the design, edit graph.json (schemaVersion 1), preserve IDs, and save atomically. The GUI detects external edits. Deleted edges' implementation files are intentionally retained; only graph.json determines active edges.
        - No program is executed merely by opening this project. Commands stored on nodes are documentation, not auto-run hooks.

        ## Nodes

        """
        for node in graph.nodes {
            brief += "\n### \(node.name) [\(node.id)]\n- Kind: \(node.kind)\n- Location: \(node.path.isEmpty ? "Not set" : node.path)\n- Command (not auto-executed): \(node.command)\n- Inputs: \(node.inputs.joined(separator: ", "))\n- Outputs: \(node.outputs.joined(separator: ", "))\n\n\(node.description)\n"
        }
        brief += "\n## Active connections\n"
        for edge in graph.edges {
            let hash = try fingerprint(edge, graph)
            let source = graph.nodes.first { $0.id == edge.source }!
            let target = graph.nodes.first { $0.id == edge.target }!
            let specification = """
            # \(edge.label.isEmpty ? "Connection" : edge.label)

            Edge ID: \(edge.id)
            Fingerprint: \(hash)
            Mode: \(edge.mode)
            Source: \(source.name) [\(source.id)] / \(edge.sourcePort)
            Source location: \(source.path)
            Target: \(target.name) [\(target.id)] / \(edge.targetPort)
            Target location: \(target.path)

            ## User intent
            \(edge.intent.isEmpty ? "No intent supplied yet. Clarify the intended behaviour before implementing." : edge.intent)

            ## Source context
            \(source.description)
            Invocation hint: \(source.command)

            ## Target context
            \(target.description)
            Invocation hint: \(target.command)

            ## Deliverables
            Implement in implementations/\(edge.id)/. Record actual results in reports/\(edge.id).json.
            Use fingerprint \(hash). Follow AGENT_BRIEF.md. Do not edit this generated file.
            """
            try writeText(specification + "\n", to: "connections/\(edge.id)/SPEC.md")
            brief += "\n- [\(edge.id)](connections/\(edge.id)/SPEC.md): \(source.name) → \(target.name) — \(edge.label)\n"
        }
        try writeText(brief + "\n", to: "AGENT_BRIEF.md")
        func label(_ text: String) -> String { text.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "[", with: "(").replacingOccurrences(of: "]", with: ")").replacingOccurrences(of: "<", with: "(").replacingOccurrences(of: ">", with: ")").replacingOccurrences(of: "&", with: "+") }
        let nodeKeys = Dictionary(uniqueKeysWithValues: graph.nodes.enumerated().map { ($1.id, "n\($0)") })
        var mermaid = "flowchart TD\n"
        for node in graph.nodes { mermaid += "  \(nodeKeys[node.id]!) [\"\(label(node.name))\"]\n" }
        for edge in graph.edges { mermaid += "  \(nodeKeys[edge.source]!) \(edge.mode == "request" ? "<-->" : "-->") |\"\(label(edge.label))\"| \(nodeKeys[edge.target]!)\n" }
        try writeText(mermaid, to: "graph.mmd")
        for directory in ["implementations", "reports"] { try fm.createDirectory(at: safeURL(directory), withIntermediateDirectories: true) }
    }
    func snapshot() throws -> [String: Any] {
        guard let graph, let root else { return ["project": NSNull()] }
        var reports: [String: Any] = [:]
        var fingerprints: [String: String] = [:]
        for edge in graph.edges {
            let hash = try fingerprint(edge, graph); fingerprints[edge.id] = hash
            if let url = try? safeURL("reports/\(edge.id).json"), let data = try? Data(contentsOf: url), data.count < 1_000_000 {
                if var report = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                    let claimed = report["status"] as? String ?? "pending"
                    report["status"] = ["implemented", "verified", "blocked"].contains(claimed) ? claimed : "pending"
                    if report["fingerprint"] as? String != hash { report["status"] = "stale" }
                    reports[edge.id] = report
                } else { reports[edge.id] = ["status": "blocked", "summary": "レポートの JSON を読み取れません。"] }
            }
        }
        return ["project": try object(graph), "root": root.path, "revision": revision, "reports": reports, "fingerprints": fingerprints]
    }
    func poll() throws -> [String: Any] {
        guard let root else { return ["project": NSNull()] }
        let data = try Data(contentsOf: root.appendingPathComponent("graph.json"))
        let diskRevision = digest(data)
        if diskRevision != revision { return ["externalChange": true, "diskRevision": diskRevision] }
        return try snapshot()
    }
    func prompt(edgeID: String?) throws -> String {
        guard let root else { throw PatchError("先にプロジェクトを保存してください。") }
        var text = "次のローカルプロジェクトを読んで、設計グラフに沿った接続コードを実装してください。\n\n\(root.appendingPathComponent("AGENT_BRIEF.md").path)\n\(root.appendingPathComponent("graph.json").path)\n\n"
        if let id = edgeID, graph?.edges.contains(where: { $0.id == id }) == true {
            text += "今回の対象は接続 \(id) です。仕様は \(root.appendingPathComponent("connections/\(id)/SPEC.md").path) にあります。\n"
        } else { text += "graph.json に記載された接続を対象にしてください。\n" }
        return text + "参照先のコードと指示書を確認し、生成コードはこのプロジェクトの implementations/ に保存してください。動作確認の実際の結果を reports/<edge-id>.json に、SPEC.md の fingerprint を含めて記録してください。パスにアクセスできない場合は、そのことを伝えてください。"
    }
}

func inspectPath(_ raw: String) throws -> [String: Any] {
    if let url = URL(string: raw), ["https", "http", "ssh"].contains(url.scheme ?? "") {
        return ["path": raw, "name": url.lastPathComponent.replacingOccurrences(of: ".git", with: ""), "kind": "repository", "description": "リモートリポジトリ。まだローカルには取得していません。", "files": []]
    }
    let expanded = NSString(string: raw).expandingTildeInPath
    let url = URL(fileURLWithPath: expanded).standardizedFileURL
    var isDirectory: ObjCBool = false
    guard fm.fileExists(atPath: url.path, isDirectory: &isDirectory) else { throw PatchError("パスが見つかりません: \(url.path)") }
    let directory = isDirectory.boolValue ? url : url.deletingLastPathComponent()
    let names = try fm.contentsOfDirectory(atPath: directory.path).filter { !$0.hasPrefix(".") }.sorted()
    var description = ""
    if let readme = names.first(where: { $0.lowercased() == "readme.md" || $0.lowercased() == "readme.txt" }) {
        let readmeURL = directory.appendingPathComponent(readme).resolvingSymlinksInPath()
        if readmeURL.path.hasPrefix(directory.resolvingSymlinksInPath().path + "/"),
           let handle = try? FileHandle(forReadingFrom: readmeURL) {
            defer { try? handle.close() }
            if let bytes = try? handle.read(upToCount: 4096), let text = String(data: bytes, encoding: .utf8) { description = String(text.prefix(3000)) }
        }
    }
    return ["path": url.path, "name": url.lastPathComponent, "kind": fm.fileExists(atPath: directory.appendingPathComponent(".git").path) ? "repository" : "directory", "description": description, "files": Array(names.prefix(40))]
}
