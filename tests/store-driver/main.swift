// Test harness for the same store used by the app; no substitute fingerprints.
import Foundation
let args = CommandLine.arguments
let store = ProjectStore()
do {
    guard args.count >= 3 else { throw PatchError("Usage: store-driver project prompt|snapshot|poll [edge-id]") }
    _ = try store.open(URL(fileURLWithPath: args[1]))
    switch args[2] {
    case "prompt": print(try store.prompt(edgeID: args.count > 3 ? args[3] : nil))
    case "history":
        guard args.count > 3, let history = store.history else { throw PatchError("Commit ID required") }
        print(String(data: try JSONSerialization.data(withJSONObject: history.detail(args[3]), options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    case "snapshot", "poll":
        let snapshot = args[2] == "poll" ? try store.poll() : try store.snapshot()
        print(String(data: try JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    default: throw PatchError("Unknown command")
    }
} catch { fputs("\(error.localizedDescription)\n", stderr); exit(1) }
