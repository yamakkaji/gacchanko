// Regression for navigation cost and the compact component inspector.
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const base=path.resolve(__dirname,'..'),baseline=process.argv.find(arg=>arg.startsWith('--baseline='))?.slice(11);
const read=name=>baseline?execFileSync('git',['show',baseline+':web/'+name],{cwd:base,encoding:'utf8'}):fs.readFileSync(path.join(base,'web',name),'utf8');
const dom=new JSDOM(read('index.html'),{url:'https://gacchanko.local/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
w.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:1000,height:800,right:1000,bottom:800});
let stored=null;
w.gacchankoPlatform={kind:'test',async request(command,args){
 if(command==='state')return {project:null};if(command==='dirty')return true;
 if(command==='save'){stored=JSON.parse(JSON.stringify(args.graph));return {project:stored,root:'/tmp/viewport.gacchanko',revision:'next',reports:{}};}
 if(command==='unlock')return null; // A cancelled native unlock must retain protection.
 throw Error(command);
},on(){return ()=>{};}};
for(const name of ['bridge.js','appearance.js','node-appearance.js','workflow.js','design.js','app.js'])w.eval(read(name));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const frame=()=>new Promise(r=>w.requestAnimationFrame(r));
(async()=>{try{
 await w.gacchankoReady;
 const api=w.gacchanko,$=s=>w.document.querySelector(s);
 const nodes=Array.from({length:24},(_,i)=>api.makeNode({id:'n'+i,name:'Component '+i,description:'Keep description',command:'keep-command',designInstructions:'Keep instructions',implementationState:i===0?'verified':'existing',path:'/component/'+i},{x:(i%6)*320,y:Math.floor(i/6)*240}));
 const edges=Array.from({length:48},(_,i)=>({id:'e'+i,source:'n'+(i%24),target:'n'+((i+1+Math.floor(i/24))%24),sourcePort:'out',targetPort:'in',label:'Connection '+i,intent:'Pass data',mode:i%5===0?'request':'data'}));
 api.cleanState({project:{schemaVersion:1,name:'Viewport test',description:'Connect components',nodes,edges},root:'/tmp/viewport.gacchanko',revision:'initial',reports:{}});
 api.select('edge','e0');await delay(180);
 let rebuilds=0;
 const observer=new w.MutationObserver(records=>{rebuilds+=records.filter(r=>r.target.id==='edge-paths').length;});
 observer.observe($('#edge-paths'),{childList:true});
 const first=$('.edge-group'),canvas=$('#canvas'),before=JSON.stringify(api.graph);
 const start=performance.now();
 for(let i=0;i<12;i++)canvas.dispatchEvent(new w.WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:i%2?3:-4,clientX:410,clientY:310}));
 const eventMs=performance.now()-start;
 await frame();await frame();
 if(!baseline){assert.equal($('.edge-group'),first,'zoom keeps SVG paths and listeners alive');assert.equal(rebuilds,0);}
 await delay(180);
 if(!baseline){assert.equal(rebuilds,1,'zoom decorations refresh once after gesture');assert.equal(JSON.stringify(api.graph),before,'navigation does not edit graph');}
 const settled=$('.edge-group'),count=rebuilds;
 for(let i=0;i<12;i++)canvas.dispatchEvent(new w.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:4,deltaY:2}));
 await frame();await delay(180);
 if(!baseline){assert.equal($('.edge-group'),settled,'pan preserves edge DOM');assert.equal(rebuilds,count,'pan does not rebuild edges');}
 console.log(JSON.stringify({mode:baseline?'baseline':'updated',nodes:24,edges:48,zoomEvents:12,zoomEventMs:Math.round(eventMs*100)/100,edgeRebuildsForZoomAndPan:rebuilds}));
 observer.disconnect();
 if(baseline)return;
 api.select('node','n0');
 assert.deepEqual([...w.document.querySelectorAll('#inspector .field > span')].map(e=>e.textContent),['Component Name','Mutability','Implementation','Component Type','Access']);
 assert.equal($('#node-implementation').options.length,2);
 assert.equal($('#node-implementation').value,'existing');
 assert.equal(api.graph.nodes[0].implementationState,'verified','viewing retains legacy verification state');
 const access=$('#node-path');access.value='192.168.1.12:8011';access.dispatchEvent(new w.Event('change',{bubbles:true}));
 await api.save(false);
 assert.equal(stored.nodes[0].path,'192.168.1.12:8011');
 for(const key of ['description','command','designInstructions','inputs','outputs'])assert.equal(JSON.stringify(stored.nodes[0][key]),JSON.stringify(nodes[0][key]),'preserve '+key);
 api.undo();assert.equal(api.graph.nodes[0].path,'/component/0');api.redo();assert.equal(api.graph.nodes[0].path,'192.168.1.12:8011');
 api.select('node','n0');$('#design-policy').value='immutable';$('#design-policy').dispatchEvent(new w.Event('change'));
 assert($('#node-name').disabled&&$('#node-path').disabled);
 $('#design-policy').value='mutable';$('#design-policy').dispatchEvent(new w.Event('change'));await delay(20);
 assert.equal(api.graph.nodes[0].policy,'immutable','cancelled native unlock retains policy');assert.equal($('#design-policy').value,'immutable');
 assert(!w.gacchankoWorkflow.check(api.graph).some(i=>['node-description','node-implementation'].includes(i.field)));
 console.log('PASS zoom/pan DOM stability, compact fields, IP access, metadata preservation, undo/redo and cancelled unlock');
 }finally{w.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
