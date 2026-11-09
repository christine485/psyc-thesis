#!/usr/bin/env node
// Native Cloudflare Workers Builds entry point. Wrangler owns authentication.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {stripVTControlCharacters} from 'node:util';
import {prepareConfig,STAGING} from './deploy-hk-staging.mjs';
import {PROTOCOL} from '../docs/modules/protocol.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const WRANGLER=path.join(ROOT,'standalone/node_modules/wrangler');
const REQUIRED_SECRETS=['DRAW_SECRET','ADMIN_TOKEN'];
const ACCOUNT_ID=/^[a-f0-9]{32}$/i;
const DATABASE_ID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function parseJson(output,label){
 try{return JSON.parse(stripVTControlCharacters(output).trim());}
 catch{throw Error('Wrangler returned an unreadable '+label+'. No values from its output were printed. Retry the Cloudflare build.');}
}

export function resolveAccount(output,env={}){
 const identity=parseJson(output,'account list');
 if(identity?.loggedIn!==true||!Array.isArray(identity.accounts))throw Error('Cloudflare authentication is not ready. Use the automatically created build API token, then retry the build.');
 const accounts=[...new Set(identity.accounts.map(account=>account?.id).filter(id=>typeof id==='string'&&ACCOUNT_ID.test(id)))];
 const selected=env.CLOUDFLARE_ACCOUNT_ID||env.CF_ACCOUNT_ID;
 if(selected){
  if(!ACCOUNT_ID.test(selected)||!accounts.includes(selected))throw Error('The configured Cloudflare account ID does not match an account available to this build. Check the account setting before retrying.');
  return selected;
 }
 if(accounts.length!==1)throw Error(accounts.length?'This build can access several Cloudflare accounts. Set CLOUDFLARE_ACCOUNT_ID to the intended account ID in the build settings, then retry.':'No Cloudflare account is available to this build. Check the automatically created build API token and its account permissions.');
 return accounts[0];
}

function stagingDatabases(output){
 const databases=parseJson(output,'D1 database list');
 if(!Array.isArray(databases)||databases.some(db=>!db||typeof db.name!=='string'))throw Error('Wrangler returned an invalid D1 database list. No database ID was guessed.');
 const findDatabase=name=>{
  const matches=databases.filter(db=>db.name===name);
  if(matches.length>1)throw Error('Several D1 databases have a staging name. Resolve the duplicate names before retrying.');
  if(matches[0]&&!DATABASE_ID.test(matches[0].uuid||''))throw Error('Wrangler did not return a valid staging D1 database ID. No ID was guessed.');
  return matches[0];
 };
 const db=findDatabase(STAGING.database),contactsDb=findDatabase(STAGING.contactsDatabase);
 if(db&&contactsDb&&db.uuid.toLowerCase()===contactsDb.uuid.toLowerCase())throw Error('Research answers and draw contacts require two independent D1 databases. The returned database IDs match; no migrations or deployment were run.');
 return {db,contactsDb};
}

function secretNames(output){
 const secrets=parseJson(output,'Worker secret name list');
 if(!Array.isArray(secrets)||secrets.some(secret=>!secret||typeof secret.name!=='string'))throw Error('Wrangler returned an invalid Worker secret name list. Existing secrets were not changed.');
 return new Set(secrets.map(secret=>secret.name));
}

export function deploymentOrigin(output){
 const origins=new Set();
 for(const line of stripVTControlCharacters(output).split(/\r?\n/)){
  const match=/^\s*(https:\/\/[a-z0-9.-]+\.workers\.dev)\/?\s*$/i.exec(line);
  if(!match)continue;
  const url=new URL(match[1]);
  const prefix=STAGING.worker+'.';
  if(!url.hostname.startsWith(prefix))continue;
  const accountLabel=url.hostname.slice(prefix.length,-'.workers.dev'.length);
  if(/^[a-z0-9][a-z0-9-]{0,62}$/.test(accountLabel))origins.add(url.origin);
 }
 if(origins.size!==1)throw Error('The deployment did not return one workers.dev URL for the exact staging Worker. Complete Workers setup in the Cloudflare dashboard, then retry. No URL was guessed.');
 return [...origins][0];
}

function operationError(args){
 if(args[0]==='whoami')return 'Cloudflare could not authenticate this build. Keep the automatically created build API token selected and retry. Never paste the token into chat.';
 if(args[0]==='d1')return 'The staging D1 operation failed. Check this build token has D1 Storage (edit) and the account has available D1 capacity, then retry. Existing research data was not deleted.';
 if(args[0]==='secret')return 'The staging Worker secret operation failed. Check this build token has Workers Scripts (edit), then retry. Existing secret values are preserved on reruns.';
 return 'The staging Worker deployment failed. Check the Cloudflare build token permissions and Workers setup, then retry the build.';
}

export async function runWrangler(args,{env,input}={}){
 let version;
 try{version=JSON.parse(await fs.readFile(path.join(WRANGLER,'package.json'),'utf8')).version;}catch{}
 if(version!=='4.92.0')throw Error('Install the pinned Wrangler 4.92.0 with npm ci in standalone/ before deploying.');
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(WRANGLER,'bin/wrangler.js'),...args],{
   cwd:ROOT,env:{...env,CI:'true',WRANGLER_SEND_METRICS:'false',NO_COLOR:'1',FORCE_COLOR:'0'},stdio:['pipe','pipe','pipe']
  });
  let stdout='',overflow=false;
  // CLI output can contain account metadata or echoed request details. It is
  // captured only in memory for the parsers and never forwarded to build logs.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
   if(stdout.length+chunk.length>4*1024*1024){overflow=true;child.kill();}
   else stdout+=chunk;
  });
  child.stderr.on('data',()=>{});
  child.on('error',()=>reject(Error('Could not start Wrangler. Run npm ci in standalone/ and retry the build.')));
  child.on('close',code=>{
   if(overflow)reject(Error('Wrangler output exceeded the safety limit. Inspect the Cloudflare account before retrying.'));
   else if(code!==0)reject(Error(operationError(args)));
   else resolve(stdout);
  });
  child.stdin.on('error',()=>{});
  child.stdin.end(input||'');
 });
}

export async function deployCloudflareStaging({env=process.env,run=runWrangler,fetchImpl=fetch,report=console.log,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(env.WRANGLER_CI_OVERRIDE_NAME!==undefined&&env.WRANGLER_CI_OVERRIDE_NAME!==STAGING.worker)throw Error('Set the Cloudflare project name to '+STAGING.worker+' before deploying. This build is restricted to that staging Worker.');
 if(!STAGING.contactsDatabase||STAGING.database===STAGING.contactsDatabase)throw Error('Research answers and draw contacts require two different staging database names.');
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'psyc-native-staging-'));
 try{
  // A path ending in .log is important: Wrangler treats other paths as log
  // directories. Null all debug logs before authentication or secret handling.
  const logPath=path.join(temp,'wrangler.log');await fs.symlink(os.devNull,logPath);
  const operationEnv={...env,WRANGLER_LOG_PATH:logPath};
  const identityConfig=path.join(temp,'identity.json');
  const identity={name:STAGING.worker,compatibility_date:'2026-05-15'};
  await fs.writeFile(identityConfig,JSON.stringify(identity),{mode:0o600});
  const command=async(args,options={})=>{
   try{return await run(args,{env:operationEnv,...options});}
   catch{throw Error(operationError(args));}
  };
  report('Checking Cloudflare authentication and staging resources.');
  const accountId=resolveAccount(await command(['whoami','--json','--config',identityConfig]),env);
  operationEnv.CLOUDFLARE_ACCOUNT_ID=accountId;
  await fs.writeFile(identityConfig,JSON.stringify({...identity,account_id:accountId}),{mode:0o600});
  const databaseList=()=>command(['d1','list','--json','--config',identityConfig]).then(stagingDatabases);
  // Only D1 databases and the staging Worker are provisioned. Deployment never
  // activates subscriptions, changes account plans or enables paid overages.
  let {db,contactsDb}=await databaseList(),createdDatabase=false,createdContactsDatabase=false;
  if(!db){
   await command(['d1','create',STAGING.database,'--no-update-config','--config',identityConfig]);
   createdDatabase=true;({db,contactsDb}=await databaseList());
   if(!db)throw Error('The new staging D1 database was not found after creation. Retry after checking D1 in Cloudflare. No database ID was guessed.');
  }
  if(!contactsDb){
   await command(['d1','create',STAGING.contactsDatabase,'--no-update-config','--config',identityConfig]);
   createdContactsDatabase=true;({db,contactsDb}=await databaseList());
   if(!contactsDb)throw Error('The new staging draw contacts D1 database was not found after creation. Retry after checking D1 in Cloudflare. No database ID was guessed.');
  }
  if(!db)throw Error('The research D1 database could not be verified before migration. No database ID was guessed.');
  const config=await prepareConfig(temp,accountId,db.uuid,contactsDb.uuid);
  report('Applying staging database migrations and deploying the pilot experiment.');
  await command(['d1','migrations','apply',STAGING.database,'--remote','--config',config]);
  await command(['d1','migrations','apply',STAGING.contactsDatabase,'--remote','--config',config]);
  const origin=deploymentOrigin(await command(['deploy','--keep-vars','--config',config]));
  const listSecrets=()=>command(['secret','list','--format','json','--config',config]).then(secretNames);
  const existing=await listSecrets();
  const missing=Object.fromEntries(REQUIRED_SECRETS.filter(name=>!existing.has(name)).map(name=>[name,randomBytes(32).toString('hex')]));
  // New values travel only through stdin. --keep-vars above and this missing-
  // only bulk request preserve all pre-existing secret bindings and values.
  if(Object.keys(missing).length){
   await command(['secret','bulk','--config',config],{input:JSON.stringify(missing)});
   const confirmed=await listSecrets();
   if(REQUIRED_SECRETS.some(name=>!confirmed.has(name)))throw Error('The staging secret names could not be verified after setup. Retry the build before testing.');
  }
  report('Checking the staging protocol, pilot restriction and database storage.');
  let ready=false;
  for(let attempt=0;attempt<6;attempt++){
   try{
    const response=await fetchImpl(origin+'/api/health',{signal:AbortSignal.timeout(15000),redirect:'error'});
    const health=await response.json();
    ready=response.ok&&health.ok===true&&health.stagingOnly===true&&health.configurationReady===true&&health.storageReady===true&&health.protocol===PROTOCOL&&health.images===270;
    if(ready)break;
   }catch{}
   if(attempt<5)await pause(2000);
  }
  if(!ready)throw Error('Staging deployed, but its protocol, pilot restriction or independent D1 storage health check is not ready. Retry after checking Cloudflare. Do not invite participants yet.');
  const result={url:origin+'/?mode=pilot',databaseId:db.uuid,contactsDatabaseId:contactsDb.uuid,createdDatabase,createdContactsDatabase,productionChanged:false};
  report('Staging ready: '+result.url);
  report('A Hong Kong test without VPN is still required before switching the public experiment.');
  return result;
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 deployCloudflareStaging().catch(error=>{console.error(error.message);process.exitCode=1;});
}
