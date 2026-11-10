import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareBackendCutover,parseArguments} from '../scripts/set-study-backend.mjs';
import {PROTOCOL,STIMULI} from '../docs/modules/protocol.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const ORIGIN='https://psyc-thesis-api.christine040805.workers.dev',WEBSITE='https://christine485.github.io';
const FILES=['docs/config.js','docs/app.js','docs/index.html','docs/researcher.js','docs/researcher.html'];
const HEALTH={ok:true,protocol:PROTOCOL,images:270,configurationReady:true,storageReady:true,stagingOnly:false,maintenance:false};
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'psyc-cutover-test-'));
 await fs.mkdir(path.join(root,'docs'));
 await Promise.all(FILES.map(file=>fs.copyFile(path.join(ROOT,file),path.join(root,file))));
 // Exercise the original migration even after the repository already points
 // at the formal service. This fixture never modifies the actual frontend.
 await fs.writeFile(path.join(root,'docs/config.js'),"export const API_BASE='https://previous-api.example.test';\nexport const STIMULUS_BASE=new URL('./stimuli/',import.meta.url).href;\n");
 await fs.cp(path.join(ROOT,'docs/stimuli'),path.join(root,'docs/stimuli'),{recursive:true});
 return {root,snapshot:async()=>Object.fromEntries(await Promise.all(FILES.map(async file=>[file,await fs.readFile(path.join(root,file),'utf8')]))),close:()=>fs.rm(root,{recursive:true,force:true})};
}
function transport({health=HEALTH,healthStatus=200,healthHeaders={},participant={},researcher={},fail=false}={}){
 const calls=[];
 return {calls,fetchImpl:async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.ok(options.signal);assert.equal(options.headers.Origin,WEBSITE);
  if(fail)throw Error('private-debug-output-must-not-escape');
  if(url===ORIGIN+'/api/health')return Response.json(health,{status:healthStatus,headers:{'Access-Control-Allow-Origin':WEBSITE,...healthHeaders}});
  const admin=url===ORIGIN+'/api/admin/status',override=admin?researcher:participant;
  assert.equal(url,ORIGIN+(admin?'/api/admin/status':'/api/study/start'));assert.equal(options.method,'OPTIONS');
  assert.equal(options.headers['Access-Control-Request-Method'],admin?'GET':'POST');assert.equal(options.headers['Access-Control-Request-Headers'],admin?'Authorization':'Content-Type');
  return new Response(null,{status:override.status??204,headers:{'Access-Control-Allow-Origin':WEBSITE,'Access-Control-Allow-Methods':admin?'GET, OPTIONS':'POST, OPTIONS','Access-Control-Allow-Headers':admin?'Authorization':'Content-Type',...override.headers}});
 }};
}
test('only the approved formal origin and unambiguous CLI options are accepted',async()=>{
 const before=await Promise.all(FILES.map(file=>fs.readFile(path.join(ROOT,file),'utf8')));
 for(const apiBase of ['invalid','http://psyc-thesis-api.christine040805.workers.dev','https://psyc-thesis-hk-staging-api.christine040805.workers.dev','https://psyc-thesis-api.other.workers.dev',ORIGIN+'/path',ORIGIN+'?key=private',ORIGIN+'#x','https://name:private@psyc-thesis-api.christine040805.workers.dev','https://old.chatgpt.site']){
  let called=false;await assert.rejects(()=>prepareBackendCutover({apiBase,fetchImpl:()=>{called=true;}}),/approved formal HTTPS/);assert.equal(called,false);
 }
 assert.deepEqual(parseArguments(['--api-base',ORIGIN,'--dry-run']),{apiBase:ORIGIN,dryRun:true});
 for(const args of [[],['--api-base'],['--api-base',ORIGIN,'--api-base',ORIGIN],['--api-base',ORIGIN,'--dry-run','--dry-run'],['--api-base',ORIGIN,'--unexpected']])assert.throws(()=>parseArguments(args),/Usage/);
 await assert.rejects(()=>prepareBackendCutover({apiBase:ORIGIN,version:'bad\"query',fetchImpl:()=>assert.fail('Invalid version must not request the backend')}),/cache version/);
 assert.deepEqual(await Promise.all(FILES.map(file=>fs.readFile(path.join(ROOT,file),'utf8'))),before);
});
test('unready health or either unsafe CORS preflight prevents every frontend mutation',async()=>{
 const f=await fixture();try{
  const before=await f.snapshot();
  const cases=[{healthStatus:503},...[{ok:false},{stagingOnly:true},{stagingOnly:undefined},{maintenance:true},{maintenance:undefined},{storageReady:false},{configurationReady:false},{protocol:'other'},{images:269}].map(value=>({health:{...HEALTH,...value}})),{healthHeaders:{'Access-Control-Allow-Origin':'*'}},{healthHeaders:{'Access-Control-Allow-Credentials':'true'}},{participant:{status:403}},{participant:{headers:{'Access-Control-Allow-Origin':'https://attacker.example'}}},{participant:{headers:{'Access-Control-Allow-Methods':'GET'}}},{participant:{headers:{'Access-Control-Allow-Headers':'Authorization'}}},{participant:{headers:{'Access-Control-Allow-Credentials':'true'}}},{researcher:{status:403}},{researcher:{headers:{'Access-Control-Allow-Origin':'*'}}},{researcher:{headers:{'Access-Control-Allow-Methods':'POST'}}},{researcher:{headers:{'Access-Control-Allow-Headers':'Content-Type'}}},{researcher:{headers:{'Access-Control-Allow-Credentials':'true'}}}];
  for(const options of cases){const h=transport(options);await assert.rejects(()=>prepareBackendCutover({apiBase:ORIGIN,root:f.root,fetchImpl:h.fetchImpl}),/No frontend files were changed/);assert.deepEqual(await f.snapshot(),before);}
  const h=transport({fail:true});await assert.rejects(()=>prepareBackendCutover({apiBase:ORIGIN,root:f.root,fetchImpl:h.fetchImpl}),error=>/verification request failed/.test(error.message)&&!error.message.includes('private-debug'));assert.deepEqual(await f.snapshot(),before);
 }finally{await f.close();}
});
test('dry run verifies readiness and all original images without changing any frontend file',async()=>{
 const f=await fixture();try{
  const before=await f.snapshot(),h=transport();
  const result=await prepareBackendCutover({apiBase:ORIGIN,root:f.root,fetchImpl:h.fetchImpl,dryRun:true,version:'test-cutover'});
  assert.deepEqual(result,{origin:ORIGIN,dryRun:true,changes:FILES,imagesVerified:270});assert.equal(h.calls.length,3);assert.deepEqual(await f.snapshot(),before);
 }finally{await f.close();}
});
test('cutover updates exactly five files and refreshes participant and researcher cache keys together',async()=>{
 const f=await fixture();try{
  const before=await f.snapshot(),h=transport(),version='formal-fixture-20261109';
  const result=await prepareBackendCutover({apiBase:ORIGIN,root:f.root,fetchImpl:h.fetchImpl,version});assert.deepEqual(result.changes,FILES);
  const after=await f.snapshot();assert.ok(after['docs/config.js'].includes('export const API_BASE='+JSON.stringify(ORIGIN)+';'));
  for(const file of ['docs/app.js','docs/researcher.js']){assert.ok(after[file].includes("from './config.js?v="+version+"'"));assert.equal(after[file],before[file].replace(/from (['"])\.\/config\.js(?:\?[^'"]*)?\1/,"from './config.js?v="+version+"'"));}
  assert.equal(after['docs/index.html'],before['docs/index.html'].replace(/src=(["'])\.\/app\.js(?:\?[^"']*)?\1/,'src="./app.js?v='+version+'"'));
  assert.equal(after['docs/researcher.html'],before['docs/researcher.html'].replace(/src=(["'])\.\/researcher\.js(?:\?[^"']*)?\1/,'src="./researcher.js?v='+version+'"'));
  for(const image of STIMULI)assert.equal(createHash('sha256').update(await fs.readFile(path.join(f.root,'docs/stimuli',image.file))).digest('hex'),image.sha256);
  const repeated=await prepareBackendCutover({apiBase:ORIGIN,root:f.root,fetchImpl:h.fetchImpl,version});assert.deepEqual(repeated.changes,[]);assert.deepEqual(await f.snapshot(),after);
 }finally{await f.close();}
});
test('missing or duplicate source templates stop before any frontend file is written',async()=>{
 const f=await fixture();try{
  const base=await f.snapshot();
  for(const file of FILES.slice(1))for(const duplicate of [false,true]){
   for(const name of FILES)await fs.writeFile(path.join(f.root,name),base[name]);
   await fs.writeFile(path.join(f.root,file),duplicate?base[file]+'\n'+base[file]:'template without the required import or script');
   const before=await f.snapshot(),h=transport();await assert.rejects(()=>prepareBackendCutover({apiBase:ORIGIN,root:f.root,fetchImpl:h.fetchImpl}),/Expected exactly one/);assert.deepEqual(await f.snapshot(),before);
  }
 }finally{await f.close();}
});
test('a changed original PNG prevents cutover even when formal health and CORS pass',async()=>{
 const f=await fixture();try{
  const before=await f.snapshot(),h=transport(),last=STIMULI.at(-1);
  await fs.writeFile(path.join(f.root,'docs/stimuli',last.file),'not the original image');
  await assert.rejects(()=>prepareBackendCutover({apiBase:ORIGIN,root:f.root,fetchImpl:h.fetchImpl}),/stimulus checksum mismatch/);assert.deepEqual(await f.snapshot(),before);
 }finally{await f.close();}
});
