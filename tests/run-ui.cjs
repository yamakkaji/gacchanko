const {spawnSync}=require('node:child_process');
const path=require('node:path');
for (const name of ['appearance','connection','design-ui','dom','language','viewport','tauri-bridge']) {
  const result=spawnSync(process.execPath,[path.join(__dirname,`${name}-test.cjs`)],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status||1);
}
