// Run with the same jsdom development dependency as dom-test.cjs.
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const code=fs.readFileSync(path.join(__dirname,'../web/appearance.js'),'utf8');
const make=()=>{const dom=new JSDOM('<svg id="edge"></svg>',{url:'https://gacchanko.local/',runScripts:'outside-only'});dom.window.eval(code);return dom;};
const first=make(),api=first.window.gacchankoAppearance;
const chosen={...api.defaults,style:'both',source:'#102030',target:'#e0d0c0',width:7,spacing:30,arrows:false};
api.save(chosen);
const second=make(),key='gacchanko-edge-appearance-v1';
second.window.localStorage.setItem(key,first.window.localStorage.getItem(key));
const loaded=second.window.gacchankoAppearance.load();
assert.equal(JSON.stringify(loaded),JSON.stringify(chosen));
console.log('PASS persisted appearance restores in a fresh JavaScript context');
second.window.localStorage.setItem(key,'{broken');
assert.equal(JSON.stringify(second.window.gacchankoAppearance.load()),JSON.stringify(api.defaults));
console.log('PASS damaged saved preferences fall back to defaults');
const invalid=api.normalize({width:500,spacing:-2,source:'red"/>',style:'invalid',arrows:'false',size:NaN});
assert.equal(invalid.width,8);assert.equal(invalid.spacing,20);assert.equal(invalid.source,api.defaults.source);assert.equal(invalid.style,api.defaults.style);assert.equal(invalid.arrows,true);assert.equal(invalid.size,6);
console.log('PASS invalid preferences are bounded and safe for SVG attributes');
const svg=first.window.document.querySelector('svg');
for(const [name,a,b]of [
  ['forward',{x:0,y:0},{x:500,y:0}],
  ['reverse',{x:500,y:0},{x:0,y:0}],
  ['vertical',{x:0,y:0},{x:0,y:500}],
  ['loop',{x:224,y:100},{x:0,y:100}],
  ['coincident',{x:0,y:0},{x:0,y:0}]
]){
  svg.innerHTML=api.render(a,b,{settings:chosen,id:'geometry-test',zoom:.25});
  assert(!/NaN|Infinity/.test(svg.innerHTML));
  const gradients=[...svg.querySelectorAll('linearGradient')];
  assert.equal(gradients[0].firstChild.getAttribute('stop-color'),chosen.source);
  assert.equal(gradients.at(-1).lastChild.getAttribute('stop-color'),chosen.target);
  // Colours progress by travelled distance even when x or y reverses.
  let previous=-1;
  for(const stop of svg.querySelectorAll('stop')){const red=parseInt(stop.getAttribute('stop-color').slice(1,3),16);assert(red>=previous);previous=red;}
  assert.equal(svg.querySelector('.edge-gradient-segment').getAttribute('stroke-width'),'28');
  console.log(`PASS ${name} edge preserves endpoint colours, colour order and zoomed line width`);
}
for(const [sourceY,targetY] of [[99,99],[99,153],[180,99]]){
 const a={x:224,y:sourceY},b={x:0,y:targetY},route={loopBottom:284};
 const g=api.geometry(a,b,route);
 assert.equal(JSON.stringify(g.point(0)),JSON.stringify(a));assert.equal(JSON.stringify(g.point(1)),JSON.stringify(b));
 assert(g.samples.every(p=>p.x<=0||p.x>=224||p.y>200),'self-loop stays outside node body');
 assert(g.tangent(0).x>0&&g.tangent(1).x>0,'self-loop leaves output and approaches input in correct directions');
 for(const zoom of [.25,1,2.5]){
  svg.innerHTML=api.render(a,b,{...route,settings:chosen,zoom,id:'self-loop',selected:true});
  assert.equal(svg.querySelector('.edge-line').getAttribute('d'),g.d);
  assert.equal(svg.querySelector('.edge-selection').getAttribute('d'),g.d);
  assert(!/NaN|Infinity/.test(svg.innerHTML));assert.equal(svg.querySelectorAll('.edge-gradient-segment').length,64);
  assert.equal(svg.querySelector('stop').getAttribute('stop-color'),chosen.source);
  assert.equal([...svg.querySelectorAll('stop')].at(-1).getAttribute('stop-color'),chosen.target);
 }
 console.log('PASS self-loop routes outside node for ports '+sourceY+' → '+targetY+' and all zoom levels');
}
for(const [a,b,axis,sign] of [
 [{x:0,y:0},{x:500,y:0},'y',-1],
 [{x:500,y:0},{x:0,y:0},'y',1],
 [{x:0,y:500},{x:0,y:0},'x',-1],
 [{x:0,y:0},{x:0,y:500},'x',1],
 [{x:0,y:140},{x:500,y:0},'y',-1],
 [{x:500,y:0},{x:0,y:140},'y',1]
]){
 const g=api.geometry(a,b),mid=g.point(.5),baseline=(a[axis]+b[axis])/2;
 assert((mid[axis]-baseline)*sign>0,'bell bulges on the correct side of the chord');
 assert.equal(JSON.stringify(g.point(0)),JSON.stringify(a));
 assert.equal(JSON.stringify(g.point(1)),JSON.stringify(b));
 console.log('PASS directional bell '+JSON.stringify(a)+' → '+JSON.stringify(b));
}
first.window.close();second.window.close();
