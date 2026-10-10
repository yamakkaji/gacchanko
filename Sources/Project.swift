import Foundation
import CryptoKit
import Darwin

struct TemplateOrigin: Codable {
    var templateID: String
    var version: Int
    var memberID: String
}
struct NodeAppearance: Codable {
    var color: String
    var radius: Double
    var corners: String
    var surface: String
    var header: String
}
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
    var policy: String? = nil
    var designInstructions: String? = nil
    var derivedFrom: TemplateOrigin? = nil
    var appearance: NodeAppearance? = nil
    var implementationState: String? = nil
}
struct EdgeExecution: Codable {
    var dispatch: String
    var join: String
    var after: [String]
    var maxConcurrency: Int
    var timeoutMs: Int
    var bufferSize: Int
    var overflow: String
    var onError: String
}
struct EdgeAppearance: Codable {
    var style: String
    var source: String
    var target: String
    var patternColour: String
    var pattern: String
    var width: Double
    var spacing: Double
    var size: Double
    var arrows: Bool
}
struct EdgePosition: Codable {
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
    var policy: String? = nil
    var designInstructions: String? = nil
    var derivedFrom: TemplateOrigin? = nil
    var layer: String? = nil
    var execution: EdgeExecution? = nil
    var path: String? = nil
    var implementationState: String? = nil
    var appearance: EdgeAppearance? = nil
    var sourcePosition: EdgePosition? = nil
    var targetPosition: EdgePosition? = nil
}
struct GraphTemplate: Codable {
    var id: String
    var version: Int
    var name: String
    var instructions: String
    var nodes: [PatchNode]
    var edges: [PatchEdge]
}
struct PatchGraph: Codable {
    var schemaVersion: Int
    var name: String
    var description: String
    var nodes: [PatchNode]
    var edges: [PatchEdge]
    var templates: [GraphTemplate]? = nil
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
    try validateDesign(graph)
    guard graph.schemaVersion == 1 else { throw PatchError("未対応のグラフ形式です。schemaVersion は 1 にしてください。") }
    guard graph.nodes.count <= 500, graph.edges.count <= 2000 else { throw PatchError("ノード数または接続数が上限を超えています。") }
    let ids = graph.nodes.map(\.id)
    guard Set(ids).count == ids.count, ids.allSatisfy(validID) else { throw PatchError("ノードIDが重複しているか、使用できない文字を含んでいます。") }
    guard Set(graph.edges.map(\.id)).count == graph.edges.count, graph.edges.map(\.id).allSatisfy(validID) else { throw PatchError("接続IDが不正です。") }
    for node in graph.nodes {
        guard ["unspecified", "planned", "existing", "verified"].contains(node.implementationState ?? "unspecified") else { throw PatchError("実装状態が不正です。") }
        if let a = node.appearance {
            guard a.color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil,
                  a.radius.isFinite, (0...28).contains(a.radius), ["uniform", "alternating"].contains(a.corners),
                  ["filled", "outlined", "elevated"].contains(a.surface), ["striped", "plain"].contains(a.header) else { throw PatchError("ノードの外観設定が不正です。") }
        }
        guard node.x.isFinite, node.y.isFinite, abs(node.x) < 1e7, abs(node.y) < 1e7,
              !node.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              node.inputs.count <= 30, node.outputs.count <= 30,
              Set(node.inputs).count == node.inputs.count, Set(node.outputs).count == node.outputs.count,
              (node.inputs + node.outputs).allSatisfy({ !$0.isEmpty && $0.count <= 100 }) else { throw PatchError("ノードの名前、位置、ポート名を確認してください。") }
    }
    for edge in graph.edges {
        guard ["unspecified", "planned", "existing", "verified"].contains(edge.implementationState ?? "unspecified") else { throw PatchError("実装状態が不正です。") }
        if let a = edge.appearance {
            guard [a.source, a.target, a.patternColour].allSatisfy({ $0.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil }),
                  ["gradient", "pattern", "both", "solid"].contains(a.style), ["chevrons", "taper"].contains(a.pattern),
                  a.width.isFinite, (1...8).contains(a.width), a.spacing.isFinite, (20...120).contains(a.spacing),
                  a.size.isFinite, (3...12).contains(a.size) else { throw PatchError("エッジの外観設定が不正です。") }
        }
        guard ["data", "control", "event"].contains(edge.layer ?? "data") else { throw PatchError("接続レイヤーが不正です。") }
        if let e = edge.execution {
            guard ["sync", "async"].contains(e.dispatch), ["all", "any"].contains(e.join),
                  (1...64).contains(e.maxConcurrency), (e.dispatch != "sync" || e.maxConcurrency == 1), (1...3600000).contains(e.timeoutMs), (1...10000).contains(e.bufferSize),
                  ["block", "dropOldest", "dropNewest"].contains(e.overflow), ["stop", "continue"].contains(e.onError),
                  Set(e.after).count == e.after.count, e.after.allSatisfy({ $0 != edge.id }) else { throw PatchError("非同期実行設定を確認してください。") }
            guard e.after.allSatisfy({ id in graph.edges.contains(where: { $0.id == id }) }) else { throw PatchError("待機先の接続が見つかりません。") }
        }
        func validateEndpoint(_ id: String, _ port: String, _ position: EdgePosition?, output: Bool) throws {
            if id.isEmpty {
                guard port.isEmpty, let position, position.x.isFinite, position.y.isFinite,
                      abs(position.x) < 1e7, abs(position.y) < 1e7 else { throw PatchError("未接続の端点の位置が不正です。") }
            } else {
                guard position == nil, let node = graph.nodes.first(where: { $0.id == id }),
                      (output ? node.outputs : node.inputs).contains(port) else { throw PatchError("接続先またはポートが見つかりません。") }
            }
        }
        try validateEndpoint(edge.source, edge.sourcePort, edge.sourcePosition, output: true)
        try validateEndpoint(edge.target, edge.targetPort, edge.targetPosition, output: false)
        guard ["data", "request", "event"].contains(edge.mode) else { throw PatchError("接続の種類が不正です。") }
    }
    var visiting = Set<String>(), done = Set<String>()
    func visit(_ id: String) throws {
        if done.contains(id) { return }
        guard visiting.insert(id).inserted else { throw PatchError("完了待ちの依存関係が循環しています。反復はイベントで表し、停止条件を指定してください。") }
        for dependency in graph.edges.first(where: { $0.id == id })?.execution?.after ?? [] { try visit(dependency) }
        visiting.remove(id); done.insert(id)
    }
    for edge in graph.edges { try visit(edge.id) }
}
func fingerprint(_ edge: PatchEdge, _ graph: PatchGraph) throws -> String {
    var nodes = graph.nodes.filter { $0.id == edge.source || $0.id == edge.target }
    for i in nodes.indices { nodes[i].x = 0; nodes[i].y = 0; nodes[i].appearance = nil }
    var definition = edge; definition.appearance = nil; definition.sourcePosition = nil; definition.targetPosition = nil
    let payload: [String: Any] = ["edge": try object(definition), "nodes": try nodes.sorted { $0.id < $1.id }.map { try object($0) }, "projectDescription": graph.description]
    return digest(try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes]))
}

func nodeFingerprint(_ node: PatchNode, _ graph: PatchGraph) throws -> String {
    var definition = node; definition.x = 0; definition.y = 0; definition.appearance = nil
    let payload: [String: Any] = ["node": try object(definition), "projectDescription": graph.description]
    return digest(try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes]))
}

final class ProjectStore {
    var root: URL?
    var revision = ""
    var graph: PatchGraph?
    var history: ProjectHistory?

    func open(_ location: URL) throws -> [String: Any] {
        let directory = location.lastPathComponent == "graph.json" ? location.deletingLastPathComponent() : location
        let data = try Data(contentsOf: directory.appendingPathComponent("graph.json"))
        let history = try ProjectHistory(root: directory.standardizedFileURL)
        let previous = try history.acceptedGraph()
        let loaded: PatchGraph
        do {
            guard data.count < 10_000_000 else { throw PatchError("graph.json が大きすぎます。") }
            loaded = try JSONDecoder().decode(PatchGraph.self, from: data)
            try validate(loaded)
        } catch {
            guard let previous else { throw error }
            root = directory.standardizedFileURL; self.history = history; graph = previous; revision = digest(try jsonData(previous))
            var result = try snapshot(); result["pendingExternal"] = try externalState(data); return result
        }
        root = directory.standardizedFileURL; self.history = history
        if let previous, try jsonData(previous) != jsonData(loaded) {
            graph = previous
            revision = digest(try jsonData(previous))
            var result = try snapshot()
            result["pendingExternal"] = try externalState(data)
            return result
        }
        graph = loaded; revision = digest(data)
        try exportBrief()
        try history.checkpoint(actor: previous == nil ? "gacchanko / import" : "external / unknown", message: previous == nil ? "Import project" : "External design or implementation update")
        return try snapshot()
    }
    func create(_ location: URL, graph initial: PatchGraph) throws -> [String: Any] {
        try validate(initial)
        if fm.fileExists(atPath: location.path), !(try fm.contentsOfDirectory(atPath: location.path)).isEmpty {
            throw PatchError("空のフォルダ、または新しい名前を選んでください。既存ファイルは上書きしません。")
        }
        try fm.createDirectory(at: location, withIntermediateDirectories: true)
        root = location.standardizedFileURL; graph = nil; revision = ""; history = try ProjectHistory(root: location.standardizedFileURL)
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
    func save(_ updated: PatchGraph, expectedRevision: String, unlocked: Set<String> = [], checkpointBefore: Bool = true) throws -> [String: Any] {
        try validate(updated)
        if let graph {
            let violations = try protectionViolations(graph, updated, unlocked: unlocked)
            guard violations.isEmpty else { throw PatchError("保護された設計は変更できません。先に明示的に保護を解除してください。\n" + violations.joined(separator: "\n")) }
        }
        if let history {
            let violations = try history.codeViolations(unlocked: unlocked)
            guard violations.isEmpty else { throw PatchError("保護された実装ファイルに外部変更があります。変更を戻すか、対象エッジを明示的に解除してください。\n" + violations.joined(separator: "\n")) }
            _ = try history.trackedFiles()
        }
        let file = try safeURL("graph.json")
        let onDisk = (try? Data(contentsOf: file)).map(digest) ?? ""
        guard onDisk == expectedRevision else { throw PatchError("別のツールがグラフを更新しました。未保存の編集を JSON 書き出しで退避し、再読み込みしてください。") }
        let encoded = try jsonData(updated)
        guard encoded.count < 10_000_000 else { throw PatchError("graph.json が大きすぎます。") }
        if unlocked.isEmpty && checkpointBefore { try history?.checkpoint(actor: "external / unknown", message: "Implementation / report update before design save") }
        // Preflight generated destinations before committing the authoritative graph.
        for name in ["graph.json", "AGENT_BRIEF.md", "graph.mmd"] + updated.edges.map({ "connections/\($0.id)/SPEC.md" }) + updated.nodes.map({ "components/nodes/\($0.id)/SPEC.md" }) { _ = try safeURL(name) }
        try write(encoded, to: "graph.json")
        graph = updated; revision = digest(encoded)
        try exportBrief()
        try history?.checkpoint(actor: "gacchanko / user", message: unlocked.isEmpty ? "Save design" : "Unlock " + unlocked.sorted().joined(separator: ", "), unlocked: unlocked)
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
        - The component inspector intentionally asks for the same six fields on both nodes and edges: name, mutability, implementation state, type, access, and description. Infer roles, invocation methods and port contracts from accessible source code and the connection intent. Preserve existing detailed metadata. For unimplemented components, propose the missing design in graph.json; ask only when an unresolved choice materially changes behaviour. Do not require the user to fill in technical forms before investigating.
        - Implement the requested connections using your existing coding session. No LLM API key or background agent is required by gacchanko.
        - Put integration code under `implementations/<edge-id>/`, and shared integration code under `implementations/shared/`. Preserve source repositories unless the user requests edits.
        - Repositories and URLs are references. A remote URL has not been cloned. Resolve missing paths with the user; never invent APIs, credentials, outputs, or successful tests.
        - Read the specifications for the requested edges in `connections/<edge-id>/SPEC.md`. If the handoff names one edge, implement only that edge; other edges are context unless explicitly requested. Ask only about ambiguities that materially affect behaviour. Request/response edges include the response on the same connection.
        - When a handoff names a node, implement only that node. Read components/nodes/<node-id>/SPEC.md, put new code in components/nodes/<node-id>/implementation/, and write components/nodes/<node-id>/report.json with that SPEC.md fingerprint and the same report format. Adjacent nodes and edges are context only. Do not modify referenced source repositories unless the user explicitly requests it. This node scope takes precedence over the general connection workflow.
        - Immutable nodes protect their components/nodes/<node-id>/implementation/ files; request explicit GUI unlock before changing protected code. Node reports remain writable.
        - Node SPEC.md files are generated; do not edit them directly. Design changes belong in graph.json and await adoption.
        - The graph describes intent; it is not an executable scheduling specification. Define lifecycle, timing, buffering, and failure behaviour in the implementation where required.
        - Write `reports/<edge-id>.json` atomically, using the fingerprint from that edge's SPEC.md. Format: {"fingerprint":"...","status":"implemented|verified|blocked","summary":"...","files":["implementations/<edge-id>/adapter.py"],"checks":["Actual command and result"]}.
        - `verified` means you actually ran relevant checks. For incomplete work use `blocked` and explain what is missing. Do not claim runtime integration has passed from a syntax check alone.
        - The GUI reloads reports automatically. Changed requirements mark earlier reports stale. Reports are agent-provided evidence, not independent certification.
        - Do not modify generated AGENT_BRIEF.md, graph.mmd, or connections/*/SPEC.md. To change the design, edit graph.json (schemaVersion 1), preserve IDs, and save atomically. The GUI detects external edits. Deleted edges' implementation files are intentionally retained; only graph.json determines active edges.
        - Every node and edge has `policy`: omitted or `mutable` permits edits; `immutable` and `template` protect its definition and existing wiring. Layout and component appearance may change without unlocking and do not invalidate implementation reports. Appearance is visual metadata, not behaviour. Do not remove protection yourself or edit history. Ask the user to unlock in the GUI when needed. Existing protected nodes may receive NEW connections through their declared ports, but existing connections cannot be removed or rewired without unlocking their protected endpoints.
        - A protected edge also freezes `implementations/<edge-id>/` as of the accepted version. Do not create, alter or delete code there without asking the user to unlock the edge. Reports remain writable; shared code is not covered by an individual edge lock. Referenced source repositories are not OS-locked by gacchanko.
        - `template` means an architectural prototype, not a blank starting point. Read `designInstructions`, the pinned `derivedFrom` reference, and `templates[].instructions`. Reuse its member roles, ports and internal topology when designing a variant. Explain intentional deviations in the variant's designInstructions. These are design constraints, not C++ code generation.
        - `templates` holds versioned, self-contained subgraphs. Existing versions are append-only. To create a variant, copy its nodes AND internal edges with new IDs, remap endpoints, and set each member's derivedFrom to {templateID, version, memberID}. Use mutable for variant members. Preserve the pinned version; do not silently upgrade it. To revise a prototype, append a new version.
        - All policy, provenance and designInstructions fields must survive graph edits. External edits are attributed as external / unknown unless an explicit author was recorded elsewhere; the app does not infer Codex versus Claude from file changes.
        - Project-local graph, generated specifications, implementations and reports are checkpointed to `.gacchanko/history.git`. Referenced repositories are not included. Same-user filesystem writes cannot be sandboxed by this app. Do not bypass protection by editing its history.
        - External graph edits are proposals. The GUI retains the accepted graph until the user selects changes to adopt; rejected and partially adopted proposals are archived locally. Preserve IDs and explain your changes in designInstructions. Do not overwrite a proposal while it is being reviewed.
        - implementationState is user-declared: unspecified / planned / existing / verified. It is not automatic evidence of working code. Inspect references and record actual checks.
        - An edge may have an unconnected endpoint: its source/target and corresponding port are empty strings, with sourcePosition/targetPosition containing canvas x/y. Such edges retain their identity, intent, metadata and implementation files. Do not delete them or invent endpoints. Resolve missing endpoints before implementation or verification. Positions are layout only.
        - Edge layer is data (payload), control (start target after source completes), or event (trigger per event). Missing layer means data. execution describes a contract for generated code, not a scheduler running inside gacchanko.
        - execution.after lists edge completion dependencies within the SAME run_id and iteration_id. join=all waits for all, any for the first; when any wins, late completions must not trigger the same task again. Dependencies must be acyclic. Roots are activated by explicit start, input or event as described in intent.
        - dispatch=sync awaits completion before the producer proceeds; async queues work and lets the producer proceed. maxConcurrency bounds active invocations per edge; sync uses one. bufferSize bounds pending work; overflow=block applies backpressure, dropOldest/dropNewest drops that pending item. Define cancellation and delivery guarantees in intent. timeoutMs is the task deadline including dependency/queue waits; onError=stop stops the run, continue emits an error result and proceeds. Failed dependencies must be resolved as errors, never waited for indefinitely.
        - Loops use event edges with explicit iteration IDs, termination and cancellation rules in intent. A graph cycle alone is not a complete loop specification. Never automatically retry side-effecting operations.
        - No program is executed merely by opening this project. Commands stored on nodes are documentation, not auto-run hooks.

        ## Nodes

        """
        for node in graph.nodes {
            let hash = try nodeFingerprint(node, graph)
            let specification = """
            # \(node.name)

            Node ID: \(node.id)
            Fingerprint: \(hash)
            Policy: \(node.policy ?? "mutable")
            Component Type: \(node.kind)
            Access: \(node.path)
            Implementation state (user-declared): \(node.implementationState ?? "unspecified")
            Design instructions: \(node.designInstructions ?? "")
            Template origin: \(try originDescription(node.derivedFrom, graph))
            Command (not auto-executed): \(node.command)
            Inputs: \(node.inputs.joined(separator: ", "))
            Outputs: \(node.outputs.joined(separator: ", "))

            ## Description
            \(node.description)

            ## Project goal
            \(graph.description)

            ## Scope and deliverables
            Implement or verify only this node. Adjacent edges and nodes are context, not additional implementation targets.
            Preserve referenced source repositories unless explicitly authorized to edit them.
            Write new code in components/nodes/\(node.id)/implementation/.
            Write components/nodes/\(node.id)/report.json with fingerprint \(hash), status implemented|verified|blocked, summary, files, and checks.
            Report actual checks only. Follow AGENT_BRIEF.md. Do not edit this generated SPEC.md.
            """
            try writeText(specification + "\n", to: "components/nodes/\(node.id)/SPEC.md")
            brief += "\n### \(node.name) [\(node.id)]\n- Policy: \(node.policy ?? "mutable")\n- Design instructions: \(node.designInstructions ?? "")\n- Template origin: \(try originDescription(node.derivedFrom, graph))\n- Kind: \(node.kind)\n- Implementation state (user-declared): \(node.implementationState ?? "unspecified")\n- Location: \(node.path.isEmpty ? "Not set" : node.path)\n- Command (not auto-executed): \(node.command)\n- Inputs: \(node.inputs.joined(separator: ", "))\n- Outputs: \(node.outputs.joined(separator: ", "))\n\n\(node.description)\n"
        }
        brief += "\n## Connection components\n"
        for edge in graph.edges {
            let hash = try fingerprint(edge, graph)
            let source = graph.nodes.first { $0.id == edge.source }
            let target = graph.nodes.first { $0.id == edge.target }
            let specification = """
            # \(edge.label.isEmpty ? "Connection" : edge.label)

            Edge ID: \(edge.id)
            Fingerprint: \(hash)
            Component Type: \(edge.mode)
            Access: \(edge.path ?? "Not set")
            Implementation state (user-declared): \(edge.implementationState ?? "unspecified")
            Connection state: \(source == nil || target == nil ? "Unconnected. Preserve this edge and its intent; resolve missing endpoints before implementation or verification." : "Connected")
            Mode: \(edge.mode)
            Layer: \(edge.layer ?? "data")
            Execution: \(try edge.execution.map { String(data: try jsonData($0), encoding: .utf8)! } ?? "Unspecified; agree on scheduling before implementation")
            Policy: \(edge.policy ?? "mutable")
            Design instructions: \(edge.designInstructions ?? "")
            Template origin: \(try originDescription(edge.derivedFrom, graph))
            Source: \(source?.name ?? "Unconnected") [\(source?.id ?? "")] / \(edge.sourcePort)
            Source location: \(source?.path ?? "")
            Target: \(target?.name ?? "Unconnected") [\(target?.id ?? "")] / \(edge.targetPort)
            Target location: \(target?.path ?? "")

            ## User intent
            \(edge.intent.isEmpty ? "No intent supplied yet. Clarify the intended behaviour before implementing." : edge.intent)

            ## Source context
            \(source?.description ?? "")
            Invocation hint: \(source?.command ?? "")

            ## Target context
            \(target?.description ?? "")
            Invocation hint: \(target?.command ?? "")

            ## Deliverables
            Implement in implementations/\(edge.id)/. Record actual results in reports/\(edge.id).json.
            Use fingerprint \(hash). Follow AGENT_BRIEF.md. Do not edit this generated file.
            """
            try writeText(specification + "\n", to: "connections/\(edge.id)/SPEC.md")
            brief += "\n- [\(edge.id)](connections/\(edge.id)/SPEC.md): \(source?.name ?? "Unconnected") → \(target?.name ?? "Unconnected") — \(edge.label)\n"
        }
        try writeText(brief + "\n", to: "AGENT_BRIEF.md")
        func label(_ text: String) -> String { text.replacingOccurrences(of: "\"", with: "'").replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "[", with: "(").replacingOccurrences(of: "]", with: ")").replacingOccurrences(of: "<", with: "(").replacingOccurrences(of: ">", with: ")").replacingOccurrences(of: "&", with: "+") }
        let nodeKeys = Dictionary(uniqueKeysWithValues: graph.nodes.enumerated().map { ($1.id, "n\($0)") })
        var mermaid = "flowchart TD\n"
        for node in graph.nodes { mermaid += "  \(nodeKeys[node.id]!) [\"\(label(node.name))\"]\n" }
        for (index, edge) in graph.edges.enumerated() {
            let source = nodeKeys[edge.source] ?? "loose\(index)s"
            let target = nodeKeys[edge.target] ?? "loose\(index)t"
            if edge.source.isEmpty { mermaid += "  \(source) [\"Unconnected output\"]\n" }
            if edge.target.isEmpty { mermaid += "  \(target) [\"Unconnected input\"]\n" }
            mermaid += "  \(source) \(edge.mode == "request" ? "<-->" : "-->") |\"\(label(edge.label))\"| \(target)\n"
        }
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
                    if history?.protectedFiles.contains(where: { $0.hasPrefix("implementations/" + edge.id + "/") }) == true {
                        report["status"] = "blocked"; report["summary"] = "保護された実装への外部変更を検出しました。履歴への採用を停止しています。"
                    }
                    reports[edge.id] = report
                } else { reports[edge.id] = ["status": "blocked", "summary": "レポートの JSON を読み取れません。"] }
            }
        }
        var nodeReports: [String: Any] = [:], nodeFingerprints: [String: String] = [:]
        for node in graph.nodes {
            let hash = try nodeFingerprint(node, graph); nodeFingerprints[node.id] = hash
            let directory = "components/nodes/\(node.id)/"
            if let url = try? safeURL(directory + "report.json"), let data = try? Data(contentsOf: url), data.count < 1_000_000 {
                if var report = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                    let claimed = report["status"] as? String ?? "pending"
                    report["status"] = ["implemented", "verified", "blocked"].contains(claimed) ? claimed : "pending"
                    if report["fingerprint"] as? String != hash { report["status"] = "stale" }
                    if history?.protectedFiles.contains(where: { $0.hasPrefix(directory + "implementation/") }) == true {
                        report["status"] = "blocked"; report["summary"] = "保護されたノード実装への外部変更を検出しました。"
                    }
                    nodeReports[node.id] = report
                } else { nodeReports[node.id] = ["status": "blocked", "summary": "レポートの JSON を読み取れません。"] }
            }
        }
        return ["project": try object(graph), "root": root.path, "revision": revision, "reports": reports, "fingerprints": fingerprints, "nodeReports": nodeReports, "nodeFingerprints": nodeFingerprints, "history": try history?.summary() ?? [:]]
    }
    func poll() throws -> [String: Any] {
        guard let root else { return ["project": NSNull()] }
        let data = try Data(contentsOf: root.appendingPathComponent("graph.json"))
        let diskRevision = digest(data)
        if diskRevision != revision { return try externalState(data) }
        try history?.checkpoint(actor: "external / unknown", message: "Implementation / report update")
        return try snapshot()
    }
    func prompt(edgeID: String?, nodeID: String? = nil) throws -> String {
        guard let root else { throw PatchError("先にプロジェクトを保存してください。") }
        if let nodeID {
            guard edgeID == nil, let node = graph?.nodes.first(where: { $0.id == nodeID }) else { throw PatchError("対象のノードが見つからないか、対象指定が重複しています。") }
            let directory = root.appendingPathComponent("components/nodes/\(nodeID)")
            return """
            次のノードコンポーネントだけを実装・検証してください。
            対象: \(node.name) [\(nodeID)]
            \(root.appendingPathComponent("AGENT_BRIEF.md").path)
            \(root.appendingPathComponent("graph.json").path)
            \(directory.appendingPathComponent("SPEC.md").path)

            接続されたノードやエッジは文脈として参照し、今回の実装対象には含めないでください。
            参照先のコードを確認し、新しい実装は \(directory.appendingPathComponent("implementation").path) に保存してください。
            参照先リポジトリの変更や保護解除を勝手に行わないでください。
            実際の検証結果を \(directory.appendingPathComponent("report.json").path) に、SPEC.mdのfingerprint、status、summary、files、checksを含めて記録してください。
            """
        }
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

// Design policy is checked against the last accepted version, never against the
// policy claimed by an incoming external edit. This is an application guard,
// not a security boundary against another process with the same file access.
func validateDesign(_ graph: PatchGraph) throws {
    let templates = graph.templates ?? []
    guard templates.count <= 200 else { throw PatchError("原型は200版までです。") }
    var keys = Set<String>()
    for t in templates {
        guard validID(t.id), t.version > 0, keys.insert("\(t.id):\(t.version)").inserted,
              !t.name.isEmpty, t.nodes.count > 0,
              (t.nodes.allSatisfy { $0.derivedFrom == nil }), (t.edges.allSatisfy { $0.derivedFrom == nil }) else { throw PatchError("原型のID・版・構成を確認してください。原型の中に派生参照は保存しません。") }
        try validate(PatchGraph(schemaVersion: 1, name: t.name, description: t.instructions, nodes: t.nodes, edges: t.edges))
    }
    func member(_ policy: String?, _ origin: TemplateOrigin?, node: Bool) throws {
        guard ["mutable", "immutable", "template"].contains(policy ?? "mutable") else { throw PatchError("policy は mutable / immutable / template のいずれかです。") }
        if let origin {
            guard let t = templates.first(where: { $0.id == origin.templateID && $0.version == origin.version }),
                  node ? t.nodes.contains(where: { $0.id == origin.memberID }) : t.edges.contains(where: { $0.id == origin.memberID }) else { throw PatchError("原型の版または構成要素が見つかりません。") }
        }
    }
    for n in graph.nodes { try member(n.policy, n.derivedFrom, node: true) }
    for e in graph.edges { try member(e.policy, e.derivedFrom, node: false) }
}
func originDescription(_ origin: TemplateOrigin?, _ graph: PatchGraph) throws -> String {
    guard let origin else { return "none" }
    let t = graph.templates?.first { $0.id == origin.templateID && $0.version == origin.version }
    return "\(origin.templateID) v\(origin.version) / \(origin.memberID). \(t?.instructions ?? "")"
}
func protected(_ policy: String?) -> Bool { ["immutable", "template"].contains(policy ?? "mutable") }
func protectionViolations(_ old: PatchGraph, _ next: PatchGraph, unlocked: Set<String> = []) throws -> [String] {
    var violations: [String] = []
    for n in old.nodes where protected(n.policy) && !unlocked.contains("node:" + n.id) {
        var before = n; before.x = 0; before.y = 0; before.appearance = nil
        var after = next.nodes.first { $0.id == n.id }; after?.x = 0; after?.y = 0; after?.appearance = nil
        if try after.map({ try jsonData($0) }) != jsonData(before) { violations.append("node:" + n.id) }
        for edge in old.edges where edge.source == n.id || edge.target == n.id {
            let other = next.edges.first { $0.id == edge.id }
            if other?.source != edge.source || other?.target != edge.target || other?.sourcePort != edge.sourcePort || other?.targetPort != edge.targetPort { violations.append("wiring:" + n.id + "/" + edge.id) }
        }
    }
    for edge in old.edges where protected(edge.policy) && !unlocked.contains("edge:" + edge.id) {
        var before = edge; before.appearance = nil
        var after = next.edges.first { $0.id == edge.id }; after?.appearance = nil
        if try after.map({ try jsonData($0) }) != jsonData(before) { violations.append("edge:" + edge.id) }
    }
    for t in old.templates ?? [] {
        if try next.templates?.first(where: { $0.id == t.id && $0.version == t.version }).map({ try jsonData($0) }) != jsonData(t) { violations.append("template:" + t.id + ":" + String(t.version)) }
    }
    return violations
}
func designChanges(_ old: PatchGraph?, _ new: PatchGraph) throws -> [[String: Any]] {
    var result: [[String: Any]] = []
    func compare<T: Encodable>(_ before: [T], _ after: [T], kind: String, key: (T) -> String) throws {
        let a = Dictionary(uniqueKeysWithValues: try before.map { (key($0), try object($0) as! [String: Any]) })
        let b = Dictionary(uniqueKeysWithValues: try after.map { (key($0), try object($0) as! [String: Any]) })
        for id in Set(a.keys).union(b.keys).sorted() {
            let left = a[id], right = b[id]
            let fields = Set(left?.keys.map { $0 } ?? []).union(right?.keys.map { $0 } ?? []).sorted().filter {
                !NSDictionary(dictionary: ["v": left?[$0] ?? NSNull()]).isEqual(to: ["v": right?[$0] ?? NSNull()])
            }
            if fields.isEmpty { continue }
            result.append(["kind": kind, "id": id, "name": right?["name"] ?? right?["label"] ?? left?["name"] ?? left?["label"] ?? id,
                           "change": left == nil ? "added" : right == nil ? "removed" : "modified",
                           "fields": fields, "before": left as Any? ?? NSNull(), "after": right as Any? ?? NSNull()])
        }
    }
    try compare(old?.nodes ?? [], new.nodes, kind: "node", key: { $0.id })
    try compare(old?.edges ?? [], new.edges, kind: "edge", key: { $0.id })
    try compare(old?.templates ?? [], new.templates ?? [], kind: "template", key: { "\($0.id):\($0.version)" })
    if old?.name != new.name || old?.description != new.description {
        result.append(["kind": "project", "id": "project", "name": new.name, "change": "modified", "fields": ["name", "description"],
                       "before": ["name": old?.name ?? "", "description": old?.description ?? ""], "after": ["name": new.name, "description": new.description]])
    }
    return result
}

final class ProjectHistory {
    let root: URL
    let directory: URL
    var lastManifest = ""
    var cachedSummary: [String: Any]?
    var protectedFiles: [String] = []
    init(root: URL) throws {
        self.root = URL(fileURLWithPath: canonicalPath(root), isDirectory: true)
        directory = self.root.appendingPathComponent(".gacchanko/history.git")
        guard canonicalPath(directory).hasPrefix(canonicalPath(root) + "/") else { throw PatchError("履歴の保存先がプロジェクト外です。") }
        if !fm.fileExists(atPath: directory.path) {
            try fm.createDirectory(at: directory.deletingLastPathComponent(), withIntermediateDirectories: true)
            _ = try git(["init", "--bare", directory.path], repository: false)
        }
        guard fm.fileExists(atPath: directory.appendingPathComponent("HEAD").path) else { throw PatchError("プロジェクトのGit履歴を読み込めません。") }
    }
    @discardableResult func git(_ args: [String], repository: Bool = true, allowFailure: Bool = false, outputLimit: Int = 2_000_000) throws -> String {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        task.currentDirectoryURL = root
        task.arguments = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "core.fsmonitor=false", "-c", "core.quotePath=false"] + (repository ? ["--git-dir=" + directory.path, "--work-tree=" + root.path] : []) + args
        // Do not inherit repository routing, index overrides, or global filters.
        var env = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("GIT_") }
        env["GIT_CONFIG_NOSYSTEM"] = "1"; env["GIT_CONFIG_GLOBAL"] = "/dev/null"; env["GIT_TERMINAL_PROMPT"] = "0"
        task.environment = env
        let output = fm.temporaryDirectory.appendingPathComponent("gacchanko-git-" + UUID().uuidString)
        fm.createFile(atPath: output.path, contents: nil)
        let handle = try FileHandle(forWritingTo: output)
        defer { try? handle.close(); try? fm.removeItem(at: output) }
        task.standardOutput = handle; task.standardError = handle
        try task.run(); task.waitUntilExit()
        let reader = try FileHandle(forReadingFrom: output); defer { try? reader.close() }
        let text = String(data: try reader.read(upToCount: outputLimit) ?? Data(), encoding: .utf8) ?? ""
        if task.terminationStatus != 0 && !allowFailure { throw PatchError("Git履歴を保存できません。\n" + String(text.prefix(1500))) }
        return task.terminationStatus == 0 ? text : ""
    }
    func head() throws -> String { try git(["rev-parse", "--verify", "HEAD"], allowFailure: true).trimmingCharacters(in: .whitespacesAndNewlines) }
    func acceptedGraph(_ ref: String = "HEAD") throws -> PatchGraph? {
        let text = try git(["show", ref + ":graph.json"], allowFailure: true, outputLimit: 12_000_000)
        if text.isEmpty { return nil }
        return try JSONDecoder().decode(PatchGraph.self, from: Data(text.utf8))
    }
    func trackedFiles() throws -> [String] {
        var files: [String] = []
        for name in ["graph.json", "AGENT_BRIEF.md", "graph.mmd", "connections", "implementations", "reports", "components"] {
            let url = root.appendingPathComponent(name)
            guard fm.fileExists(atPath: url.path) else { continue }
            let resourceKeys: [URLResourceKey] = [.isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey, .fileSizeKey]
            func inspect(_ file: URL) throws -> Bool {
                let values = try file.resourceValues(forKeys: Set(resourceKeys))
                guard values.isSymbolicLink != true else { throw PatchError("履歴対象にシンボリックリンクは使えません: " + file.lastPathComponent) }
                if values.isRegularFile == true {
                    guard (values.fileSize ?? 0) <= 20_000_000 else { throw PatchError("履歴対象のファイルが20MBを超えています: " + file.lastPathComponent) }
                    files.append(String(file.path.dropFirst(root.path.count + 1)))
                }
                return values.isDirectory == true
            }
            if try inspect(url), let entries = fm.enumerator(at: url, includingPropertiesForKeys: resourceKeys, options: []) {
                for case let file as URL in entries {
                    if file.lastPathComponent.hasPrefix(".") || ["__pycache__", "node_modules", "venv"].contains(file.lastPathComponent) { entries.skipDescendants(); continue }
                    _ = try inspect(file)
                    guard files.count < 10000 else { throw PatchError("履歴対象は10000ファイルまでです。") }
                }
            }
        }
        return files.sorted()
    }
    func codeViolations(unlocked: Set<String> = []) throws -> [String] {
        guard let baseline = try acceptedGraph() else { return [] }
        var scopes = baseline.edges.filter { protected($0.policy) && !unlocked.contains("edge:" + $0.id) }.map { "implementations/" + $0.id + "/" }
        scopes += baseline.nodes.filter { protected($0.policy) && !unlocked.contains("node:" + $0.id) }.map { "components/nodes/" + $0.id + "/implementation/" }
        if scopes.isEmpty { return [] }
        let baselineFiles = Set(try git(["ls-tree", "-r", "--name-only", "HEAD", "--"] + scopes).split(separator: "\n").map(String.init))
        let current = try trackedFiles().filter { file in scopes.contains { file.hasPrefix($0) } }
        let changed = try git(["diff", "--no-ext-diff", "--no-textconv", "--name-only", "HEAD", "--"] + scopes).split(separator: "\n").map(String.init)
        return Array(Set(changed + current.filter { !baselineFiles.contains($0) })).sorted()
    }
    func checkpoint(actor: String, message: String, unlocked: Set<String> = []) throws {
        let blocked = try codeViolations(unlocked: unlocked)
        if blocked != protectedFiles { protectedFiles = blocked; cachedSummary = nil }
        if !blocked.isEmpty { return }
        let files = try trackedFiles()
        // Hash actual bytes: equal mtimes or atomic replacements must not hide changes.
        var manifest = ""
        for file in files { manifest += file + ":" + digest(try Data(contentsOf: root.appendingPathComponent(file))) + "\n" }
        let hash = digest(Data(manifest.utf8))
        if hash == lastManifest { return }
        _ = try git(["add", "-u"])
        for i in stride(from: 0, to: files.count, by: 100) { _ = try git(["add", "--"] + Array(files[i..<min(i+100, files.count)])) }
        if !(try git(["diff", "--cached", "--name-only"])).isEmpty {
            _ = try git(["-c", "user.name=" + actor, "-c", "user.email=gacchanko@localhost", "commit", "-m", message])
            cachedSummary = nil
        }
        lastManifest = hash
    }
    func summary() throws -> [String: Any] {
        if let cachedSummary { return cachedSummary }
        let log = try git(["log", "-40", "--format=%H%x09%aI%x09%an%x09%s"], allowFailure: true)
        let entries: [[String: String]] = log.split(separator: "\n").compactMap { line in
            let p = line.split(separator: "\t", maxSplits: 3).map(String.init)
            return p.count == 4 ? ["id": p[0], "date": p[1], "actor": p[2], "message": p[3]] : nil
        }
        let changes: [[String: Any]]
        if let current = try acceptedGraph() { changes = try designChanges(acceptedGraph("HEAD^"), current) } else { changes = [] }
        let result: [String: Any] = ["commits": entries, "changes": changes, "head": try head(), "files": try changedFiles("HEAD"), "directory": directory.path, "protectedFiles": protectedFiles]
        cachedSummary = result
        return result
    }
    func changedFiles(_ ref: String) throws -> [String] {
        try git(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", ref]).split(separator: "\n").map(String.init)
    }
    func detail(_ ref: String) throws -> [String: Any] {
        guard ref.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil,
              let graph = try acceptedGraph(ref) else { throw PatchError("履歴の版が見つかりません。") }
        return ["id": ref, "changes": try designChanges(acceptedGraph(ref + "^"), graph), "files": try changedFiles(ref),
                "diff": try git(["show", "--format=fuller", "--no-ext-diff", "--no-textconv", "--no-renames", "--stat", "--patch", ref, "--", "graph.json", "implementations", "reports", "components"])]
    }
}

extension ProjectStore {
    func externalState(_ data: Data) throws -> [String: Any] {
        var result: [String: Any] = ["externalChange": true, "diskRevision": digest(data)]
        do {
            guard data.count < 10_000_000 else { throw PatchError("graph.json が大きすぎます。") }
            let next = try JSONDecoder().decode(PatchGraph.self, from: data)
            try validate(next)
            result["changes"] = try designChanges(graph, next)
            result["violations"] = try graph.map { try protectionViolations($0, next) } ?? []
        } catch { result["error"] = error.localizedDescription; result["violations"] = ["invalid graph"] }
        return result
    }
    func adoptExternal(diskRevision: String, selections: [String]) throws -> [String: Any] {
        let data = try Data(contentsOf: safeURL("graph.json"))
        guard digest(data) == diskRevision, let baseline = graph else { throw PatchError("提案が更新されました。比較を開き直してください。") }
        guard data.count < 10_000_000 else { throw PatchError("提案が大きすぎます。") }
        let proposed = try JSONDecoder().decode(PatchGraph.self, from: data)
        try validate(proposed)
        let changes = try designChanges(baseline, proposed)
        let allowed = Set(changes.map { ($0["kind"] as! String) + ":" + ($0["id"] as! String) })
        let selected = Set(selections)
        guard !selected.isEmpty, selected.isSubset(of: allowed) else { throw PatchError("採用する変更を選択してください。") }
        var next = baseline
        func merge<T>(_ old: [T], _ incoming: [T], _ kind: String, _ key: (T) -> String) -> [T] {
            let previousKeys = Set(old.map(key))
            let kept: [T] = old.compactMap { item in
                selected.contains(kind + ":" + key(item)) ? incoming.first(where: { key($0) == key(item) }) : item
            }
            return kept + incoming.filter { !previousKeys.contains(key($0)) && selected.contains(kind + ":" + key($0)) }
        }
        next.nodes = merge(baseline.nodes, proposed.nodes, "node", { $0.id })
        next.edges = merge(baseline.edges, proposed.edges, "edge", { $0.id })
        if baseline.templates != nil || proposed.templates != nil { next.templates = merge(baseline.templates ?? [], proposed.templates ?? [], "template", { "\($0.id):\($0.version)" }) }
        if selected.contains("project:project") { next.name = proposed.name; next.description = proposed.description }
        try validate(next)
        guard try protectionViolations(baseline, next).isEmpty else { throw PatchError("選択した変更には保護対象が含まれます。解除せずに採用できません。") }
        try write(data, to: ".gacchanko/proposals/" + UUID().uuidString + ".json")
        return try save(next, expectedRevision: diskRevision, checkpointBefore: false)
    }
    func unlock(kind: String, id: String, expectedRevision: String) throws -> [String: Any] {
        guard var next = graph else { throw PatchError("プロジェクトを開いてください。") }
        if kind == "node", let index = next.nodes.firstIndex(where: { $0.id == id }) { next.nodes[index].policy = "mutable" }
        else if kind == "edge", let index = next.edges.firstIndex(where: { $0.id == id }) { next.edges[index].policy = "mutable" }
        else { throw PatchError("解除対象が見つかりません。") }
        return try save(next, expectedRevision: expectedRevision, unlocked: [kind + ":" + id])
    }
    func rejectExternal(diskRevision: String) throws -> [String: Any] {
        let url = try safeURL("graph.json"), data = try Data(contentsOf: url)
        guard digest(data) == diskRevision, let graph else { throw PatchError("外部の変更が進みました。差分を再確認してください。") }
        try write(data, to: ".gacchanko/rejected/" + UUID().uuidString + ".json")
        let accepted = try jsonData(graph)
        try write(accepted, to: "graph.json"); revision = digest(accepted)
        try exportBrief()
        return try snapshot()
    }
}
