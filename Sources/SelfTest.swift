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
    // Real Git, policy checks across process restarts, and versioned templates.
    let versions = ProjectStore()
    var design = PatchGraph(schemaVersion: 1, name: "Versions", description: "", nodes: [node, other], edges: [edge])
    _ = try versions.create(temp.appendingPathComponent("versions"), graph: design)
    let firstCommit = try versions.history!.head()
    try check(firstCommit.count == 40, "project automatically creates a Git checkpoint")
    _ = try versions.save(design, expectedRevision: versions.revision)
    try check(try versions.history!.head() == firstCommit, "unchanged save does not create empty commit")
    try versions.writeText("print('original')\n", to: "implementations/e1/adapter.py")
    _ = try versions.poll()
    let implementationCommit = try versions.history!.head()
    try check(implementationCommit != firstCommit, "external implementation edit is checkpointed")
    let implementationDetail = try versions.history!.detail(implementationCommit)
    try check((implementationDetail["files"] as? [String])?.contains("implementations/e1/adapter.py") == true, "history lists actual changed implementation files")
    design.nodes[0].policy = "immutable"; design.edges[0].policy = "immutable"
    _ = try versions.save(design, expectedRevision: versions.revision)
    let lockedCommit = try versions.history!.head()
    var edited = design; edited.nodes[0].description = "unauthorized"
    try rejects("locked definition cannot be edited in store") { _ = try versions.save(edited, expectedRevision: versions.revision) }
    edited = design; edited.nodes[0].policy = "mutable"
    try rejects("changing incoming policy cannot unlock a node") { _ = try versions.save(edited, expectedRevision: versions.revision) }
    edited = design; edited.edges = []
    try rejects("protected wiring and edge cannot be deleted") { _ = try versions.save(edited, expectedRevision: versions.revision) }
    edited = design; edited.nodes[0].x = 120
    _ = try versions.save(edited, expectedRevision: versions.revision); design = edited
    try check(versions.graph!.nodes[0].x == 120, "layout of protected node remains movable")
    edited = design; edited.nodes[0].policy = "mutable"; edited.nodes[0].description = "external unlock attack"
    try versions.write(jsonData(edited), to: "graph.json")
    let pending = try versions.poll()
    try check((pending["violations"] as? [String])?.contains("node:n1") == true, "external lock bypass detected against accepted graph")
    let restarted = ProjectStore(); let reopened = try restarted.open(versions.root!)
    try check(restarted.graph!.nodes[0].policy == "immutable" && reopened["pendingExternal"] != nil, "reopening retains protected baseline and pending diff")
    try rejects("reject does not overwrite newer external revision") { _ = try restarted.rejectExternal(diskRevision: "stale") }
    _ = try restarted.rejectExternal(diskRevision: pending["diskRevision"] as! String)
    try check(try JSONDecoder().decode(PatchGraph.self, from: Data(contentsOf: restarted.root!.appendingPathComponent("graph.json"))).nodes[0].policy == "immutable", "rejected graph is restored without adopting protection bypass")
    let rejected = try fm.contentsOfDirectory(atPath: restarted.root!.appendingPathComponent(".gacchanko/rejected").path)
    try check(rejected.count == 1, "rejected external design is preserved for recovery")
    _ = try restarted.unlock(kind: "node", id: "n1", expectedRevision: restarted.revision)
    try check(restarted.graph!.nodes[0].policy == "mutable", "explicit unlock succeeds and is recorded")
    try restarted.writeText("print('changed without unlock')\n", to: "implementations/e1/adapter.py")
    let beforeCodeViolation = try restarted.history!.head()
    let blockedCode = try restarted.poll()
    try check((blockedCode["history"] as? [String: Any])?["protectedFiles"] as? [String] == ["implementations/e1/adapter.py"], "protected implementation change is shown without adopting it")
    try check(try restarted.history!.head() == beforeCodeViolation, "protected code change does not enter history")
    try rejects("save blocked while protected implementation is changed") { _ = try restarted.save(restarted.graph!, expectedRevision: restarted.revision) }
    _ = try restarted.unlock(kind: "edge", id: "e1", expectedRevision: restarted.revision)
    try check(try restarted.history!.head() != beforeCodeViolation, "explicit edge unlock permits changed implementation checkpoint")
    design = restarted.graph!
    let prototype = GraphTemplate(id: "pipeline", version: 1, name: "Observe and act", instructions: "Retain the source to target topology; specialize the policy.", nodes: [node, other], edges: [edge])
    design.templates = [prototype]
    design.nodes[0].derivedFrom = TemplateOrigin(templateID: "pipeline", version: 1, memberID: "n1")
    design.nodes[0].designInstructions = "Variant with a different observation format"
    _ = try restarted.save(design, expectedRevision: restarted.revision)
    let variantReader = ProjectStore(); _ = try variantReader.open(restarted.root!)
    try check(variantReader.graph!.nodes[0].derivedFrom?.version == 1 && variantReader.graph!.templates?.first?.instructions == prototype.instructions, "template provenance and design instructions survive JSON round trip")
    try check(try String(contentsOf: restarted.root!.appendingPathComponent("AGENT_BRIEF.md"), encoding: .utf8).contains(prototype.instructions), "handoff includes pinned template instructions")
    edited = design; edited.templates![0].instructions = "rewrite original"
    try rejects("published template version is append only") { _ = try restarted.save(edited, expectedRevision: restarted.revision) }
    edited = design; edited.nodes[0].derivedFrom!.version = 9
    try rejects("dangling template version rejected") { try validate(edited) }
    edited = design; edited.templates!.append(GraphTemplate(id: "pipeline", version: 2, name: "Observe and act v2", instructions: "Revised topology", nodes: [node, other], edges: [edge]))
    _ = try restarted.save(edited, expectedRevision: restarted.revision)
    try check(restarted.graph!.nodes[0].derivedFrom?.version == 1, "new template version does not silently upgrade variants")
    let old = restarted.graph!; edited = old; edited.nodes[1].name = "Agent redesign"
    try restarted.write(jsonData(edited), to: "graph.json")
    let agentChanges = try restarted.poll()
    try check((agentChanges["changes"] as? [[String: Any]])?.contains(where: { $0["id"] as? String == "n2" && ($0["fields"] as? [String])?.contains("name") == true }) == true, "external redesign exposes per-field before and after")
    _ = try restarted.open(restarted.root!)
    let history = try restarted.history!.summary()
    try check((history["commits"] as? [[String: String]])?.first?["actor"] == "external / unknown", "external design checkpoint does not invent agent identity")
    try check(try restarted.history!.acceptedGraph(lockedCommit)?.nodes[0].policy == "immutable", "historical graph remains retrievable")
    try rejects("history ref injection rejected") { _ = try restarted.history!.detail("--output=/tmp/unsafe") }
    try restarted.writeText("{broken", to: "graph.json")
    let malformedReader = ProjectStore(); let malformedState = try malformedReader.open(restarted.root!)
    try check(malformedState["pendingExternal"] != nil && malformedReader.graph!.nodes[1].name == "Agent redesign", "malformed external JSON reopens with last accepted design and warning")
    print("\(count) core checks passed")
}
