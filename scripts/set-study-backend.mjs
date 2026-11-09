// Prepares a reviewed frontend change after the formal backend is ready.
// Does not deploy resources, migrate data or submit a questionnaire.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PROTOCOL,STIMULI} from '../docs/modules/protocol.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const FORMAL_ORIGIN='https://psyc-thesis-api.christine040805.workers.dev';
const WEBSITE_ORIGIN='https://christine485.github.io';
const FILES=['docs/config.js','docs/app.js','docs/index.html','docs/researcher.js','docs/researcher.html'];
function formalOrigin(value){
 let url;try{url=new URL(value);}catch{throw Error('Provide the approved formal HTTPS API origin only.');}
 if(url.origin!==FORMAL_ORIGIN||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Provide the approved formal HTTPS API origin only, without credentials, a path or a query.');
 return url.origin;
}
function replaceOne(source,expression,replacement,label){
 if([...source.matchAll(expression)].length!==1)throw Error('Expected exactly one '+label+'. No frontend files were changed.');
 return source.replace(expression,replacement);
}
function permission(response,method,header){
 const values=name=>(response.headers.get(name)||'').split(',').map(value=>value.trim().toLowerCase());
 return response.status===204&&response.headers.get('Access-Control-Allow-Origin')===WEBSITE_ORIGIN&&!response.headers.get('Access-Control-Allow-Credentials')&&values('Access-Control-Allow-Methods').includes(method.toLowerCase())&&values('Access-Control-Allow-Headers').includes(header.toLowerCase());
}
export async function prepareBackendCutover({apiBase,root=ROOT,fetchImpl=fetch,dryRun=false,version='backend-'+Date.now()}={}){
 const origin=formalOrigin(apiBase);
 if(typeof version!=='string'||!/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(version))throw Error('Use a simple cache version without URL or source-code characters.');
 async function request(route,options={}){
  try{return await fetchImpl(origin+route,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(15000),...options});}
  catch{throw Error('The formal backend verification request failed. No frontend files were changed.');}
 }
 const healthResponse=await request('/api/health',{headers:{Origin:WEBSITE_ORIGIN}});
 if(!healthResponse.ok)throw Error('The formal backend health check failed. No frontend files were changed.');
 let health;try{health=await healthResponse.json();}catch{throw Error('The formal backend returned invalid health data. No frontend files were changed.');}
 if(health?.ok!==true||health.protocol!==PROTOCOL||health.images!==STIMULI.length||health.configurationReady!==true||health.storageReady!==true||health.stagingOnly!==false||health.maintenance!==false)throw Error('The formal backend protocol, storage or live state is not ready. No frontend files were changed.');
 if(healthResponse.headers.get('Access-Control-Allow-Origin')!==WEBSITE_ORIGIN||healthResponse.headers.get('Access-Control-Allow-Credentials'))throw Error('The formal backend does not allow the exact website origin safely. No frontend files were changed.');
 const participant=await request('/api/study/start',{method:'OPTIONS',headers:{Origin:WEBSITE_ORIGIN,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type'}});
 if(!permission(participant,'POST','Content-Type'))throw Error('The formal participant CORS preflight failed. No frontend files were changed.');
 const researcher=await request('/api/admin/status',{method:'OPTIONS',headers:{Origin:WEBSITE_ORIGIN,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization'}});
 if(!permission(researcher,'GET','Authorization'))throw Error('The formal researcher CORS preflight failed. No frontend files were changed.');
 const originals=new Map(await Promise.all(FILES.map(async file=>[file,await fs.readFile(path.join(root,file),'utf8')])));
 const updates=new Map([
  ['docs/config.js',`// Independent backend. Secrets must never be added to this file.\nexport const API_BASE=${JSON.stringify(origin)};\nexport const STIMULUS_BASE=new URL('./stimuli/',import.meta.url).href;\n`],
  ['docs/app.js',replaceOne(originals.get('docs/app.js'),/from (['"])\.\/config\.js(?:\?[^'"]*)?\1/g,"from './config.js?v="+version+"'",'participant config import')],
  ['docs/index.html',replaceOne(originals.get('docs/index.html'),/src=(["'])\.\/app\.js(?:\?[^"']*)?\1/g,'src="./app.js?v='+version+'"','participant script')],
  ['docs/researcher.js',replaceOne(originals.get('docs/researcher.js'),/from (['"])\.\/config\.js(?:\?[^'"]*)?\1/g,"from './config.js?v="+version+"'",'researcher config import')],
  ['docs/researcher.html',replaceOne(originals.get('docs/researcher.html'),/src=(["'])\.\/researcher\.js(?:\?[^"']*)?\1/g,'src="./researcher.js?v='+version+'"','researcher script')]
 ]);
 // Check every template and original stimulus before writing any source file.
 for(const stimulus of STIMULI){
  const bytes=await fs.readFile(path.join(root,'docs/stimuli',stimulus.file));
  if(createHash('sha256').update(bytes).digest('hex')!==stimulus.sha256)throw Error('Local stimulus checksum mismatch: '+stimulus.file+'. No frontend files were changed.');
 }
 const changes=FILES.filter(file=>originals.get(file)!==updates.get(file));
 if(!dryRun){
  const written=[];
  try{for(const file of changes){written.push(file);await fs.writeFile(path.join(root,file),updates.get(file));}}
  catch{
   let restored=true;for(const file of written)try{await fs.writeFile(path.join(root,file),originals.get(file));}catch{restored=false;}
   throw Error(restored?'Could not save the frontend update; previously written files were restored.':'Could not save or fully restore the frontend update. Inspect the working tree before publishing.');
  }
 }
 return {origin,dryRun,changes,imagesVerified:STIMULI.length};
}
export function parseArguments(args){
 const values=[...args];let apiBase,dryRun=false;
 while(values.length){const value=values.shift();if(value==='--api-base'&&apiBase===undefined&&values[0]&&!values[0].startsWith('--'))apiBase=values.shift();else if(value==='--dry-run'&&!dryRun)dryRun=true;else throw Error('Usage: node scripts/set-study-backend.mjs --api-base FORMAL_HTTPS_ORIGIN [--dry-run]');}
 if(apiBase===undefined)throw Error('Usage: node scripts/set-study-backend.mjs --api-base FORMAL_HTTPS_ORIGIN [--dry-run]');
 return {apiBase,dryRun};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 prepareBackendCutover(parseArguments(process.argv.slice(2))).then(result=>{
  console.log(result.dryRun?'Formal health, both website CORS preflights, frontend templates and all 270 PNG checks passed; no files changed.':'Prepared the frontend and researcher cache versions for '+result.origin+'. Review and publish the Git change before Hong Kong end-to-end acceptance.');
 }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
