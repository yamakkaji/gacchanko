'use strict';
window.gacchankoWorkflow=(()=>{
  const states={unspecified:'状態未設定',planned:'構想',existing:'既存実装',verified:'検証済（申告）'};
  const layers={data:'データ',control:'実行制御',event:'イベント'};
  const execution=()=>({dispatch:'sync',join:'all',after:[],maxConcurrency:1,timeoutMs:30000,bufferSize:32,overflow:'block',onError:'stop'});
  function check(graph,edgeID){
    const issues=[],add=(kind,id,field,message)=>issues.push({kind,id,field,message});
    const edges=edgeID?graph.edges.filter(e=>e.id===edgeID):graph.edges;
    const nodes=edgeID?graph.nodes.filter(n=>edges.some(e=>e.source===n.id||e.target===n.id)):graph.nodes;
    if(!graph.description.trim())add('project','project','project-description','全体で実現したいことが未入力');
    if(!edges.length)add('project','project','project-description','実装対象の接続がありません');
    for(const n of nodes){
      if(!n.description.trim()&&!n.designInstructions?.trim())add('node',n.id,'node-description','ノードの役割・意図が未入力');
      if(!n.implementationState||n.implementationState==='unspecified')add('node',n.id,'node-implementation','構想／既存実装の区別が未設定');
      if(['existing','verified'].includes(n.implementationState)&&!n.path.trim())add('node',n.id,'node-path','既存実装の参照先が未設定');
    }
    const adjacency=new Map(graph.nodes.map(n=>[n.id,[]])),reachable=new Map();
    for(const e of graph.edges)adjacency.get(e.source)?.push(e.target);
    function reaches(start,target){if(!reachable.has(start)){const seen=new Set(),queue=[start];while(queue.length){const id=queue.pop();if(seen.has(id))continue;seen.add(id);queue.push(...(adjacency.get(id)||[]));}reachable.set(start,seen);}return reachable.get(start).has(target);}
    for(const e of edges){
      if(!e.intent.trim())add('edge',e.id,'edge-intent','何を渡し、何を実現するかが未入力');
      if(!e.label.trim()||e.label==='新しい接続')add('edge',e.id,'edge-label','接続名を具体的にしてください');
      if(e.execution?.after.some(id=>!graph.edges.some(x=>x.id===id)))add('edge',e.id,'execution-after','削除された接続への完了待ちがあります');
      if(!e.execution)add('edge',e.id,'execution-dispatch','実行順序・同期／非同期の設定が未確認');
      if(e.execution?.dispatch==='async'&&!e.designInstructions?.trim())add('edge',e.id,'design-instructions','非同期のキャンセル・重複・失敗時の扱いを設計指示に記述してください');
      if(reaches(e.target,e.source)&&!e.designInstructions?.trim())add('edge',e.id,'design-instructions','循環があります。反復の開始・終了条件を設計指示に記述してください');
    }
    return issues;
  }
  return Object.freeze({states,layers,execution,check});
})();
