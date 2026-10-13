const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const calls=[],listeners=new Map();
const w={__TAURI__:{core:{invoke:async(command,args)=>{calls.push({command,args});return {project:null};}},event:{listen:async(event,fn)=>{listeners.set(event,fn);return ()=>listeners.delete(event);}}}};
const context=vm.createContext({window:w,console,localStorage:{getItem:()=> 'en'}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/tauri.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/bridge.js'),'utf8'),context);
(async()=>{
 assert.equal(w.gacchankoHost.platform,'tauri');assert.equal(calls[0].args.args.language,'en');
 await w.gacchankoHost.request('save',{revision:'expected'});assert.equal(calls.at(-1).args.args.revision,'expected');
 let received;const off=await w.gacchankoHost.on('drop',v=>received=v);
 listeners.get('gacchanko://drop')({payload:{paths:['C:\\project'],x:20,y:40}});
 assert.equal(received.paths[0],'C:\\project');assert.equal(received.x,20);off();assert(!listeners.has('gacchanko://drop'));
 w.__TAURI__.core.invoke=async()=>{throw 'native error';};await assert.rejects(w.gacchankoHost.request('save'),/native error/);
 console.log('PASS Tauri bridge request, error normalization, language, drop events and cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
