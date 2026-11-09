import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {deployCloudflareStaging,resolveAccount,deploymentOrigin} from '../scripts/deploy-cloudflare-staging.mjs';
import {STAGING} from '../scripts/deploy-hk-staging.mjs';
import {PROTOCOL} from '../docs/modules/protocol.mjs';

const ACCOUNT='a'.repeat(32),OTHER_ACCOUNT='b'.repeat(32);
const DB='01234567-89ab-cdef-0123-456789abcdef';
const CONTACTS_DB='12345678-9abc-def0-1234-56789abcdef0';
const ORIGIN='https://'+STAGING.worker+'.actual-build-account.workers.dev';
const PRIVATE='synthetic-private-output-never-print';
const healthy={ok:true,stagingOnly:true,configurationReady:true,storageReady:true,protocol:PROTOCOL,images:270};

function harness({existing=false,secrets=[],accounts=[ACCOUNT],deployment=ORIGIN,health=healthy,hideCreatedDatabase=false,hideCreatedContactsDatabase=false,sameDatabaseId=false,contactsMigrationFails=false}={}){
 let dbExists=existing,contactsDbExists=existing,temp,config;
 const secretValues=new Map(secrets.map(name=>[name,'preserved-'+name]));
 const runs=[],reports=[],requests=[];
 const h={runs,reports,requests,secretValues,get temp(){return temp;},get config(){return config;},
  report:value=>reports.push(value),pause:async()=>{},
  fetchImpl:async(url,options)=>{
   requests.push(url);assert.equal(url,ORIGIN+'/api/health');assert.equal(options.redirect,'error');
   return Response.json(health);
  },
  run:async(args,options)=>{
   const configPath=args[args.indexOf('--config')+1];
   const cfg=JSON.parse(await fs.readFile(configPath,'utf8'));
   temp=path.dirname(configPath);
   assert.equal(cfg.name,STAGING.worker);
   assert.equal(await fs.readlink(options.env.WRANGLER_LOG_PATH),os.devNull);
   assert.ok(options.env.WRANGLER_LOG_PATH.endsWith('.log'));
   assert.equal(Object.hasOwn(options.env,'CLOUDFLARE_API_TOKEN'),false,'Native build auth must not require a manually configured token.');
   assert.ok(!args.join(' ').includes(PRIVATE));
   assert.ok(!args.includes('delete'));
   assert.ok(['whoami','d1','deploy','secret'].includes(args[0]),'Deployment must never activate other products or change subscriptions.');
   runs.push({args:[...args],input:options.input});
   if(args[0]==='whoami'){
    assert.deepEqual(args.slice(0,2),['whoami','--json']);
    return JSON.stringify({loggedIn:true,email:PRIVATE,accounts:accounts.map(id=>({id,name:'private-account-name'})),tokenPermissions:['metadata-only']});
   }
   assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID,ACCOUNT);
   if(args[0]==='d1'&&args[1]==='list')return JSON.stringify([
    {name:'production-research',uuid:'fedcba98-7654-3210-fedc-ba9876543210'},
    ...(dbExists&&!hideCreatedDatabase?[{name:STAGING.database,uuid:DB}]:[]),
    ...(contactsDbExists&&!hideCreatedContactsDatabase?[{name:STAGING.contactsDatabase,uuid:sameDatabaseId?DB.toUpperCase():CONTACTS_DB}]:[])
   ]);
   if(args[0]==='d1'&&args[1]==='create'){
    assert.ok([STAGING.database,STAGING.contactsDatabase].includes(args[2]));assert.ok(args.includes('--no-update-config'));
    if(args[2]===STAGING.database)dbExists=true;
    else contactsDbExists=true;
    return 'Created '+args[2];
   }
   config=cfg;
   assert.equal(cfg.account_id,ACCOUNT);assert.equal(cfg.vars.STAGING_ONLY,'1');
   assert.deepEqual(cfg.d1_databases,[
    {binding:'DB',database_name:STAGING.database,database_id:DB,migrations_dir:path.resolve('standalone/migrations')},
    {binding:'CONTACTS_DB',database_name:STAGING.contactsDatabase,database_id:CONTACTS_DB,migrations_dir:path.resolve('standalone/contact-migrations')}
   ]);
   assert.equal(Object.hasOwn(cfg,'r2_buckets'),false);
   assert.deepEqual(cfg.assets.run_worker_first,['/api/*']);
   if(args[0]==='d1'){
    assert.deepEqual(args.slice(0,3),['d1','migrations','apply']);
    assert.ok([STAGING.database,STAGING.contactsDatabase].includes(args[3]));assert.equal(args[4],'--remote');
    if(args[3]===STAGING.contactsDatabase&&contactsMigrationFails)throw Error(PRIVATE+' migration failure');
    return 'Migration applied';
   }
   if(args[0]==='deploy'){
    assert.ok(args.includes('--keep-vars'),'Existing secrets must survive a repeat deployment.');
    const app=await fs.readFile(path.join(cfg.assets.directory,'app.js'),'utf8');
    assert.ok(app.includes("const mode='pilot',preview="));
    const settings=await fs.readFile(path.join(cfg.assets.directory,'config.js'),'utf8');
    assert.ok(settings.includes('API_BASE=location.origin'));assert.ok(!settings.includes('chatgpt.site'));
    assert.equal((await fs.readdir(path.join(cfg.assets.directory,'stimuli'))).filter(name=>name.endsWith('.png')).length,270);
    return 'Uploaded staging\nDeployed '+STAGING.worker+' triggers\n  \u001b[1m'+deployment+'\u001b[0m\nCurrent Version ID: example';
   }
   if(args[0]==='secret'&&args[1]==='list'){
    assert.deepEqual(args.slice(0,4),['secret','list','--format','json']);
    return JSON.stringify([...secretValues.keys()].map(name=>({name,type:'secret_text'})));
   }
   if(args[0]==='secret'&&args[1]==='bulk'){
    const values=JSON.parse(options.input);
    assert.ok(Object.keys(values).length>0);
    for(const [name,value]of Object.entries(values)){
     assert.ok(['ADMIN_TOKEN','DRAW_SECRET'].includes(name));assert.equal(secretValues.has(name),false,'Existing secrets must never rotate.');
     assert.match(value,/^[a-f0-9]{64}$/);secretValues.set(name,value);
     assert.ok(!JSON.stringify(cfg).includes(value));assert.ok(!args.join(' ').includes(value));
    }
    return PRIVATE+' '+options.input;
   }
   throw Error('Unexpected mocked command');
  }
 };
 return h;
}

test('fresh native build creates isolated research/contact D1 databases, without activating paid products',async()=>{
 const h=harness();const result=await deployCloudflareStaging({env:{WRANGLER_CI_OVERRIDE_NAME:STAGING.worker},...h});
 assert.deepEqual(result,{url:ORIGIN+'/?mode=pilot',databaseId:DB,contactsDatabaseId:CONTACTS_DB,createdDatabase:true,createdContactsDatabase:true,productionChanged:false});
 const commands=h.runs.map(run=>run.args.slice(0,3).join(' '));
 assert.equal(commands.filter(command=>command==='d1 list --json').length,3,'Both creations must be followed by authoritative D1 re-listing.');
 assert.deepEqual(h.runs.filter(run=>run.args[1]==='create').map(run=>run.args[2]),[STAGING.database,STAGING.contactsDatabase]);
 assert.deepEqual(h.runs.filter(run=>run.args[1]==='migrations').map(run=>run.args[3]),[STAGING.database,STAGING.contactsDatabase]);
 assert.ok(h.runs.findIndex(run=>run.args[0]==='deploy')>h.runs.findIndex(run=>run.args[1]==='migrations'&&run.args[3]===STAGING.contactsDatabase));
 assert.equal(h.runs.filter(run=>run.args[0]==='secret'&&run.args[1]==='bulk').length,1);
 assert.equal(h.runs.filter(run=>run.args[0]==='secret'&&run.args[1]==='list').length,2);
 assert.equal(h.requests.length,1);
 assert.ok(!h.reports.join('').includes(PRIVATE));
 for(const value of h.secretValues.values())assert.ok(!h.reports.join('').includes(value));
 await assert.rejects(()=>fs.access(h.temp),'Temporary files must be removed.');
});

test('repeat native build reuses resources and preserves both existing secrets without a bulk upload',async()=>{
 const h=harness({existing:true,secrets:['DRAW_SECRET','ADMIN_TOKEN','ANOTHER_SECRET']});
 const original=[...h.secretValues];
 const result=await deployCloudflareStaging({env:{},...h});
 assert.equal(result.createdDatabase,false);assert.equal(result.createdContactsDatabase,false);
 assert.deepEqual([...h.secretValues],original);
 assert.ok(!h.runs.some(run=>run.args.includes('create')||run.args.includes('bulk')));
 assert.ok(h.runs.find(run=>run.args[0]==='deploy').args.includes('--keep-vars'));
});

test('partial secret setup creates only the missing name and preserves an existing DRAW_SECRET',async()=>{
 const h=harness({existing:true,secrets:['DRAW_SECRET']});
 await deployCloudflareStaging({env:{},...h});
 const bulk=h.runs.find(run=>run.args[1]==='bulk');
 assert.deepEqual(Object.keys(JSON.parse(bulk.input)),['ADMIN_TOKEN']);
 assert.equal(h.secretValues.get('DRAW_SECRET'),'preserved-DRAW_SECRET');
});

test('several permitted accounts fail before resource reads or mutations, without printing private whoami metadata',async()=>{
 const h=harness({accounts:[ACCOUNT,OTHER_ACCOUNT]});
 await assert.rejects(()=>deployCloudflareStaging({env:{},...h}),error=>/several Cloudflare accounts/.test(error.message)&&!error.message.includes(PRIVATE));
 assert.equal(h.runs.length,1);assert.equal(h.requests.length,0);assert.ok(!h.reports.join('').includes(PRIVATE));
 await assert.rejects(()=>fs.access(h.temp));
});

test('explicit account choice is checked against authenticated accounts',()=>{
 const json=JSON.stringify({loggedIn:true,accounts:[{id:ACCOUNT},{id:OTHER_ACCOUNT}]});
 assert.equal(resolveAccount(json,{CLOUDFLARE_ACCOUNT_ID:ACCOUNT}),ACCOUNT);
 assert.throws(()=>resolveAccount(json,{CLOUDFLARE_ACCOUNT_ID:'c'.repeat(32)}),/does not match/);
 assert.throws(()=>resolveAccount(JSON.stringify({loggedIn:false,accounts:[]})),/authentication is not ready/);
 assert.throws(()=>resolveAccount(PRIVATE),error=>!error.message.includes(PRIVATE));
});

test('native CI name override cannot redirect the script to production or another Worker',async()=>{
 const h=harness();
 await assert.rejects(()=>deployCloudflareStaging({env:{WRANGLER_CI_OVERRIDE_NAME:'production-worker'},...h}),/restricted to that staging Worker/);
 assert.equal(h.runs.length,0);assert.equal(h.requests.length,0);
});

test('contacts migration failure is redacted and prevents deployment, secrets or a ready result',async()=>{
 const h=harness({existing:true,contactsMigrationFails:true});
 await assert.rejects(()=>deployCloudflareStaging({env:{},...h}),error=>/D1 operation failed/.test(error.message)&&!error.message.includes(PRIVATE));
 assert.deepEqual(h.runs.filter(run=>run.args[1]==='migrations').map(run=>run.args[3]),[STAGING.database,STAGING.contactsDatabase]);
 assert.ok(!h.runs.some(run=>run.args[0]==='deploy'||run.args[0]==='secret'));
 assert.equal(h.requests.length,0);assert.ok(!h.reports.some(message=>message.startsWith('Staging ready:')));
});

test('both D1 creations are verified by re-listing and never fall back to invented IDs',async()=>{
 for(const options of [{hideCreatedDatabase:true},{hideCreatedContactsDatabase:true}]){
  const h=harness(options);
  await assert.rejects(()=>deployCloudflareStaging({env:{},...h}),/not found after creation/);
  assert.ok(!h.runs.some(run=>run.args[0]==='deploy'||run.args[0]==='secret'));
 }
});

test('research and contact databases resolving to the same ID fail before migrations or deployment',async()=>{
 for(const existing of [false,true]){
  const h=harness({existing,sameDatabaseId:true});
  await assert.rejects(()=>deployCloudflareStaging({env:{},...h}),/two independent D1 databases/);
  assert.ok(!h.runs.some(run=>run.args[1]==='migrations'||run.args[0]==='deploy'||run.args[0]==='secret'));
  assert.equal(h.requests.length,0);
 }
});

test('only the actual exact staging workers.dev URL is accepted',()=>{
 assert.equal(deploymentOrigin('  '+ORIGIN+'\n'),ORIGIN);
 for(const output of ['https://production.actual-build-account.workers.dev','https://preview-'+STAGING.worker+'.actual-build-account.workers.dev',ORIGIN+'.evil.test',ORIGIN+'\nhttps://'+STAGING.worker+'.another-account.workers.dev'])assert.throws(()=>deploymentOrigin(output),/No URL was guessed/);
});

test('failed pilot or storage health checks prevent a ready result after bounded retries',async()=>{
 for(const invalidHealth of [{...healthy,stagingOnly:false},{...healthy,storageReady:false},{...healthy,protocol:'different-protocol'}]){
  const h=harness({existing:true,secrets:['DRAW_SECRET','ADMIN_TOKEN'],health:invalidHealth});
  await assert.rejects(()=>deployCloudflareStaging({env:{},...h}),/health check is not ready/);
  assert.equal(h.requests.length,6);assert.ok(!h.reports.some(message=>message.startsWith('Staging ready:')));
 }
});
