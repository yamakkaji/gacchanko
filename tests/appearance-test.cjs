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
first.window.close();second.window.close();
