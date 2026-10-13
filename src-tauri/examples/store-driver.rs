use gacchanko_core::{graph::*, model::PatchGraph, store::Store};
fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1)
    }
}
fn run() -> gacchanko_core::Result<()> {
    let args: Vec<_> = std::env::args().collect();
    let path = std::path::Path::new(
        args.get(1)
            .ok_or("Usage: store-driver project [snapshot|poll|prompt|fingerprints]")?,
    );
    if args.get(2).map(String::as_str) == Some("fingerprints") {
        let g: PatchGraph = serde_json::from_slice(&std::fs::read(path)?)?;
        validate(&g)?;
        let mut out = serde_json::json!({"fingerprints":{},"nodeFingerprints":{}});
        for e in &g.edges {
            out["fingerprints"][&e.id] = serde_json::json!(fingerprint(&g, &value(e), false));
        }
        for n in &g.nodes {
            out["nodeFingerprints"][&n.id] = serde_json::json!(fingerprint(&g, &value(n), true));
        }
        println!("{out}");
        return Ok(());
    }
    let mut store = Store::default();
    let state = store.open(path)?;
    match args.get(2).map(String::as_str).unwrap_or("snapshot") {
        "prompt" => println!(
            "{}",
            store.prompt(args.get(3).map(String::as_str), None, "ja")?
        ),
        "adopt-edge" => {
            let id = args.get(3).ok_or("Edge ID required")?;
            let revision = hash(&std::fs::read(path.join("graph.json"))?);
            println!("{}", store.adopt(&revision, &[format!("edge:{id}")])?);
        }
        "poll" => println!("{}", store.poll()?),
        "snapshot" => println!("{state}"),
        _ => return Err("Unknown command".into()),
    }
    Ok(())
}
