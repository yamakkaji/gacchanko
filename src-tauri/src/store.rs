use crate::{
    graph::*,
    history::{atomic, open_regular, read_limited, safe, History},
    model::*,
    Result,
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Default)]
pub struct Store {
    pub root: Option<PathBuf>,
    pub revision: String,
    pub graph: Option<PatchGraph>,
    pub history: Option<History>,
}
impl Store {
    pub fn open(&mut self, path: &Path) -> Result<Value> {
        let root = dunce::canonicalize(if path.file_name().is_some_and(|n| n == "graph.json") {
            path.parent().unwrap()
        } else {
            path
        })?;
        let data = read_limited(&safe(&root, "graph.json")?, 10_000_000)?;
        let h = History::new(&root)?;
        let previous = h.accepted("HEAD")?;
        let loaded: Result<PatchGraph> = serde_json::from_slice::<PatchGraph>(&data)
            .map_err(|e| e.into())
            .and_then(|g| {
                validate(&g)?;
                Ok(g)
            });
        let pending = match (&previous, &loaded) {
            (Some(p), Ok(g)) => value(p) != value(g),
            (Some(_), Err(_)) => true,
            _ => false,
        };
        // Construct a candidate store first. Failed open never corrupts the current session.
        let g = if pending {
            previous.clone().unwrap()
        } else {
            loaded?
        };
        let mut next = Self {
            root: Some(root),
            revision: if pending {
                hash(&bytes(&g)?)
            } else {
                hash(&data)
            },
            graph: Some(g),
            history: Some(h),
        };
        let result = if pending {
            let mut s = next.snapshot()?;
            s["pendingExternal"] = next.external(&data);
            s
        } else {
            next.export()?;
            next.history.as_mut().unwrap().checkpoint(
                if previous.is_none() {
                    "gacchanko / import"
                } else {
                    "external / unknown"
                },
                "Open project",
                &[],
            )?;
            next.snapshot()?
        };
        *self = next;
        Ok(result)
    }
    pub fn create(&mut self, path: &Path, g: PatchGraph) -> Result<Value> {
        validate(&g)?;
        if path.exists() && fs::read_dir(path)?.next().is_some() {
            return Err("Choose a new or empty project directory".into());
        }
        fs::create_dir_all(path)?;
        let root = dunce::canonicalize(path)?;
        let h = History::new(&root)?;
        let mut next = Self {
            root: Some(root),
            history: Some(h),
            ..Default::default()
        };
        let result = next.save(g, "", &[], false)?;
        *self = next;
        Ok(result)
    }
    fn path(&self, rel: &str) -> Result<PathBuf> {
        safe(self.root.as_deref().ok_or("Open a project first")?, rel)
    }
    fn write(&self, rel: &str, b: &[u8]) -> Result<()> {
        atomic(&self.path(rel)?, b)
    }
    pub fn save(
        &mut self,
        g: PatchGraph,
        revision: &str,
        unlocked: &[String],
        checkpoint_before: bool,
    ) -> Result<Value> {
        validate(&g)?;
        if let Some(old) = &self.graph {
            let v = violations(old, &g, unlocked);
            if !v.is_empty() {
                return Err(format!("Protected design cannot be changed: {}", v.join(", ")).into());
            }
        }
        if let Some(h) = &self.history {
            let v = h.code_violations(unlocked)?;
            if !v.is_empty() {
                return Err(format!("Protected implementation changed: {}", v.join(", ")).into());
            }
            h.files()?;
        }
        let file = self.path("graph.json")?;
        let current = if file.exists() {
            hash(&read_limited(&file, 10_000_000)?)
        } else {
            String::new()
        };
        if current != revision {
            return Err("The graph was changed by another tool. Review the external proposal before saving.".into());
        }
        let encoded = bytes(&g)?;
        if encoded.len() >= 10_000_000 {
            return Err("Graph exceeds size limit".into());
        }
        self.preflight(&g)?;
        if unlocked.is_empty() && checkpoint_before {
            self.history.as_mut().unwrap().checkpoint(
                "external / unknown",
                "Implementation / report update before design save",
                &[],
            )?;
        }
        // Check again after hashing/checkpointing potentially large implementations.
        let latest = if file.exists() {
            hash(&read_limited(&file, 10_000_000)?)
        } else {
            String::new()
        };
        if latest != revision {
            return Err(
                "The graph changed while preparing the save. Review the external proposal.".into(),
            );
        }
        self.write("graph.json", &encoded)?;
        self.graph = Some(g);
        self.revision = hash(&encoded);
        self.export()?;
        self.history.as_mut().unwrap().checkpoint(
            "gacchanko / user",
            &if unlocked.is_empty() {
                "Save design".into()
            } else {
                format!("Unlock {}", unlocked.join(", "))
            },
            unlocked,
        )?;
        self.snapshot()
    }
    fn preflight(&self, g: &PatchGraph) -> Result<()> {
        // Descriptions and template instructions are repeated in generated specs.
        // Bound that expansion before writing even the first output file.
        let origin_size = |o: &Option<TemplateOrigin>| -> usize {
            o.as_ref()
                .and_then(|o| {
                    g.templates
                        .as_deref()
                        .unwrap_or(&[])
                        .iter()
                        .find(|t| t.id == o.template_id && t.version == o.version)
                })
                .map(|t| t.instructions.len())
                .unwrap_or(0)
        };
        let mut estimate = bytes(g)?.len() as u64 + 20_000;
        let node_sizes: std::collections::HashMap<_, _> = g
            .nodes
            .iter()
            .map(|n| Ok((n.id.as_str(), bytes(n)?.len() as u64)))
            .collect::<Result<_>>()?;
        for n in &g.nodes {
            estimate += 10_000
                + 4 * node_sizes[n.id.as_str()]
                + 2 * (g.description.len() + origin_size(&n.derived_from)) as u64;
        }
        for e in &g.edges {
            estimate += 10_000
                + 3 * bytes(e)?.len() as u64
                + 3 * (node_sizes.get(e.source.as_str()).copied().unwrap_or(0)
                    + node_sizes.get(e.target.as_str()).copied().unwrap_or(0))
                + 2 * (g.description.len() + origin_size(&e.derived_from)) as u64;
        }
        if estimate > crate::history::MAX_CHECKPOINT_BYTES {
            return Err("Generated specifications exceed the project size budget".into());
        }
        for p in [
            "graph.json",
            "AGENT_BRIEF.md",
            "graph.mmd",
            "implementations",
            "reports",
        ] {
            self.path(p)?;
        }
        for n in &g.nodes {
            self.path(&format!("components/nodes/{}/SPEC.md", n.id))?;
        }
        for e in &g.edges {
            self.path(&format!("connections/{}/SPEC.md", e.id))?;
        }
        Ok(())
    }
    pub fn export(&self) -> Result<()> {
        let g = self.graph.as_ref().ok_or("Open a project first")?;
        self.preflight(g)?;
        let mut brief=format!("# {}\n\nThis is a gacchanko integration project. Read `graph.json` as the authoritative design.\nProject directory: the directory containing this file.\n\n## Goal\n{}\n\n{}\n## Nodes\n",g.name,g.description,include_str!("../resources/working-agreement.md"));
        let origin = |o: &Option<TemplateOrigin>| {
            o.as_ref()
                .map(|o| {
                    format!(
                        "{} v{} / {}. {}",
                        o.template_id,
                        o.version,
                        o.member_id,
                        g.templates
                            .as_deref()
                            .unwrap_or(&[])
                            .iter()
                            .find(|t| t.id == o.template_id && t.version == o.version)
                            .map(|t| t.instructions.as_str())
                            .unwrap_or("")
                    )
                })
                .unwrap_or("none".into())
        };
        for n in &g.nodes {
            let fp = fingerprint(g, &value(n), true);
            let spec=format!("# {}\n\nNode ID: {}\nFingerprint: {}\nPolicy: {}\nComponent Type: {}\nAccess: {}\nImplementation state (user-declared): {}\nDesign instructions: {}\nTemplate origin: {}\nCommand (not auto-executed): {}\nInputs: {}\nOutputs: {}\n\n## Description\n{}\n\n## Project goal\n{}\n\n## Scope and deliverables\nImplement or verify only this node. Adjacent edges and nodes are context, not additional implementation targets.\nPreserve referenced source repositories unless explicitly authorized to edit them.\nWrite new code in components/nodes/{}/implementation/.\nWrite components/nodes/{}/report.json with fingerprint {}, status implemented|verified|blocked, summary, files, and checks.\nReport actual checks only. Follow AGENT_BRIEF.md. Do not edit this generated SPEC.md.\n",n.name,n.id,fp,n.policy.as_deref().unwrap_or("mutable"),n.kind,n.path,n.implementation_state.as_deref().unwrap_or("unspecified"),n.design_instructions.as_deref().unwrap_or(""),origin(&n.derived_from),n.command,n.inputs.join(", "),n.outputs.join(", "),n.description,g.description,n.id,n.id,fp);
            self.write(
                &format!("components/nodes/{}/SPEC.md", n.id),
                spec.as_bytes(),
            )?;
            brief += &format!("\n### {} [{}]\n- Policy: {}\n- Design instructions: {}\n- Template origin: {}\n- Kind: {}\n- Implementation state (user-declared): {}\n- Location: {}\n- Command (not auto-executed): {}\n- Inputs: {}\n- Outputs: {}\n\n{}\n", n.name,n.id,n.policy.as_deref().unwrap_or("mutable"),n.design_instructions.as_deref().unwrap_or(""),origin(&n.derived_from),n.kind,n.implementation_state.as_deref().unwrap_or("unspecified"),if n.path.is_empty(){"Not set"}else{&n.path},n.command,n.inputs.join(", "),n.outputs.join(", "),n.description);
        }
        brief += "\n## Connection components\n";
        for e in &g.edges {
            let fp = fingerprint(g, &value(e), false);
            let source = g.nodes.iter().find(|n| n.id == e.source);
            let target = g.nodes.iter().find(|n| n.id == e.target);
            let mut spec = format!(
                "# {}\n\nEdge ID: {}\nFingerprint: {}\n",
                if e.label.is_empty() {
                    "Connection"
                } else {
                    &e.label
                },
                e.id,
                fp
            );
            for(k,v)in [("Component Type",e.mode.clone()),("Access",e.path.clone().unwrap_or("Not set".into())),("Implementation state (user-declared)",e.implementation_state.clone().unwrap_or("unspecified".into())),("Connection state",if source.is_none()||target.is_none(){"Unconnected. Preserve this edge and its intent; resolve missing endpoints before implementation or verification."}else{"Connected"}.into()),("Mode",e.mode.clone()),("Layer",e.layer.clone().unwrap_or("data".into())),("Execution",e.execution.as_ref().map(|x|serde_json::to_string_pretty(x).unwrap()).unwrap_or("Unspecified; agree on scheduling before implementation".into())),("Policy",e.policy.clone().unwrap_or("mutable".into())),("Design instructions",e.design_instructions.clone().unwrap_or_default()),("Template origin",origin(&e.derived_from))] {spec+=&format!("{k}: {v}\n");}
            for (label, n, port) in [
                ("Source", source, &e.source_port),
                ("Target", target, &e.target_port),
            ] {
                spec += &format!(
                    "{}: {} [{}] / {}\n{} location: {}\n",
                    label,
                    n.map(|n| n.name.as_str()).unwrap_or("Unconnected"),
                    n.map(|n| n.id.as_str()).unwrap_or(""),
                    port,
                    label,
                    n.map(|n| n.path.as_str()).unwrap_or("")
                );
            }
            spec += &format!(
                "\n## User intent\n{}\n",
                if e.intent.is_empty() {
                    "No intent supplied yet. Clarify the intended behaviour before implementing."
                } else {
                    &e.intent
                }
            );
            for (label, n) in [("Source", source), ("Target", target)] {
                spec += &format!(
                    "\n## {label} context\n{}\nInvocation hint: {}\n",
                    n.map(|n| n.description.as_str()).unwrap_or(""),
                    n.map(|n| n.command.as_str()).unwrap_or("")
                );
            }
            spec+=&format!("\n## Deliverables\nImplement in implementations/{}/. Record actual results in reports/{}.json.\nUse fingerprint {}. Follow AGENT_BRIEF.md. Do not edit this generated file.\n",e.id,e.id,fp);
            self.write(&format!("connections/{}/SPEC.md", e.id), spec.as_bytes())?;
            brief += &format!(
                "\n- [{}](connections/{}/SPEC.md): {} → {} — {}\n",
                e.id,
                e.id,
                source.map(|n| n.name.as_str()).unwrap_or("Unconnected"),
                target.map(|n| n.name.as_str()).unwrap_or("Unconnected"),
                e.label
            );
        }
        self.write("AGENT_BRIEF.md", brief.as_bytes())?;
        let label = |s: &str| {
            s.replace('"', "'")
                .replace(['\n', '\r'], " ")
                .replace(['[', '<'], "(")
                .replace([']', '>'], ")")
                .replace('&', "+")
        };
        let mut mermaid = "flowchart TD\n".to_string();
        for (i, n) in g.nodes.iter().enumerate() {
            mermaid += &format!("  n{i}[\"{}\"]\n", label(&n.name));
        }
        for (i, e) in g.edges.iter().enumerate() {
            let mut ends = vec![];
            for (s, id) in [("s", &e.source), ("t", &e.target)] {
                ends.push(if let Some(j) = g.nodes.iter().position(|n| n.id == *id) {
                    format!("n{j}")
                } else {
                    let key = format!("loose{i}{s}");
                    mermaid += &format!(
                        "  {key}[\"Unconnected {}\"]\n",
                        if s == "s" { "output" } else { "input" }
                    );
                    key
                });
            }
            mermaid += &format!(
                "  {} {} |\"{}\"| {}\n",
                ends[0],
                if e.mode == "request" { "<-->" } else { "-->" },
                label(&e.label),
                ends[1]
            );
        }
        self.write("graph.mmd", mermaid.as_bytes())?;
        for p in ["implementations", "reports"] {
            fs::create_dir_all(self.path(p)?)?;
        }
        Ok(())
    }
    pub fn snapshot(&self) -> Result<Value> {
        let Some(g) = &self.graph else {
            return Ok(json!({"project":null}));
        };
        let mut result = json!({"project":g,"root":self.root,"revision":self.revision,"reports":{},"fingerprints":{},"nodeReports":{},"nodeFingerprints":{},"history":self.history.as_ref().map(|h|h.summary()).transpose()?.unwrap_or(json!({}))});
        for (node, m) in g
            .nodes
            .iter()
            .map(|n| (true, value(n)))
            .chain(g.edges.iter().map(|e| (false, value(e))))
        {
            let id = m["id"].as_str().unwrap();
            let fp = fingerprint(g, &m, node);
            let (map, hashes, path, scope) = if node {
                (
                    "nodeReports",
                    "nodeFingerprints",
                    format!("components/nodes/{id}/report.json"),
                    format!("components/nodes/{id}/implementation/"),
                )
            } else {
                (
                    "reports",
                    "fingerprints",
                    format!("reports/{id}.json"),
                    format!("implementations/{id}/"),
                )
            };
            result[hashes][id] = json!(fp);
            let path = self.path(&path)?;
            if path.exists() {
                let Some(mut report) = read_limited(&path, 1_000_000)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                    .filter(|v| v.is_object())
                else {
                    result[map][id] =
                        json!({"status":"blocked","summary":"レポートの JSON を読み取れません。"});
                    continue;
                };
                if !["implemented", "verified", "blocked"]
                    .contains(&report["status"].as_str().unwrap_or(""))
                {
                    report["status"] = json!("pending");
                }
                if report["fingerprint"] != fp {
                    report["status"] = json!("stale");
                }
                if self
                    .history
                    .as_ref()
                    .is_some_and(|h| h.protected_files.iter().any(|p| p.starts_with(&scope)))
                {
                    report["status"] = json!("blocked");
                    report["summary"] = json!(if node {
                        "保護されたノード実装への外部変更を検出しました。"
                    } else {
                        "保護された実装への外部変更を検出しました。履歴への採用を停止しています。"
                    });
                }
                result[map][id] = report;
            }
        }
        Ok(result)
    }
    pub fn external(&self, data: &[u8]) -> Value {
        let mut result = json!({"externalChange":true,"diskRevision":hash(data)});
        let parsed: Result<PatchGraph> = serde_json::from_slice::<PatchGraph>(data)
            .map_err(|e| e.into())
            .and_then(|g| {
                validate(&g)?;
                Ok(g)
            });
        match parsed {
            Ok(g) => {
                result["changes"] = json!(changes(self.graph.as_ref(), &g));
                result["violations"] = json!(self
                    .graph
                    .as_ref()
                    .map(|old| violations(old, &g, &[]))
                    .unwrap_or_default());
            }
            Err(e) => {
                result["error"] = json!(e.to_string());
                result["violations"] = json!(["invalid graph"]);
            }
        }
        result
    }
    pub fn poll(&mut self) -> Result<Value> {
        if self.root.is_none() {
            return self.snapshot();
        }
        let data = read_limited(&self.path("graph.json")?, 10_000_000)?;
        if hash(&data) != self.revision {
            return Ok(self.external(&data));
        }
        self.history.as_mut().unwrap().checkpoint(
            "external / unknown",
            "Implementation / report update",
            &[],
        )?;
        self.snapshot()
    }
    pub fn adopt(&mut self, revision: &str, selections: &[String]) -> Result<Value> {
        let data = read_limited(&self.path("graph.json")?, 10_000_000)?;
        if hash(&data) != revision {
            return Err("Proposal has changed. Review it again.".into());
        }
        let incoming: PatchGraph = serde_json::from_slice(&data)?;
        validate(&incoming)?;
        let old = self.graph.as_ref().ok_or("Open a project first")?;
        let allowed: Vec<_> = changes(Some(old), &incoming)
            .iter()
            .map(|c| {
                format!(
                    "{}:{}",
                    c["kind"].as_str().unwrap(),
                    c["id"].as_str().unwrap()
                )
            })
            .collect();
        if selections.is_empty() || selections.iter().any(|s| !allowed.contains(s)) {
            return Err("Select changes to adopt".into());
        }
        let mut next = value(old);
        let proposed = value(&incoming);
        for (kind, key) in [
            ("node", "nodes"),
            ("edge", "edges"),
            ("template", "templates"),
        ] {
            if next.get(key).is_none() && proposed.get(key).is_none() {
                continue;
            }
            let identity = |v: &Value| {
                if kind == "template" {
                    format!("{}:{}", v["id"].as_str().unwrap(), v["version"])
                } else {
                    v["id"].as_str().unwrap().into()
                }
            };
            let a = next[key].as_array().cloned().unwrap_or_default();
            let b = proposed[key].as_array().cloned().unwrap_or_default();
            let mut merged = vec![];
            for v in &a {
                if selections.contains(&format!("{kind}:{}", identity(v))) {
                    if let Some(p) = b.iter().find(|p| identity(p) == identity(v)) {
                        merged.push(p.clone());
                    }
                } else {
                    merged.push(v.clone());
                }
            }
            for v in &b {
                if !a.iter().any(|p| identity(p) == identity(v))
                    && selections.contains(&format!("{kind}:{}", identity(v)))
                {
                    merged.push(v.clone());
                }
            }
            next[key] = json!(merged);
        }
        if selections.contains(&"project:project".into()) {
            next["name"] = proposed["name"].clone();
            next["description"] = proposed["description"].clone();
        }
        let next: PatchGraph = serde_json::from_value(next)?;
        validate(&next)?;
        if !violations(old, &next, &[]).is_empty() {
            return Err("Selected changes modify protected components".into());
        }
        self.write(
            &format!(".gacchanko/proposals/{}.json", uuid::Uuid::new_v4()),
            &data,
        )?;
        self.save(next, revision, &[], false)
    }
    pub fn reject(&mut self, revision: &str) -> Result<Value> {
        let data = read_limited(&self.path("graph.json")?, 10_000_000)?;
        if hash(&data) != revision {
            return Err("Proposal has changed. Review it again.".into());
        }
        let accepted = bytes(self.graph.as_ref().ok_or("Open a project first")?)?;
        self.write(
            &format!(".gacchanko/rejected/{}.json", uuid::Uuid::new_v4()),
            &data,
        )?;
        self.write("graph.json", &accepted)?;
        self.revision = hash(&accepted);
        self.export()?;
        self.snapshot()
    }
    pub fn unlock(&mut self, kind: &str, id: &str, revision: &str) -> Result<Value> {
        let mut g = self.graph.clone().ok_or("Open a project first")?;
        match kind {
            "node" => {
                g.nodes
                    .iter_mut()
                    .find(|n| n.id == id)
                    .ok_or("Node not found")?
                    .policy = Some("mutable".into())
            }
            "edge" => {
                g.edges
                    .iter_mut()
                    .find(|e| e.id == id)
                    .ok_or("Edge not found")?
                    .policy = Some("mutable".into())
            }
            _ => return Err("Invalid component kind".into()),
        }
        self.save(g, revision, &[format!("{kind}:{id}")], false)
    }
    pub fn prompt(&self, edge: Option<&str>, node: Option<&str>, language: &str) -> Result<String> {
        let root = self.root.as_ref().ok_or("Save the project first")?;
        let g = self.graph.as_ref().unwrap();
        if edge.is_some() && node.is_some() {
            return Err("Specify one component only".into());
        }
        let mut text = if language == "ja" {
            "次のローカルプロジェクトを読み、指定した対象だけを実装・検証してください。"
        } else {
            "Read this local project and implement and verify only the specified targets."
        }
        .to_string();
        text += &format!(
            "\n\n{}\n{}\n\n",
            root.join("AGENT_BRIEF.md").display(),
            root.join("graph.json").display()
        );
        if let Some(id) = node {
            if !g.nodes.iter().any(|n| n.id == id) {
                return Err("Node not found".into());
            }
            let dir = root.join(format!("components/nodes/{id}"));
            text += &if language == "ja" {
                format!("対象ノード: {id}\n{}\n接続されたノードやエッジは文脈のみです。新しい実装は {} に、実際の検証結果は {} に保存してください。",dir.join("SPEC.md").display(),dir.join("implementation").display(),dir.join("report.json").display())
            } else {
                format!("Target node: {id}\n{}\nAdjacent nodes and edges are context only. Save new code in {} and actual verification results in {}.",dir.join("SPEC.md").display(),dir.join("implementation").display(),dir.join("report.json").display())
            };
        } else {
            if let Some(id) = edge {
                if !g.edges.iter().any(|e| e.id == id) {
                    return Err("Edge not found".into());
                }
                text += &format!(
                    "{}: {id}\n{}\n",
                    if language == "ja" {
                        "対象エッジ（この接続のみ）"
                    } else {
                        "Target edge (only this connection)"
                    },
                    root.join(format!("connections/{id}/SPEC.md")).display()
                );
            } else {
                text += if language == "ja" {
                    "graph.json に記載された接続を対象にしてください。\n"
                } else {
                    "Implement the connections in graph.json.\n"
                };
            }
            text += if language == "ja" {
                "生成コードは implementations/<edge-id>/ に、実際の検証結果は reports/<edge-id>.json に保存してください。"
            } else {
                "Save generated code in implementations/<edge-id>/ and actual verification results in reports/<edge-id>.json."
            };
        }
        text += if language == "ja" {
            "\nレポートには SPEC.md の fingerprint、status、summary、files、checks を含めてください。参照先コードと指示書を確認し、参照先リポジトリの変更や保護解除を勝手に行わないでください。パスにアクセスできない場合はそのことを伝えてください。"
        } else {
            "\nInclude the SPEC.md fingerprint, status, summary, files and checks in the report. Inspect referenced code and instructions. Do not modify referenced repositories or remove protection without authorization. If you cannot access these paths, say so."
        };
        Ok(text)
    }
}
pub fn inspect(raw: &str) -> Result<Value> {
    if ["https://", "http://", "ssh://"]
        .iter()
        .any(|p| raw.starts_with(p))
    {
        return Ok(
            json!({"path":raw,"name":raw.trim_end_matches('/').rsplit('/').next().unwrap_or(raw).trim_end_matches(".git"),"kind":"repository","description":"Remote repository; not cloned locally.","files":[]}),
        );
    }
    let path = if let Some(p) = raw.strip_prefix("~/") {
        PathBuf::from(
            std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                .ok_or("Home directory unavailable")?,
        )
        .join(p)
    } else {
        PathBuf::from(raw)
    };
    let path = dunce::canonicalize(path)?;
    let metadata = fs::metadata(&path)?;
    if metadata.is_file() {
        return Ok(
            json!({"path":path,"name":path.file_name().unwrap_or_default().to_string_lossy(),"kind":"file","description":"","files":[]}),
        );
    }
    if !metadata.is_dir() {
        return Err("Only regular files and directories are supported".into());
    }
    let dir = path.as_path();
    let mut names = fs::read_dir(dir)?
        .map(|e| e.map(|e| e.file_name().to_string_lossy().into_owned()))
        .collect::<std::io::Result<Vec<_>>>()?;
    names.retain(|n| !n.starts_with('.'));
    names.sort();
    let description = names
        .iter()
        .find(|n| ["readme.md", "readme.txt"].contains(&n.to_lowercase().as_str()))
        .and_then(|n| safe(dir, n).ok())
        .and_then(|p| {
            use std::io::Read;
            let mut b = vec![];
            open_regular(&p).ok()?.take(4096).read_to_end(&mut b).ok()?;
            Some(
                String::from_utf8_lossy(&b)
                    .chars()
                    .take(3000)
                    .collect::<String>(),
            )
        })
        .unwrap_or_default();
    Ok(
        json!({"path":path,"name":path.file_name().unwrap_or_default().to_string_lossy(),"kind":if dir.join(".git").exists(){"repository"}else{"directory"},"description":description,"files":names.into_iter().take(40).collect::<Vec<_>>()}),
    )
}
