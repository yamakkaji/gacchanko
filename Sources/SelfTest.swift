import Foundation

func runSelfTests() throws {
    var count = 0
    func check(_ condition: Bool, _ name: String) throws { if !condition { throw PatchError(name) }; count += 1; print("PASS \(name)") }
    func rejects(_ name: String, _ body: () throws -> Void) throws {
        var rejected = false
        do { try body() } catch { rejected = true }
        try check(rejected, name)
    }
    let temp = fm.temporaryDirectory.appendingPathComponent("gacchanko-tests-\(UUID().uuidString)")
    defer { try? fm.removeItem(at: temp) }
    let node = PatchNode(id: "n1", name: "Source", path: "/tmp/source", kind: "directory", description: "input", command: "", inputs: ["in"], outputs: ["out"], x: 0, y: 0)
    var other = node; other.id = "n2"; other.name = "Target"
    let edge = PatchEdge(id: "e1", source: "n1", target: "n2", sourcePort: "out", targetPort: "in", label: "Bridge", intent: "Convert JSON", mode: "request")
    var graph = PatchGraph(schemaVersion: 1, name: "Test", description: "Test integration", nodes: [node, other], edges: [edge])
    let store = ProjectStore()
    _ = try store.create(temp.appendingPathComponent("project"), graph: graph)
    try check(fm.fileExists(atPath: store.root!.appendingPathComponent("AGENT_BRIEF.md").path), "brief exported")
    try check(fm.fileExists(atPath: store.root!.appendingPathComponent("connections/e1/SPEC.md").path), "edge spec exported")
    try check(try String(contentsOf: store.root!.appendingPathComponent("AGENT_BRIEF.md"), encoding: .utf8).contains("implement only that edge"), "single-edge handoff scope is explicit")
    let reader = ProjectStore(); _ = try reader.open(store.root!)
    try check(reader.graph?.edges.first?.intent == "Convert JSON", "graph round trip")
    let originalHash = try fingerprint(edge, graph)
    graph.nodes[0].x = 123
    try check(try fingerprint(edge, graph) == originalHash, "layout does not invalidate implementation")
    graph.nodes[0].description = "changed"
    try check(try fingerprint(edge, graph) != originalHash, "source context invalidates implementation")
    graph.nodes[0].description = "input"
    let report: [String: Any] = ["fingerprint": originalHash, "status": "verified", "summary": "test", "files": [], "checks": []]
    try store.write(JSONSerialization.data(withJSONObject: report), to: "reports/e1.json")
    let reports = try store.snapshot()["reports"] as! [String: [String: Any]]
    try check(reports["e1"]?["status"] as? String == "verified", "agent report loaded")
    graph.edges[0].intent = "Changed requirement"
    _ = try store.save(graph, expectedRevision: store.revision)
    let stale = try store.snapshot()["reports"] as! [String: [String: Any]]
    try check(stale["e1"]?["status"] as? String == "stale", "old report marked stale")
    try rejects("stale writer rejected") { _ = try reader.save(graph, expectedRevision: reader.revision) }
    try rejects("path traversal rejected") { try store.writeText("bad", to: "../outside.txt") }
    let outside = temp.appendingPathComponent("outside"); try fm.createDirectory(at: outside, withIntermediateDirectories: true)
    try fm.createSymbolicLink(at: store.root!.appendingPathComponent("escape"), withDestinationURL: outside)
    try rejects("symlink escape rejected") { try store.writeText("bad", to: "escape/owned.txt") }
    var invalid = graph; invalid.edges[0].id = "../evil"
    try rejects("invalid ID rejected") { try validate(invalid) }
    invalid = graph; invalid.edges[0].targetPort = "missing"
    try rejects("dangling port rejected") { try validate(invalid) }
    try rejects("nonempty project preserved") { _ = try ProjectStore().create(store.root!, graph: graph) }
    let code = "# source-owned\n"; try store.writeText(code, to: "implementations/e1/adapter.py")
    graph.edges = []; _ = try store.save(graph, expectedRevision: store.revision)
    try check(try String(contentsOf: store.root!.appendingPathComponent("implementations/e1/adapter.py"), encoding: .utf8) == code, "deleted edge preserves implementation")
    graph.name = "External change"; try jsonData(graph).write(to: store.root!.appendingPathComponent("graph.json"), options: .atomic)
    try check(try store.poll()["externalChange"] as? Bool == true, "external graph change detected")
    print("\(count) core checks passed")
}
