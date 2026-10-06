'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const uid = prefix => prefix + '_' + crypto.randomUUID().slice(0, 8);
const host = window.gacchankoHost;
const native = host.available;
const call = (command, args={}) => host.request(command,args);
const emptyGraph = () => ({schemaVersion:1,name:'Untitled project',description:'',nodes:[],edges:[]});
let graph=emptyGraph(), root='', revision='', reports={}, fingerprints={}, dirty=false, selected=null;
let view={x:65,y:65,zoom:1}, connecting=null, drag=null, undoStack=[], redoStack=[], editSerial=0;
let saveTimer, toastTimer, saveTask=null, external=false, inspectorKey='', draftBackupError=false;
const symbols={repository:'⌘',directory:'▧',model:'✧',service:'⇄',application:'▣',note:'◇'};
const statusNames={pending:'未実装',implemented:'実装済',verified:'検証済',blocked:'確認が必要',stale:'要更新'};
function toast(message,error=false) {
  $('#toast').textContent=message; $('#toast').classList.toggle('error',error); $('#toast').hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,error?7000:3500);
}
function safe(action) { return (...args)=>Promise.resolve().then(()=>action(...args)).catch(e=>toast(e.message,true)); }
function remember() { undoStack.push(clone(graph)); if(undoStack.length>60)undoStack.shift(); redoStack=[]; }
function mutate(action,{inspector=true}={}) { remember(); action(); markDirty(); render(inspector); }
function markDirty() {
  dirty=true; editSerial++; call('dirty',{value:true}).catch(()=>{});
  try { localStorage.setItem('gacchanko-draft',JSON.stringify({graph,root,revision})); } catch { if(!draftBackupError){draftBackupError=true;toast('一時バックアップを保存できません。保存ボタンでプロジェクトを保存してください。',true);} }
  clearTimeout(saveTimer); if(root&&!external)saveTimer=setTimeout(()=>save(false).catch(e=>toast(e.message,true)),850);
  updateHeader();
}
function cleanState(state,{replace=true}={}) {
  if(replace){graph=state.project;selected=null;undoStack=[];redoStack=[];}
  root=state.root;revision=state.revision;reports=state.reports||{};fingerprints=state.fingerprints||{};dirty=false;external=false;
  $('#external-banner').hidden=true; call('dirty',{value:false}).catch(()=>{});
  try {localStorage.removeItem('gacchanko-draft');localStorage.removeItem('patchwork-draft');}catch{}
  render(true);
}
async function save(interactive=true) {
  clearTimeout(saveTimer);
  if(saveTask){await saveTask;if(dirty)return save(interactive);return true;}
  if(!root&&!interactive)return false;
  const serial=editSerial;
  const outgoing=clone(graph);
  const wasNew=!root;
  saveTask=call(wasNew?'newProject':'save',{graph:outgoing,revision});
  try {
    const state=await saveTask;
    if(!state)return false;
    root=state.root;revision=state.revision;reports=state.reports||{};fingerprints=state.fingerprints||{};
    if(serial===editSerial){dirty=false;call('dirty',{value:false}).catch(()=>{});try{localStorage.removeItem('gacchanko-draft');localStorage.removeItem('patchwork-draft');}catch{}}
    else {dirty=true;call('dirty',{value:true}).catch(()=>{});saveTimer=setTimeout(()=>save(false).catch(e=>toast(e.message,true)),100);}
    updateHeader();if(wasNew)renderInspector(true);return true;
  } catch(e){$('#save-state').textContent='保存できません';throw e;}
  finally{saveTask=null;}
}
function updateHeader(){
  $('#project-title').textContent=graph.name;$('#workspace-name').textContent=graph.name;
  $('#workspace-subtitle').textContent=root?root.split('/').pop():'未保存';
  $('#save-state').textContent=dirty?(root?'変更あり':'未保存'):(root?'保存済み':'未保存');
  $('#node-count').textContent=graph.nodes.length;$('#edge-count').textContent=`${graph.edges.length} connections`;
  $('#ready-count').textContent=`${graph.edges.filter(e=>status(e.id)==='verified').length} verified`;
  $('#undo').disabled=!undoStack.length;$('#redo').disabled=!redoStack.length;
}
function status(id){return reports[id]?.status||'pending';}
function nodeHeight(n){return 86+Math.max(n.inputs.length,n.outputs.length,1)*27;}
function portPoint(nodeID,port,direction){const n=graph.nodes.find(n=>n.id===nodeID);if(!n)return {x:0,y:0};const index=Math.max(0,(direction==='out'?n.outputs:n.inputs).indexOf(port));return{x:n.x+(direction==='out'?224:0),y:n.y+85+index*27+13.5};}
function curve(a,b){const bend=Math.max(70,Math.abs(b.x-a.x)*.5);return `M ${a.x} ${a.y} C ${a.x+bend} ${a.y}, ${b.x-bend} ${b.y}, ${b.x} ${b.y}`;}
function renderEdges(){
  $('#edge-paths').innerHTML=graph.edges.map(e=>{
    const a=portPoint(e.source,e.sourcePort,'out'),b=portPoint(e.target,e.targetPort,'in');
    const x=(a.x+b.x)/2,y=(a.y+b.y)/2, label=e.label||'接続', width=Math.min(230,Math.max(85,[...label].length*7+22));
    const colour={verified:'#8bcbb2',implemented:'#b2a0e7',stale:'#d6a567',blocked:'#d49a87'}[status(e.id)]||'#7d789d';
    return `<g class="edge-group ${selected?.type==='edge'&&selected.id===e.id?'selected':''}" data-edge="${esc(e.id)}"><path class="edge-hit" d="${curve(a,b)}"/><path class="edge-line ${e.mode==='request'?'request':''}" style="stroke:${colour}" d="${curve(a,b)}" marker-end="url(#arrow)" ${e.mode==='request'?'marker-start="url(#arrow)"':''}/><rect class="edge-label-bg" x="${x-width/2}" y="${y-13}" width="${width}" height="26" rx="6"/><text class="edge-label" x="${x}" y="${y+3.5}" text-anchor="middle">${esc(label.length>27?label.slice(0,26)+'…':label)}</text></g>`;
  }).join('')+(connecting?`<path class="edge-line" style="stroke:#99e7ca;stroke-dasharray:5 4" d="${curve(portPoint(connecting.node,connecting.port,'out'),connecting.point)}"/>`:'');
  $$('.edge-group').forEach(el=>el.addEventListener('pointerdown',e=>{e.stopPropagation();select('edge',el.dataset.edge);}));
}
function renderNodes(){
  $('#nodes').innerHTML=graph.nodes.map(n=>`<div class="node ${esc(n.kind)} ${selected?.type==='node'&&selected.id===n.id?'selected':''}" style="left:${n.x}px;top:${n.y}px" data-node="${esc(n.id)}"><div class="node-head"><div class="node-symbol">${symbols[n.kind]||'◇'}</div><div class="node-info"><div class="node-kind">${esc(n.kind)}</div><div class="node-name" title="${esc(n.name)}">${esc(n.name)}</div></div><span class="node-menu">···</span></div><div class="node-path ${n.path?'':'unresolved'}" title="${esc(n.path)}">${esc(n.path||'参照先を設定してください')}</div>${Array.from({length:Math.max(n.inputs.length,n.outputs.length,1)},(_,i)=>`<div class="port-row">${n.inputs[i]?`<div class="port-side"><button aria-label="${esc(n.name)} input ${esc(n.inputs[i])}" class="port in" data-direction="in" data-port="${esc(n.inputs[i])}"></button><span>${esc(n.inputs[i])}</span></div>`:''}${n.outputs[i]?`<div class="port-side out"><span>${esc(n.outputs[i])}</span><button aria-label="${esc(n.name)} output ${esc(n.outputs[i])}" class="port out" data-direction="out" data-port="${esc(n.outputs[i])}"></button></div>`:''}</div>`).join('')}</div>`).join('');
  $$('.node').forEach(el=>{
    el.addEventListener('pointerdown',e=>{
      if(e.target.closest('.port'))return;e.stopPropagation();if(e.button!==0)return;
      const id=el.dataset.node;select('node',id,false);const node=graph.nodes.find(n=>n.id===id);
      drag={type:'node',id,startX:e.clientX,startY:e.clientY,x:node.x,y:node.y,remembered:false};
    });
    $$('.port',el).forEach(port=>port.addEventListener('pointerdown',e=>{
      e.preventDefault();e.stopPropagation();
      if(port.dataset.direction==='out'){
        connecting={node:el.dataset.node,port:port.dataset.port,point:portPoint(el.dataset.node,port.dataset.port,'out')};$('#connect-hint').hidden=false;renderEdges();
      }else if(connecting){createConnection(connecting.node,el.dataset.node,connecting.port,port.dataset.port);}
    }));
    $$('.port.in',el).forEach(port=>port.addEventListener('pointerup',e=>{
      if(connecting){e.stopPropagation();createConnection(connecting.node,el.dataset.node,connecting.port,port.dataset.port);}
    }));
  });
}
function renderList(){
  $('#node-list').innerHTML=graph.nodes.map(n=>`<button class="node-item ${selected?.type==='node'&&selected.id===n.id?'active':''}" data-select-node="${esc(n.id)}"><span class="node-mini">${symbols[n.kind]||'◇'}</span><span class="item-name">${esc(n.name)}</span><span class="item-state" style="background:${n.path?'#86b39c':'#887656'}"></span></button>`).join('');
  $$('[data-select-node]').forEach(b=>b.onclick=()=>{select('node',b.dataset.selectNode);const n=graph.nodes.find(n=>n.id===b.dataset.selectNode);const r=$('#canvas').getBoundingClientRect();view.x=r.width/2-(n.x+112)*view.zoom;view.y=r.height/2-(n.y+70)*view.zoom;transform();});
}
function render(inspector=true){updateHeader();renderNodes();renderEdges();renderList();$('#empty-state').hidden=!!graph.nodes.length;transform();if(inspector)renderInspector(true);}
function select(type,id,redraw=true){selected={type,id};if(redraw)render(false);else{$$('.node').forEach(e=>e.classList.toggle('selected',e.dataset.node===id));renderList();renderEdges();}renderInspector(true);}
function transform(){ $('#world').style.transform=`translate(${view.x}px,${view.y}px) scale(${view.zoom})`;$('#zoom-label').textContent=Math.round(view.zoom*100)+'%';$('#canvas').style.backgroundSize=`${22*view.zoom}px ${22*view.zoom}px`;$('#canvas').style.backgroundPosition=`${view.x}px ${view.y}px`; }
function canvasPoint(clientX,clientY){const r=$('#canvas').getBoundingClientRect();return{x:(clientX-r.left-view.x)/view.zoom,y:(clientY-r.top-view.y)/view.zoom};}
function fit(){if(!graph.nodes.length){view={x:65,y:65,zoom:1};transform();return;}const r=$('#canvas').getBoundingClientRect();const minX=Math.min(...graph.nodes.map(n=>n.x)),minY=Math.min(...graph.nodes.map(n=>n.y)),maxX=Math.max(...graph.nodes.map(n=>n.x+224)),maxY=Math.max(...graph.nodes.map(n=>n.y+nodeHeight(n)));
  const zoom=Math.min(1.1,Math.max(.25,Math.min((r.width-100)/(maxX-minX),(r.height-130)/(maxY-minY))));view={zoom,x:(r.width-(maxX-minX)*zoom)/2-minX*zoom,y:(r.height-(maxY-minY)*zoom)/2-minY*zoom-12};transform();}
function zoomBy(factor,cx,cy){const r=$('#canvas').getBoundingClientRect();const x=cx??r.left+r.width/2,y=cy??r.top+r.height/2;const p=canvasPoint(x,y);view.zoom=Math.max(.2,Math.min(2.5,view.zoom*factor));view.x=x-r.left-p.x*view.zoom;view.y=y-r.top-p.y*view.zoom;transform();}
function createConnection(source,target,sourcePort,targetPort){
  connecting=null;$('#connect-hint').hidden=true;
  if(graph.edges.some(e=>e.source===source&&e.target===target&&e.sourcePort===sourcePort&&e.targetPort===targetPort)){toast('このポート間の接続はすでにあります。');renderEdges();return;}
  const edge={id:uid('edge'),source,target,sourcePort,targetPort,label:'新しい接続',intent:'',mode:'data'};
  mutate(()=>{graph.edges.push(edge);selected={type:'edge',id:edge.id};});
  setTimeout(()=>$('#edge-intent')?.focus(),30);
}
function invalidateEdges(nodeID,edgeID){for(const e of graph.edges){if((edgeID&&e.id===edgeID)||(nodeID&&(e.source===nodeID||e.target===nodeID))){if(reports[e.id])reports[e.id]={...reports[e.id],status:'stale'};}}}
function makeNode(values={},point){const r=$('#canvas').getBoundingClientRect();const pos=point||canvasPoint(r.left+r.width/2-112,r.top+r.height/2-70);return{id:uid('node'),name:'New component',path:'',kind:'directory',description:'',command:'',inputs:['in'],outputs:['out'],x:pos.x,y:pos.y,...values};}
async function addPaths(paths,position){const values=[];for(const path of paths){try{values.push(await call('inspect',{path}));}catch(e){toast(e.message,true);}}
  if(!values.length)return;
  mutate(()=>{for(const [i,value]of values.entries()){const {files,...fields}=value;const p=position?{x:position.x+i*32,y:position.y+i*40}:undefined;const n=makeNode(fields,p);graph.nodes.push(n);selected={type:'node',id:n.id};}});
  $('#status-text').textContent=`${values.length} 個のコンポーネントを追加`;
}
async function chooseNodes(){const paths=await call('chooseNodes');if(paths.length)await addPaths(paths);}
function field(label,id,value,{textarea=false,hint='',cls=''}={}){return `<label class="field"><span>${label}</span>${textarea?`<textarea id="${id}" class="${cls}">${esc(value)}</textarea>`:`<input id="${id}" value="${esc(value)}">`}${hint?`<small>${hint}</small>`:''}</label>`;}
function bindText(id, read, apply, required=false){
  const element=$('#'+id);let checkpoint=false;
  element.onfocus=()=>{checkpoint=false;};
  const edit=()=>{const value=element.value;if(required&&!value.trim())return;if(value===read())return;
    if(!checkpoint){remember();checkpoint=true;}apply(value);markDirty();render(false);
  };
  element.oninput=edit;element.onchange=edit;
  element.addEventListener('blur',()=>{if(required&&!element.value.trim())element.value=read();});
}
function renderInspector(force=false){
  const key=selected?selected.type+selected.id:'project';if(!force&&inspectorKey===key)return;inspectorKey=key;
  const panel=$('#inspector');
  if(selected?.type==='node'){
    const n=graph.nodes.find(n=>n.id===selected.id);if(!n){selected=null;return renderInspector(true);}
    panel.innerHTML=`<div class="inspector-heading"><span class="eyebrow">COMPONENT</span><span class="badge">${esc(n.id)}</span></div><h2>${esc(n.name)}</h2>${field('名前','node-name',n.name)}<label class="field"><span>種類</span><select id="node-kind">${Object.keys(symbols).map(k=>`<option ${k===n.kind?'selected':''}>${k}</option>`).join('')}</select></label>${field('ディレクトリ / リポジトリ URL','node-path',n.path,{})}<button class="wide-button" id="set-node-path">参照先を選び直す…</button>${field('役割・補足','node-description',n.description,{textarea:true})}${field('起動・呼び出し方法（参考）','node-command',n.command,{})}<div class="field-row">${field('入力ポート','node-inputs',n.inputs.join(', '),{hint:'カンマ区切り'})}${field('出力ポート','node-outputs',n.outputs.join(', '),{hint:'カンマ区切り'})}</div><hr><button class="wide-button danger" id="delete-selected">コンポーネントを削除</button>`;
    for(const prop of ['name','path','description','command'])bindText('node-'+prop,()=>n[prop],value=>{n[prop]=value;invalidateEdges(n.id);},prop==='name');
    $('#node-kind').onchange=e=>mutate(()=>{n.kind=e.target.value;invalidateEdges(n.id);});
    for(const prop of ['inputs','outputs'])$('#node-'+prop).onchange=e=>{
      const ports=[...new Set(e.target.value.split(',').map(s=>s.trim()).filter(Boolean))];
      if(ports.length>30||ports.some(p=>p.length>100)){toast('ポートは30個まで、名前は100文字以内にしてください。',true);renderInspector(true);return;}
      const affected=graph.edges.some(edge=>prop==='inputs'?edge.target===n.id&&!ports.includes(edge.targetPort):edge.source===n.id&&!ports.includes(edge.sourcePort));
      if(affected){toast('接続中のポートは削除・改名できません。先にエッジを削除してください。',true);renderInspector(true);return;}
      mutate(()=>{n[prop]=ports;invalidateEdges(n.id);});
    };
    $('#set-node-path').onclick=safe(async()=>{const paths=await call('chooseNodes');if(paths.length){const value=await call('inspect',{path:paths[0]});mutate(()=>{n.path=value.path;if(!n.description)n.description=value.description;invalidateEdges(n.id);});}});
  }else if(selected?.type==='edge'){
    const e=graph.edges.find(e=>e.id===selected.id);if(!e){selected=null;return renderInspector(true);}const a=graph.nodes.find(n=>n.id===e.source),b=graph.nodes.find(n=>n.id===e.target);const report=reports[e.id];
    panel.innerHTML=`<div class="inspector-heading"><span class="eyebrow">CONNECTION</span><span class="badge">${statusNames[status(e.id)]}</span></div><div class="connection-endpoint"><span>${esc(a.name)}</span><small>${esc(e.sourcePort)}</small></div><div class="endpoint-arrow">${e.mode==='request'?'↕ REQUEST / RESPONSE':'↓'}</div><div class="connection-endpoint"><span>${esc(b.name)}</span><small>${esc(e.targetPort)}</small></div>${field('接続の名前','edge-label',e.label)}<label class="field"><span>接続の形式</span><select id="edge-mode"><option value="data" ${e.mode==='data'?'selected':''}>→ データの受け渡し</option><option value="request" ${e.mode==='request'?'selected':''}>↔ リクエストと応答</option><option value="event" ${e.mode==='event'?'selected':''}>→ イベント / トリガー</option></select></label>${field('実現したいこと','edge-intent',e.intent,{textarea:true,cls:'intent'})}<button class="primary wide-button" id="edge-handoff">↗ この接続をエージェントに渡す</button><div class="status-card ${status(e.id)}"><strong>● ${statusNames[status(e.id)]}</strong>${report?.summary?`<p>${esc(report.summary)}</p>`:''}</div>${Array.isArray(report?.checks)?`<p class="subtle">エージェントの確認記録</p><div class="artifact">${report.checks.map(v=>esc(v)).join('<br>')}</div>`:''}<hr><span class="eyebrow">PROJECT FILES</span><p class="artifact">connections/${esc(e.id)}/SPEC.md<br>implementations/${esc(e.id)}/<br>reports/${esc(e.id)}.json</p>${Array.isArray(report?.files)?`<div class="artifact">${report.files.map(v=>esc(v)).join('<br>')}</div>`:''}<button class="wide-button danger" id="delete-selected">接続を削除</button>`;
    for(const prop of ['label','intent'])bindText('edge-'+prop,()=>e[prop],value=>{e[prop]=value;invalidateEdges(null,e.id);});
    $('#edge-mode').onchange=event=>mutate(()=>{e.mode=event.target.value;invalidateEdges(null,e.id);});
    $('#edge-handoff').onclick=safe(()=>handoff(e.id));
  }else{
    panel.innerHTML=`<div class="inspector-heading"><span class="eyebrow">PROJECT OVERVIEW</span></div>${field('プロジェクト名','project-name',graph.name)}${field('全体で実現したいこと','project-description',graph.description,{textarea:true})}${root?`<p class="artifact" style="margin-top:20px">${esc(root)}</p><button class="wide-button" id="copy-location">プロジェクトのパスをコピー</button>`:''}`;
    bindText('project-name',()=>graph.name,value=>{graph.name=value;},true);
    bindText('project-description',()=>graph.description,value=>{graph.description=value;for(const id in reports)reports[id]={...reports[id],status:'stale'};});
    if($('#copy-location'))$('#copy-location').onclick=safe(async()=>{await call('copy',{text:root});toast('パスをコピーしました。');});
  }
  if($('#delete-selected'))$('#delete-selected').onclick=safe(deleteSelected);
}
function modal(html){const d=$('#modal');$('#modal-content').innerHTML=html;if(!d.open)d.showModal();}
async function confirmChoice(message){return new Promise(resolve=>{
  modal(`<h2>変更を確認</h2><p>${esc(message)}</p><div class="modal-actions"><button value="cancel">キャンセル</button><button value="confirm" class="primary">続ける</button></div>`);
  $('#modal').addEventListener('close',()=>resolve($('#modal').returnValue==='confirm'),{once:true});$('#modal').returnValue='cancel';
});}
async function deleteSelected(){if(!selected)return;const item={...selected};if(item.type==='node'&&graph.edges.some(e=>e.source===item.id||e.target===item.id)){if(!await confirmChoice('このコンポーネントと、それにつながる接続を削除します。生成済みの実装ファイルは保持されます。'))return;}
  mutate(()=>{if(item.type==='node'){graph.nodes=graph.nodes.filter(n=>n.id!==item.id);graph.edges=graph.edges.filter(e=>e.source!==item.id&&e.target!==item.id);}else graph.edges=graph.edges.filter(e=>e.id!==item.id);selected=null;});}
function addDialog(){modal(`<h2>コンポーネントを追加</h2><button type="button" class="option" id="dialog-folder"><span class="option-icon">▧</span><span><strong>ローカルのフォルダ / ファイル</strong></span></button><button type="button" class="option" id="dialog-url"><span class="option-icon">⌘</span><span><strong>リポジトリ URL / パス</strong></span></button><button type="button" class="option" id="dialog-note"><span class="option-icon">◇</span><span><strong>空のコンポーネント</strong></span></button><div class="modal-actions"><button>閉じる</button></div>`);
  $('#dialog-folder').onclick=safe(async()=>{$('#modal').close();await chooseNodes();});
  $('#dialog-note').onclick=()=>{$('#modal').close();mutate(()=>{const n=makeNode({kind:'note',name:'新しいモジュール'});graph.nodes.push(n);selected={type:'node',id:n.id};});};
  $('#dialog-url').onclick=()=>{modal(`<h2>参照先を追加</h2>${field('絶対パス、またはリポジトリ URL','path-entry','')}<div class="modal-actions"><button>キャンセル</button><button type="button" class="primary" id="add-reference">追加</button></div>`);$('#path-entry').focus();$('#add-reference').onclick=safe(async()=>{const value=$('#path-entry').value.trim();if(!value)return;const info=await call('inspect',{path:value});$('#modal').close();mutate(()=>{const{files,...fields}=info;const n=makeNode(fields);graph.nodes.push(n);selected={type:'node',id:n.id};});});};
}
async function handoff(edgeID){document.activeElement?.blur();if(!await save(true))return;const prompt=await call('copyPrompt',{edgeID});modal(`<h2>依頼文をコピーしました</h2><pre>${esc(prompt)}</pre><div class="modal-actions"><button>閉じる</button><button type="button" id="copy-again" class="primary">もう一度コピー</button></div>`);$('#copy-again').onclick=safe(async()=>{await call('copy',{text:prompt});toast('依頼文をコピーしました。');});}
function exampleGraph(){return {"schemaVersion":1,"name":"Multimodal LLM agent","description":"画像・音声・テキストを入力できるシンプルなLLMエージェントの設計例。画像理解と文字起こしを経てLLMへ渡し、必要に応じてツールを呼び出して応答する。参照先・モデル・実装は未設定。","nodes":[{"id":"image","name":"画像入力","kind":"note","x":0,"y":0,"path":"","command":"","description":"ユーザーが選んだ画像をMIMEタイプとともに渡す。","inputs":[],"outputs":["image"],"policy":"mutable","appearance":{"color":"#4a6282","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"audio","name":"音声入力","kind":"note","x":0,"y":200,"path":"","command":"","description":"録音または音声ファイルをサンプルレートとともに渡す。","inputs":[],"outputs":["audio"],"policy":"mutable","appearance":{"color":"#715669","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"text","name":"テキスト入力","kind":"note","x":0,"y":400,"path":"","command":"","description":"ユーザーの質問や指示を文字列として渡す。","inputs":[],"outputs":["text"],"policy":"mutable","appearance":{"color":"#416762","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"vision","name":"画像理解","kind":"model","x":300,"y":0,"path":"","command":"","description":"画像を解釈し、内容とユーザーの質問に関連する情報をテキストにする。","inputs":["image"],"outputs":["description"],"policy":"mutable","appearance":{"color":"#4a6282","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"transcribe","name":"文字起こし","kind":"model","x":300,"y":200,"path":"","command":"","description":"音声認識で文字起こしする。認識できない場合はエラーを返す。","inputs":["audio"],"outputs":["transcript"],"policy":"mutable","appearance":{"color":"#715669","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"agent","name":"LLMエージェント","kind":"model","x":620,"y":160,"path":"","command":"","description":"同じリクエストの画像説明・文字起こし・テキストをまとめて推論する。各入力は任意。必要に応じてツールを呼び、結果を踏まえて最終応答を返す。","inputs":["image_context","audio_text","text"],"outputs":["tool_call","response"],"policy":"mutable","appearance":{"color":"#416762","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"tools","name":"ツール実行","kind":"service","x":940,"y":0,"path":"","command":"","description":"許可された検索・計算などのツールを実行する。引数を検証し結果またはエラーを返す。","inputs":["request"],"outputs":["result"],"policy":"mutable","appearance":{"color":"#80602d","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"response","name":"応答表示","kind":"application","x":940,"y":340,"path":"","command":"","description":"最終テキストをユーザーに表示する。","inputs":["text"],"outputs":[],"policy":"mutable","appearance":{"color":"#4a6282","radius":8,"corners":"uniform","surface":"filled","header":"plain"}}],"edges":[{"id":"edge_01","source":"image","target":"vision","sourcePort":"image","targetPort":"image","label":"画像","intent":"画像データとMIMEタイプを渡す。サイズと形式を検証する。","mode":"data","policy":"mutable"},{"id":"edge_02","source":"audio","target":"transcribe","sourcePort":"audio","targetPort":"audio","label":"音声","intent":"音声データとサンプルレートを渡す。形式を検証する。","mode":"data","policy":"mutable"},{"id":"edge_03","source":"vision","target":"agent","sourcePort":"description","targetPort":"image_context","label":"画像の説明","intent":"画像の説明をrequest_idとともに渡す。","mode":"data","policy":"mutable"},{"id":"edge_04","source":"transcribe","target":"agent","sourcePort":"transcript","targetPort":"audio_text","label":"文字起こし","intent":"認識したテキストをrequest_idとともに渡す。","mode":"data","policy":"mutable"},{"id":"edge_05","source":"text","target":"agent","sourcePort":"text","targetPort":"text","label":"ユーザーの指示","intent":"入力テキストをrequest_idとともに渡す。入力されていないモダリティは待たない。","mode":"data","policy":"mutable"},{"id":"edge_06","source":"agent","target":"tools","sourcePort":"tool_call","targetPort":"request","label":"ツール呼び出し","intent":"ツール名・引数・call_idを送り、同じ呼び出しの結果またはエラーを応答として受け取る。タイムアウトと最大呼び出し回数を設ける。","mode":"request","policy":"mutable"},{"id":"edge_07","source":"agent","target":"response","sourcePort":"response","targetPort":"text","label":"最終応答","intent":"最終テキストを渡して表示する。失敗時にはエラーを表示する。","mode":"data","policy":"mutable"}]};}

async function replaceDraft(next){if(dirty&&!root&&!await confirmChoice('現在の未保存のグラフを置き換えます。'))return;if(root&&dirty){if(!await save(true))return;}root='';revision='';reports={};fingerprints={};selected=null;external=false;$('#external-banner').hidden=true;undoStack=[];redoStack=[];graph=next;markDirty();render();fit();}
async function poll(){if(!root||saveTask)return;try{const state=await call('poll');if(state.externalChange){external=true;$('#external-banner').hidden=false;clearTimeout(saveTimer);if(!dirty&&!drag&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'')){
  const selectedBefore=selected;const refreshed=await call('reload');cleanState(refreshed);selected=selectedBefore;render(true);$('#status-text').textContent='エージェントによるグラフの変更を反映しました。';
 }return;}
 if(dirty||drag)return;
 if(JSON.stringify(reports)!==JSON.stringify(state.reports)){reports=state.reports||{};fingerprints=state.fingerprints||{};updateHeader();renderEdges();if(!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||''))renderInspector(true);$('#status-text').textContent='実装レポートを更新しました。';}
}catch(e){$('#status-text').textContent=e.message;}}
$('#canvas').addEventListener('pointerdown',e=>{if(e.target.closest('.node,.edge-group,.canvas-controls')||e.button>1)return;if(connecting){connecting=null;$('#connect-hint').hidden=true;renderEdges();}selected=null;render(false);renderInspector(true);drag={type:'pan',startX:e.clientX,startY:e.clientY,x:view.x,y:view.y};});
window.addEventListener('pointermove',e=>{
  if(connecting){connecting.point=canvasPoint(e.clientX,e.clientY);renderEdges();}
  if(!drag)return;
  if(drag.type==='pan'){view.x=drag.x+e.clientX-drag.startX;view.y=drag.y+e.clientY-drag.startY;transform();}
  else{const dx=(e.clientX-drag.startX)/view.zoom,dy=(e.clientY-drag.startY)/view.zoom;if(!drag.remembered&&Math.hypot(dx,dy)>2){remember();drag.remembered=true;}if(!drag.remembered)return;const n=graph.nodes.find(n=>n.id===drag.id);if(!n)return;n.x=drag.x+dx;n.y=drag.y+dy;const el=$(`[data-node="${n.id}"]`);el.style.left=n.x+'px';el.style.top=n.y+'px';renderEdges();}
});
window.addEventListener('pointerup',()=>{if(drag?.type==='node'&&drag.remembered)markDirty();drag=null;updateHeader();});
$('#canvas').addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||e.metaKey)zoomBy(Math.exp(-e.deltaY*.012),e.clientX,e.clientY);else{view.x-=e.deltaX;view.y-=e.deltaY;transform();}},{passive:false});
$('#canvas').addEventListener('dragover',e=>{e.preventDefault();$('#canvas').classList.add('drag-over');});
$('#canvas').addEventListener('dragleave',()=>$('#canvas').classList.remove('drag-over'));
$('#canvas').addEventListener('drop',safe(async e=>{e.preventDefault();$('#canvas').classList.remove('drag-over');const text=e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain');if(text&&/^https?:\/\//.test(text))await addPaths([text.trim()],canvasPoint(e.clientX,e.clientY));}));
host.on('drop',safe(async detail=>{const r=$('#canvas').getBoundingClientRect();$('#canvas').classList.remove('drag-over');if(detail.x<r.left||detail.x>r.right||detail.y<r.top||detail.y>r.bottom){toast('中央のキャンバスにドロップしてください。');return;}await addPaths(detail.paths,canvasPoint(detail.x,detail.y));})).catch(e=>toast(e.message,true));
host.on('error',message=>toast(message,true)).catch(e=>toast(e.message,true));
function undo(){if(!undoStack.length)return;redoStack.push(clone(graph));graph=undoStack.pop();selected=null;markDirty();render();}
function redo(){if(!redoStack.length)return;undoStack.push(clone(graph));graph=redoStack.pop();selected=null;markDirty();render();}
$('#zoom-in').onclick=()=>zoomBy(1.2);$('#zoom-out').onclick=()=>zoomBy(1/1.2);$('#fit-view').onclick=fit;$('#undo').onclick=undo;$('#redo').onclick=redo;
$('#add-node').onclick=addDialog;$('#empty-add').onclick=safe(chooseNodes);$('#save-project').onclick=safe(()=>save(true));$('#handoff').onclick=safe(()=>handoff());
$('#new-project').onclick=safe(()=>replaceDraft(emptyGraph()));$('#load-example').onclick=safe(()=>replaceDraft(exampleGraph()));
$('#project-settings').onclick=()=>{selected=null;render();};$('#reveal-project').onclick=safe(()=>call('reveal'));
$('#open-project').onclick=safe(async()=>{document.activeElement?.blur();if(dirty){if(root){if(!await save(true))return;}else if(!await confirmChoice('未保存のグラフを破棄して別のプロジェクトを開きます。'))return;}const state=await call('openProject');if(state){clearTimeout(saveTimer);cleanState(state);fit();}});
$('#reload-project').onclick=safe(async()=>{if(dirty&&!await confirmChoice('未保存の編集を破棄して、ディスクのグラフを読み込みます。必要なら先に JSON 書き出しで退避してください。'))return;clearTimeout(saveTimer);cleanState(await call('reload'));fit();});
$('#export-draft').onclick=safe(()=>call('exportJSON',{graph}));
$('#show-help').onclick=()=>modal(`<h2>ヘルプ</h2><p>① フォルダを配置し、右の出力から左の入力へ線を引きます。<br>② 線を選んで、つなぎたい内容を記入します。<br>③ 保存して「エージェントに渡す」を押します。<br>④ コピーした依頼文を、ローカルファイルにアクセスできる ChatGPT / Codex / Claude Code のチャットへ貼り付けます。</p><pre>graph.json                  設計の正本\nAGENT_BRIEF.md              エージェントへの指示\nconnections/&lt;id&gt;/SPEC.md    接続ごとの仕様\nimplementations/&lt;id&gt;/       生成コードの保存先\nreports/&lt;id&gt;.json          実装・検証の報告\ngraph.mmd                   Mermaid のグラフ</pre><p>保存済みプロジェクトの編集は自動保存されます。エージェントのレポートは約2秒ごとに読み込みます。元のリポジトリの更新は自動検知しないため、コードを変えた際は再検証を依頼してください。</p><div class="modal-actions"><button class="primary">わかりました</button></div>`);
window.addEventListener('keydown',safe(async e=>{
  const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'');
  if(e.key==='Escape'){connecting=null;drag=null;$('#connect-hint').hidden=true;renderEdges();}
  if(e.metaKey&&e.key.toLowerCase()==='s'){e.preventDefault();document.activeElement?.blur();await save(true);}
  if(e.metaKey&&e.key.toLowerCase()==='o'){e.preventDefault();$('#open-project').click();}
  if(!typing&&!$('#modal').open){if(e.metaKey&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}if(['Backspace','Delete'].includes(e.key)){e.preventDefault();await deleteSelected();}if(e.key.toLowerCase()==='f')fit();}
}));
window.gacchanko={call,get graph(){return graph;},get root(){return root;},get reports(){return reports;},makeNode,mutate,createConnection,select,save,poll,cleanState,fit,render,exampleGraph,addPaths,undo,redo,status,replaceDraft};
async function init(){render();if(native){const state=await call('state');if(state.project){cleanState(state);fit();}else{try{const backup=JSON.parse(localStorage.getItem('gacchanko-draft')||localStorage.getItem('patchwork-draft')||'null');if(backup?.graph&&await confirmChoice('前回の未保存の編集を復元しますか？')){graph=backup.graph;root='';revision='';markDirty();render();fit();}}catch(e){toast(e.message,true);}}}setInterval(poll,2000);}
window.gacchankoReady=init().catch(e=>toast(e.message,true));
