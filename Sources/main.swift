import Cocoa
@preconcurrency import WebKit

func argument(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else { return nil }
    return CommandLine.arguments[index + 1]
}
if CommandLine.arguments.contains("--self-test") {
    do { try runSelfTests(); exit(0) } catch { fputs("FAIL: \(error)\n", stderr); exit(1) }
}
if let location = argument("--refresh") {
    do { let store = ProjectStore(); _ = try store.open(URL(fileURLWithPath: location)); try store.exportBrief(); print("Refreshed \(location)"); exit(0) }
    catch { fputs("\(error.localizedDescription)\n", stderr); exit(1) }
}

final class CanvasWebView: WKWebView {
    var filesDropped: (([String], NSPoint) -> Void)?
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if sender.draggingPasteboard.canReadObject(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) { return .copy }
        return super.draggingEntered(sender)
    }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { draggingEntered(sender) }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty {
            let point = convert(sender.draggingLocation, from: nil)
            filesDropped?(urls.map(\.path), NSPoint(x: point.x, y: isFlipped ? point.y : bounds.height - point.y))
            return true
        }
        return super.performDragOperation(sender)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: CanvasWebView!
    let store = ProjectStore()
    var dirty = false
    var initialError: String?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "gacchanko")
        web = CanvasWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.registerForDraggedTypes([.fileURL])
        web.filesDropped = { [weak self] paths, point in
            self?.emit("nativeDrop", value: ["paths": paths, "x": point.x, "y": point.y])
        }
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "がっちゃんこ gacchanko"
        window.minSize = NSSize(width: 1050, height: 680)
        window.contentView = web
        window.delegate = self
        window.center()
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "がっちゃんこ を終了", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); menu.addItem(editItem)
        let editMenu = NSMenu(title: "Edit"); editItem.submenu = editMenu
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        NSApp.mainMenu = menu
        if let initial = argument("--project") {
            do { _ = try store.open(URL(fileURLWithPath: initial)) } catch { initialError = error.localizedDescription }
        }
        let resources = Bundle.main.resourceURL!.appendingPathComponent("web")
        web.loadFileURL(resources.appendingPathComponent("index.html"), allowingReadAccessTo: resources)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let initialError { emit("nativeError", value: initialError) }
        if argument("--ui-test") != nil, let url = Bundle.main.resourceURL?.appendingPathComponent("ui-smoke.js"), let code = try? String(contentsOf: url, encoding: .utf8) {
            web.evaluateJavaScript(code) { _, error in
                if let error { self.finishTest(["ok": false, "error": error.localizedDescription]) }
            }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let allowed = Bundle.main.resourceURL!.appendingPathComponent("web").path + "/"
        decisionHandler(url.isFileURL && url.standardizedFileURL.path.hasPrefix(allowed) ? .allow : .cancel)
    }
    func emit(_ name: String, value: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["value": value], options: [.fragmentsAllowed]), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('\(name)', {detail: (\(json)).value}))", completionHandler: nil)
    }
    func reply(_ id: String, value: Any? = nil, error: String? = nil) {
        var payload: [String: Any] = ["id": id]
        payload["value"] = value ?? NSNull()
        if let error { payload["error"] = error }
        emit("nativeReply", value: payload)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any], let id = body["id"] as? String, let command = body["command"] as? String else { return }
        let args = body["args"] as? [String: Any] ?? [:]
        do {
            switch command {
            case "state": reply(id, value: try store.snapshot())
            case "dirty": dirty = args["value"] as? Bool ?? false; reply(id, value: true)
            case "inspect": reply(id, value: try inspectPath(args["path"] as? String ?? ""))
            case "chooseNodes":
                let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = true; panel.allowsMultipleSelection = true; panel.prompt = "ノードとして追加"
                reply(id, value: panel.runModal() == .OK ? panel.urls.map(\.path) : [])
            case "newProject":
                guard let raw = args["graph"] else { throw PatchError("グラフがありません。") }
                let graph = try JSONDecoder().decode(PatchGraph.self, from: JSONSerialization.data(withJSONObject: raw))
                let panel = NSSavePanel(); panel.title = "プロジェクトの保存先"; panel.nameFieldStringValue = "\(graph.name).gacchanko"; panel.canCreateDirectories = true
                if panel.runModal() == .OK, let url = panel.url { let result = try store.create(url, graph: graph); dirty = false; reply(id, value: result) } else { reply(id) }
            case "openProject":
                let panel = NSOpenPanel(); panel.canChooseDirectories = true; panel.canChooseFiles = true; panel.message = "プロジェクトフォルダ、または graph.json を選択"; panel.prompt = "開く"
                if panel.runModal() == .OK, let url = panel.url { let result = try store.open(url); dirty = false; reply(id, value: result) } else { reply(id) }
            case "save":
                guard let raw = args["graph"] else { throw PatchError("グラフがありません。") }
                let graph = try JSONDecoder().decode(PatchGraph.self, from: JSONSerialization.data(withJSONObject: raw))
                let result = try store.save(graph, expectedRevision: args["revision"] as? String ?? "")
                dirty = false; reply(id, value: result)
            case "poll": reply(id, value: try store.poll())
            case "reload":
                guard let root = store.root else { throw PatchError("プロジェクトを開いてください。") }
                let result = try store.open(root); try store.exportBrief(); dirty = false; reply(id, value: result)
            case "copyPrompt":
                let text = try store.prompt(edgeID: args["edgeID"] as? String)
                NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
                reply(id, value: text)
            case "copy":
                NSPasteboard.general.clearContents(); NSPasteboard.general.setString(args["text"] as? String ?? "", forType: .string); reply(id, value: true)
            case "reveal":
                guard let root = store.root else { throw PatchError("先に保存してください。") }
                NSWorkspace.shared.activateFileViewerSelecting([root]); reply(id, value: true)
            case "exportJSON":
                let panel = NSSavePanel(); panel.nameFieldStringValue = "graph-export.json"
                if panel.runModal() == .OK, let url = panel.url {
                    try JSONSerialization.data(withJSONObject: args["graph"] ?? [:], options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
                    reply(id, value: url.path)
                } else { reply(id) }
            case "testCreate":
                guard let output = argument("--ui-test"), let raw = args["graph"] else { throw PatchError("Test mode only") }
                let graph = try JSONDecoder().decode(PatchGraph.self, from: JSONSerialization.data(withJSONObject: raw))
                let url = URL(fileURLWithPath: output).deletingLastPathComponent().appendingPathComponent("ui-project-\(UUID().uuidString).gacchanko")
                reply(id, value: try store.create(url, graph: graph))
            case "testReport":
                guard argument("--ui-test") != nil, let edge = store.graph?.edges.first else { throw PatchError("Test mode only") }
                let report: [String: Any] = ["fingerprint": try fingerprint(edge, store.graph!), "status": "verified", "summary": "UI test report", "files": [], "checks": ["Fixture only"]]
                try store.write(JSONSerialization.data(withJSONObject: report), to: "reports/\(edge.id).json"); reply(id, value: true)
            case "testFinish":
                guard argument("--ui-test") != nil else { throw PatchError("Test mode only") }
                finishTest(args)
            default: throw PatchError("未対応の操作: \(command)")
            }
        } catch { reply(id, error: error.localizedDescription) }
    }
    func finishTest(_ result: [String: Any]) {
        if let path = argument("--ui-test"), let data = try? JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL(fileURLWithPath: path)) }
        dirty = false
        NSApp.terminate(nil)
    }
    func allowClose() -> Bool {
        guard dirty else { return true }
        let alert = NSAlert(); alert.messageText = "まだ保存されていない編集があります"; alert.informativeText = "編集を続けて保存するか、未保存の変更を破棄して閉じてください。"; alert.addButton(withTitle: "編集を続ける"); alert.addButton(withTitle: "破棄して閉じる")
        return alert.runModal() == .alertSecondButtonReturn
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { allowClose() }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { allowClose() ? .terminateNow : .terminateCancel }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.run()
