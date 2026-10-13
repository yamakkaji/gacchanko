[日本語](README.md)

# がっちゃんこ gacchanko

Gacchanko is a GUI application for creating new software by combining existing programs and libraries with the help of AI coding agents.

Place folders containing programs you want to use—or ideas for programs you want to create—on a canvas as nodes, connect them, and describe what you want them to do together. Hand this design to an AI coding agent you already use, such as Codex or Claude Code. The agent inspects the code and implements the connections.

Gacchanko itself does not require an LLM API key. Designs and generated implementations are managed as local projects.

This is an experimental desktop application built with Tauri 2. The macOS build has been verified locally, and GitHub Actions supports Windows builds. Runtime behavior on Windows has not yet been verified on a Windows machine. To generate connection code, you need a separate AI coding agent with read and write access to the relevant local files.

## Contents

- [Preface](#preface)
- [Installation and launch](#getting-started)
- [First steps](#first-steps)
- [Language and tutorial](#language-and-tutorial)
- [Canvas controls](#canvas-controls)
  - [Node and edge appearance](#node-appearance)
- [Component settings](#component-inspector)
  - [Connection descriptions and design checks](#design-checks)
- [Connection layers and asynchronous design](#execution-layers)
- [Mutability, templates, and change history](#design-and-history)
- [Connection implementation example](#agent-handoff)
- [Current scope and limitations](#scope)
- [Project files](#project-files)
- [Report format](#report-format)
- [Development and testing](#development)
- [Implementation structure](#tauri)

<a id="preface"></a>

## Preface

Broadly speaking, when we create something, we create elements and connect them. We then group those elements and their connections into a new element, and connect it to others to create something more complex. In programming, this perspective applies to both object-oriented and functional approaches. Biological evolution, too, involves changes to elements and their relationships. Our bodies exist through the evolution not only of diverse protein functions, but also of the mechanisms that regulate their expression and interactions.

From this perspective, creativity involves deciding “what elements to create” and “what to connect, and how.” If we also view the inside of an element as a combination of existing elements, creating a new element can itself be understood as designing its internal combinations. In programming, combining existing libraries and mechanisms produces functions and behaviors that the individual elements could not achieve alone. When the result becomes an element for further creation, the possibilities for combination grow. Here, we view creativity through this process, following the idea of “combinatorial evolution” discussed in accounts of technological evolution and related fields.

Yet much work lies between imagining a connection and implementing something that actually works. Suppose we want to combine a newly developed image-processing algorithm with a camera, keyboard, mouse, and display to build a GUI application for editing camera footage. We need to capture frames, convert them into a format the algorithm accepts, change processing in response to user input, and display the results. We also need to account for differences in processing speed, execution timing, and error handling. Implementing all this requires combining still more libraries. Even if “camera → image-processing algorithm → display” is easy to imagine, implementing those connections takes considerable effort.

A connection has two aspects. One is its design: what to pass, when to process it, and what behavior to produce. Even with the same elements, changing their order, timing, or feedback can change the result. The other is the code that realizes that design: data conversion, calls between components, synchronization, buffering, and so on. These aspects cannot be completely separated; discoveries during implementation can change the design. Nevertheless, reducing the burden of implementing connections should leave more time and effort for thinking about what to combine, how to combine it, and trying it out.

A common way to reduce this burden is to provide a shared platform or standard. Elements that follow the same interface are easier to connect. Independently developed programs, however, do not necessarily follow the same standard. Adapting existing elements to a standard or porting them to a particular platform can itself be costly, and can limit the combinations we can try.

Here, we consider an approach in which LLM-based AI coding agents build the implementation needed for each connection. An agent reads the referenced code and the intended connection, then implements wrappers or intermediary code to bridge the differences between elements. It needs access to the individual elements and a description of how they should work together. With that information, it can investigate the relevant code, implement the connection, and test it. Incomplete specifications or differences in execution environments may still require clarification and revisions, but this approach could reduce the burden of writing every connection by hand.

Gacchanko is experimental software intended to support this process. Although AI coding agents accept natural-language instructions, describing many elements and their relationships entirely in prose—and keeping track of changes—can be difficult. Inspired by graph interfaces such as Max/MSP and Unreal Engine Blueprint, gacchanko lets users arrange elements as nodes and connections as edges, and describe their roles, intent, and conditions.

For example, place a camera and a display as nodes and connect them with an edge. Describe the format in which camera frames should be passed and how frequently the display should update. The graph and its descriptions are saved as JSON and instruction documents, then handed to the AI coding agent you normally use. The agent examines the referenced code, implements the connection from capture to display, and records the results of its checks.

In this application, edges have specifications and implementations, just as nodes do. An edge represents the flow of data or processing, and also provides a place for the wrapper or middleware that makes the connection work. This lets us keep the intent—what to connect and how—associated with the code that implements it.

Gacchanko is an experimental implementation for exploring this idea. We hope to make it possible to pursue ideas for connecting things without giving up because of the work needed to implement those connections. We also hope that the combinations people try will produce new elements for further combinations. If this software can offer even a little support for that creative process, it will have served its purpose.

<a id="getting-started"></a>

## Installation and launch

Installers are distributed through [GitHub Releases](https://github.com/yamakkaji/gacchanko/releases). If a suitable release is not yet available, build from source using the instructions below. Build artifacts are also available from the “Desktop builds” workflow in GitHub Actions.

**Running a distributed Tauri build does not require Rust, Node.js, Git, or Xcode Command Line Tools.** Git history is handled by libgit2 embedded in the application. You will need to install any runtimes required by the programs you connect or the generated code.

Building from source requires Node.js, npm, stable Rust, and the [Tauri prerequisites for your operating system](https://v2.tauri.app/start/prerequisites/).

- macOS 13 or later: Xcode Command Line Tools are required for development and building, including with Tauri.
- Windows: Visual Studio C++ Build Tools and WebView2. The distributed installer can download WebView2 if it is missing.
- Linux: Not currently included in distribution or runtime testing.

```sh
git clone https://github.com/yamakkaji/gacchanko.git
cd gacchanko
npm ci
npm run dev
```

To create a distribution build:

```sh
npm run build
```

Build output is written to `src-tauri/target/release/bundle/`: `macos/gacchanko.app` and a DMG on macOS, or an installer on Windows. Build in the appropriate environment for each operating system.

To update, quit the application, then run `git pull --ff-only`, `npm ci`, and `npm run build`.

You can open `.gacchanko` projects created with the former Swift version. Appearance and language preferences from that version are not migrated automatically; set them again in the new application.

Save your `.gacchanko` projects outside this repository to keep them separate from the application's source code.

<a id="first-steps"></a>

## First steps

1. **Add elements.** Drop folders containing programs from Finder onto the canvas. You can also use “+ Add component” to add URLs or ideas that have no implementation yet.
2. **Connect them.** Drag from an output port on the right of a node to an input port on the left. You can also click an output and then an input.
3. **Describe your intent.** Select a node or edge and enter its name and Description in the Inspector on the right. Explain what to pass, how it should be processed, and any required conditions.
4. **Save.** Use Save to create a `.gacchanko` project folder. Subsequent edits are saved automatically.
5. **Hand it to an agent.** Use the agent handoff button and paste the copied request into Codex, Claude Code, or another agent. Use an environment with local file access and grant access to the project.
6. **Review the results.** When the agent saves connection code and verification reports, the application displays the implementation status and reported results. After changing the design, you can request another implementation and verification pass.

To request work on just one node or connection, use the component handoff action in the Inspector. This also works for nodes without connections.

Use the sample-opening action on the initial screen to explore an LLM agent design with image, audio, and text inputs. You can also open the [sample project](examples/Multimodal-agent.gacchanko) through the application's Open action. This is an architectural example: you still need to configure the referenced code and models and ask an agent to implement it.

<a id="language-and-tutorial"></a>

## Language and tutorial

Switch between Japanese and English under Settings → Language / 言語. The selection applies to the interface, application menus, and agent handoff requests, and persists across launches. Project content such as node names and descriptions is not translated. Some native file dialog text follows the operating system's language settings.

The in-app tutorial introduces nodes and edges, adding and connecting components, the Inspector, saving and handing off to an agent, and reviewing results in six steps. Open it from the top menu, the bottom-left button, the empty canvas, or Help.

<a id="canvas-controls"></a>

## Canvas controls

- **Shift + click:** Add a node to the selection or deselect it.
- **Drag on empty canvas:** Select nodes fully enclosed by the rectangle. Hold Shift to add them to the current selection.
- **Drag a selected node:** Move the selection together. Delete removes the selected nodes; ⌘Z undoes the action.
- **Space + drag / middle-button drag:** Pan the canvas. Trackpad scrolling also pans.
- **Select an edge and drag an endpoint:** Reconnect its input or output. An input port with a single connection can also be dragged directly to reconnect it.
- **Release near a port:** Snap to a compatible port. Reconnection attempts released over an incompatible port or outside the canvas revert to the original connection.
- **Release a new wire on empty canvas:** Open the node creation dialog and automatically connect the new node at that position. Adding the node and edge can be undone in a single action.
- **Release an existing endpoint on empty canvas:** Keep that endpoint disconnected. The edge retains its ID, Description, design instructions, implementation files, and appearance. Reconnect it by dragging the round loose endpoint. Edges with both ends disconnected can also be saved and survive a restart.
- **Esc:** Cancel rectangle selection or a connection gesture.

Edges change color along the line from output to input. Request–response connections display ↔ in the label and a return arrow near the output. A colored dot beside the label indicates implementation status.

Open Settings at the bottom left to adjust edge rendering with a preview:

- Choose gradients, patterns, both, or status colors.
- Set output, input, and pattern colors.
- Choose chevrons or tapered stripes; adjust pattern size, spacing, and line width.
- Show or hide arrows, or reset to defaults.

These display preferences are stored locally by the application and restored on restart. They are not included in the project graph or agent specifications. Line width, pattern size, and spacing remain constant on screen when zoomed out.

<a id="node-appearance"></a>

### Node and edge appearance

Select a node and use the appearance action at the bottom of the Inspector to customize its accent color (color picker or HEX), corner radius (0–28 px), asymmetric opposite corners, fill, outline, shadow, and title-bar stripes. Apply changes to multiple nodes selected with Shift or rectangle selection. Reset to defaults and Undo/Redo are supported.

Settings are saved in each node's `appearance` and inherited by variants created from templates. Appearance can be changed even for immutable nodes, without making implementation reports stale. Appearance changes are recorded in Git history.

Node colors use the selected HEX value as a solid fill. Text automatically switches between white and black for contrast. The outline style uses a white body and the selected color for the title bar.

Edges can also be customized individually through the appearance action at the bottom of the Inspector. Individual settings are saved in the project; otherwise, application-wide display preferences apply.

<a id="component-inspector"></a>

## Component settings

Both nodes and edges are called components. Selecting one displays a common set of fields in the Inspector:

| Field | Meaning |
|---|---|
| Component Name | Name of the component |
| Mutability | `mutable` (editable) or `immutable` (protected) |
| Implementation | `implemented` or `not implemented`. A user declaration, not an automatic verification result |
| Component Type | The node type, or a connection type such as data transfer, request–response, or event |
| Access | A reference such as a directory path, URL, or IP address. Entering it does not connect to or execute anything |
| Description | The element's role, the connection's intent, and required conditions |

Node details let you edit design instructions, invocation details, and input/output ports. Connection details let you edit design instructions and synchronous or asynchronous behavior. Disconnect a port before deleting or renaming it.

For either nodes or edges, the Inspector lets you hand work to an agent and view implementation reports and check results.

<a id="design-checks"></a>

### Connection descriptions and design checks

Creating a connection opens the shared Inspector so you can describe its intent in Description. The design check action on the left lists missing information, highlights nodes with red outlines and connections with red labels, and lets you jump to the relevant field by clicking an item. The same check runs before agent handoff. You can explicitly continue with an incomplete design when you want to discuss it with the agent. This checks the descriptions, not whether the code works.

Choose `implemented` or `not implemented` for a node's implementation state; this is also displayed on the canvas. A path or README alone does not cause a node to be classified as implemented.

<a id="execution-layers"></a>

## Connection layers and asynchronous design

Switch between data, execution control, and event layers at the top of the canvas. Open connection details from the Inspector to configure synchronous or asynchronous behavior, connections to wait for, all/any completion, maximum concurrency, deadlines, queue limits, and overflow and failure handling. Cyclic completion dependencies are rejected on save. Describe iteration using events and start/stop conditions.

Settings are written to `graph.json` and each `SPEC.md`. See the [execution contract](docs/workflow-contract.md) for semantics and JSON examples. These are specifications for the agent to implement, not a scheduler running inside the application.

<a id="design-and-history"></a>

## Mutability, templates, and change history

`mutable` allows editing; `immutable` protects the design. Removing protection requires confirmation. The appearance of nodes and edges remains editable while protected.

Register multiple nodes and their internal connections as a **template**, then create **variants** that inherit the same structure. The template version, mappings between elements, and design instructions are saved in the project and included in the agent handoff. See the [template and variant example](examples/Template-variants.gacchanko).

Designs, implementations, and reports are automatically recorded in Git history within the project. The history view shows additions, changes, deletions, and code diffs.

When an external agent edits the graph, the application presents those changes as a proposal. Compare the before and after states and choose which changes to accept. Changes that violate protection or leave connections with missing targets cannot be accepted. If you have unsaved edits, set the proposal aside and save first, or export your edits as JSON.

`immutable` protects the application's editing and saving operations and the corresponding implementations inside the project. It does not prevent writes by external processes with the same file permissions, or changes to referenced repositories.

See [design properties, templates, and history](docs/design-versioning.md) for details.

<a id="agent-handoff"></a>

## Connection implementation example

The [example and walkthrough](examples/agent-handoff/README.md) connect two local programs with different formats through a wrapper. You can try the workflow from creating a handoff project through implementation, execution tests, and displaying reports.

This example requires Python 3.10 or later. A working reference implementation is included, so running that implementation does not require an LLM or an external API.

<a id="scope"></a>

## Current scope and limitations

Gacchanko is an experimental application for designing with graphs, handing work to agents, and reviewing implementation results.

See the [security review](docs/security-review.md) (Japanese) for findings and protection boundaries. Project history accepts files up to 20 MB each and 100 MB in total. Generated specification expansion is also bounded; keep models and large datasets outside the project and reference them instead.

- **Code generation and execution happen on the agent side.** The application contains neither an LLM nor an execution scheduler. Synchronous and asynchronous settings describe requirements for the generated code.
- **Agent handoff is manual.** Paste the copied request into your existing agent session. The application does not automatically send messages to a chat.
- **Referenced code is not automatically analyzed.** Adding a folder imports the beginning of its README into the description. The agent investigates APIs and ports. Entering a URL does not automatically clone a repository.
- **Implementation status is based on declarations and reports.** The application does not independently verify the correctness of generated code. Ask the agent to verify again when referenced code changes.
- **Check paths when moving to another machine.** References are stored as absolute paths and need to be adjusted for the destination.

<a id="project-files"></a>

## Project files

| File / folder | Purpose |
|---|---|
| `graph.json` | Authoritative graph: nodes, references, ports, and edge intent |
| `AGENT_BRIEF.md` | Generated overview of the project goal, references, and working instructions |
| `connections/<edge-id>/SPEC.md` | Specification and fingerprint for each connection |
| `implementations/<edge-id>/` | Where the agent writes connection code |
| `implementations/shared/` | Code shared across connections |
| `reports/<edge-id>.json` | Agent report on implementation and verification |
| `graph.mmd` | Mermaid output for reading the design |
| `components/nodes/<node-id>/SPEC.md` | Specification and fingerprint for each node |
| `components/nodes/<node-id>/implementation/` | Generated code for an individual node |
| `components/nodes/<node-id>/report.json` | Implementation and verification report for an individual node |

The agent reads `AGENT_BRIEF.md` and `graph.json`, then checks the original programs' code and applicable instructions. Connection code can be managed without modifying the original repositories. Generated specifications are rewritten on the next save, so edit the design through the GUI or `graph.json` rather than editing those documents directly.

<a id="report-format"></a>

## Report format

Save connection reports to `reports/<edge-id>.json` in this format:

```json
{
  "fingerprint": "value from connections/<edge-id>/SPEC.md",
  "status": "implemented",
  "summary": "What was implemented and what remains",
  "files": ["implementations/<edge-id>/adapter.py"],
  "checks": ["Commands actually run and their results"]
}
```

- `implemented` means the implementation is present; `verified` means relevant checks have actually been run; `blocked` means unresolved issues remain.
- Changing an edge's specification, a connected node's description, reference or ports, or the overall goal changes the fingerprint and marks old reports as stale. Position and node appearance changes do not affect it.
- Status reflects the agent's report. The GUI does not perform verification itself. The instructions explicitly prohibit reporting a successful integration run based only on a syntax check.
- **Source changes in referenced repositories are not monitored automatically.** Request verification again after updating the code.
- Deleting an edge preserves its implementation and previous report. Use `graph.json` as the authority for which connections are active.

Individual node reports use the same format with the fingerprint from that node's own `SPEC.md`. See the project file table above for their locations.

<a id="development"></a>

## Development and testing

```sh
npm ci
npm run test:store
npm run test:integration
npm run test:ui
npm run dev
```

Rust store tests cover persistence, specifications, reports, history, comparison and partial acceptance of external proposals, proposal persistence across restarts, immutable protection, explicit unlocking, and rejection of writes through symbolic links. UI tests cover editing operations as well as Tauri adapter communication and events.

Tests using the actual WebView and Rust host require an environment that can launch a GUI. The following is a macOS example. Test-only commands are included only in debug builds.

```sh
npm run test:native
```

See [test coverage](docs/testing.md) for verified behavior and checks to perform on actual devices. `npm run test:integration` checks 42 persistence, protection, and proposal scenarios, plus fingerprint compatibility with the former version, using Rust alone. Check native file dialogs, Finder drops, quit confirmation, Windows display scaling, and path handling on the target machines. Test fixture reports marked `verified` are not verification results for agent-generated implementations.

GitHub Actions builds for Mac (Apple Silicon / Intel) and Windows x64. Pushing a `v*` tag attaches successfully built installers to a draft GitHub Release. Test on the target machines and review the release before publishing. Apple Developer ID signing and notarization, and Windows code signing, are not currently configured. See the [release guide](docs/tauri-release.md) for distribution details.

<a id="tauri"></a>

## Implementation structure

The interface uses HTML, CSS, and JavaScript; the desktop host and persistence layer use Tauri 2 and Rust. The application displays its interface in the operating system's WebView without a resident web server or Node.js process.

- `web/`: Shared graph editor. `tauri.js` detects Tauri and connects it to the common interface in `bridge.js`.
- `src-tauri/src/main.rs`: File dialogs, clipboard, drops, menus, and quit confirmation.
- `src-tauri/src/store.rs`, `graph.rs`, and `history.rs`: Persistence, specifications, validation, fingerprints, and project history using libgit2.

See the [architecture document](docs/architecture.md) for communication commands and component responsibilities.
