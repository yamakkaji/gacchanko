// Development-only test. Requires jsdom 26.1.0; no runtime dependencies for the app.
const {JSDOM}=require('jsdom'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gacchanko-dom-'));
const html=fs.readFileSync(path.join(base,'web/index.html'),'utf8');
const dom=new JSDOM(html,{url:'https://gacchanko.local/',runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window;w.PointerEvent=w.MouseEvent;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
w.HTMLElement.prototype.getBoundingClientRect=function(){return this.id==='canvas'?{x:226,y:142,left:226,top:142,right:1126,bottom:842,width:900,height:700}:{left:0,top:0,width:224,height:138};};
let graph=null,revision='',reports={};
const hash=g=>crypto.createHash('sha256').update(JSON.stringify(g)).digest('hex');
const fingerprint=(edge,g)=>hash({edge,nodes:g.nodes.filter(n=>[edge.source,edge.target].includes(n.id)).map(({x,y,...rest})=>rest),description:g.description});
const state=()=>JSON.parse(JSON.stringify({project:graph,root:dir+'.gacchanko',revision,reports:graph?Object.fromEntries(graph.edges.filter(e=>reports[e.id]).map(e=>[e.id,{...reports[e.id],status:reports[e.id].fingerprint===fingerprint(e,graph)?reports[e.id].status:'stale'}])):{}}));
let finish;const result=new Promise(r=>finish=r);
w.webkit={messageHandlers:{gacchanko:{postMessage:async({id,command,args})=>{
 try{let value;
 switch(command){
 case 'state':value={project:null};break;
 case 'dirty':value=true;break;
 case 'testCreate':case 'save':
  if(command==='save'&&args.revision!==revision)throw Error('revision conflict');graph=JSON.parse(JSON.stringify(args.graph));revision=hash(graph);fs.writeFileSync(path.join(dir,'graph.json'),JSON.stringify(graph));value=state();break;
 case 'reload':graph=JSON.parse(fs.readFileSync(path.join(dir,'graph.json')));value=state();break;
 case 'poll':value=state();break;
 case 'testReport':{const e=graph.edges[0];reports[e.id]={fingerprint:fingerprint(e,graph),status:'verified',summary:'Test report',files:[],checks:['Mock bridge fixture']};value=true;break;}
 case 'copyPrompt':value=path.join(dir,'AGENT_BRIEF.md')+' '+args.edgeID;break;
 case 'inspect':value={path:args.path,name:path.basename(args.path),kind:'directory',description:'Local directory',files:[]};break;
 case 'testFinish':finish(args);return;
 default:throw Error('Unexpected command '+command);
 }
 queueMicrotask(()=>w.dispatchEvent(new w.CustomEvent('nativeReply',{detail:{id,value}})));
 }catch(error){queueMicrotask(()=>w.dispatchEvent(new w.CustomEvent('nativeReply',{detail:{id,error:error.message}})));}
}}}};
w.eval(fs.readFileSync(path.join(base,'web/bridge.js'),'utf8'));
w.eval(fs.readFileSync(path.join(base,'web/appearance.js'),'utf8'));
w.eval(fs.readFileSync(path.join(base,'web/node-appearance.js'),'utf8'));
w.eval(fs.readFileSync(path.join(base,'web/workflow.js'),'utf8'));
w.eval(fs.readFileSync(path.join(base,'web/design.js'),'utf8'));
w.eval(fs.readFileSync(path.join(base,'web/app.js'),'utf8'));
w.eval(fs.readFileSync(path.join(base,'tests/ui-smoke.js'),'utf8'));
const timeout=setTimeout(()=>{console.error('DOM tests timed out');dom.window.close();process.exit(1);},20000);
result.then(r=>{clearTimeout(timeout);console.log(JSON.stringify(r,null,2));fs.writeFileSync(path.join(base,'tests/dom-result.json'),JSON.stringify(r,null,2)+'\n');dom.window.close();fs.rmSync(dir,{recursive:true,force:true});process.exit(r.ok?0:1);});
