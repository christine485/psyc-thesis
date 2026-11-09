#!/usr/bin/env node
// GitHub Actions staging bootstrap. Never changes the production Sites or Pages config.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {STIMULI,PROTOCOL} from '../docs/modules/protocol.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const STAGING=Object.freeze({worker:'psyc-thesis-hk-staging-api',database:'psyc-thesis-hk-staging-research',contactsDatabase:'psyc-thesis-hk-staging-draw'});

export function requireCredentials(env){
 if(!env.CLOUDFLARE_API_TOKEN)throw Error('Add the CLOUDFLARE_API_TOKEN GitHub Actions repository secret. Do not put the token in workflow inputs or chat.');
 if(!/^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID||''))throw Error('Set the CLOUDFLARE_ACCOUNT_ID GitHub Actions repository variable to the intended Cloudflare account ID.');
 return env.CLOUDFLARE_ACCOUNT_ID;
}

function validateDatabaseIds(databaseId,contactsDatabaseId){
 if(typeof databaseId!=='string'||!databaseId||typeof contactsDatabaseId!=='string'||!contactsDatabaseId)throw Error('Cloudflare did not return both D1 database IDs. No ID was guessed.');
 if(databaseId.toLowerCase()===contactsDatabaseId.toLowerCase())throw Error('Research answers and draw contacts require separate D1 databases. The returned database IDs match.');
}

export async function prepareConfig(temp,accountId,databaseId,contactsDatabaseId){
 validateDatabaseIds(databaseId,contactsDatabaseId);
 const assets=path.join(temp,'assets');
 await fs.cp(path.join(ROOT,'docs'),assets,{recursive:true});
 for(const item of STIMULI){
  const data=await fs.readFile(path.join(assets,'stimuli',item.file));
  if(createHash('sha256').update(data).digest('hex')!==item.sha256)throw Error('Staging stimulus checksum mismatch: '+item.file);
 }
 await fs.writeFile(path.join(assets,'config.js'),"export const API_BASE=location.origin;\nexport const STIMULUS_BASE=new URL('./stimuli/',import.meta.url).href;\n");
 const appPath=path.join(assets,'app.js'),app=await fs.readFile(appPath,'utf8');
 const original="const mode=query.get('mode')==='pilot'?'pilot':'live',preview=";
 if(app.split(original).length!==2)throw Error('The experiment mode declaration changed; staging copy must be reviewed before deployment.');
 await fs.writeFile(appPath,app.replace(original,"const mode='pilot',preview="));
 const config={name:STAGING.worker,account_id:accountId,main:path.join(ROOT,'standalone/src/index.ts'),compatibility_date:'2026-05-15',workers_dev:true,
  observability:{enabled:false},vars:{STAGING_ONLY:'1'},assets:{directory:assets,run_worker_first:['/api/*']},
  d1_databases:[
   {binding:'DB',database_name:STAGING.database,database_id:databaseId,migrations_dir:path.join(ROOT,'standalone/migrations')},
   {binding:'CONTACTS_DB',database_name:STAGING.contactsDatabase,database_id:contactsDatabaseId,migrations_dir:path.join(ROOT,'standalone/contact-migrations')}
  ]};
 const configPath=path.join(temp,'wrangler.json');
 await fs.writeFile(configPath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
 return configPath;
}

async function runWrangler(args,{env,input}){
 const cli=path.join(ROOT,'standalone/node_modules/wrangler/bin/wrangler.js');
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,...args],{cwd:ROOT,env:{...env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['pipe','inherit','inherit']});
  child.on('error',()=>reject(Error('Could not start the installed Wrangler CLI. Run npm ci in standalone/.')));
  child.on('close',code=>code===0?resolve():reject(Error('Wrangler staging operation failed. Check the job output and Cloudflare token permissions.')));
  child.stdin.on('error',()=>{});
  child.stdin.end(input||'');
 });
}

export async function deployStaging({env=process.env,fetchImpl=fetch,run=runWrangler,report=console.log}={}){
 const accountId=requireCredentials(env),base='/accounts/'+accountId;
 async function api(endpoint,{method='GET',body}={}){
  let response,value;
  try{
   response=await fetchImpl('https://api.cloudflare.com/client/v4'+endpoint,{method,headers:{Authorization:'Bearer '+env.CLOUDFLARE_API_TOKEN,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});
   value=await response.json();
  }catch{throw Error('Cloudflare API could not be reached or returned an invalid response. Retry after checking network access.');}
  if(!response.ok||value.success!==true){
   const codes=(value.errors||[]).map(x=>Number(x.code)).filter(Number.isFinite).join(',');
   throw Error('Cloudflare API refused the staging operation (HTTP '+response.status+(codes?', code '+codes:'')+'). Check account ID and token permissions.');
  }
  return value.result;
 }
 // Read the intended account and existing D1 databases before creating resources.
 // This deployment never enables billing or changes the account plan.
 const subdomain=await api(base+'/workers/subdomain');
 if(typeof subdomain?.subdomain!=='string'||!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(subdomain.subdomain))throw Error('Complete Workers & Pages setup in the Cloudflare dashboard and choose a workers.dev subdomain, then rerun.');
 let databases=[];
 for(let page=1;page<=100;page++){
  const rows=await api(base+'/d1/database?per_page=100&page='+page);
  if(!Array.isArray(rows))throw Error('Cloudflare returned an invalid D1 database list.');
  databases.push(...rows);
  if(rows.length<100)break;
  if(page===100)throw Error('D1 database listing exceeded the safety limit. No staging resources were created.');
 }
 const matches=databases.filter(x=>x.name===STAGING.database);
 const contactsMatches=databases.filter(x=>x.name===STAGING.contactsDatabase);
 if(matches.length>1||contactsMatches.length>1)throw Error('More than one staging database matches. Resolve the duplicate names before deployment.');
 let db=matches[0],contactsDb=contactsMatches[0],createdDatabase=false,createdContactsDatabase=false;
 if(!db){db=await api(base+'/d1/database',{method:'POST',body:{name:STAGING.database}});createdDatabase=true;}
 if(!contactsDb){contactsDb=await api(base+'/d1/database',{method:'POST',body:{name:STAGING.contactsDatabase}});createdContactsDatabase=true;}
 validateDatabaseIds(db?.uuid,contactsDb?.uuid);
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'psyc-hk-staging-'));
 try{
  const config=await prepareConfig(temp,accountId,db.uuid,contactsDb.uuid);
  // Wrangler otherwise writes debug request logs. A .log symlink to the null
  // device prevents secret bulk request bodies from ever being retained.
  const logPath=path.join(temp,'wrangler.log');await fs.symlink(os.devNull,logPath);
  const operationEnv={...env,WRANGLER_LOG_PATH:logPath};
  await run(['d1','migrations','apply',STAGING.database,'--remote','--config',config],{env:operationEnv});
  await run(['d1','migrations','apply',STAGING.contactsDatabase,'--remote','--config',config],{env:operationEnv});
  await run(['deploy','--keep-vars','--config',config],{env:operationEnv});
  const secrets=await api(base+'/workers/scripts/'+STAGING.worker+'/secrets');
  if(!Array.isArray(secrets))throw Error('Cloudflare did not return the staging secret names.');
  const missing=Object.fromEntries(['DRAW_SECRET','ADMIN_TOKEN'].filter(name=>!secrets.some(x=>x.name===name)).map(name=>[name,randomBytes(32).toString('hex')]));
  // Secret values exist only in memory and this subprocess's stdin, never args/files/logs.
  if(Object.keys(missing).length)await run(['secret','bulk','--config',config],{env:operationEnv,input:JSON.stringify(missing)});
  const origin='https://'+STAGING.worker+'.'+subdomain.subdomain+'.workers.dev';
  let ready=false;
  for(let attempt=0;attempt<6;attempt++){
   try{
    const response=await fetchImpl(origin+'/api/health',{signal:AbortSignal.timeout(15000),redirect:'error'}),health=await response.json();
    ready=response.ok&&health.ok===true&&health.stagingOnly===true&&health.configurationReady===true&&health.storageReady===true&&health.protocol===PROTOCOL&&health.images===270;
    if(ready)break;
   }catch{}
   if(attempt<5)await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!ready)throw Error('Staging deployed, but its health check is not ready. Inspect the deployment before inviting testers; do not switch production.');
  const result={url:origin+'/?mode=pilot',databaseId:db.uuid,contactsDatabaseId:contactsDb.uuid,createdDatabase,createdContactsDatabase,productionChanged:false};
  const summary='### Hong Kong staging experiment\n\n'+result.url+'\n\nHealth, protocol and storage checks passed. Production entry and research data were not changed. Hong Kong without-VPN participant acceptance is still required.\n\nResearch D1: `'+STAGING.database+'` (`'+db.uuid+'`)\n\nDraw contacts D1: `'+STAGING.contactsDatabase+'` (`'+contactsDb.uuid+'`)\n';
  if(env.GITHUB_STEP_SUMMARY)await fs.appendFile(env.GITHUB_STEP_SUMMARY,summary);
  report(JSON.stringify(result));
  return result;
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 deployStaging().catch(error=>{console.error(error.message);process.exitCode=1;});
}
