use crate::{graph::*, history::*, model::PatchGraph, store::Store};
use serde_json::json;
use std::fs;
fn graph() -> PatchGraph {
    serde_json::from_value(json!({"schemaVersion":1,"name":"Test","description":"画像と音声 / text","nodes":[{"id":"a","name":"Input","path":"","kind":"planned","description":"input","command":"","inputs":["in"],"outputs":["out"],"x":1.5,"y":20,"policy":"mutable"},{"id":"b","name":"Agent","path":"","kind":"planned","description":"agent","command":"","inputs":["in"],"outputs":["out"],"x":200,"y":20}],"edges":[{"id":"e","source":"a","target":"b","sourcePort":"out","targetPort":"in","label":"input","intent":"deliver text","mode":"data","layer":"data","policy":"mutable"}]})).unwrap()
}
fn fixture() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Store::default();
    s.create(&dir.path().join("test.gacchanko"), graph())
        .unwrap();
    (dir, s)
}
fn external(s: &Store, g: &PatchGraph) -> String {
    let data = bytes(g).unwrap();
    fs::write(s.root.as_ref().unwrap().join("graph.json"), &data).unwrap();
    hash(&data)
}
#[test]
fn roundtrip_specs_reports_history() {
    let (_d, mut s) = fixture();
    let root = s.root.clone().unwrap();
    let snap = s.snapshot().unwrap();
    assert!(root.join("components/nodes/a/SPEC.md").exists());
    assert!(root.join("connections/e/SPEC.md").exists());
    assert!(!snap["history"]["commits"].as_array().unwrap().is_empty());
    let report = json!({"fingerprint":snap["fingerprints"]["e"],"status":"verified","summary":"actual check","checks":["test"],"files":[]});
    fs::write(root.join("reports/e.json"), report.to_string()).unwrap();
    assert_eq!(s.poll().unwrap()["reports"]["e"]["status"], "verified");
    let mut g = s.graph.clone().unwrap();
    g.edges[0].intent = "different".into();
    s.save(g, &s.revision.clone(), &[], true).unwrap();
    assert_eq!(s.snapshot().unwrap()["reports"]["e"]["status"], "stale");
    let id = s.snapshot().unwrap()["history"]["head"]
        .as_str()
        .unwrap()
        .to_string();
    assert!(s.history.as_ref().unwrap().detail(&id).unwrap()["diff"]
        .as_str()
        .unwrap()
        .contains("different"));
}
#[test]
fn stale_save_rejected_and_proposal_survives_restart() {
    let (_d, mut s) = fixture();
    let old = s.graph.clone().unwrap();
    let mut next = old.clone();
    next.nodes[0].description = "agent proposal".into();
    let rev = external(&s, &next);
    assert!(s.save(old.clone(), &s.revision.clone(), &[], true).is_err());
    assert!(s.poll().unwrap()["externalChange"].as_bool().unwrap());
    let mut reopened = Store::default();
    let state = reopened.open(s.root.as_ref().unwrap()).unwrap();
    assert!(state.get("pendingExternal").is_some());
    assert_eq!(state["project"]["nodes"][0]["description"], "input");
    reopened.adopt(&rev, &["node:a".into()]).unwrap();
    assert_eq!(
        reopened.graph.unwrap().nodes[0].description,
        "agent proposal"
    );
}
#[test]
fn partial_adopt_and_reject_preserve_archive() {
    let (_d, mut s) = fixture();
    let mut g = s.graph.clone().unwrap();
    g.nodes[0].description = "adopt".into();
    g.nodes[1].description = "skip".into();
    let rev = external(&s, &g);
    s.adopt(&rev, &["node:a".into()]).unwrap();
    assert_eq!(s.graph.as_ref().unwrap().nodes[0].description, "adopt");
    assert_eq!(s.graph.as_ref().unwrap().nodes[1].description, "agent");
    let rev = external(&s, &g);
    s.reject(&rev).unwrap();
    assert_eq!(s.graph.as_ref().unwrap().nodes[1].description, "agent");
    let root = s.root.as_ref().unwrap();
    assert_eq!(
        fs::read_dir(root.join(".gacchanko/proposals"))
            .unwrap()
            .count(),
        1
    );
    assert_eq!(
        fs::read_dir(root.join(".gacchanko/rejected"))
            .unwrap()
            .count(),
        1
    );
}
#[test]
fn immutable_design_and_code_are_enforced() {
    let (_d, mut s) = fixture();
    let mut g = s.graph.clone().unwrap();
    g.nodes[0].policy = Some("immutable".into());
    g.edges[0].policy = Some("immutable".into());
    s.save(g.clone(), &s.revision.clone(), &[], true).unwrap();
    let mut changed = g.clone();
    changed.nodes[0].description = "violation".into();
    assert!(s.save(changed, &s.revision.clone(), &[], true).is_err());
    let mut layout = g.clone();
    layout.nodes[0].x += 1.0;
    s.save(layout, &s.revision.clone(), &[], true).unwrap();
    let root = s.root.as_ref().unwrap();
    fs::create_dir_all(root.join("implementations/e")).unwrap();
    fs::write(root.join("implementations/e/code.py"), "print('changed')").unwrap();
    s.poll().unwrap();
    assert_eq!(
        s.snapshot().unwrap()["history"]["protectedFiles"][0],
        "implementations/e/code.py"
    );
    let rev = s.revision.clone();
    s.unlock("edge", "e", &rev).unwrap();
    assert!(s.snapshot().unwrap()["history"]["protectedFiles"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(s.graph.as_ref().unwrap().nodes[0].policy.as_deref() == Some("immutable"));
}
#[test]
fn protected_wiring_and_template_versions() {
    let mut g = graph();
    g.nodes[0].policy = Some("immutable".into());
    let mut next = g.clone();
    next.edges.clear();
    assert!(violations(&g, &next, &[])
        .iter()
        .any(|v| v.starts_with("wiring:")));
    let mut v = value(&g);
    v["templates"] = json!([{"id":"base","version":1,"name":"Base","instructions":"reuse topology","nodes":v["nodes"],"edges":v["edges"]}]);
    let g: PatchGraph = serde_json::from_value(v).unwrap();
    validate(&g).unwrap();
    let mut next = g.clone();
    next.templates.as_mut().unwrap()[0].instructions = "modified".into();
    assert!(violations(&g, &next, &[])
        .iter()
        .any(|v| v.starts_with("template:")));
}
#[test]
fn fingerprint_ignores_layout_but_tracks_contracts() {
    let g = graph();
    let fp = fingerprint(&g, &value(&g.edges[0]), false);
    let mut next = g.clone();
    next.nodes[0].x = 500.0;
    next.nodes[1].y = -3.0;
    assert_eq!(fp, fingerprint(&next, &value(&next.edges[0]), false));
    next.edges[0].layer = Some("control".into());
    assert_ne!(fp, fingerprint(&next, &value(&next.edges[0]), false));
}
#[test]
fn disconnected_edges_and_dependency_cycles() {
    let mut v = value(&graph());
    v["edges"][0]["source"] = json!("");
    v["edges"][0]["sourcePort"] = json!("");
    v["edges"][0]["sourcePosition"] = json!({"x":-50,"y":100});
    let g: PatchGraph = serde_json::from_value(v.clone()).unwrap();
    validate(&g).unwrap();
    let fp = fingerprint(&g, &value(&g.edges[0]), false);
    v["edges"][0]["sourcePosition"]["x"] = json!(2);
    let g: PatchGraph = serde_json::from_value(v.clone()).unwrap();
    assert_eq!(fp, fingerprint(&g, &value(&g.edges[0]), false));
    v["edges"][0]["execution"] = json!({"dispatch":"async","join":"all","after":["e"],"maxConcurrency":2,"timeoutMs":1000,"bufferSize":5,"overflow":"block","onError":"stop"});
    assert!(validate(&serde_json::from_value(v).unwrap()).is_err());
}
#[test]
fn bad_report_and_invalid_proposal() {
    let (_d, mut s) = fixture();
    let root = s.root.clone().unwrap();
    fs::write(root.join("reports/e.json"), "{").unwrap();
    assert_eq!(s.poll().unwrap()["reports"]["e"]["status"], "blocked");
    fs::write(root.join("graph.json"), "invalid").unwrap();
    let pending = s.poll().unwrap();
    assert!(pending.get("error").is_some());
    let mut reopened = Store::default();
    assert!(reopened.open(&root).unwrap()["pendingExternal"]
        .get("error")
        .is_some());
    s.reject(pending["diskRevision"].as_str().unwrap()).unwrap();
}
#[test]
fn scoped_prompts_and_path_guard() {
    let (_d, s) = fixture();
    assert!(s.prompt(Some("e"), Some("a"), "en").is_err());
    assert!(s.prompt(Some("missing"), None, "ja").is_err());
    let p = s.prompt(None, Some("a"), "en").unwrap();
    assert!(p.contains("context only"));
    assert!(p
        .replace('\\', "/")
        .contains("components/nodes/a/report.json"));
    assert!(safe(s.root.as_ref().unwrap(), "../outside").is_err());
    assert!(safe(s.root.as_ref().unwrap(), "/outside").is_err());
}
#[cfg(unix)]
#[test]
fn symlink_output_cannot_escape() {
    use std::os::unix::fs::symlink;
    let (d, mut s) = fixture();
    let outside = d.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let root = s.root.clone().unwrap();
    fs::remove_dir_all(root.join("connections")).unwrap();
    symlink(&outside, root.join("connections")).unwrap();
    let original = fs::read(root.join("graph.json")).unwrap();
    let mut g = s.graph.clone().unwrap();
    g.description = "must not save".into();
    assert!(s.save(g, &s.revision.clone(), &[], true).is_err());
    assert_eq!(original, fs::read(root.join("graph.json")).unwrap());
    assert!(fs::read_dir(outside).unwrap().next().is_none());
}
#[test]
fn failed_open_keeps_current_project() {
    let (d, mut s) = fixture();
    let root = s.root.clone();
    fs::create_dir(d.path().join("bad")).unwrap();
    fs::write(d.path().join("bad/graph.json"), "bad").unwrap();
    assert!(s.open(&d.path().join("bad")).is_err());
    assert_eq!(s.root, root);
}
#[test]
fn node_implementation_protection_and_report() {
    let (_d, mut s) = fixture();
    let mut g = s.graph.clone().unwrap();
    g.nodes[0].policy = Some("immutable".into());
    s.save(g, &s.revision.clone(), &[], true).unwrap();
    let root = s.root.clone().unwrap();
    let dir = root.join("components/nodes/a/implementation");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("agent.py"), "changed").unwrap();
    let fp = s.snapshot().unwrap()["nodeFingerprints"]["a"].clone();
    fs::write(
        root.join("components/nodes/a/report.json"),
        json!({"fingerprint":fp,"status":"verified"}).to_string(),
    )
    .unwrap();
    assert_eq!(s.poll().unwrap()["nodeReports"]["a"]["status"], "blocked");
}

#[test]
fn brief_preserves_node_template_context_and_invalid_report_status() {
    let (_d, mut s) = fixture();
    let mut g = s.graph.clone().unwrap();
    let instructions = "Retain these roles in every variant";
    g.templates = Some(vec![crate::model::GraphTemplate {
        id: "prototype".into(),
        version: 1,
        name: "Original".into(),
        instructions: instructions.into(),
        nodes: g.nodes.clone(),
        edges: g.edges.clone(),
    }]);
    g.nodes[0].derived_from = Some(crate::model::TemplateOrigin {
        template_id: "prototype".into(),
        version: 1,
        member_id: "a".into(),
    });
    g.nodes[0].design_instructions = Some("Specialize the observation format".into());
    g.nodes[0].command = "python input.py".into();
    s.save(g, &s.revision.clone(), &[], true).unwrap();
    let root = s.root.as_ref().unwrap();
    let brief = fs::read_to_string(root.join("AGENT_BRIEF.md")).unwrap();
    for text in [
        instructions,
        "Specialize the observation format",
        "python input.py",
        "Inputs: in",
        "Outputs: out",
    ] {
        assert!(brief.contains(text), "{text}");
    }
    fs::write(
        root.join("reports/e.json"),
        json!({"status":"verified","summary":"Cannot read report JSON"}).to_string(),
    )
    .unwrap();
    assert_eq!(s.snapshot().unwrap()["reports"]["e"]["status"], "stale");
}

#[test]
fn inspection_distinguishes_files_from_directories_and_repositories() {
    use crate::store::inspect;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("README.md"), "Parent project description").unwrap();
    let file = root.join("video.MOV");
    fs::write(&file, b"fixture").unwrap();
    assert_eq!(
        inspect(root.to_str().unwrap()).unwrap()["kind"],
        "directory"
    );
    fs::create_dir(root.join(".git")).unwrap();
    assert_eq!(
        inspect(root.to_str().unwrap()).unwrap()["kind"],
        "repository"
    );
    let result = inspect(file.to_str().unwrap()).unwrap();
    assert_eq!(result["kind"], "file");
    assert_eq!(result["description"], "");
    assert_eq!(result["files"], json!([]));
    assert!(inspect(root.join("missing").to_str().unwrap()).is_err());
    let (_d, mut store) = fixture();
    let mut g = graph();
    g.nodes[0].kind = "file".into();
    let revision = store.snapshot().unwrap()["revision"]
        .as_str()
        .unwrap()
        .to_owned();
    store.save(g, &revision, &[], true).unwrap();
    assert_eq!(
        store.snapshot().unwrap()["project"]["nodes"][0]["kind"],
        "file"
    );
}

#[cfg(unix)]
#[test]
fn history_internal_symlinks_are_rejected_before_writing() {
    use std::os::unix::fs::symlink;
    let (d, mut s) = fixture();
    let root = s.root.clone().unwrap();
    let objects = root.join(".gacchanko/history.git/objects");
    let outside = d.path().join("outside-objects");
    fs::rename(&objects, &outside).unwrap();
    symlink(&outside, &objects).unwrap();
    fs::write(root.join("implementations/new.py"), "new content").unwrap();
    assert!(s.poll().is_err(), "must not write objects through a link");
    assert!(Store::default().open(&root).is_err());
}

#[test]
fn history_redirects_are_rejected() {
    for relative in [
        "commondir",
        "objects/info/alternates",
        "objects/info/http-alternates",
    ] {
        let (_d, s) = fixture();
        let root = s.root.as_ref().unwrap();
        let path = root.join(".gacchanko/history.git").join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, "../../outside\n").unwrap();
        assert!(Store::default().open(root).is_err(), "{relative}");
    }
}

#[test]
fn checkpoint_total_size_and_depth_are_bounded() {
    let (_d, mut s) = fixture();
    let root = s.root.clone().unwrap();
    let original = fs::read(root.join("graph.json")).unwrap();
    let dir = root.join("implementations");
    // Sparse files exercise the aggregate limit without allocating 100 MB.
    for i in 0..6 {
        fs::File::create(dir.join(format!("large-{i}")))
            .unwrap()
            .set_len(20_000_000)
            .unwrap();
    }
    let mut g = s.graph.clone().unwrap();
    g.description = "must not be written".into();
    assert!(s.save(g, &s.revision.clone(), &[], true).is_err());
    assert_eq!(fs::read(root.join("graph.json")).unwrap(), original);
    fs::remove_dir_all(&dir).unwrap();
    let mut nested = dir;
    for _ in 0..34 {
        nested.push("child");
    }
    fs::create_dir_all(nested).unwrap();
    assert!(s.poll().is_err());
}

#[cfg(unix)]
#[test]
fn special_files_and_readme_links_do_not_block_or_leak() {
    use std::{ffi::CString, os::unix::fs::symlink};
    let d = tempfile::tempdir().unwrap();
    let fifo = d.path().join("README.md");
    let name = CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    assert!(read_limited(&fifo, 100).is_err());
    assert_eq!(
        crate::store::inspect(d.path().to_str().unwrap()).unwrap()["description"],
        ""
    );
    fs::remove_file(&fifo).unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    fs::write(outside.path(), "private content").unwrap();
    symlink(outside.path(), &fifo).unwrap();
    assert!(read_limited(&fifo, 100).is_err());
    assert_eq!(
        crate::store::inspect(d.path().to_str().unwrap()).unwrap()["description"],
        ""
    );
    fs::remove_file(&fifo).unwrap();
    fs::write(&fifo, "a".repeat(5000)).unwrap();
    assert_eq!(
        crate::store::inspect(d.path().to_str().unwrap()).unwrap()["description"]
            .as_str()
            .unwrap()
            .len(),
        3000
    );
}

#[cfg(unix)]
#[test]
fn linked_history_config_and_replaced_project_root_are_rejected() {
    use std::os::unix::fs::symlink;
    let (d, mut s) = fixture();
    let root = s.root.clone().unwrap();
    let config = root.join(".gacchanko/history.git/config");
    let outside = d.path().join("config");
    fs::rename(&config, &outside).unwrap();
    symlink(&outside, &config).unwrap();
    assert!(s.poll().is_err());
    fs::remove_file(&config).unwrap();
    fs::rename(&outside, &config).unwrap();
    let moved = d.path().join("moved");
    fs::rename(&root, &moved).unwrap();
    symlink(&moved, &root).unwrap();
    assert!(s.poll().is_err());
}

#[test]
fn ids_cannot_alias_output_paths() {
    for id in ["CON", "nul", "COM1", "LPT9"] {
        assert!(!valid_id(id), "reserved ID: {id}");
    }
    let mut g = graph();
    g.nodes[1].id = "A".into();
    g.edges[0].target = "A".into();
    assert!(
        validate(&g).is_err(),
        "case-insensitive directory collision"
    );
    let mut g = graph();
    g.edges[0].id = "Shared".into();
    assert!(validate(&g).is_err(), "reserved shared code directory");
}

#[test]
fn specification_expansion_is_rejected_before_replacing_graph() {
    let (_d, mut s) = fixture();
    let root = s.root.clone().unwrap();
    let before = fs::read(root.join("graph.json")).unwrap();
    let mut g = graph();
    g.nodes[0].description = "x".repeat(1_000_000);
    let edge = g.edges[0].clone();
    g.edges = (0..40)
        .map(|i| {
            let mut e = edge.clone();
            e.id = format!("e{i}");
            e
        })
        .collect();
    assert!(s
        .save(g, &s.revision.clone(), &[], false)
        .unwrap_err()
        .to_string()
        .contains("size budget"));
    assert_eq!(fs::read(root.join("graph.json")).unwrap(), before);
    assert!(!root.join("connections/e1").exists());
}
