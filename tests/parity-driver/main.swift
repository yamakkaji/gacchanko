import Foundation
var store = ProjectStore()
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let operations = try JSONSerialization.jsonObject(with: Data(contentsOf: input)) as! [[String: Any]]
let root = URL(fileURLWithPath: CommandLine.arguments[2])
func decode(_ raw: Any) throws -> PatchGraph { try JSONDecoder().decode(PatchGraph.self, from: JSONSerialization.data(withJSONObject: raw)) }
var results: [[String: Any]] = []
for op in operations {
    do {
        let action = op["op"] as! String
        var result: [String: Any] = [:]
        switch action {
        case "create": result = try store.create(root, graph: decode(op["graph"]!))
        case "save": result = try store.save(decode(op["graph"]!), expectedRevision: op["stale"] as? Bool == true ? "stale" : store.revision)
        case "reopen": store = ProjectStore(); result = try store.open(root)
        case "poll": result = try store.poll()
        case "external": try store.write(Data((op["raw"] as! String).utf8), to: "graph.json")
        case "write": try store.writeText(op["text"] as! String, to: op["path"] as! String)
        case "report":
            let id = op["id"] as! String, node = op["node"] as? Bool == true
            let fp = try node ? nodeFingerprint(store.graph!.nodes.first{$0.id == id}!, store.graph!) : fingerprint(store.graph!.edges.first{$0.id == id}!, store.graph!)
            try store.write(JSONSerialization.data(withJSONObject: ["fingerprint": fp, "status": "verified", "summary": "Test fixture"]), to: node ? "components/nodes/\(id)/report.json" : "reports/\(id).json")
        case "adopt":
            let rev = op["stale"] as? Bool == true ? "stale" : digest(try Data(contentsOf: root.appendingPathComponent("graph.json")))
            result = try store.adoptExternal(diskRevision: rev, selections: op["selections"] as! [String])
        case "reject":
            let rev = op["stale"] as? Bool == true ? "stale" : digest(try Data(contentsOf: root.appendingPathComponent("graph.json")))
            result = try store.rejectExternal(diskRevision: rev)
        case "unlock": result = try store.unlock(kind: op["kind"] as! String, id: op["id"] as! String, expectedRevision: store.revision)
        case "read": result = ["text": try String(contentsOf: store.safeURL(op["path"] as! String), encoding: .utf8)]
        default: throw PatchError("Unknown scenario operation")
        }
        results.append(["ok": true, "value": result])
    } catch { results.append(["ok": false]) }
}
print(String(data: try JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]), encoding: .utf8)!)
