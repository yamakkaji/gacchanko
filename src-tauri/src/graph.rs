use crate::{model::*, Result};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};

pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn value<T: Serialize>(v: &T) -> Value {
    serde_json::to_value(v).expect("validated serializable graph")
}
// Foundation's compact JSON encodes integral doubles as integers. The keys in
// the schema are ASCII; serde_json's sorted map gives the same key ordering.
pub fn canonical(v: &Value) -> Value {
    match v {
        Value::Number(n) if n.is_f64() => {
            let x = n.as_f64().unwrap();
            if x.fract() == 0.0 && x.abs() < 9_007_199_254_740_992.0 {
                json!(x as i64)
            } else {
                v.clone()
            }
        }
        Value::Array(a) => Value::Array(a.iter().map(canonical).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), canonical(v))).collect())
        }
        _ => v.clone(),
    }
}
pub fn bytes<T: Serialize>(v: &T) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec_pretty(&canonical(&value(v)))?)
}
pub fn definition(v: &Value, node: bool) -> Value {
    let mut v = v.clone();
    if let Some(o) = v.as_object_mut() {
        o.remove("appearance");
        if node {
            o.insert("x".into(), json!(0));
            o.insert("y".into(), json!(0));
        }
    }
    canonical(&v)
}
pub fn fingerprint(g: &PatchGraph, member: &Value, node: bool) -> String {
    let payload = if node {
        json!({"node":definition(member,true),"projectDescription":g.description})
    } else {
        let mut e = definition(member, false);
        e.as_object_mut().unwrap().remove("sourcePosition");
        e.as_object_mut().unwrap().remove("targetPosition");
        let mut nodes: Vec<_> = g
            .nodes
            .iter()
            .filter(|n| member["source"] == n.id || member["target"] == n.id)
            .collect();
        nodes.sort_by(|a, b| a.id.cmp(&b.id));
        json!({"edge":e,"nodes":nodes.iter().map(|n|definition(&value(n),true)).collect::<Vec<_>>(),"projectDescription":g.description})
    };
    hash(&serde_json::to_vec(&canonical(&payload)).unwrap())
}
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}
fn check(ok: bool, msg: &str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(msg.into())
    }
}
fn color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|c| c.is_ascii_hexdigit())
}
fn position(x: f64, y: f64) -> bool {
    x.is_finite() && y.is_finite() && x.abs() < 1e7 && y.abs() < 1e7
}
pub fn protected(policy: &Option<String>) -> bool {
    matches!(policy.as_deref(), Some("immutable" | "template"))
}
pub fn validate(g: &PatchGraph) -> Result<()> {
    check(g.schema_version == 1, "Unsupported schemaVersion")?;
    check(
        g.nodes.len() <= 500 && g.edges.len() <= 2000,
        "Graph exceeds size limit",
    )?;
    for ids in [
        g.nodes.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(),
        g.edges.iter().map(|e| e.id.as_str()).collect(),
    ] {
        check(
            ids.iter().all(|s| valid_id(s))
                && ids.iter().collect::<HashSet<_>>().len() == ids.len(),
            "Invalid or duplicate component ID",
        )?;
    }
    let templates = g.templates.as_deref().unwrap_or(&[]);
    check(templates.len() <= 200, "Too many template versions")?;
    let mut keys = HashSet::new();
    for t in templates {
        check(
            valid_id(&t.id)
                && t.version > 0
                && keys.insert((t.id.clone(), t.version))
                && !t.name.is_empty()
                && !t.nodes.is_empty(),
            "Invalid template",
        )?;
        check(
            t.nodes.iter().all(|n| n.derived_from.is_none())
                && t.edges.iter().all(|e| e.derived_from.is_none()),
            "Templates cannot contain derived references",
        )?;
        validate(&PatchGraph {
            schema_version: 1,
            name: t.name.clone(),
            description: t.instructions.clone(),
            nodes: t.nodes.clone(),
            edges: t.edges.clone(),
            templates: None,
        })?;
    }
    for (is_node, m) in g
        .nodes
        .iter()
        .map(|n| (true, value(n)))
        .chain(g.edges.iter().map(|e| (false, value(e))))
    {
        check(
            ["mutable", "immutable", "template"]
                .contains(&m["policy"].as_str().unwrap_or("mutable")),
            "Invalid policy",
        )?;
        check(
            ["unspecified", "planned", "existing", "verified"]
                .contains(&m["implementationState"].as_str().unwrap_or("unspecified")),
            "Invalid implementation state",
        )?;
        if let Some(o) = m.get("derivedFrom") {
            let t = templates
                .iter()
                .find(|t| o["templateID"] == t.id && o["version"] == t.version)
                .ok_or("Template version not found")?;
            check(
                if is_node {
                    t.nodes.iter().any(|n| o["memberID"] == n.id)
                } else {
                    t.edges.iter().any(|e| o["memberID"] == e.id)
                },
                "Template member not found",
            )?;
        }
    }
    for n in &g.nodes {
        check(
            !n.name.trim().is_empty() && position(n.x, n.y),
            "Invalid node name or position",
        )?;
        for ports in [&n.inputs, &n.outputs] {
            check(
                ports.len() <= 30
                    && ports.iter().collect::<HashSet<_>>().len() == ports.len()
                    && ports
                        .iter()
                        .all(|p| !p.is_empty() && p.chars().count() <= 100),
                "Invalid node ports",
            )?;
        }
        if let Some(a) = &n.appearance {
            check(
                color(&a.color)
                    && (0.0..=28.0).contains(&a.radius)
                    && ["uniform", "alternating"].contains(&a.corners.as_str())
                    && ["filled", "outlined", "elevated"].contains(&a.surface.as_str())
                    && ["striped", "plain"].contains(&a.header.as_str()),
                "Invalid node appearance",
            )?;
        }
    }
    for e in &g.edges {
        check(
            ["data", "request", "event"].contains(&e.mode.as_str())
                && ["data", "control", "event"].contains(&e.layer.as_deref().unwrap_or("data")),
            "Invalid edge type or layer",
        )?;
        if let Some(a) = &e.appearance {
            check(
                [&a.source, &a.target, &a.pattern_colour]
                    .iter()
                    .all(|s| color(s))
                    && ["gradient", "pattern", "both", "solid"].contains(&a.style.as_str())
                    && ["chevrons", "taper"].contains(&a.pattern.as_str())
                    && (1.0..=8.0).contains(&a.width)
                    && (20.0..=120.0).contains(&a.spacing)
                    && (3.0..=12.0).contains(&a.size),
                "Invalid edge appearance",
            )?;
        }
        for (id, port, pos, output) in [
            (&e.source, &e.source_port, &e.source_position, true),
            (&e.target, &e.target_port, &e.target_position, false),
        ] {
            if id.is_empty() {
                check(
                    port.is_empty() && pos.as_ref().is_some_and(|p| position(p.x, p.y)),
                    "Invalid disconnected endpoint",
                )?;
            } else {
                let n = g
                    .nodes
                    .iter()
                    .find(|n| n.id == *id)
                    .ok_or("Endpoint node not found")?;
                check(
                    pos.is_none() && (if output { &n.outputs } else { &n.inputs }).contains(port),
                    "Endpoint port not found",
                )?;
            }
        }
        if let Some(x) = &e.execution {
            check(
                ["sync", "async"].contains(&x.dispatch.as_str())
                    && ["all", "any"].contains(&x.join.as_str())
                    && (1..=64).contains(&x.max_concurrency)
                    && (x.dispatch != "sync" || x.max_concurrency == 1)
                    && (1..=3_600_000).contains(&x.timeout_ms)
                    && (1..=10_000).contains(&x.buffer_size)
                    && ["block", "dropOldest", "dropNewest"].contains(&x.overflow.as_str())
                    && ["stop", "continue"].contains(&x.on_error.as_str())
                    && x.after.iter().collect::<HashSet<_>>().len() == x.after.len()
                    && x.after
                        .iter()
                        .all(|id| *id != e.id && g.edges.iter().any(|d| d.id == *id)),
                "Invalid execution contract",
            )?;
        }
    }
    fn visit(
        id: &str,
        g: &PatchGraph,
        active: &mut HashSet<String>,
        done: &mut HashSet<String>,
    ) -> Result<()> {
        if done.contains(id) {
            return Ok(());
        }
        check(active.insert(id.into()), "Cyclic completion dependencies")?;
        if let Some(x) = g
            .edges
            .iter()
            .find(|e| e.id == id)
            .and_then(|e| e.execution.as_ref())
        {
            for d in &x.after {
                visit(d, g, active, done)?;
            }
        }
        active.remove(id);
        done.insert(id.into());
        Ok(())
    }
    let (mut active, mut done) = (HashSet::new(), HashSet::new());
    for e in &g.edges {
        visit(&e.id, g, &mut active, &mut done)?;
    }
    Ok(())
}
pub fn violations(old: &PatchGraph, next: &PatchGraph, unlocked: &[String]) -> Vec<String> {
    let mut out = vec![];
    for n in old
        .nodes
        .iter()
        .filter(|n| protected(&n.policy) && !unlocked.contains(&format!("node:{}", n.id)))
    {
        if next
            .nodes
            .iter()
            .find(|v| v.id == n.id)
            .map(|v| definition(&value(v), true))
            != Some(definition(&value(n), true))
        {
            out.push(format!("node:{}", n.id));
        }
        for e in old
            .edges
            .iter()
            .filter(|e| e.source == n.id || e.target == n.id)
        {
            if !next.edges.iter().any(|v| {
                v.id == e.id
                    && v.source == e.source
                    && v.target == e.target
                    && v.source_port == e.source_port
                    && v.target_port == e.target_port
            }) {
                out.push(format!("wiring:{}/{}", n.id, e.id));
            }
        }
    }
    for e in old
        .edges
        .iter()
        .filter(|e| protected(&e.policy) && !unlocked.contains(&format!("edge:{}", e.id)))
    {
        if next
            .edges
            .iter()
            .find(|v| v.id == e.id)
            .map(|v| definition(&value(v), false))
            != Some(definition(&value(e), false))
        {
            out.push(format!("edge:{}", e.id));
        }
    }
    for t in old.templates.as_deref().unwrap_or(&[]) {
        if next
            .templates
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .find(|v| v.id == t.id && v.version == t.version)
            .map(value)
            != Some(value(t))
        {
            out.push(format!("template:{}:{}", t.id, t.version));
        }
    }
    out
}
pub fn changes(old: Option<&PatchGraph>, new: &PatchGraph) -> Vec<Value> {
    let a = old.map(value).unwrap_or(json!({}));
    let b = value(new);
    let mut out = vec![];
    for (kind, key) in [
        ("node", "nodes"),
        ("edge", "edges"),
        ("template", "templates"),
    ] {
        let identity = |v: &Value| {
            if kind == "template" {
                format!("{}:{}", v["id"].as_str().unwrap(), v["version"])
            } else {
                v["id"].as_str().unwrap().into()
            }
        };
        let left = a[key].as_array().cloned().unwrap_or_default();
        let right = b[key].as_array().cloned().unwrap_or_default();
        let ids: BTreeSet<_> = left.iter().chain(&right).map(identity).collect();
        for id in ids {
            let l = left.iter().find(|v| identity(v) == id);
            let r = right.iter().find(|v| identity(v) == id);
            if l == r {
                continue;
            }
            let fields: BTreeSet<_> = l
                .into_iter()
                .chain(r)
                .flat_map(|v| v.as_object().unwrap().keys())
                .filter(|k| l.and_then(|v| v.get(*k)) != r.and_then(|v| v.get(*k)))
                .cloned()
                .collect();
            let name = r
                .or(l)
                .and_then(|v| v.get("name").or(v.get("label")))
                .cloned()
                .unwrap_or(json!(id));
            out.push(json!({"kind":kind,"id":id,"name":name,"change":if l.is_none(){"added"}else if r.is_none(){"removed"}else{"modified"},"fields":fields,"before":l,"after":r}));
        }
    }
    if a["name"] != b["name"] || a["description"] != b["description"] {
        out.push(json!({"kind":"project","id":"project","name":new.name,"change":"modified","fields":["name","description"],"before":{"name":a["name"].as_str().unwrap_or(""),"description":a["description"].as_str().unwrap_or("")},"after":{"name":new.name,"description":new.description}}));
    }
    out
}
