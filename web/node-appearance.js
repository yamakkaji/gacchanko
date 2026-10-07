'use strict';
window.gacchankoNodeAppearance=(()=>{
  const presets=[['Slate','#4a6282'],['Plum','#715669'],['Sage','#416762'],['Platinum','#5d5f62'],['Cyan','#00677f'],['Amber','#b26a00'],['Iris','#5256a9']];
  const kindColors={repository:'#304867',directory:'#304867',model:'#715669',service:'#294f4a',application:'#80602d',note:'#715669'};
  function normalize(raw={},kind='directory'){
    raw=raw||{};
    return {color:/^#[0-9a-f]{6}$/i.test(raw.color)?raw.color.toLowerCase():kindColors[kind]||'#4a6282',radius:Number.isFinite(raw.radius)?Math.max(0,Math.min(28,raw.radius)):8,corners:raw.corners==='alternating'?'alternating':'uniform',surface:['filled','outlined','elevated'].includes(raw.surface)?raw.surface:'elevated',header:raw.header==='plain'?'plain':'striped'};
  }
  const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  const hex=values=>'#'+values.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  const mix=(a,b,t)=>hex(rgb(a).map((v,i)=>v*(1-t)+rgb(b)[i]*t));
  const luminance=color=>rgb(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  function tokens(raw,kind){
    const a=normalize(raw,kind),container=a.color,body=a.surface==='outlined'?'#ffffff':a.color;
    const readable=background=>contrast('#ffffff',background)>contrast('#000000',background)?'#ffffff':'#000000';
    const ink=readable(container),bodyInk=readable(body);
    const r=a.radius,small=a.corners==='alternating'?Math.min(4,r):r;
    return {accent:ink,container,body,onContainer:ink,bodyInk,outline:mix(a.color,'#ffffff',.35),radii:[r,small,r,small]};
  }
  function style(raw,kind){const t=tokens(raw,kind);return `--accent:${t.accent};--node-container:${t.container};--node-body:${t.body};--node-body-ink:${t.bodyInk};--node-on-container:${t.onContainer};--node-outline:${t.outline};--node-tl:${t.radii[0]}px;--node-tr:${t.radii[1]}px;--node-br:${t.radii[2]}px;--node-bl:${t.radii[3]}px;`;}
  return Object.freeze({presets,normalize,tokens,style,contrast});
})();
