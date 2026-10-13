// Run the GUI scenarios against a real Tauri WebView and
// Rust store. All projects are temporary and the WebView is incognito.
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const build=spawnSync('cargo',['build','--manifest-path','src-tauri/Cargo.toml','--bin','gacchanko'],{cwd:root,stdio:'inherit'});
if(build.error){console.error(build.error.message);process.exit(1);}
if(build.status!==0)process.exit(build.status||1);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gacchanko-native-'));
const result=path.join(dir,'result.json');
const exe=path.join(root,'src-tauri/target/debug/gacchanko'+(process.platform==='win32'?'.exe':''));
console.log('Automatic GUI test. Results: '+result);
const child=spawn(exe,['--ui-test',result],{cwd:root,stdio:'inherit'});
let timedOut=false;
const timer=setTimeout(()=>{timedOut=true;console.error('GUI test timed out. Inspect '+dir);child.kill();},180000);
child.on('error',error=>{clearTimeout(timer);console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{
 clearTimeout(timer);
 if(timedOut||!fs.existsSync(result)){console.error('No completed GUI test result. '+dir);process.exitCode=1;return;}
 const report=JSON.parse(fs.readFileSync(result,'utf8'));
 for(const check of report.checks||[])console.log('PASS '+check);
 if(report.ok&&code===0){console.log(`PASS ${(report.checks||[]).length} native GUI checks`);}else{console.error(report.error||'Native test failed');process.exitCode=1;}
 console.log('Report: '+result);
});
