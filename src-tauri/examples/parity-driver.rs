use gacchanko_core::{
    graph::{bytes, fingerprint, hash, value},
    history::{atomic, safe},
    store::Store,
    Result,
};
use serde_json::{json, Value};
use std::{fs, path::Path};
fn step(s: &mut Store, root: &Path, op: &Value) -> Result<Value> {
    let text = |key: &str| op[key].as_str().unwrap_or("");
    match text("op") {
        "create" => s.create(root, serde_json::from_value(op["graph"].clone())?),
        "save" => {
            let rev = if op["stale"] == true {
                "stale".into()
            } else {
                s.revision.clone()
            };
            s.save(
                serde_json::from_value(op["graph"].clone())?,
                &rev,
                &[],
                true,
            )
        }
        "reopen" => {
            *s = Store::default();
            s.open(root)
        }
        "poll" => s.poll(),
        "external" => {
            atomic(&safe(root, "graph.json")?, text("raw").as_bytes())?;
            Ok(json!({}))
        }
        "write" => {
            atomic(&safe(root, text("path"))?, text("text").as_bytes())?;
            Ok(json!({}))
        }
        "report" => {
            let id = text("id");
            let node = op["node"] == true;
            let g = s.graph.as_ref().unwrap();
            let m = if node {
                value(g.nodes.iter().find(|n| n.id == id).unwrap())
            } else {
                value(g.edges.iter().find(|e| e.id == id).unwrap())
            };
            let fp = fingerprint(g, &m, node);
            let path = if node {
                format!("components/nodes/{id}/report.json")
            } else {
                format!("reports/{id}.json")
            };
            atomic(
                &safe(root, &path)?,
                &bytes(&json!({"fingerprint":fp,"status":"verified","summary":"Test fixture"}))?,
            )?;
            Ok(json!({}))
        }
        "adopt" | "reject" => {
            let rev = if op["stale"] == true {
                "stale".into()
            } else {
                hash(&fs::read(root.join("graph.json"))?)
            };
            if text("op") == "reject" {
                s.reject(&rev)
            } else {
                s.adopt(
                    &rev,
                    &serde_json::from_value::<Vec<String>>(op["selections"].clone())?,
                )
            }
        }
        "unlock" => s.unlock(text("kind"), text("id"), &s.revision.clone()),
        "read" => Ok(json!({"text":fs::read_to_string(safe(root,text("path"))?)?})),
        _ => Err("Unknown scenario operation".into()),
    }
}
fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    let ops: Vec<Value> = serde_json::from_slice(&fs::read(&args[1])?)?;
    let mut store = Store::default();
    let results: Vec<_> = ops
        .iter()
        .map(|op| match step(&mut store, Path::new(&args[2]), op) {
            Ok(v) => json!({"ok":true,"value":v}),
            Err(_) => json!({"ok":false}),
        })
        .collect();
    println!("{}", serde_json::to_string(&results)?);
    Ok(())
}
