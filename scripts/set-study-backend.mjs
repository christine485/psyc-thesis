// Run only after staging, data migration and Hong Kong participant acceptance.
// This prepares a reviewed Git change; it does not deploy or migrate any data.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {PROTOCOL, STIMULI} from '../docs/modules/protocol.mjs';

const args=process.argv.slice(2);
const index=args.indexOf('--api-base');
if(index<0 || !args[index+1] || args.some((x,i)=>i!==index&&i!==index+1&&x!=='--dry-run')){
  throw Error('Usage: node scripts/set-study-backend.mjs --api-base https://YOUR-WORKER.workers.dev [--dry-run]');
}
const url=new URL(args[index+1]);
if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.hostname.endsWith('.chatgpt.site')){
  throw Error('Provide the independent HTTPS API origin only, without a path, credentials or query.');
}
const response=await fetch(new URL('/api/health',url),{
  headers:{Origin:'https://christine485.github.io'},
  signal:AbortSignal.timeout(15000),redirect:'error'
});
if(!response.ok)throw Error('Backend health check failed: HTTP '+response.status);
const health=await response.json();
if(health.ok!==true||health.protocol!==PROTOCOL||health.images!==STIMULI.length||health.configurationReady!==true||health.storageReady!==true||health.stagingOnly===true){
  throw Error('Backend protocol, secrets or storage is not ready. No files were changed.');
}
if(response.headers.get('access-control-allow-origin')!=='https://christine485.github.io'){
  throw Error('Backend does not allow the GitHub Pages origin. No files were changed.');
}
for(const stimulus of STIMULI){
  const data=await fs.readFile(new URL('../docs/stimuli/'+stimulus.file,import.meta.url));
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',data)).toString('hex');
  if(digest!==stimulus.sha256)throw Error('Local stimulus checksum mismatch: '+stimulus.file);
}
if(args.includes('--dry-run')){
  console.log('Health, CORS and all 270 local PNG checks passed; no files changed. Hong Kong end-to-end acceptance and migration still require separate verification.');
}else{
  const config=new URL('../docs/config.js',import.meta.url);
  await fs.writeFile(config,`// Independent backend. Secrets must never be added to this file.\nexport const API_BASE=${JSON.stringify(url.origin)};\nexport const STIMULUS_BASE=new URL('./stimuli/',import.meta.url).href;\n`);
  const version='backend-'+Date.now();
  const appPath=new URL('../docs/app.js',import.meta.url);
  const app=await fs.readFile(appPath,'utf8');
  await fs.writeFile(appPath,app.replace(/from '\.\/config\.js(?:\?[^']*)?'/,"from './config.js?v="+version+"'"));
  const htmlPath=new URL('../docs/index.html',import.meta.url);
  const html=await fs.readFile(htmlPath,'utf8');
  await fs.writeFile(htmlPath,html.replace(/src="\.\/app\.js(?:\?[^"]*)?"/,'src="./app.js?v='+version+'"'));
  console.log('Prepared '+fileURLToPath(config)+' for '+url.origin+'. Review and publish only after the migration and Hong Kong acceptance checklist.');
}
