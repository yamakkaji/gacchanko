const {JSDOM}=require('jsdom'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..'),read=n=>fs.readFileSync(path.join(base,'web',n),'utf8');
function launch(language,nativeLanguage){
 const dom=new JSDOM(read('index.html'),{url:'https://gacchanko.local/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,right:1000,bottom:800,width:1000,height:800});
 if(language)w.localStorage.setItem('gacchanko-language',language);if(nativeLanguage)w.gacchankoLanguage=nativeLanguage;
 const calls=[];
 w.gacchankoPlatform={kind:'test',async request(cmd,args){calls.push([cmd,args]);if(cmd==='state')return {project:null};if(cmd==='dirty'||cmd==='setLanguage')return true;throw Error(cmd);},on(){return ()=>{};}};
 for(const name of ['i18n.js','bridge.js','appearance.js','node-appearance.js','workflow.js','design.js','app.js','tutorial.js'])w.eval(read(name));
 return {w,calls};
}
const tick=()=>new Promise(r=>setTimeout(r,0));
(async()=>{
 const {w,calls}=launch();
 try{
 await w.gacchankoReady;const api=w.gacchanko,$=s=>w.document.querySelector(s);
 const source=api.makeNode({id:'a',name:'保存',description:'Description 編集 immutable 日本語',path:'/tmp/保存'}, {x:0,y:0});
 const target=api.makeNode({id:'b',name:'Target'},{x:400,y:0});
 api.mutate(()=>{api.graph.nodes.push(source,target);});api.createConnection('a','b','out','in');
 api.graph.edges[0].label='接続';api.graph.edges[0].intent='閉じるから開く';api.select('node','a');
 const graph=JSON.stringify(api.graph),undoDisabled=$('#undo').disabled;
 assert.equal(w.document.documentElement.lang,'ja');assert($('#inspector').textContent.includes('コンポーネント名'));
 $('#appearance-settings').click();assert($('#ui-language'));$('#ui-language').value='en';$('#ui-language').dispatchEvent(new w.Event('change'));await tick();await tick();
 assert.equal(w.document.documentElement.lang,'en');assert.equal(w.localStorage.getItem('gacchanko-language'),'en');assert(calls.some(([cmd,args])=>cmd==='setLanguage'&&args.language==='en'));
 assert.equal($('#modal h2').textContent,'Settings');assert.equal($('#node-description').value,'Description 編集 immutable 日本語');assert.equal($('#node-name').value,'保存');assert.equal($('#node-path').value,'/tmp/保存');
 assert.equal(JSON.stringify(api.graph),graph);assert.equal($('#undo').disabled,undoDisabled);
 assert.equal($('#inspector .field span').textContent,'Component Name');assert.equal($('#node-details').textContent,'Node details…');
 $('#modal').close();$('#node-details').click();assert.equal($('#modal h2').textContent,'Node details');$('#modal').close();
 api.select('edge',api.graph.edges[0].id);assert.equal($('#edge-label').value,'接続');assert.equal($('#edge-intent').value,'閉じるから開く');assert.equal($('#edge-details').textContent,'Connection details…');$('#edge-details').click();assert.equal($('#modal h2').textContent,'Connection details');assert.equal($('#execution-dispatch option').textContent,'Synchronous · Wait for completion');$('#modal').close();
 $('#show-help').click();assert.equal($('#modal h2').textContent,'Help');assert(!/[ぁ-んァ-ヶ一-龯]/.test($('#modal-content').textContent),'English help contains no untranslated Japanese');$('#help-tutorial').click();
 assert($('#modal').classList.contains('tutorial-modal'));assert.equal($('#tutorial-title').textContent,'Getting started with gacchanko');assert($('#tutorial-back').disabled);
 for(let step=1;step<6;step++){$('#tutorial-next').click();assert.equal($('[aria-current="step"]').dataset.tutorialStep,String(step));}
 assert.equal($('#tutorial-next').textContent,'Return to canvas');$('#tutorial-back').click();assert.equal($('[aria-current="step"]').dataset.tutorialStep,'4');
 $('#tutorial-language').value='ja';$('#tutorial-language').dispatchEvent(new w.Event('change'));await tick();await tick();assert.equal($('#tutorial-title').textContent,'gacchanko の使い方');assert.equal($('[aria-current="step"]').dataset.tutorialStep,'4');assert.equal(JSON.stringify(api.graph),graph,'language and tutorial navigation never alter user content');
 $('[data-tutorial-step="5"]').click();$('#tutorial-next').click();assert(!$('#modal').open);assert(!$('#modal').classList.contains('tutorial-modal'));
 api.undo();assert.equal(api.graph.edges.length,0,'undo stack survives both language switches and tutorial navigation');api.redo();assert.equal(api.graph.edges.length,1);
 $('#empty-tutorial').click();assert($('#modal').open);$('#tutorial-close').click();
 await api.changeLanguage('en');const fresh=launch(w.localStorage.getItem('gacchanko-language'));await fresh.w.gacchankoReady;assert.equal(fresh.w.document.documentElement.lang,'en');assert.equal(fresh.w.document.querySelector('[data-action="new-project"]').textContent,'New project');fresh.w.close();
 const nativePreference=launch('ja','en');await nativePreference.w.gacchankoReady;assert.equal(nativePreference.w.document.documentElement.lang,'en');nativePreference.w.close();
 console.log('PASS: live language switch, native preference sync, restart restoration, common fields, English help, tutorial navigation in both languages, user-content and undo preservation');
 }finally{w.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
