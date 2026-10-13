// Run after building .build/store-driver (Swift) and the Rust store-driver.
// Each host gets a separate temporary project: never rewrites shipped examples.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'gacchanko-compat-'));
const swift=path.join(repo,'.build/store-driver'),rust=path.join(repo,'src-tauri/target/debug/examples/store-driver');
try {
 for(const name of ['Multimodal-agent','Template-variants']) {
  const graph=JSON.parse(fs.readFileSync(path.join(repo,`examples/${name}.gacchanko/graph.json`)));
  graph.description+='\n日本語 / "quoted" \\ escaped 🎨 café é\u2028';
  const folder=path.join(dir,name);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'graph.json'),JSON.stringify(graph));
  const a=JSON.parse(cp.execFileSync(swift,[folder,'snapshot'],{encoding:'utf8'}));
  const b=JSON.parse(cp.execFileSync(rust,[path.join(folder,'graph.json'),'fingerprints'],{encoding:'utf8'}));
  assert.deepEqual(b.fingerprints,a.fingerprints);assert.deepEqual(b.nodeFingerprints,a.nodeFingerprints);
  // Open the Swift-created project, including its bare Git history, in Rust.
  const opened=JSON.parse(cp.execFileSync(rust,[folder,'snapshot'],{encoding:'utf8'}));
  assert(!opened.pendingExternal);assert.deepEqual(opened.fingerprints,a.fingerprints);
  // And reopen the Rust-updated history in Swift.
  const back=JSON.parse(cp.execFileSync(swift,[folder,'snapshot'],{encoding:'utf8'}));
  assert(!back.pendingExternal);assert.deepEqual(back.fingerprints,a.fingerprints);
  console.log(`PASS Swift ↔ Rust graph, fingerprints, and Git history: ${name}`);
 }
} finally {fs.rmSync(dir,{recursive:true,force:true});}
