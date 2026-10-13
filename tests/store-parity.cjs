// Differential tests exercise the actual Swift and Rust stores with identical
// actions, including agent file writes. Only host paths/hashes of formatted
// graph files and nondeterministic commit IDs/dates are excluded.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gacchanko-parity-'));
const clone=v=>JSON.parse(JSON.stringify(v));
const node=id=>({id,name:id,path:'',kind:'directory',description:'context',command:'',inputs:['in'],outputs:['out'],x:0,y:0});
let g={schemaVersion:1,name:'Parity',description:'画像 / voice',nodes:[node('a'),node('b')],edges:[{id:'e',source:'a',target:'b',sourcePort:'out',targetPort:'in',label:'Bridge',intent:'Convert JSON',mode:'request'}]};
const ops=[];function add(name,op){ops.push({name,...clone(op)});}const save=name=>add(name,{op:'save',graph:g});const proposal=name=>add(name,{op:'external',raw:JSON.stringify(g)});
add('create',{op:'create',graph:g});save('unchanged save');
add('edge report',{op:'report',id:'e'});add('node report',{op:'report',id:'a',node:true});add('reports verified',{op:'poll'});
g.nodes[0].x=23;save('layout preserves reports');g.nodes[0].description='Changed input';save('context invalidates reports');
add('stale save rejected',{op:'save',graph:g,stale:true});
add('write code',{op:'write',path:'implementations/e/main.py',text:'original'});add('code checkpoint',{op:'poll'});
g.nodes[0].policy='immutable';g.edges[0].policy='immutable';save('protect definitions');
let locked=clone(g);g.nodes[0].policy='mutable';save('policy bypass rejected');g=clone(locked);
g.nodes[0].appearance={color:'#715669',radius:24,corners:'alternating',surface:'filled',header:'plain'};g.edges[0].appearance={style:'both',source:'#102030',target:'#abcdef',patternColour:'#294f4a',pattern:'chevrons',width:5,spacing:50,size:6,arrows:true};save('protected appearance editable');locked=clone(g);
g.edges=[];save('protected wiring removal rejected');g=clone(locked);
add('modify protected code',{op:'write',path:'implementations/e/main.py',text:'external edit'});add('code change blocked',{op:'poll'});save('save blocked by protected code');add('unlock edge',{op:'unlock',kind:'edge',id:'e'});g.edges[0].policy='mutable';
g.nodes[0].description='unsafe';g.nodes[1].description='safe';proposal('mixed proposal');add('proposal diff',{op:'poll'});add('reopen retains pending',{op:'reopen'});add('unsafe adoption rejected',{op:'adopt',selections:['node:a']});add('safe subset adopted',{op:'adopt',selections:['node:b']});g.nodes[0].description=locked.nodes[0].description;
add('unlock node',{op:'unlock',kind:'node',id:'a'});g.nodes[0].policy='mutable';
g.nodes[1].name='external rename';proposal('new proposal');add('stale adoption rejected',{op:'adopt',selections:['node:b'],stale:true});add('stale rejection rejected',{op:'reject',stale:true});add('reject proposal',{op:'reject'});g.nodes[1].name='b';
add('malformed proposal',{op:'external',raw:'{broken'});add('malformed proposal pending',{op:'poll'});add('malformed restart retains accepted graph',{op:'reopen'});add('reject malformed proposal',{op:'reject'});
g.edges[0].target='';g.edges[0].targetPort='';g.edges[0].targetPosition={x:300,y:150};save('detached edge persists');add('reopen detached edge',{op:'reopen'});add('detaching retains code',{op:'read',path:'implementations/e/main.py'});
g.edges[0].source='';g.edges[0].sourcePort='';g.edges[0].sourcePosition={x:20,y:50};save('both ends detached');g.edges=[];save('delete edge');add('deletion retains code',{op:'read',path:'implementations/e/main.py'});
const template={id:'prototype',version:1,name:'Prototype',instructions:'Keep both component roles and specialize behaviour.',nodes:[node('p')],edges:[]};g.templates=[template];g.nodes[0].derivedFrom={templateID:'prototype',version:1,memberID:'p'};g.nodes[0].designInstructions='Variant';save('template variant');g.templates[0].instructions='rewrite';save('template overwrite rejected');g.templates[0]=template; // restore below (template shares mutable object)
g.templates[0].instructions='Keep both component roles and specialize behaviour.';g.templates.push({...clone(g.templates[0]),version:2});save('append template version');add('template version stays pinned',{op:'reopen'});
function normalized(v){if(Array.isArray(v))return v.map(normalized);if(!v||typeof v!=='object')return v;const out={};for(const [k,x]of Object.entries(v)){if(['root','revision','diskRevision','directory','head','error'].includes(k))continue;if(k==='commits'){out.commitCount=x.length;continue;}out[k]=normalized(x);}return out;}
try {
 const file=path.join(tmp,'scenario.json');fs.writeFileSync(file,JSON.stringify(ops));
 const run=(bin,name)=>JSON.parse(cp.execFileSync(bin,[file,path.join(tmp,name)],{encoding:'utf8',maxBuffer:8e6}));
 const swift=run(path.join(base,'.build/parity-driver'),'swift');const rust=run(path.join(base,'src-tauri/target/debug/examples/parity-driver'),'rust');
 for(let i=0;i<ops.length;i++){const expected=!ops[i].name.includes('rejected')&&ops[i].name!=='save blocked by protected code';assert.equal(swift[i].ok,expected,'Swift baseline: '+ops[i].name);assert.deepEqual(normalized(rust[i]),normalized(swift[i]),ops[i].name);console.log('PASS parity: '+ops[i].name);}
 console.log(`${ops.length} Swift/Rust scenario steps match`);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
