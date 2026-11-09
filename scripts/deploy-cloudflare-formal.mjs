#!/usr/bin/env node
// Run only from the dedicated formal Workers Builds project. CI identity stays intact.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {stripVTControlCharacters} from 'node:util';
import {resolveAccount,runWrangler} from './deploy-cloudflare-staging.mjs';
import {STAGING} from './deploy-hk-staging.mjs';
import {PROTOCOL,STIMULI} from '../docs/modules/protocol.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const DATABASE_ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const REQUIRED_SECRETS=['DRAW_SECRET','ADMIN_TOKEN'];
export const FORMAL=Object.freeze({worker:'psyc-thesis-api',database:'psyc-thesis-research',contactsDatabase:'psyc-thesis-draw'});
export const PARTICIPANT_ENTRY='https://christine485.github.io/psyc-thesis/';
const PARTICIPANT_ORIGIN=new URL(PARTICIPANT_ENTRY).origin;

function parseJson(output,label){
 try{return JSON.parse(stripVTControlCharacters(output).trim());}
 catch{throw Error('Wrangler returned an unreadable '+label+'. No private output was printed. Retry the formal build.');}
}

function databases(output){
 const list=parseJson(output,'D1 database list');
 if(!Array.isArray(list)||list.some(db=>!db||typeof db.name!=='string'))throw Error('Wrangler returned an invalid database list. No database ID was guessed.');
 const selected=[FORMAL.database,FORMAL.contactsDatabase,STAGING.database,STAGING.contactsDatabase].map(name=>{
  const found=list.filter(db=>db.name===name);
  if(found.length>1)throw Error('Several D1 databases have a reserved study name. Resolve the duplicates before retrying.');
  if(found[0]&&!DATABASE_ID.test(found[0].uuid||''))throw Error('Wrangler did not return a valid study D1 database ID. No database ID was guessed.');
  return found[0];
 });
 const present=selected.filter(Boolean),ids=present.map(db=>db.uuid.toLowerCase());
 if(new Set(ids).size!==ids.length)throw Error('Formal and staging research/contact databases must use different IDs. No migrations or deployment were run.');
 return {db:selected[0],contactsDb:selected[1]};
}

export function formalDeploymentOrigin(output){
 const origins=new Set();
 for(const line of stripVTControlCharacters(output).split(/\r?\n/)){
  const match=/^\s*(https:\/\/[a-z0-9.-]+\.workers\.dev)\/?\s*$/i.exec(line);
  if(!match)continue;
  const url=new URL(match[1]),prefix=FORMAL.worker+'.';
  if(!url.hostname.startsWith(prefix))continue;
  const account=url.hostname.slice(prefix.length,-'.workers.dev'.length);
  if(/^[a-z0-9][a-z0-9-]{0,62}$/.test(account))origins.add(url.origin);
 }
 if(origins.size!==1)throw Error('The deployment did not return one URL for the exact formal Worker. No URL was guessed.');
 return [...origins][0];
}

export async function prepareFormalConfig(temp,accountId,databaseId,contactsDatabaseId){
 if(!DATABASE_ID.test(databaseId||'')||!DATABASE_ID.test(contactsDatabaseId||''))throw Error('Both formal database IDs must come from Cloudflare.');
 if(databaseId.toLowerCase()===contactsDatabaseId.toLowerCase())throw Error('Formal research and contacts require different database IDs.');
 const assets=path.join(temp,'assets');await fs.cp(path.join(ROOT,'docs'),assets,{recursive:true});
 for(const image of STIMULI){
  const bytes=await fs.readFile(path.join(assets,'stimuli',image.file));
  if(createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw Error('An original stimulus checksum changed. Formal deployment stopped.');
 }
 // Retain the original live/pilot selection; unlike staging, this is not forced to pilot.
 const app=await fs.readFile(path.join(assets,'app.js'),'utf8');
 if(!app.includes("const mode=query.get('mode')==='pilot'?'pilot':'live',preview="))throw Error('The formal experiment mode declaration changed. Review it before deployment.');
 await fs.writeFile(path.join(assets,'config.js'),"export const API_BASE=location.origin;\nexport const STIMULUS_BASE=new URL('./stimuli/',import.meta.url).href;\n");
 await fs.writeFile(path.join(assets,'index.html'),'<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>研究入口</title><link rel="stylesheet" href="./researcher.css"></head><body><main><h1>圖案、情緒與你的感受</h1><section class="card"><h2>參加研究</h2><p><a href="'+PARTICIPANT_ENTRY+'">開啟正式研究網站</a></p></section><section class="card"><h2>研究團隊</h2><p><a href="./researcher">登入資料後台</a></p></section></main></body></html>');
 const config={name:FORMAL.worker,account_id:accountId,main:path.join(ROOT,'standalone/src/index.ts'),compatibility_date:'2026-05-15',workers_dev:true,
  observability:{enabled:false},vars:{STAGING_ONLY:'0'},assets:{directory:assets,run_worker_first:['/api/*']},
  d1_databases:[
   {binding:'DB',database_name:FORMAL.database,database_id:databaseId,migrations_dir:path.join(ROOT,'standalone/migrations')},
   {binding:'CONTACTS_DB',database_name:FORMAL.contactsDatabase,database_id:contactsDatabaseId,migrations_dir:path.join(ROOT,'standalone/contact-migrations')}
  ]};
 const file=path.join(temp,'wrangler.json');await fs.writeFile(file,JSON.stringify(config,null,2)+'\n',{mode:0o600});return file;
}

function operationError(args){
 if(args[0]==='whoami')return 'Cloudflare could not authenticate the formal build. Keep the automatic build token selected; never paste it into chat.';
 if(args[0]==='d1')return 'The formal D1 operation failed. Check D1 Storage (edit) permission and free account capacity. Existing study data was not deleted.';
 if(args[0]==='secret')return 'The formal secret operation failed. Check Workers Scripts (edit) permission. Existing secret values are preserved.';
 return 'The formal Worker deployment failed. Check the dedicated formal project and its automatic build token permissions.';
}

export async function deployCloudflareFormal({env=process.env,run=runWrangler,fetchImpl=fetch,report=console.log,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 // Wrangler overrides config.name in Builds. Never remove that override or the CI
 // match tag: rejecting the wrong connected project protects the staging Worker.
 if(env.WRANGLER_CI_OVERRIDE_NAME!==undefined&&env.WRANGLER_CI_OVERRIDE_NAME!==FORMAL.worker)throw Error('Create a separate Cloudflare project named '+FORMAL.worker+' and run deploy-formal there. This command cannot run in the staging project.');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'psyc-native-formal-'));
 try{
  const logPath=path.join(temp,'wrangler.log');await fs.symlink(os.devNull,logPath);
  const operationEnv={...env,WRANGLER_LOG_PATH:logPath};
  const identityConfig=path.join(temp,'identity.json'),identity={name:FORMAL.worker,compatibility_date:'2026-05-15'};
  await fs.writeFile(identityConfig,JSON.stringify(identity),{mode:0o600});
  const command=async(args,options={})=>{try{return await run(args,{env:operationEnv,...options});}catch{throw Error(operationError(args));}};
  report('Checking the formal project identity and independent D1 resources.');
  const accountId=resolveAccount(await command(['whoami','--json','--config',identityConfig]),env);operationEnv.CLOUDFLARE_ACCOUNT_ID=accountId;
  await fs.writeFile(identityConfig,JSON.stringify({...identity,account_id:accountId}),{mode:0o600});
  const databaseList=()=>command(['d1','list','--json','--config',identityConfig]).then(databases);
  let {db,contactsDb}=await databaseList(),createdDatabase=false,createdContactsDatabase=false;
  if(!db){await command(['d1','create',FORMAL.database,'--no-update-config','--config',identityConfig]);createdDatabase=true;({db,contactsDb}=await databaseList());if(!db)throw Error('The new formal research database was not found after creation. No database ID was guessed.');}
  if(!contactsDb){await command(['d1','create',FORMAL.contactsDatabase,'--no-update-config','--config',identityConfig]);createdContactsDatabase=true;({db,contactsDb}=await databaseList());if(!contactsDb)throw Error('The new formal contacts database was not found after creation. No database ID was guessed.');}
  if(!db)throw Error('The formal research database could not be verified. No database ID was guessed.');
  const config=await prepareFormalConfig(temp,accountId,db.uuid,contactsDb.uuid);
  report('Applying formal database migrations and deploying without changing staging.');
  await command(['d1','migrations','apply',FORMAL.database,'--remote','--config',config]);
  await command(['d1','migrations','apply',FORMAL.contactsDatabase,'--remote','--config',config]);
  const origin=formalDeploymentOrigin(await command(['deploy','--keep-vars','--config',config]));
  const listSecrets=async()=>{
   const list=parseJson(await command(['secret','list','--format','json','--config',config]),'formal secret name list');
   if(!Array.isArray(list)||list.some(item=>!item||typeof item.name!=='string'))throw Error('Wrangler returned an invalid secret name list. Existing secrets were not changed.');
   return new Set(list.map(item=>item.name));
  };
  const existing=await listSecrets(),missing=Object.fromEntries(REQUIRED_SECRETS.filter(name=>!existing.has(name)).map(name=>[name,randomBytes(32).toString('hex')]));
  if(Object.keys(missing).length){await command(['secret','bulk','--config',config],{input:JSON.stringify(missing)});const confirmed=await listSecrets();if(REQUIRED_SECRETS.some(name=>!confirmed.has(name)))throw Error('Formal secret setup was not confirmed. Retry the dedicated formal build.');}
  let ready=false;
  for(let attempt=0;attempt<6;attempt++){
   try{const response=await fetchImpl(origin+'/api/health',{redirect:'error',signal:AbortSignal.timeout(15000)}),health=await response.json();ready=response.ok&&health.ok===true&&health.stagingOnly===false&&health.configurationReady===true&&health.storageReady===true&&health.maintenance===false&&health.protocol===PROTOCOL&&health.images===270;if(ready)break;}catch{}
   if(attempt<5)await pause(2000);
  }
  if(!ready)throw Error('The formal health check is not ready. Enable the Production workers.dev URL and check both databases, then retry. Do not switch GitHub Pages yet.');
  let corsReady=false;
  try{
   const response=await fetchImpl(origin+'/api/study/start',{method:'OPTIONS',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Origin:PARTICIPANT_ORIGIN,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type'}});
   corsReady=response.status===204&&response.headers.get('Access-Control-Allow-Origin')===PARTICIPANT_ORIGIN&&(response.headers.get('Access-Control-Allow-Methods')||'').split(',').map(item=>item.trim()).includes('POST')&&(response.headers.get('Access-Control-Allow-Headers')||'').toLowerCase().split(',').map(item=>item.trim()).includes('content-type');
  }catch{}
  if(!corsReady)throw Error('The formal backend does not yet allow the GitHub participant origin. Do not switch GitHub Pages.');
  let adminReady=false;
  try{
   const response=await fetchImpl(origin+'/api/admin/status',{method:'OPTIONS',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Origin:PARTICIPANT_ORIGIN,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization'}});
   adminReady=response.status===204&&response.headers.get('Access-Control-Allow-Origin')===PARTICIPANT_ORIGIN&&(response.headers.get('Access-Control-Allow-Methods')||'').split(',').map(item=>item.trim()).includes('GET')&&(response.headers.get('Access-Control-Allow-Headers')||'').toLowerCase().split(',').map(item=>item.trim()).includes('authorization')&&!response.headers.get('Access-Control-Allow-Credentials');
  }catch{}
  if(!adminReady)throw Error('The formal backend does not yet allow the GitHub researcher origin. Do not switch GitHub Pages.');
  const result={url:origin,adminURL:origin+'/researcher',participantURL:PARTICIPANT_ENTRY,databaseId:db.uuid,contactsDatabaseId:contactsDb.uuid,createdDatabase,createdContactsDatabase,stagingChanged:false,productionFrontendChanged:false};
  report('Formal backend ready: '+origin);report('Researcher page: '+result.adminURL);report('GitHub Pages has not been switched; complete the reviewed frontend cutover and Hong Kong pilot check.');return result;
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))deployCloudflareFormal().catch(error=>{console.error(error.message);process.exitCode=1;});
