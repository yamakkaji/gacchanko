'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const uid = prefix => prefix + '_' + crypto.randomUUID().slice(0, 8);
const host = window.gacchankoHost;
const native = host.available;
const appearance=window.gacchankoAppearance;
let edgeAppearance=appearance.load();
const call = (command, args={}) => host.request(command,args);
const emptyGraph = () => ({schemaVersion:1,name:'Untitled project',description:'',nodes:[],edges:[]});
let graph=emptyGraph(), root='', revision='', reports={}, fingerprints={}, dirty=false, selected=null;
let spacePressed=false;
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
  if(replace){clearConnection(false);graph=state.project;selected=null;undoStack=[];redoStack=[];}
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
  $('#project-title').textContent=graph.name;$('#canvas-project-title').textContent=graph.name;$('#workspace-name').textContent=graph.name;
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
// Selection is UI state only; the saved graph schema stays unchanged.
function selectedNodeIDs(){return selected?.type==='node'?[selected.id]:selected?.type==='nodes'?selected.ids:[];}
function setNodeSelection(ids){
  ids=[...new Set(ids)].filter(id=>graph.nodes.some(n=>n.id===id));
  selected=ids.length===1?{type:'node',id:ids[0]}:ids.length?{type:'nodes',ids}:null;
}
function refreshSelection(){
  const ids=new Set(selectedNodeIDs());
  $$('.node').forEach(el=>el.classList.toggle('selected',ids.has(el.dataset.node)));
  renderList();renderEdges();renderInspector(true);
}
function toggleNode(id){const ids=selectedNodeIDs();setNodeSelection(ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);refreshSelection();}
function beginDrag(event,state){
  $('#canvas').focus({preventScroll:true});
  drag={...state,startX:event.clientX,startY:event.clientY,pointerID:event.pointerId};
  if(event.pointerId!==undefined)try{$('#canvas').setPointerCapture(event.pointerId);}catch{}
  event.preventDefault();
}
function renderEdges(){
  $('#edge-paths').innerHTML=graph.edges.map((e,index)=>{
    const a=portPoint(e.source,e.sourcePort,'out'),b=portPoint(e.target,e.targetPort,'in');
    const x=(a.x+b.x)/2,y=(a.y+b.y)/2, label=(e.mode==='request'?'↔ ':'')+(e.label||'接続'), width=Math.min(230,Math.max(85,[...label].length*7+38));
    const colour={verified:'#416762',implemented:'#715669',stale:'#9a6a23',blocked:'#a54844'}[status(e.id)]||'#486080';
    return `<g class="edge-group ${selected?.type==='edge'&&selected.id===e.id?'selected':''}" data-edge="${esc(e.id)}" style="color:${colour}"><title>${esc(e.sourcePort)} → ${esc(e.targetPort)}${e.mode==='request'?' · リクエスト / 応答':''}</title><path class="edge-hit" d="${curve(a,b)}"/>${appearance.render(a,b,{settings:edgeAppearance,zoom:view.zoom,id:'canvas-edge-'+index,statusColour:colour,request:e.mode==='request',selected:selected?.type==='edge'&&selected.id===e.id})}<rect class="edge-label-bg" x="${x-width/2}" y="${y-26-8/view.zoom}" width="${width}" height="26" rx="6"/><circle class="edge-status" cx="${x-width/2+10}" cy="${y-13-8/view.zoom}" r="3" fill="${colour}"><title>${statusNames[status(e.id)]}</title></circle><text class="edge-label" x="${x+5}" y="${y-9.5-8/view.zoom}" text-anchor="middle">${esc(label.length>27?label.slice(0,26)+'…':label)}</text></g>`;
  }).join('')+connectionPreview();
  $$('.edge-group').forEach(el=>{
    el.classList.toggle('reconnecting',connecting?.edgeID===el.dataset.edge);
    el.addEventListener('pointerdown',e=>{if(e.button!==0||spacePressed)return;e.stopPropagation();e.preventDefault();if(connecting)clearConnection();$('#canvas').focus({preventScroll:true});select('edge',el.dataset.edge);});
  });
  renderConnectionHandles();updatePortStates();
}
function renderNodes(){
  $('#nodes').innerHTML=graph.nodes.map(n=>`<div class="node ${esc(n.kind)} ${selectedNodeIDs().includes(n.id)?'selected':''}" style="left:${n.x}px;top:${n.y}px" data-node="${esc(n.id)}"><div class="node-head"><div class="node-symbol">${symbols[n.kind]||'◇'}</div><div class="node-info"><div class="node-kind">${esc(n.kind)}</div><div class="node-name" title="${esc(n.name)}">${esc(n.name)}</div></div><span class="node-menu">···</span></div><div class="node-path ${n.path?'':'unresolved'}" title="${esc(n.path)}">${esc(n.path||'参照先を設定してください')}</div>${Array.from({length:Math.max(n.inputs.length,n.outputs.length,1)},(_,i)=>`<div class="port-row">${n.inputs[i]?`<div class="port-side"><button aria-label="${esc(n.name)} input ${esc(n.inputs[i])}" class="port in" data-direction="in" data-port="${esc(n.inputs[i])}"></button><span>${esc(n.inputs[i])}</span></div>`:''}${n.outputs[i]?`<div class="port-side out"><span>${esc(n.outputs[i])}</span><button aria-label="${esc(n.name)} output ${esc(n.outputs[i])}" class="port out" data-direction="out" data-port="${esc(n.outputs[i])}"></button></div>`:''}</div>`).join('')}</div>`).join('');
  $$('.node').forEach(el=>{
    el.addEventListener('pointerdown',e=>{
      if(drag||e.button!==0||spacePressed||e.target.closest('.port'))return;
      e.stopPropagation();if(connecting)clearConnection();
      const id=el.dataset.node;
      if(e.shiftKey){toggleNode(id);if(!selectedNodeIDs().includes(id))return;}
      else if(!selectedNodeIDs().includes(id))select('node',id,false);
      const ids=new Set(selectedNodeIDs());
      beginDrag(e,{type:'nodes',origins:graph.nodes.filter(n=>ids.has(n.id)).map(n=>({id:n.id,x:n.x,y:n.y})),remembered:false});
    });
    $$('.port',el).forEach(port=>port.addEventListener('pointerdown',e=>{
      if(e.button!==0||spacePressed||drag)return;
      e.preventDefault();e.stopPropagation();
      const candidate={node:el.dataset.node,port:port.dataset.port,direction:port.dataset.direction};
      if(connecting&&candidate.direction===movingDirection()){completeConnection(candidate);return;}
      if(connecting)clearConnection();
      // A singly-wired input can be picked up directly. For shared ports the
      // selected edge's endpoint handles identify exactly which wire to move.
      const incoming=graph.edges.filter(edge=>edge.target===candidate.node&&edge.targetPort===candidate.port);
      if(candidate.direction==='in'&&incoming.length===1)beginConnection(e,'target',incoming[0]);
      else if(candidate.direction==='in'&&incoming.length>1)toast('付け替える線を選び、その接点をドラッグしてください。');
      else beginConnection(e,candidate.direction==='out'?'target':'source',null,candidate);
    }));
  });
}
function renderList(){
  $('#node-list').innerHTML=graph.nodes.map(n=>`<button class="node-item ${selectedNodeIDs().includes(n.id)?'active':''}" data-select-node="${esc(n.id)}"><span class="node-mini">${symbols[n.kind]||'◇'}</span><span class="item-name">${esc(n.name)}</span><span class="item-state" style="background:${n.path?'#86b39c':'#887656'}"></span></button>`).join('');
  $$('[data-select-node]').forEach(b=>b.onclick=e=>{if(e.shiftKey){toggleNode(b.dataset.selectNode);return;}select('node',b.dataset.selectNode);const n=graph.nodes.find(n=>n.id===b.dataset.selectNode);const r=$('#canvas').getBoundingClientRect();view.x=r.width/2-(n.x+112)*view.zoom;view.y=r.height/2-(n.y+70)*view.zoom;transform();});
}
function render(inspector=true){if(selected?.type==='node'||selected?.type==='nodes')setNodeSelection(selectedNodeIDs());updateHeader();renderNodes();renderEdges();renderList();$('#empty-state').hidden=!!graph.nodes.length;transform();if(inspector)renderInspector(true);}
function select(type,id,redraw=true){selected={type,id};if(redraw)render(false);refreshSelection();}
function transform(){
  $('#world').style.transform=`translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
  $('#zoom-label').textContent=Math.round(view.zoom*100)+'%';
  $('#canvas').style.backgroundSize=`${22*view.zoom}px ${22*view.zoom}px`;
  $('#canvas').style.backgroundPosition=`${view.x}px ${view.y}px`;
  renderEdges();
}
function canvasPoint(clientX,clientY){const r=$('#canvas').getBoundingClientRect();return{x:(clientX-r.left-view.x)/view.zoom,y:(clientY-r.top-view.y)/view.zoom};}
function fit(){if(!graph.nodes.length){view={x:65,y:65,zoom:1};transform();return;}const r=$('#canvas').getBoundingClientRect();const minX=Math.min(...graph.nodes.map(n=>n.x)),minY=Math.min(...graph.nodes.map(n=>n.y)),maxX=Math.max(...graph.nodes.map(n=>n.x+224)),maxY=Math.max(...graph.nodes.map(n=>n.y+nodeHeight(n)));
  const zoom=Math.min(1.1,Math.max(.25,Math.min((r.width-100)/(maxX-minX),(r.height-130)/(maxY-minY))));view={zoom,x:(r.width-(maxX-minX)*zoom)/2-minX*zoom,y:(r.height-(maxY-minY)*zoom)/2-minY*zoom-12};transform();}
function zoomBy(factor,cx,cy){const r=$('#canvas').getBoundingClientRect();const x=cx??r.left+r.width/2,y=cy??r.top+r.height/2;const p=canvasPoint(x,y);view.zoom=Math.max(.2,Math.min(2.5,view.zoom*factor));view.x=x-r.left-p.x*view.zoom;view.y=y-r.top-p.y*view.zoom;transform();}
function movingDirection(){return connecting?.moving==='source'?'out':'in';}
function connectionEndpoints(candidate){
  const c=connecting;
  return c.moving==='target'?{source:c.fixed.node,sourcePort:c.fixed.port,target:candidate.node,targetPort:candidate.port}:{source:candidate.node,sourcePort:candidate.port,target:c.fixed.node,targetPort:c.fixed.port};
}
function validCandidate(candidate){
  if(!connecting||candidate.direction!==movingDirection())return false;
  const n=graph.nodes.find(n=>n.id===candidate.node);
  if(!n||(candidate.direction==='in'?!n.inputs.includes(candidate.port):!n.outputs.includes(candidate.port)))return false;
  const next=connectionEndpoints(candidate);
  return !graph.edges.some(e=>e.id!==connecting.edgeID&&e.source===next.source&&e.target===next.target&&e.sourcePort===next.sourcePort&&e.targetPort===next.targetPort);
}
function nearestPort(clientX,clientY){
  if(!connecting)return null;
  const r=$('#canvas').getBoundingClientRect();
  if(clientX<r.left||clientX>r.right||clientY<r.top||clientY>r.bottom)return null;
  const point=canvasPoint(clientX,clientY),direction=movingDirection();
  const distance=c=>{const p=portPoint(c.node,c.port,c.direction);return Math.hypot(p.x-point.x,p.y-point.y)*view.zoom;};
  if(connecting.candidate&&validCandidate(connecting.candidate)&&distance(connecting.candidate)<=28)return connecting.candidate;
  let nearest=null,best=22;
  for(const n of graph.nodes)for(const port of direction==='in'?n.inputs:n.outputs){
    const c={node:n.id,port,direction};if(!validCandidate(c))continue;
    const d=distance(c);if(d<best){best=d;nearest=c;}
  }
  return nearest;
}
function updatePortStates(){
  $$('.node .port').forEach(el=>{
    const node=el.closest('.node').dataset.node,direction=el.dataset.direction,port=el.dataset.port,c=connecting?.candidate;
    el.classList.toggle('snap-target',!!c&&c.node===node&&c.direction===direction&&c.port===port);
    el.classList.toggle('connected',graph.edges.some(e=>direction==='out'?e.source===node&&e.sourcePort===port:e.target===node&&e.targetPort===port));
  });
}
function beginConnection(event,moving,edge=null,port=null){
  clearConnection(false);
  const fixed=edge?(moving==='target'?{node:edge.source,port:edge.sourcePort,direction:'out'}:{node:edge.target,port:edge.targetPort,direction:'in'}):port;
  const point=edge?portPoint(moving==='target'?edge.target:edge.source,moving==='target'?edge.targetPort:edge.sourcePort,moving==='target'?'in':'out'):portPoint(port.node,port.port,port.direction);
  if(edge)selected={type:'edge',id:edge.id};
  connecting={moving,fixed,edgeID:edge?.id,point,candidate:null,pointerID:event.pointerId,held:true,moved:false,startX:event.clientX,startY:event.clientY};
  $('#canvas').focus({preventScroll:true});
  if(event.pointerId!==undefined)try{$('#canvas').setPointerCapture(event.pointerId);}catch{}
  $('#connect-hint').textContent=(moving==='target'?'入力':'出力')+'ポートへドラッグ · Esc でキャンセル';
  $('#connect-hint').hidden=false;renderEdges();renderInspector(true);
}
function clearConnection(redraw=true){
  const old=connecting;connecting=null;$('#connect-hint').hidden=true;
  if(old?.pointerID!==undefined)try{$('#canvas').releasePointerCapture(old.pointerID);}catch{}
  if(redraw)renderEdges();
}
function updateConnection(event){
  if(!connecting)return;
  if(connecting.held&&connecting.pointerID!==undefined&&event.pointerId!==connecting.pointerID)return;
  connecting.moved ||= Math.hypot(event.clientX-connecting.startX,event.clientY-connecting.startY)>3;
  connecting.candidate=nearestPort(event.clientX,event.clientY);
  connecting.point=connecting.candidate?portPoint(connecting.candidate.node,connecting.candidate.port,connecting.candidate.direction):canvasPoint(event.clientX,event.clientY);
  renderEdges();
}
function completeConnection(candidate){
  if(!validCandidate(candidate)){clearConnection();return;}
  const next=connectionEndpoints(candidate),edgeID=connecting.edgeID;
  clearConnection(false);
  if(edgeID){
    const edge=graph.edges.find(e=>e.id===edgeID);
    if(!edge||Object.keys(next).every(key=>edge[key]===next[key])){renderEdges();return;}
    mutate(()=>{Object.assign(edge,next);invalidateEdges(null,edgeID);selected={type:'edge',id:edgeID};});
  }else createConnection(next.source,next.target,next.sourcePort,next.targetPort);
}
function connectionPreview(){
  if(!connecting)return '';
  const c=connecting,p=portPoint(c.fixed.node,c.fixed.port,c.fixed.direction),a=c.moving==='source'?c.point:p,b=c.moving==='target'?c.point:p;
  return `<g class="connection-preview ${c.candidate?'snapped':''}"><path class="edge-line" d="${curve(a,b)}" ${c.candidate?'':'stroke-dasharray="5 4"'}/>${c.candidate?`<circle class="snap-ring" cx="${c.point.x}" cy="${c.point.y}" r="${11/view.zoom}" vector-effect="non-scaling-stroke"/>`:''}</g>`;
}
function renderConnectionHandles(){
  const edge=selected?.type==='edge'?graph.edges.find(e=>e.id===selected.id):null;
  $('#edge-handles').innerHTML=!edge||connecting?'':['source','target'].map(end=>{
    const point=portPoint(edge[end],edge[end+'Port'],end==='source'?'out':'in');
    return `<circle class="edge-endpoint" data-reconnect="${end}" cx="${point.x}" cy="${point.y}" r="${7/view.zoom}" vector-effect="non-scaling-stroke"><title>${end==='source'?'出力':'入力'}側を付け替え</title></circle>`;
  }).join('');
  $$('[data-reconnect]').forEach(el=>el.addEventListener('pointerdown',event=>{
    if(event.button!==0||spacePressed||drag)return;event.preventDefault();event.stopPropagation();beginConnection(event,el.dataset.reconnect,edge);
  }));
}
function createConnection(source,target,sourcePort,targetPort){
  clearConnection(false);
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
  const key=selected?selected.type+(selected.id||selected.ids.join(',')):'project';if(!force&&inspectorKey===key)return;inspectorKey=key;
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
  }else if(selected?.type==='nodes'){
    const count=selectedNodeIDs().length;
    panel.innerHTML=`<div class="inspector-heading"><span class="eyebrow">COMPONENTS</span></div><h2>${count} 個を選択</h2><button class="wide-button danger" id="delete-selected">選択したコンポーネントを削除</button>`;
  }else if(selected?.type==='edge'){
    const e=graph.edges.find(e=>e.id===selected.id);if(!e){selected=null;return renderInspector(true);}const a=graph.nodes.find(n=>n.id===e.source),b=graph.nodes.find(n=>n.id===e.target);const report=reports[e.id];
    panel.innerHTML=`<div class="inspector-heading"><span class="eyebrow">CONNECTION</span><span class="badge">${statusNames[status(e.id)]}</span></div><div class="connection-endpoint"><span>${esc(a.name)}</span><small>${esc(e.sourcePort)}</small></div><div class="endpoint-arrow">${e.mode==='request'?'↕ REQUEST / RESPONSE':'↓'}</div><div class="connection-endpoint"><span>${esc(b.name)}</span><small>${esc(e.targetPort)}</small></div>${field('接続の名前','edge-label',e.label)}<label class="field"><span>接続の形式</span><select id="edge-mode"><option value="data" ${e.mode==='data'?'selected':''}>→ データの受け渡し</option><option value="request" ${e.mode==='request'?'selected':''}>↔ リクエストと応答</option><option value="event" ${e.mode==='event'?'selected':''}>→ イベント / トリガー</option></select></label>${field('実現したいこと','edge-intent',e.intent,{textarea:true,cls:'intent'})}<button class="primary wide-button" id="edge-handoff">↗ この接続をエージェントに渡す</button><div class="status-card ${status(e.id)}"><strong>● ${statusNames[status(e.id)]}</strong>${report?.summary?`<p>${esc(report.summary)}</p>`:''}</div>${Array.isArray(report?.checks)?`<details class="report-checks"><summary>エージェントの確認記録</summary><pre class="artifact">${report.checks.map(v=>esc(v)).join('\n\n')}</pre></details>`:''}<hr><span class="eyebrow">PROJECT FILES</span><p class="artifact">connections/${esc(e.id)}/SPEC.md<br>implementations/${esc(e.id)}/<br>reports/${esc(e.id)}.json</p>${Array.isArray(report?.files)?`<div class="artifact">${report.files.map(v=>esc(v)).join('<br>')}</div>`:''}<button class="wide-button danger" id="delete-selected">接続を削除</button>`;
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
function appearanceSettings(){
  const s=edgeAppearance;
  const options=(values,current)=>Object.entries(values).map(([value,label])=>`<option value="${value}" ${value===current?'selected':''}>${label}</option>`).join('');
  const colour=(name,label)=>`<label class="field"><span>${label}</span><input type="color" data-appearance="${name}" value="${s[name]}"></label>`;
  const slider=(name,label,min,max,step=1)=>`<label class="field"><span>${label} <output data-output="${name}">${s[name]}</output></span><input type="range" data-appearance="${name}" min="${min}" max="${max}" step="${step}" value="${s[name]}"></label>`;
  modal(`<h2>設定</h2><span class="eyebrow">エッジの表示</span><div class="edge-preview"><div><span>out</span><span>in</span></div><svg id="appearance-preview" viewBox="0 0 440 110" role="img" aria-label="出力から入力へのエッジ表示プレビュー"></svg></div><label class="field"><span>表示方式</span><select data-appearance="style">${options({gradient:'グラデーション',pattern:'模様',both:'グラデーション＋模様',solid:'状態色（従来の表示）'},s.style)}</select></label><div class="appearance-colours">${colour('source','out 側の色')}${colour('target','in 側の色')}${colour('patternColour','模様の色')}</div><label class="field"><span>模様</span><select data-appearance="pattern">${options({chevrons:'山形 › › ›',taper:'先細りのストライプ'},s.pattern)}</select></label><div class="field-row">${slider('width','線の太さ',1,8,.5)}${slider('spacing','模様の間隔',20,120)}</div>${slider('size','模様の大きさ',3,12)}<label class="appearance-checkbox"><input type="checkbox" data-appearance="arrows" ${s.arrows?'checked':''}>矢印を表示</label><div class="modal-actions"><button type="button" id="reset-appearance">初期設定に戻す</button><button class="primary">閉じる</button></div>`);
  const preview=()=>{
    $('#appearance-preview').innerHTML=appearance.render({x:18,y:80},{x:420,y:28},{settings:edgeAppearance,id:'settings-preview'});
    const gradient=['gradient','both'].includes(edgeAppearance.style),pattern=['pattern','both'].includes(edgeAppearance.style);
    for(const name of ['pattern','patternColour','spacing','size'])$(`[data-appearance="${name}"]`).disabled=!pattern;
    $('[data-appearance="target"]').disabled=!gradient;
    $('[data-appearance="source"]').disabled=edgeAppearance.style==='solid';
    $$('[data-output]').forEach(el=>el.value=edgeAppearance[el.dataset.output]);
  };
  $$('[data-appearance]').forEach(input=>input.addEventListener('input',()=>{
    const value=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;
    edgeAppearance=appearance.normalize({...edgeAppearance,[input.dataset.appearance]:value});
    try{appearance.save(edgeAppearance);}catch{toast('表示設定を保存できませんでした。',true);}
    preview();renderEdges();
  }));
  $('#reset-appearance').onclick=()=>{edgeAppearance={...appearance.defaults};try{appearance.save(edgeAppearance);}catch{toast('表示設定を保存できませんでした。',true);}appearanceSettings();renderEdges();};
  preview();
}
function modal(html){const d=$('#modal');$('#modal-content').innerHTML=html;if(!d.open)d.showModal();}
async function confirmChoice(message){return new Promise(resolve=>{
  modal(`<h2>変更を確認</h2><p>${esc(message)}</p><div class="modal-actions"><button value="cancel">キャンセル</button><button value="confirm" class="primary">続ける</button></div>`);
  $('#modal').addEventListener('close',()=>resolve($('#modal').returnValue==='confirm'),{once:true});$('#modal').returnValue='cancel';
});}
async function deleteSelected(){
  if(!selected)return;
  const item=clone(selected),ids=new Set(selectedNodeIDs());
  if(ids.size&&graph.edges.some(e=>ids.has(e.source)||ids.has(e.target))){
    if(!await confirmChoice(`${ids.size} 個のコンポーネントと、それにつながる接続を削除します。生成済みの実装ファイルは保持されます。`))return;
  }
  mutate(()=>{
    if(ids.size){graph.nodes=graph.nodes.filter(n=>!ids.has(n.id));graph.edges=graph.edges.filter(e=>!ids.has(e.source)&&!ids.has(e.target));}
    else graph.edges=graph.edges.filter(e=>e.id!==item.id);
    selected=null;
  });
}
function addDialog(){modal(`<h2>コンポーネントを追加</h2><button type="button" class="option" id="dialog-folder"><span class="option-icon">▧</span><span><strong>ローカルのフォルダ / ファイル</strong></span></button><button type="button" class="option" id="dialog-url"><span class="option-icon">⌘</span><span><strong>リポジトリ URL / パス</strong></span></button><button type="button" class="option" id="dialog-note"><span class="option-icon">◇</span><span><strong>空のコンポーネント</strong></span></button><div class="modal-actions"><button>閉じる</button></div>`);
  $('#dialog-folder').onclick=safe(async()=>{$('#modal').close();await chooseNodes();});
  $('#dialog-note').onclick=()=>{$('#modal').close();mutate(()=>{const n=makeNode({kind:'note',name:'新しいモジュール'});graph.nodes.push(n);selected={type:'node',id:n.id};});};
  $('#dialog-url').onclick=()=>{modal(`<h2>参照先を追加</h2>${field('絶対パス、またはリポジトリ URL','path-entry','')}<div class="modal-actions"><button>キャンセル</button><button type="button" class="primary" id="add-reference">追加</button></div>`);$('#path-entry').focus();$('#add-reference').onclick=safe(async()=>{const value=$('#path-entry').value.trim();if(!value)return;const info=await call('inspect',{path:value});$('#modal').close();mutate(()=>{const{files,...fields}=info;const n=makeNode(fields);graph.nodes.push(n);selected={type:'node',id:n.id};});});};
}
async function handoff(edgeID){document.activeElement?.blur();if(!await save(true))return;const prompt=await call('copyPrompt',{edgeID});modal(`<h2>依頼文をコピーしました</h2><pre>${esc(prompt)}</pre><div class="modal-actions"><button>閉じる</button><button type="button" id="copy-again" class="primary">もう一度コピー</button></div>`);$('#copy-again').onclick=safe(async()=>{await call('copy',{text:prompt});toast('依頼文をコピーしました。');});}
function exampleGraph(){return {"schemaVersion":1,"name":"Multimodal LLM agent","description":"画像・音声・テキストを入力できるシンプルなLLMエージェントの設計例。画像理解と文字起こしを経てLLMへ渡し、必要に応じてツールを呼び出して応答する。参照先・モデル・実装は未設定。","nodes":[{"id":"image","name":"画像入力","kind":"note","x":0,"y":0,"path":"","command":"","description":"ユーザーが選んだ画像をMIMEタイプとともに渡す。","inputs":[],"outputs":["image"],"policy":"mutable","appearance":{"color":"#4a6282","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"audio","name":"音声入力","kind":"note","x":0,"y":200,"path":"","command":"","description":"録音または音声ファイルをサンプルレートとともに渡す。","inputs":[],"outputs":["audio"],"policy":"mutable","appearance":{"color":"#715669","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"text","name":"テキスト入力","kind":"note","x":0,"y":400,"path":"","command":"","description":"ユーザーの質問や指示を文字列として渡す。","inputs":[],"outputs":["text"],"policy":"mutable","appearance":{"color":"#416762","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"vision","name":"画像理解","kind":"model","x":300,"y":0,"path":"","command":"","description":"画像を解釈し、内容とユーザーの質問に関連する情報をテキストにする。","inputs":["image"],"outputs":["description"],"policy":"mutable","appearance":{"color":"#4a6282","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"transcribe","name":"文字起こし","kind":"model","x":300,"y":200,"path":"","command":"","description":"音声認識で文字起こしする。認識できない場合はエラーを返す。","inputs":["audio"],"outputs":["transcript"],"policy":"mutable","appearance":{"color":"#715669","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"agent","name":"LLMエージェント","kind":"model","x":620,"y":160,"path":"","command":"","description":"同じリクエストの画像説明・文字起こし・テキストをまとめて推論する。各入力は任意。必要に応じてツールを呼び、結果を踏まえて最終応答を返す。","inputs":["image_context","audio_text","text"],"outputs":["tool_call","response"],"policy":"mutable","appearance":{"color":"#416762","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"tools","name":"ツール実行","kind":"service","x":940,"y":0,"path":"","command":"","description":"許可された検索・計算などのツールを実行する。引数を検証し結果またはエラーを返す。","inputs":["request"],"outputs":["result"],"policy":"mutable","appearance":{"color":"#80602d","radius":8,"corners":"uniform","surface":"filled","header":"plain"}},{"id":"response","name":"応答表示","kind":"application","x":940,"y":340,"path":"","command":"","description":"最終テキストをユーザーに表示する。","inputs":["text"],"outputs":[],"policy":"mutable","appearance":{"color":"#4a6282","radius":8,"corners":"uniform","surface":"filled","header":"plain"}}],"edges":[{"id":"edge_01","source":"image","target":"vision","sourcePort":"image","targetPort":"image","label":"画像","intent":"画像データとMIMEタイプを渡す。サイズと形式を検証する。","mode":"data","policy":"mutable"},{"id":"edge_02","source":"audio","target":"transcribe","sourcePort":"audio","targetPort":"audio","label":"音声","intent":"音声データとサンプルレートを渡す。形式を検証する。","mode":"data","policy":"mutable"},{"id":"edge_03","source":"vision","target":"agent","sourcePort":"description","targetPort":"image_context","label":"画像の説明","intent":"画像の説明をrequest_idとともに渡す。","mode":"data","policy":"mutable"},{"id":"edge_04","source":"transcribe","target":"agent","sourcePort":"transcript","targetPort":"audio_text","label":"文字起こし","intent":"認識したテキストをrequest_idとともに渡す。","mode":"data","policy":"mutable"},{"id":"edge_05","source":"text","target":"agent","sourcePort":"text","targetPort":"text","label":"ユーザーの指示","intent":"入力テキストをrequest_idとともに渡す。入力されていないモダリティは待たない。","mode":"data","policy":"mutable"},{"id":"edge_06","source":"agent","target":"tools","sourcePort":"tool_call","targetPort":"request","label":"ツール呼び出し","intent":"ツール名・引数・call_idを送り、同じ呼び出しの結果またはエラーを応答として受け取る。タイムアウトと最大呼び出し回数を設ける。","mode":"request","policy":"mutable"},{"id":"edge_07","source":"agent","target":"response","sourcePort":"response","targetPort":"text","label":"最終応答","intent":"最終テキストを渡して表示する。失敗時にはエラーを表示する。","mode":"data","policy":"mutable"}]};}

async function replaceDraft(next){if(dirty&&!root&&!await confirmChoice('現在の未保存のグラフを置き換えます。'))return;if(root&&dirty){if(!await save(true))return;}clearConnection(false);root='';revision='';reports={};fingerprints={};selected=null;external=false;$('#external-banner').hidden=true;undoStack=[];redoStack=[];graph=next;markDirty();render();fit();}
async function poll(){if(!root||saveTask)return;try{const state=await call('poll');if(state.externalChange){external=true;$('#external-banner').hidden=false;clearTimeout(saveTimer);if(!dirty&&!drag&&!connecting&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'')){
  const selectedBefore=selected;const refreshed=await call('reload');cleanState(refreshed);selected=selectedBefore;render(true);$('#status-text').textContent='エージェントによるグラフの変更を反映しました。';
 }return;}
 if(dirty||drag||connecting)return;
 if(JSON.stringify(reports)!==JSON.stringify(state.reports)){reports=state.reports||{};fingerprints=state.fingerprints||{};updateHeader();renderEdges();if(!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||''))renderInspector(true);$('#status-text').textContent='実装レポートを更新しました。';}
}catch(e){$('#status-text').textContent=e.message;}}
$('#canvas').addEventListener('pointerdown',e=>{
  if(drag||e.button>1||e.target.closest('button,.canvas-controls'))return;
  if(e.button===1||(e.button===0&&spacePressed)){
    if(connecting)clearConnection();beginDrag(e,{type:'pan',x:view.x,y:view.y});$('#canvas').classList.add('panning');return;
  }
  if(e.target.closest('.node,.edge-group'))return;
  if(connecting){clearConnection();return;}
  const before=clone(selected),base=e.shiftKey?selectedNodeIDs():[];
  setNodeSelection(base);refreshSelection();
  beginDrag(e,{type:'marquee',point:canvasPoint(e.clientX,e.clientY),base,before});
});
window.addEventListener('pointermove',e=>{
  if(connecting)updateConnection(e);
  if(!drag||(drag.pointerID!==undefined&&e.pointerId!==drag.pointerID))return;
  if(drag.type==='pan'){
    view.x=drag.x+e.clientX-drag.startX;view.y=drag.y+e.clientY-drag.startY;transform();
  }else if(drag.type==='marquee'){
    if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<3&&!drag.moved)return;
    drag.moved=true;
    const r=$('#canvas').getBoundingClientRect(),box=$('#selection-box');
    box.hidden=false;
    Object.assign(box.style,{left:Math.min(e.clientX,drag.startX)-r.left+'px',top:Math.min(e.clientY,drag.startY)-r.top+'px',width:Math.abs(e.clientX-drag.startX)+'px',height:Math.abs(e.clientY-drag.startY)+'px'});
    const p=canvasPoint(e.clientX,e.clientY),left=Math.min(p.x,drag.point.x),right=Math.max(p.x,drag.point.x),top=Math.min(p.y,drag.point.y),bottom=Math.max(p.y,drag.point.y);
    const enclosed=graph.nodes.filter(n=>n.x>=left&&n.x+224<=right&&n.y>=top&&n.y+nodeHeight(n)<=bottom).map(n=>n.id);
    setNodeSelection([...drag.base,...enclosed]);refreshSelection();
  }else{
    const dx=(e.clientX-drag.startX)/view.zoom,dy=(e.clientY-drag.startY)/view.zoom;
    if(!drag.remembered&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>2){remember();drag.remembered=true;}
    if(!drag.remembered)return;
    for(const origin of drag.origins){
      const n=graph.nodes.find(n=>n.id===origin.id);if(!n)continue;
      n.x=origin.x+dx;n.y=origin.y+dy;
      const el=$$('.node').find(el=>el.dataset.node===n.id);if(el){el.style.left=n.x+'px';el.style.top=n.y+'px';}
    }
    renderEdges();
  }
});
function finishDrag(cancel=false){
  if(!drag)return;
  const ended=drag;drag=null;
  if(ended.type==='nodes'&&ended.remembered)markDirty();
  if(ended.type==='marquee'&&cancel){selected=ended.before;refreshSelection();}
  $('#selection-box').hidden=true;$('#canvas').classList.remove('panning');
  if(ended.pointerID!==undefined)try{$('#canvas').releasePointerCapture(ended.pointerID);}catch{}
  updateHeader();
}
window.addEventListener('pointerup',e=>{
  if(connecting&&(connecting.pointerID===undefined||e.pointerId===connecting.pointerID)){
    const el=e.target.closest?.('.port'),node=el?.closest('.node');
    const exact=node?{node:node.dataset.node,port:el.dataset.port,direction:el.dataset.direction}:null;
    const candidate=exact&&validCandidate(exact)?exact:nearestPort(e.clientX,e.clientY);
    if(candidate)completeConnection(candidate);
    else if(connecting.edgeID||connecting.moved)clearConnection();
    else{const id=connecting.pointerID;connecting.held=false;connecting.pointerID=undefined;if(id!==undefined)try{$('#canvas').releasePointerCapture(id);}catch{}}
  }
  if(drag&&(drag.pointerID===undefined||e.pointerId===drag.pointerID))finishDrag();});
window.addEventListener('pointercancel',()=>{finishDrag(true);clearConnection();});
$('#canvas').addEventListener('lostpointercapture',()=>{finishDrag(true);if(connecting?.held)clearConnection();});
window.addEventListener('blur',()=>{spacePressed=false;$('#canvas').classList.remove('pan-ready');finishDrag(true);clearConnection();});
window.addEventListener('keyup',e=>{if(e.code==='Space'){spacePressed=false;$('#canvas').classList.remove('pan-ready');}});
$('#canvas').addEventListener('wheel',e=>{e.preventDefault();if(drag||connecting)return;if(e.ctrlKey||e.metaKey)zoomBy(Math.exp(-e.deltaY*.012),e.clientX,e.clientY);else{view.x-=e.deltaX;view.y-=e.deltaY;transform();}},{passive:false});
$('#canvas').addEventListener('dragover',e=>{e.preventDefault();$('#canvas').classList.add('drag-over');});
$('#canvas').addEventListener('dragleave',()=>$('#canvas').classList.remove('drag-over'));
$('#canvas').addEventListener('drop',safe(async e=>{e.preventDefault();$('#canvas').classList.remove('drag-over');const text=e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain');if(text&&/^https?:\/\//.test(text))await addPaths([text.trim()],canvasPoint(e.clientX,e.clientY));}));
host.on('drop',safe(async detail=>{const r=$('#canvas').getBoundingClientRect();$('#canvas').classList.remove('drag-over');if(detail.x<r.left||detail.x>r.right||detail.y<r.top||detail.y>r.bottom){toast('中央のキャンバスにドロップしてください。');return;}await addPaths(detail.paths,canvasPoint(detail.x,detail.y));})).catch(e=>toast(e.message,true));
host.on('error',message=>toast(message,true)).catch(e=>toast(e.message,true));
function undo(){clearConnection(false);if(!undoStack.length)return;redoStack.push(clone(graph));graph=undoStack.pop();selected=null;markDirty();render();}
function redo(){clearConnection(false);if(!redoStack.length)return;undoStack.push(clone(graph));graph=redoStack.pop();selected=null;markDirty();render();}
$('#zoom-in').onclick=()=>zoomBy(1.2);$('#zoom-out').onclick=()=>zoomBy(1/1.2);$('#fit-view').onclick=fit;$('#undo').onclick=undo;$('#redo').onclick=redo;
$('#add-node').onclick=addDialog;$('#empty-add').onclick=safe(chooseNodes);$('#save-project').onclick=safe(()=>save(true));$('#handoff').onclick=safe(()=>handoff());
$('#new-project').onclick=safe(()=>replaceDraft(emptyGraph()));$('#load-example').onclick=safe(()=>replaceDraft(exampleGraph()));
$('#project-settings').onclick=()=>{selected=null;render();};$('#reveal-project').onclick=safe(()=>call('reveal'));
$('#open-project').onclick=safe(async()=>{document.activeElement?.blur();if(dirty){if(root){if(!await save(true))return;}else if(!await confirmChoice('未保存のグラフを破棄して別のプロジェクトを開きます。'))return;}const state=await call('openProject');if(state){clearTimeout(saveTimer);cleanState(state);fit();}});
$('#reload-project').onclick=safe(async()=>{if(dirty&&!await confirmChoice('未保存の編集を破棄して、ディスクのグラフを読み込みます。必要なら先に JSON 書き出しで退避してください。'))return;clearTimeout(saveTimer);cleanState(await call('reload'));fit();});
$('#export-draft').onclick=safe(()=>call('exportJSON',{graph}));
$('#appearance-settings').onclick=appearanceSettings;
$('#show-help').onclick=()=>modal(`<h2>ヘルプ</h2><p>Shift＋クリック：追加選択 / 解除<br>選択した線の接点をドラッグ：付け替え<br>ポートの近くで離す：吸着して接続<br>空白をドラッグ：四角で囲ったノードを選択<br>Shift＋範囲選択：選択に追加<br>Space＋ドラッグ / 中ボタンドラッグ：画面を移動<br>Delete：選択したノード・接続を削除</p><p>① フォルダを配置し、右の出力から左の入力へ線を引きます。<br>② 線を選んで、つなぎたい内容を記入します。<br>③ 保存して「エージェントに渡す」を押します。<br>④ コピーした依頼文を、ローカルファイルにアクセスできる ChatGPT / Codex / Claude Code のチャットへ貼り付けます。</p><pre>graph.json                  設計の正本\nAGENT_BRIEF.md              エージェントへの指示\nconnections/&lt;id&gt;/SPEC.md    接続ごとの仕様\nimplementations/&lt;id&gt;/       生成コードの保存先\nreports/&lt;id&gt;.json          実装・検証の報告\ngraph.mmd                   Mermaid のグラフ</pre><p>保存済みプロジェクトの編集は自動保存されます。エージェントのレポートは約2秒ごとに読み込みます。元のリポジトリの更新は自動検知しないため、コードを変えた際は再検証を依頼してください。</p><div class="modal-actions"><button class="primary">わかりました</button></div>`);
window.addEventListener('keydown',e=>{
  const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'');
  if(e.key==='Escape'){finishDrag(true);clearConnection();}
  if(e.code==='Space'&&!typing&&!$('#modal').open){e.preventDefault();spacePressed=true;$('#canvas').classList.add('pan-ready');}
  if(e.metaKey&&e.key.toLowerCase()==='s'){e.preventDefault();document.activeElement?.blur();safe(()=>save(true))();}
  if(e.metaKey&&e.key.toLowerCase()==='o'){e.preventDefault();$('#open-project').click();}
  if(!typing&&!$('#modal').open&&!drag&&!connecting){if(e.metaKey&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}if(['Backspace','Delete'].includes(e.key)){e.preventDefault();safe(deleteSelected)();}if(e.key.toLowerCase()==='f')fit();}
});
window.gacchanko={call,get graph(){return graph;},get root(){return root;},get reports(){return reports;},makeNode,mutate,createConnection,select,save,poll,cleanState,fit,render,exampleGraph,addPaths,undo,redo,status,replaceDraft};
async function init(){render();if(native){const state=await call('state');if(state.project){cleanState(state);fit();}else{try{const backup=JSON.parse(localStorage.getItem('gacchanko-draft')||localStorage.getItem('patchwork-draft')||'null');if(backup?.graph&&await confirmChoice('前回の未保存の編集を復元しますか？')){graph=backup.graph;root='';revision='';markDirty();render();fit();}}catch(e){toast(e.message,true);}}}setInterval(poll,2000);}
window.gacchankoReady=init().catch(e=>toast(e.message,true));
