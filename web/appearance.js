'use strict';
// App-local appearance preferences and SVG rendering, independent of the host.
window.gacchankoAppearance=(()=>{
  const key='gacchanko-edge-appearance-v1';
  const defaults=Object.freeze({style:'gradient',source:'#56c8ff',target:'#ffa66b',patternColour:'#f5f7ff',pattern:'chevrons',width:3,spacing:55,size:6,arrows:true});
  function normalize(value){
    const v=value&&typeof value==='object'?value:{};
    const colour=(name)=>/^#[0-9a-f]{6}$/i.test(v[name])?v[name]:defaults[name];
    const number=(name,min,max)=>typeof v[name]==='number'&&Number.isFinite(v[name])?Math.max(min,Math.min(max,v[name])):defaults[name];
    return {style:['gradient','pattern','both','solid'].includes(v.style)?v.style:defaults.style,
      source:colour('source'),target:colour('target'),patternColour:colour('patternColour'),
      pattern:['chevrons','taper'].includes(v.pattern)?v.pattern:defaults.pattern,
      width:number('width',1,8),spacing:number('spacing',20,120),size:number('size',3,12),
      arrows:typeof v.arrows==='boolean'?v.arrows:defaults.arrows};
  }
  function load(){try{return normalize(JSON.parse(localStorage.getItem(key)));}catch{return {...defaults};}}
  function save(value){const next=normalize(value);localStorage.setItem(key,JSON.stringify(next));return next;}
  function geometry(a,b){
    const bend=Math.max(70,Math.abs(b.x-a.x)*.5);
    const point=t=>{const u=1-t;return{x:u*u*u*a.x+3*u*u*t*(a.x+bend)+3*u*t*t*(b.x-bend)+t*t*t*b.x,y:u*u*u*a.y+3*u*u*t*a.y+3*u*t*t*b.y+t*t*t*b.y};};
    const tangent=t=>{const u=1-t;return{x:3*u*u*bend+6*u*t*(b.x-a.x-2*bend)+3*t*t*bend,y:6*u*t*(b.y-a.y)};};
    const samples=[];let length=0,previous=a;
    for(let i=0;i<=64;i++){const p=point(i/64);length+=Math.hypot(p.x-previous.x,p.y-previous.y);samples.push({...p,t:i/64,length});previous=p;}
    function at(distance){
      distance=Math.max(0,Math.min(length,distance));
      const hi=Math.max(1,samples.findIndex(p=>p.length>=distance)),right=samples[hi],left=samples[hi-1];
      const t=left.t+(right.t-left.t)*(distance-left.length)/(right.length-left.length||1),d=tangent(t);
      return {...point(t),angle:Math.atan2(d.y,d.x)*180/Math.PI};
    }
    return {point,tangent,samples,length,at};
  }
  function mix(a,b,t){return '#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');}
  function render(a,b,{settings,zoom=1,id='preview',statusColour='#a8a2d6',request=false,selected=false}){
    const s=normalize(settings),g=geometry(a,b),gradient=['gradient','both'].includes(s.style),pattern=['pattern','both'].includes(s.style);
    const bend=Math.max(70,Math.abs(b.x-a.x)*.5),d=`M ${a.x} ${a.y} C ${a.x+bend} ${a.y}, ${b.x-bend} ${b.y}, ${b.x} ${b.y}`;
    const colour=s.style==='solid'?statusColour:s.source;
    let svg=selected?`<path class="edge-selection" d="${d}" stroke-width="${(s.width+6)/zoom}"/>`:'';
    svg+=`<path class="edge-line" d="${d}" style="stroke:${colour};stroke-width:${s.width/zoom};vector-effect:none"/>`;
    if(gradient&&g.length>0){
      // Each subcurve gets an arc-length colour range. Loops and reverse edges
      // therefore keep progressing from source colour to target colour.
      for(let i=0;i<16;i++){
        const t0=i/16,t1=(i+1)/16,p=g.point(t0),q=g.point(t1),dp=g.tangent(t0),dq=g.tangent(t1),dt=(t1-t0)/3;
        const c0=mix(s.source,s.target,g.samples[i*4].length/g.length),c1=mix(s.source,s.target,g.samples[(i+1)*4].length/g.length),gid=`${id}-gradient-${i}`;
        svg+=`<defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs><path class="edge-gradient-segment" d="M ${p.x} ${p.y} C ${p.x+dp.x*dt} ${p.y+dp.y*dt}, ${q.x-dq.x*dt} ${q.y-dq.y*dt}, ${q.x} ${q.y}" stroke="url(#${gid})" stroke-width="${s.width/zoom}"/>`;
      }
    }
    if(pattern&&g.length*zoom>24){
      const count=Math.min(300,Math.max(1,Math.floor((g.length*zoom-24)/s.spacing)));
      for(let i=0;i<count;i++){
        const p=g.at(g.length*(i+1)/(count+1)),n=s.size;
        const shape=s.pattern==='chevrons'?`<path d="M ${-n*.7} ${-n} L ${n*.45} 0 L ${-n*.7} ${n}" fill="none" stroke="${s.patternColour}" stroke-width="${Math.max(1.5,s.width*.65)}"/>`:`<path d="M ${-n*1.3} ${-n*.55} L ${n} 0 L ${-n*1.3} ${n*.55} Z" fill="${s.patternColour}"/>`;
        svg+=`<g class="edge-pattern" transform="translate(${p.x} ${p.y}) rotate(${p.angle}) scale(${1/zoom})">${shape}</g>`;
      }
    }
    if(s.arrows){
      const distances=[Math.max(g.length*.6,g.length-22/zoom)];
      if(g.length*zoom>280&&!pattern)distances.unshift(g.length*.25);
      for(const distance of distances){const p=g.at(distance);svg+=`<path class="edge-direction" style="fill:${gradient?mix(s.source,s.target,distance/(g.length||1)):colour}" d="M -11 -5 L 0 0 L -11 5 L -8 0 Z" transform="translate(${p.x} ${p.y}) rotate(${p.angle}) scale(${1/zoom})"/>`;}
    }
    // Request/response remains explicit even when the optional forward arrows are off.
    if(request){const p=g.at(12/zoom);svg+=`<path class="edge-return" d="M -8 -4 L 0 0 L -8 4" fill="none" stroke="${colour}" stroke-width="2" transform="translate(${p.x} ${p.y}) rotate(${p.angle+180}) scale(${1/zoom})"/>`;}
    return svg;
  }
  return Object.freeze({defaults,normalize,load,save,render});
})();
