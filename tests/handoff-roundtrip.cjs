// Real Swift store + actual Python adapter + the app's report polling/DOM.
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),project=path.resolve(process.argv[2]),driver=path.join(repo,'.build/store-driver');
const state=()=>JSON.parse(cp.execFileSync(driver,[project,'snapshot'],{encoding:'utf8'}));
const initial=state(),edge=initial.project.edges[0],file=path.join(project,'reports',edge.id+'.json');
const report={fingerprint:initial.fingerprints[edge.id],status:'implemented',summary:'観測CLIと行動判断の型をつなぐラッパーを実装。',files:[`implementations/${edge.id}/adapter.py`,`implementations/${edge.id}/test_adapter.py`],checks:[]};
const writeReport=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(report,null,2)+'\n');fs.renameSync(file+'.tmp',file);};
writeReport();
const dom=new JSDOM(fs.readFileSync(path.join(repo,'web/index.html'),'utf8'),{url:'https://gacchanko.local/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,right:900,bottom:700,width:900,height:700};};
w.gacchankoPlatform={kind:'real-store-test',async request(command){if(['state','poll','reload'].includes(command))return state();if(command==='dirty')return true;throw Error('Unexpected command '+command);},on(){return ()=>{};}};
for(const name of ['bridge.js','appearance.js','node-appearance.js','design.js','app.js'])w.eval(fs.readFileSync(path.join(repo,'web',name),'utf8'));
(async()=>{
 try{
  await w.gacchankoReady;
  w.gacchanko.select('edge',edge.id);
  assert(w.document.querySelector('.status-card.implemented'));
  console.log('PASS real implementation report appears in inspector');
  const test=cp.spawnSync('python3',[path.join(project,`implementations/${edge.id}/test_adapter.py`)],{encoding:'utf8'});
  if(test.status!==0)throw Error(test.stderr);
  process.stdout.write(test.stderr);
  report.status='verified';report.summary='実プロセスでの観測→座標変換→行動判断を検証。13テスト成功（タイムアウト・不正出力の2件は故障注入）。';
  report.checks=[`python3 implementations/${edge.id}/test_adapter.py — 13 tests passed; 11 subprocess integration checks and 2 injected failure checks.`];writeReport();
  await w.gacchanko.poll();
  assert.equal(w.gacchanko.status(edge.id),'verified');assert(w.document.querySelector('.status-card.verified'));
  console.log('PASS updated report is polled from disk and displayed as verified');
  assert.equal(w.document.querySelector('#ready-count').textContent,'1 verified');
  const graphFile=path.join(project,'graph.json'),original=fs.readFileSync(graphFile);
  try{
   const changed=JSON.parse(original);changed.edges[0].intent+=' Changed after verification.';fs.writeFileSync(graphFile,JSON.stringify(changed));
   const stale=state();assert.equal(stale.reports[edge.id].status,'stale');w.gacchanko.cleanState(stale);w.gacchanko.select('edge',edge.id);
   assert(w.document.querySelector('.status-card.stale'));
   console.log('PASS changed requirements invalidate the actual fingerprint and display stale');
  }finally{fs.writeFileSync(graphFile,original);}
  fs.writeFileSync(path.join(project,'handoff-checks.json'),JSON.stringify({ok:true,adapterTests:13,reportTransitions:['implemented','verified','stale'],nativeGUI:false},null,2)+'\n');
 }finally{dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
