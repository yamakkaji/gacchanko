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
    // Unconnected edges are persisted components, not invalid references.
    let looseStore = ProjectStore()
    var looseGraph = graph
    _ = try looseStore.create(temp.appendingPathComponent("loose"), graph: looseGraph)
    try looseStore.writeText("keep implementation", to: "implementations/e1/adapter.py")
    try looseStore.write(JSONSerialization.data(withJSONObject: ["fingerprint": try fingerprint(edge, graph), "status": "verified"]), to: "reports/e1.json")
    looseGraph.edges[0].target = ""; looseGraph.edges[0].targetPort = ""
    looseGraph.edges[0].targetPosition = EdgePosition(x: 650, y: 550)
    _ = try looseStore.save(looseGraph, expectedRevision: looseStore.revision)
    let looseReader = ProjectStore(); _ = try looseReader.open(looseStore.root!)
    try check(looseReader.graph?.edges[0].targetPosition?.x == 650 && looseReader.graph?.edges[0].intent == edge.intent, "loose endpoint and intent survive save and reopen")
    try check(try String(contentsOf: looseStore.root!.appendingPathComponent("implementations/e1/adapter.py"), encoding: .utf8) == "keep implementation", "detaching preserves implementation files")
    let looseReports = try looseReader.snapshot()["reports"] as! [String: [String: Any]]
    try check(looseReports["e1"]?["status"] as? String == "stale", "detaching invalidates existing report")
    try check(try String(contentsOf: looseStore.root!.appendingPathComponent("connections/e1/SPEC.md"), encoding: .utf8).contains("Unconnected. Preserve this edge"), "loose edge spec explicitly preserves intent and asks to resolve endpoints")
    try check(try String(contentsOf: looseStore.root!.appendingPathComponent("graph.mmd"), encoding: .utf8).contains("Unconnected input"), "Mermaid export includes loose endpoint")
    let looseHash = try fingerprint(looseGraph.edges[0], looseGraph)
    looseGraph.edges[0].targetPosition?.x += 80
    try check(try fingerprint(looseGraph.edges[0], looseGraph) == looseHash, "loose endpoint layout is excluded from fingerprint")
    looseGraph.edges[0].source = ""; looseGraph.edges[0].sourcePort = ""
    looseGraph.edges[0].sourcePosition = EdgePosition(x: 200, y: 250)
    _ = try looseStore.save(looseGraph, expectedRevision: looseStore.revision)
    _ = try looseReader.open(looseStore.root!)
    try check(looseReader.graph?.edges[0].source == "" && looseReader.graph?.edges[0].target == "", "edge can persist with both ends unconnected")
    looseGraph.edges[0] = edge
    _ = try looseStore.save(looseGraph, expectedRevision: looseStore.revision)
    try check(looseStore.graph?.edges[0].target == "n2" && looseStore.graph?.edges[0].targetPosition == nil, "reconnecting returns to ordinary edge representation")
    var malformed = graph; malformed.edges[0].target = "missing"
    try rejects("unknown node reference still rejected") { try validate(malformed) }
    malformed.edges[0].target = ""; malformed.edges[0].targetPort = ""
    try rejects("loose endpoint requires explicit position") { try validate(malformed) }
    malformed.edges[0].targetPosition = EdgePosition(x: .infinity, y: 0)
    try rejects("nonfinite loose position rejected") { try validate(malformed) }
    malformed = graph; malformed.edges[0].targetPosition = EdgePosition(x: 0, y: 0)
    try rejects("connected endpoint cannot carry a loose position") { try validate(malformed) }
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
    let lockedHash = try fingerprint(design.edges[0], design)
    design.nodes[0].appearance = NodeAppearance(color: "#715669", radius: 24, corners: "alternating", surface: "filled", header: "plain")
    _ = try versions.save(design, expectedRevision: versions.revision)
    let styledReader = ProjectStore(); _ = try styledReader.open(versions.root!)
    try check(styledReader.graph!.nodes[0].appearance?.radius == 24, "immutable node appearance saves and reloads")
    try check(try fingerprint(design.edges[0], design) == lockedHash, "appearance preserves implementation fingerprint")
    design.edges[0].appearance = EdgeAppearance(style: "both", source: "#102030", target: "#abcdef", patternColour: "#294f4a", pattern: "chevrons", width: 5, spacing: 50, size: 6, arrows: true)
    _ = try versions.save(design, expectedRevision: versions.revision)
    let styledEdgeReader = ProjectStore(); _ = try styledEdgeReader.open(versions.root!)
    try check(styledEdgeReader.graph!.edges[0].appearance?.width == 5, "immutable edge appearance saves and reloads")
    try check(try fingerprint(design.edges[0], design) == lockedHash, "edge appearance preserves implementation fingerprint")
    var invalidEdge = design; invalidEdge.edges[0].appearance!.source = "invalid"
    try rejects("unsafe edge color rejected") { try validate(invalidEdge) }
    invalidEdge = design; invalidEdge.edges[0].appearance!.width = 100
    try rejects("out of range edge width rejected") { try validate(invalidEdge) }
    invalidEdge = design; invalidEdge.edges[0].implementationState = "bogus"
    try rejects("invalid edge implementation state rejected") { try validate(invalidEdge) }
    var components = graph; components.edges = [edge]
    components.edges[0].path = "192.168.1.12:8011"
    components.edges[0].implementationState = "existing"
    let componentStore = ProjectStore()
    _ = try componentStore.create(temp.appendingPathComponent("components"), graph: components)
    let componentReader = ProjectStore(); _ = try componentReader.open(componentStore.root!)
    try check(componentReader.graph!.edges[0].path == "192.168.1.12:8011" && componentReader.graph!.edges[0].implementationState == "existing", "edge access and implementation state survive native round trip")
    let componentSpec = try String(contentsOf: componentStore.root!.appendingPathComponent("connections/e1/SPEC.md"), encoding: .utf8)
    try check(componentSpec.contains("192.168.1.12:8011") && componentSpec.contains("Implementation state (user-declared): existing"), "common edge metadata is exported to agent specification")
    var invalidStyle = design; invalidStyle.nodes[0].appearance!.color = "red; color:red"
    try rejects("unsafe node color rejected") { try validate(invalidStyle) }
    invalidStyle = design; invalidStyle.nodes[0].appearance!.radius = 29
    try rejects("out of range node radius rejected") { try validate(invalidStyle) }
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
    let proposalReopen = try restarted.open(restarted.root!)
    try check(proposalReopen["pendingExternal"] != nil && restarted.graph!.nodes[1].name != "Agent redesign", "valid external proposal remains pending after restart")
    try rejects("stale proposal selection rejected") { _ = try restarted.adoptExternal(diskRevision: "stale", selections: ["node:n2"]) }
    _ = try restarted.adoptExternal(diskRevision: digest(try jsonData(edited)), selections: ["node:n2"])
    try check(restarted.graph!.nodes[1].name == "Agent redesign", "selected proposal is adopted")
    let history = try restarted.history!.summary()
    try check((history["commits"] as? [[String: String]])?.first?["actor"] == "gacchanko / user", "proposal adoption records user decision without inventing agent identity")
    try check(try restarted.history!.acceptedGraph(lockedCommit)?.nodes[0].policy == "immutable", "historical graph remains retrievable")
    try rejects("history ref injection rejected") { _ = try restarted.history!.detail("--output=/tmp/unsafe") }
    try restarted.writeText("{broken", to: "graph.json")
    let malformedReader = ProjectStore(); let malformedState = try malformedReader.open(restarted.root!)
    try check(malformedState["pendingExternal"] != nil && malformedReader.graph!.nodes[1].name == "Agent redesign", "malformed external JSON reopens with last accepted design and warning")
    let workflowStore = ProjectStore()
    var flow = PatchGraph(schemaVersion: 1, name: "Async flow", description: "Trigger and process", nodes: [node, other], edges: [edge])
    flow.nodes[0].implementationState = "planned"
    flow.edges[0].layer = "event"
    flow.edges[0].execution = EdgeExecution(dispatch: "async", join: "all", after: [], maxConcurrency: 2, timeoutMs: 5000, bufferSize: 8, overflow: "block", onError: "stop")
    _ = try workflowStore.create(temp.appendingPathComponent("workflow"), graph: flow)
    let flowReader = ProjectStore(); _ = try flowReader.open(workflowStore.root!)
    try check(flowReader.graph!.edges[0].execution?.maxConcurrency == 2 && flowReader.graph!.nodes[0].implementationState == "planned", "workflow contracts survive native JSON round trip")
    let spec = try String(contentsOf: workflowStore.root!.appendingPathComponent("connections/e1/SPEC.md"), encoding: .utf8)
    try check(spec.contains("Layer: event") && spec.contains("async"), "handoff exports layers and async execution contract")
    var badFlow = flow; badFlow.edges[0].execution!.after = ["missing"]
    try rejects("missing execution dependency rejected") { try validate(badFlow) }
    badFlow = flow; var secondEdge = edge; secondEdge.id = "e2"; secondEdge.execution = flow.edges[0].execution; secondEdge.execution!.after = ["e1"]
    badFlow.edges.append(secondEdge); badFlow.edges[0].execution!.after = ["e2"]
    try rejects("cyclic completion waits rejected") { try validate(badFlow) }
    badFlow = flow; badFlow.edges[0].execution!.bufferSize = 0
    try rejects("unbounded or empty async queue rejected") { try validate(badFlow) }
    var proposal = flow; proposal.nodes[0].description = "Accepted role"; proposal.nodes[1].description = "Not selected"
    try workflowStore.write(jsonData(proposal), to: "graph.json")
    _ = try workflowStore.adoptExternal(diskRevision: digest(try jsonData(proposal)), selections: ["node:n1"])
    try check(workflowStore.graph!.nodes[0].description == "Accepted role" && workflowStore.graph!.nodes[1].description == flow.nodes[1].description, "partial adoption preserves unselected definitions")
    try check(try fm.contentsOfDirectory(atPath: workflowStore.root!.appendingPathComponent(".gacchanko/proposals").path).count == 1, "complete incoming proposal archived on partial adoption")
    proposal = workflowStore.graph!; proposal.nodes.removeLast(); proposal.edges = []
    try workflowStore.write(jsonData(proposal), to: "graph.json")
    try rejects("partial adoption cannot leave dangling connections") { _ = try workflowStore.adoptExternal(diskRevision: digest(try jsonData(proposal)), selections: ["node:n2"]) }
    try check(try Data(contentsOf: workflowStore.root!.appendingPathComponent("graph.json")) == jsonData(proposal), "rejected partial adoption leaves proposal intact")
    _ = try workflowStore.rejectExternal(diskRevision: digest(try jsonData(proposal)))
    var lockedFlow = workflowStore.graph!; lockedFlow.nodes[0].policy = "immutable"
    _ = try workflowStore.save(lockedFlow, expectedRevision: workflowStore.revision)
    proposal = lockedFlow; proposal.nodes[0].description = "Bypass lock"; proposal.nodes[1].description = "Safe change"
    try workflowStore.write(jsonData(proposal), to: "graph.json")
    try rejects("proposal adoption cannot bypass immutable") { _ = try workflowStore.adoptExternal(diskRevision: digest(try jsonData(proposal)), selections: ["node:n1"]) }
    _ = try workflowStore.adoptExternal(diskRevision: digest(try jsonData(proposal)), selections: ["node:n2"])
    try check(workflowStore.graph!.nodes[0].description == lockedFlow.nodes[0].description && workflowStore.graph!.nodes[1].description == "Safe change", "safe subset of a protection-violating proposal can be adopted")
    // Node-only handoffs and reports have their own scope, independent of edges.
    let nodeStore = ProjectStore()
    var nodeGraph = PatchGraph(schemaVersion: 1, name: "Node-only", description: "Build the component", nodes: [node], edges: [])
    _ = try nodeStore.create(temp.appendingPathComponent("node-only"), graph: nodeGraph)
    let nodeSpec = try String(contentsOf: nodeStore.root!.appendingPathComponent("components/nodes/n1/SPEC.md"), encoding: .utf8)
    let nodeHash = try nodeFingerprint(node, nodeGraph)
    try check(nodeSpec.contains(nodeHash) && nodeSpec.contains("Implement or verify only this node"), "node-specific specification exported")
    let nodePrompt = try nodeStore.prompt(edgeID: nil, nodeID: "n1")
    try check(nodePrompt.contains("対象: Source [n1]") && nodePrompt.contains("components/nodes/n1/report.json") && nodePrompt.contains("今回の実装対象には含めない"), "node handoff targets only selected node, including isolated nodes")
    try rejects("unknown node handoff rejected") { _ = try nodeStore.prompt(edgeID: nil, nodeID: "missing") }
    try rejects("ambiguous node and edge handoff rejected") { _ = try nodeStore.prompt(edgeID: "e1", nodeID: "n1") }
    let nodeReport: [String: Any] = ["fingerprint": nodeHash, "status": "verified", "summary": "Node tested", "files": [], "checks": ["Node check"]]
    try nodeStore.write(JSONSerialization.data(withJSONObject: nodeReport), to: "components/nodes/n1/report.json")
    let nodeSnapshot = try nodeStore.poll()
    try check((nodeSnapshot["nodeReports"] as? [String: [String: Any]])?["n1"]?["status"] as? String == "verified", "node report loaded through polling")
    try check((nodeSnapshot["reports"] as? [String: Any])?.isEmpty == true, "node report is not mistaken for an edge report")
    nodeGraph.nodes[0].x = 200
    nodeGraph.nodes[0].appearance = NodeAppearance(color: "#123456", radius: 8, corners: "uniform", surface: "filled", header: "plain")
    try check(try nodeFingerprint(nodeGraph.nodes[0], nodeGraph) == nodeHash, "node layout and appearance preserve report fingerprint")
    nodeGraph.nodes[0].command = "python component.py"
    let nodeChanged = try nodeStore.save(nodeGraph, expectedRevision: nodeStore.revision)
    try check((nodeChanged["nodeReports"] as? [String: [String: Any]])?["n1"]?["status"] as? String == "stale", "node detail edit invalidates report")
    try nodeStore.writeText("original", to: "components/nodes/n1/implementation/main.py")
    _ = try nodeStore.poll()
    nodeGraph.nodes[0].policy = "immutable"
    _ = try nodeStore.save(nodeGraph, expectedRevision: nodeStore.revision)
    try nodeStore.writeText("external change", to: "components/nodes/n1/implementation/main.py")
    let blockedNode = try nodeStore.poll()
    try check((blockedNode["nodeReports"] as? [String: [String: Any]])?["n1"]?["status"] as? String == "blocked", "protected node implementation changes block report and checkpoint")
    try check(nodeStore.history!.protectedFiles.contains("components/nodes/n1/implementation/main.py"), "protected node code change is visible in history")
    _ = try nodeStore.unlock(kind: "node", id: "n1", expectedRevision: nodeStore.revision)
    nodeGraph = nodeStore.graph!; nodeGraph.nodes = []
    _ = try nodeStore.save(nodeGraph, expectedRevision: nodeStore.revision)
    try check(fm.fileExists(atPath: nodeStore.root!.appendingPathComponent("components/nodes/n1/implementation/main.py").path), "deleting a node preserves its implementation")
    print("\(count) core checks passed")
}
