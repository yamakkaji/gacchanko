const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
const dom=new JSDOM(fs.readFileSync(path.join(base,'web/index.html'),'utf8'),{url:'https://gacchanko.local/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
w.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,right:900,bottom:700,width:900,height:700};};
const n=(id,x)=>({id,name:id,path:'',kind:'note',description:'Role '+id,command:'',inputs:['in'],outputs:['out'],x,y:0,policy:'mutable',designInstructions:''});
let stored={schemaVersion:1,name:'Versioned project',description:'',nodes:[n('source',0),n('target',350)],edges:[{id:'wire',source:'source',target:'target',sourcePort:'out',targetPort:'in',label:'Convert',intent:'Convert the format',mode:'data',policy:'mutable'}]};
let revision=0,pending=null,reloads=0;
const change={kind:'node',id:'source',name:'source',change:'modified',fields:['description'],before:copy(stored.nodes[0]),after:{...stored.nodes[0],description:'Agent design'}};
const history={head:'a'.repeat(40),commits:[{id:'a'.repeat(40),date:'2026-10-07',actor:'external / unknown',message:'Design update'}],changes:[change],files:[]};
const state=()=>({project:copy(stored),root:'/tmp/design-ui.gacchanko',revision:String(revision),reports:{},history:copy(history)});
w.gacchankoPlatform={kind:'test',async request(command,args){
 if(command==='state')return state();if(command==='dirty')return true;
 if(command==='save'){stored=copy(args.graph);revision++;return state();}
 if(command==='adoptExternal'){assert.equal(args.diskRevision,pending.diskRevision);assert.equal(JSON.stringify(args.selections),'["node:source"]');stored.nodes[0].description='Agent design';pending=null;revision++;return state();}
 if(command==='unlock'){stored[args.kind==='node'?'nodes':'edges'].find(v=>v.id===args.id).policy='mutable';revision++;return state();}
 if(command==='poll')return pending||state();
 if(command==='reload'){reloads++;return state();}
 if(command==='historyDetail')return {id:history.head,changes:[change],files:['graph.json'],diff:'+ Agent design'};
 throw Error(command);
},on(){return ()=>{};}};
for(const name of ['bridge.js','appearance.js','node-appearance.js','workflow.js','design.js','app.js'])w.eval(fs.readFileSync(path.join(base,'web',name),'utf8'));
let count=0;
const check=(condition,name)=>{assert(condition,name);count++;console.log('PASS '+name);};
const input=(selector,value)=>{const e=w.document.querySelector(selector);e.value=value;e.dispatchEvent(new w.Event('change',{bubbles:true}));};
const settle=()=>new Promise(r=>setTimeout(r,10));
(async()=>{try{
 await w.gacchankoReady;const api=w.gacchanko,D=w.gacchankoDesign,$=s=>w.document.querySelector(s);
 check($('.node[data-node="source"]').dataset.change==='modified','committed external change is marked on canvas');
 $('#check-design').click();check($('#modal').textContent.includes('構想／既存実装'),'design check identifies unset implementation state');$('#modal').close();
 check($('.node.design-incomplete'),'design check highlights incomplete nodes');
 api.select('node','source');input('#node-implementation','planned');check($('.node[data-node="source"] .node-kind').textContent.includes('構想'),'node shows planned implementation status');
 api.select('edge','wire');input('#edge-layer','event');input('#execution-dispatch','async');input('#execution-maxConcurrency','3');
 check(api.graph.edges[0].execution.maxConcurrency===3&&api.graph.edges[0].layer==='event','edge stores async concurrency and layer');
 input('#edge-layer-filter','data');check(!$('.edge-group')&&!$('.edge-endpoint'),'layer filter hides edges and their reconnection handles');input('#edge-layer-filter','all');
 await api.handoff('wire');check($('#handoff-incomplete'),'handoff presents incomplete-design warning');$('#modal').close();
 const wf=w.gacchankoWorkflow;
 check(wf.check(api.graph).some(i=>i.field==='design-instructions'),'async design asks for cancellation and failure intent');

 api.select('node','source');input('#design-policy','immutable');
 check($('#node-description').disabled&&$('#design-instructions').disabled&&$('#design-policy').disabled,'immutable definition controls are disabled');
 check(!$('#node-colour').disabled,'immutable node appearance remains editable');
 input('#node-colour-hex','#715669');input('#node-radius','24');
 $('#node-radius').dispatchEvent(new w.Event('input',{bubbles:true}));
 check(api.graph.nodes[0].appearance.color==='#715669'&&api.graph.nodes[0].appearance.radius===24,'custom node color and radius update protected node');
 api.undo();check(api.graph.nodes[0].appearance.radius===8,'radius gesture can be undone');
 api.redo();check(api.graph.nodes[0].appearance.radius===24,'radius gesture can be redone');
 api.select('node','source');
 $('[data-select-node="target"]').dispatchEvent(new w.MouseEvent('click',{bubbles:true,shiftKey:true}));
 input('#node-surface','filled');
 check(api.graph.nodes.every(n=>n.appearance.surface==='filled')&&api.graph.nodes[0].appearance.radius===24&&api.graph.nodes[1].appearance.radius===8,'batch style changes preserve individual untouched fields');
 await api.save();check(stored.nodes[0].appearance.color==='#715669','appearance included in saved graph');
 const proto=w.gacchankoDesign.capture(api.graph,['source'],{id:'style-proto',name:'Styled',instructions:''});
 check(w.gacchankoDesign.instantiate(proto,()=> 'styled-variant').nodes[0].appearance.color==='#715669','template variant inherits appearance');
 $('#reset-node-appearance').click();check(api.graph.nodes.every(n=>!n.appearance),'batch reset removes overrides');
 api.select('node','source');
 const look=w.gacchankoNodeAppearance;
 for(const color of [...look.presets.map(p=>p[1]),'#ffffff','#000000','#ffff00']){const t=look.tokens({color});assert(look.contrast(t.accent,t.container)>=4.5&&look.contrast(t.onContainer,t.container)>=4.5);}
 check(true,'preset and extreme colors keep readable tonal text');
 const original=copy(api.graph);
 api.mutate(()=>{api.graph.nodes[0].policy='mutable';api.graph.nodes[0].description='bypass';});
 check(api.graph.nodes[0].policy==='immutable'&&api.graph.nodes[0].description===original.nodes[0].description,'mutation cannot bypass protection by changing incoming policy');
 api.select('edge','wire');check(!$('.edge-endpoint'),'protected node wiring has no reconnection handles');
 const beforeDelete=api.graph.edges.length;$('#delete-selected').click();await settle();
 check(api.graph.edges.length===beforeDelete,'deleting a connection of a protected node is rejected');
 await api.save();api.select('node','source');$('#unlock-design').click();await settle();
 check(api.graph.nodes[0].policy==='mutable'&&!$('#node-description').disabled,'explicit native unlock updates editable controls');
 $('#capture-template').click();input('#template-name','One-stage prototype');input('#template-instructions','Keep the input and output contract');$('#save-template').click();
 check(api.graph.templates.length===1&&api.graph.templates[0].instructions==='Keep the input and output contract','template instructions are stored in graph JSON');
 const t=D.capture(api.graph,['source','target'],{id:'pipeline',name:'Pipeline',instructions:'Reuse the source → target structure'});
 let counter=0;const variant=D.instantiate(t,prefix=>prefix+'_'+(++counter));
 check(variant.nodes.length===2&&variant.edges.length===1&&variant.edges[0].source===variant.nodes[0].id&&variant.edges[0].target===variant.nodes[1].id,'variant duplicates complete internal topology with remapped IDs');
 check(variant.nodes[0].derivedFrom.templateID==='pipeline'&&variant.edges[0].derivedFrom.memberID==='wire'&&variant.nodes[0].policy==='mutable','variant pins prototype version and per-member provenance');
 const flow=copy(api.graph);flow.edges.push({...copy(flow.edges[0]),id:'dependent',execution:{...w.gacchankoWorkflow.execution(),after:['wire']}});
 const asyncTemplate=D.capture(flow,['source','target'],{id:'async-pipeline',name:'Async',instructions:'Wait for predecessor'});
 const asyncVariant=D.instantiate(asyncTemplate,prefix=>prefix+'_'+(++counter));
 check(asyncVariant.edges[1].execution.after[0]===asyncVariant.edges[0].id,'variant remaps completion dependencies to new edge IDs');

 api.mutate(()=>api.graph.templates.push(t));$('#template-library').click();
 check($('[data-instantiate="1"]'),'prototype library lists registered subgraphs');
 $('[data-instantiate="1"]').click();check(api.graph.nodes.length===4&&api.graph.edges.length===2,'library creates an editable subgraph variant');
 const beforeTemplateEdit=api.graph.templates[1].instructions;api.mutate(()=>api.graph.templates[1].instructions='replace original');
 check(api.graph.templates[1].instructions===beforeTemplateEdit,'registered prototype version cannot be overwritten');
 await api.save();$('#show-history').click();await settle();
 check($('.change-columns')&&$('#history-detail').textContent.includes('Agent design'),'history exposes before and after and real file diff');$('#modal').close();
 pending={externalChange:true,diskRevision:'new',violations:['node:source'],changes:[change]};await api.poll();
 check(reloads===0&&!$('#external-banner').hidden&&$('#reload-project').disabled,'protected external edit stays pending and is never automatically reloaded');
 $('#review-external').click();check($('.protection-warning')&&$('.change-columns'),'pending protection violation is inspectable');$('#modal').close();
 pending=null;await api.poll();check($('#external-banner').hidden,'externally reverted graph clears stale conflict banner');
 pending={externalChange:true,diskRevision:'next',violations:[],changes:[change]};$('#canvas').focus();await api.poll();
 check(reloads===0&&!$('#external-banner').hidden,'valid external proposal waits for explicit adoption');
 $('#review-external').click();$('[data-proposal-key]').checked=true;$('#adopt-proposal').click();await settle();
 check(api.graph.nodes[0].description==='Agent design'&&$('#external-banner').hidden,'selected proposal applied through native bridge');
 const removed=D.changes(copy(stored),{...copy(stored),nodes:stored.nodes.slice(1)});
 check(removed.some(c=>c.kind==='node'&&c.change==='removed'&&c.before),'deleted nodes retain their before state in diff');
 api.cleanState({project:{schemaVersion:1,name:'Layers',description:'Layer regression',nodes:[n('a',0),n('b',350)],edges:[]},root:'',revision:'',reports:{}});
 for(const layer of ['control','event','data']){
   input('#edge-layer-filter',layer);api.createConnection('a','b','out','in');
   check(api.graph.edges.at(-1).layer===layer&&$('.edge-group')&&$('#edge-layer').value===layer,'new '+layer+' edge belongs to active layer and remains visible');
   const before=api.graph.edges.length;api.createConnection('a','b','out','in');
   check(api.graph.edges.length===before,'duplicate in '+layer+' layer rejected');
 }
 check(api.graph.edges.length===3,'same ports support independent edges on different layers');
 input('#edge-layer-filter','all');api.createConnection('b','a','out','in');
 check(api.graph.edges.at(-1).layer==='data','all-layer view defaults new edges to data');
 input('#edge-layer-filter','control');api.createConnection('a','a','out','in');
 const loop=api.graph.edges.at(-1),group=$(`.edge-group[data-edge="${loop.id}"]`);
 check(group&&group.querySelector('.edge-hit').getAttribute('d')===group.querySelector('.edge-line').getAttribute('d'),'self-loop hit area follows visible loop');
 check(Number(group.querySelector('.edge-label-bg').getAttribute('y'))>api.graph.nodes[0].y+140,'self-loop label is below the node');
 check(w.document.querySelectorAll('.edge-endpoint').length===2,'selected self-loop retains both reconnection handles');
 input('#edge-layer-filter','event');api.createConnection('a','a','out','in');
 const secondLoop=api.graph.edges.at(-1);
 input('#edge-layer-filter','all');
 check($(`.edge-group[data-edge="${loop.id}"] .edge-line`).getAttribute('d')!==$(`.edge-group[data-edge="${secondLoop.id}"] .edge-line`).getAttribute('d'),'multiple self-loops use separate lanes');
 api.undo();api.redo();api.fit();check($('.edge-group[data-edge="'+secondLoop.id+'"]'),'self-loop survives undo, redo and fit');
 console.log(count+' design/UI checks passed');
 }finally{dom.window.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
