'use strict';
// JSON-level operations shared by UI controls, variants, and change overlays.
window.gacchankoDesign = (() => {
  const copy = value => JSON.parse(JSON.stringify(value));
  const canonical = value => JSON.stringify(value, function(key, item) {
    return item && !Array.isArray(item) && typeof item==='object' ? Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])) : item;
  });
  const locked = item => ['immutable','template'].includes(item?.policy);
  const definition = item => { if(!item)return null;const result=copy(item);delete result.x;delete result.y;delete result.appearance;return result; };
  function violations(before,after) {
    const result=[];
    for(const n of before.nodes.filter(locked)) {
      if(canonical(definition(n))!==canonical(definition(after.nodes.find(v=>v.id===n.id))))result.push('node:'+n.id);
      for(const e of before.edges.filter(e=>e.source===n.id||e.target===n.id)){
        const next=after.edges.find(v=>v.id===e.id);
        if(!next||['source','target','sourcePort','targetPort'].some(k=>next[k]!==e[k]))result.push('wiring:'+n.id+'/'+e.id);
      }
    }
    for(const e of before.edges.filter(locked))if(canonical(e)!==canonical(after.edges.find(v=>v.id===e.id)))result.push('edge:'+e.id);
    for(const t of before.templates||[])if(canonical(t)!==canonical(after.templates?.find(v=>v.id===t.id&&v.version===t.version)))result.push('template:'+t.id);
    return result;
  }
  function changes(before,after) {
    const result=[];
    for(const [kind,key] of [['node','nodes'],['edge','edges'],['template','templates']]){
      const identity=v=>kind==='template'?v.id+':'+v.version:v.id;
      const a=new Map((before?.[key]||[]).map(v=>[identity(v),v])),b=new Map((after[key]||[]).map(v=>[identity(v),v]));
      for(const id of new Set([...a.keys(),...b.keys()])){
        const left=a.get(id),right=b.get(id);if(canonical(left)===canonical(right))continue;
        const fields=[...new Set([...Object.keys(left||{}),...Object.keys(right||{})])].filter(k=>canonical(left?.[k])!==canonical(right?.[k]));
        result.push({kind,id,name:right?.name||right?.label||left?.name||left?.label||id,change:!left?'added':!right?'removed':'modified',fields,before:left||null,after:right||null});
      }
    }
    return result;
  }
  function capture(graph,ids,{id,name,instructions,version=1}){
    const members=new Set(ids);
    const clean=item=>{const value=copy(item);value.policy='mutable';delete value.derivedFrom;return value;};
    const nodes=graph.nodes.filter(n=>members.has(n.id)).map(clean);
    if(!nodes.length)throw Error('原型にするノードを選択してください。');
    return {id,version,name,instructions,nodes,edges:graph.edges.filter(e=>members.has(e.source)&&members.has(e.target)).map(clean)};
  }
  function instantiate(template,newID,offset={x:60,y:60}){
    const ids=new Map(template.nodes.map(n=>[n.id,newID('node')]));
    const derive=(item,kind)=>({...copy(item),id:kind==='node'?ids.get(item.id):newID('edge'),policy:'mutable',derivedFrom:{templateID:template.id,version:template.version,memberID:item.id}});
    return {nodes:template.nodes.map(n=>({...derive(n,'node'),x:n.x+offset.x,y:n.y+offset.y})),edges:template.edges.map(e=>({...derive(e,'edge'),source:ids.get(e.source),target:ids.get(e.target)}))};
  }
  return Object.freeze({locked,violations,changes,capture,instantiate});
})();
