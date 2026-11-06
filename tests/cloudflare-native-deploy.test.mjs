import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {deployCloudflareStaging,resolveAccount,parseBuckets,deploymentOrigin} from '../scripts/deploy-cloudflare-staging.mjs';
import {STAGING} from '../scripts/deploy-hk-staging.mjs';
import {PROTOCOL} from '../docs/modules/protocol.mjs';

const ACCOUNT='a'.repeat(32),OTHER_ACCOUNT='b'.repeat(32);
const DB='01234567-89ab-cdef-0123-456789abcdef';
const ORIGIN='https://'+STAGING.worker+'.actual-build-account.workers.dev';
const PRIVATE='synthetic-private-output-never-print';
const healthy={ok:true,stagingOnly:true,configurationReady:true,storageReady:true,protocol:PROTOCOL,images:270};

function harness({existing=false,secrets=[],accounts=[ACCOUNT],deployment=ORIGIN,health=healthy,r2Disabled=false,hideCreatedDatabase=false,hideCreatedBucket=false}={}){
 let dbExists=existing,bucketExists=existing,temp,config;
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
   runs.push({args:[...args],input:options.input});
   if(args[0]==='whoami'){
    assert.deepEqual(args.slice(0,2),['whoami','--json']);
    return JSON.stringify({loggedIn:true,email:PRIVATE,accounts:accounts.map(id=>({id,name:'private-account-name'})),tokenPermissions:['metadata-only']});
   }
   assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID,ACCOUNT);
   if(args[0]==='r2'){
    if(r2Disabled)throw Error(PRIVATE+' Billing must be enabled');
    if(args[2]==='list')return '\u001b[32mListing buckets...\u001b[0m\n\nname:           production-draw\ncreation_date:  2026-01-01\n'+(bucketExists&&!hideCreatedBucket?'\nname:           '+STAGING.bucket+'\ncreation_date:  2026-11-06\n':'');
    assert.deepEqual(args.slice(0,4),['r2','bucket','create',STAGING.bucket]);assert.ok(args.includes('--no-update-config'));
    bucketExists=true;return 'Created bucket '+STAGING.bucket;
   }
   if(args[0]==='d1'&&args[1]==='list')return JSON.stringify([{name:'production-research',uuid:'fedcba98-7654-3210-fedc-ba9876543210'},...(dbExists&&!hideCreatedDatabase?[{name:STAGING.database,uuid:DB}]:[])]);
   if(args[0]==='d1'&&args[1]==='create'){
    assert.equal(args[2],STAGING.database);assert.ok(args.includes('--no-update-config'));
    dbExists=true;return 'Created '+STAGING.database;
   }
   config=cfg;
   assert.equal(cfg.account_id,ACCOUNT);assert.equal(cfg.vars.STAGING_ONLY,'1');
   assert.equal(cfg.d1_databases[0].database_name,STAGING.database);assert.equal(cfg.d1_databases[0].database_id,DB);
   assert.equal(cfg.r2_buckets[0].bucket_name,STAGING.bucket);
   assert.deepEqual(cfg.assets.run_worker_first,['/api/*']);
   if(args[0]==='d1'){
    assert.deepEqual(args.slice(0,5),['d1','migrations','apply',STAGING.database,'--remote']);return 'Migration applied';
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

test('fresh native build uses inherited Wrangler auth, creates only exact staging resources and verifies actual URL/storage',async()=>{
 const h=harness();const result=await deployCloudflareStaging({env:{WRANGLER_CI_OVERRIDE_NAME:STAGING.worker},...h});
 assert.deepEqual(result,{url:ORIGIN+'/?mode=pilot',databaseId:DB,createdDatabase:true,createdBucket:true,productionChanged:false});
 const commands=h.runs.map(run=>run.args.slice(0,3).join(' '));
 assert.ok(commands.indexOf('r2 bucket list')<commands.findIndex(command=>command.startsWith('d1 create')));
 assert.equal(commands.filter(command=>command==='d1 list --json').length,2,'Creation must be followed by authoritative D1 re-listing.');
 assert.equal(commands.filter(command=>command==='r2 bucket list').length,2,'Creation must be followed by authoritative R2 re-listing.');
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
 assert.equal(result.createdDatabase,false);assert.equal(result.createdBucket,false);
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

test('R2 activation failure is actionable, redacted, and precedes every resource creation',async()=>{
 const h=harness({r2Disabled:true});
 await assert.rejects(()=>deployCloudflareStaging({env:{},...h}),error=>/activation/.test(error.message)&&/billing details/.test(error.message)&&!error.message.includes(PRIVATE));
 assert.deepEqual(h.runs.map(run=>run.args[0]),['whoami','r2']);
});

test('D1 and R2 creation are verified by re-listing and never fall back to invented IDs',async()=>{
 for(const options of [{hideCreatedDatabase:true},{hideCreatedBucket:true}]){
  const h=harness(options);
  await assert.rejects(()=>deployCloudflareStaging({env:{},...h}),/not found after creation/);
  assert.ok(!h.runs.some(run=>run.args[0]==='deploy'||run.args[0]==='secret'));
 }
});

test('R2 parser matches exact labelled names and refuses unrecognized list output',()=>{
 assert.deepEqual(parseBuckets('Listing buckets...\n\nname: '+STAGING.bucket+'-extra\ncreation_date: now\n'),[STAGING.bucket+'-extra']);
 assert.deepEqual(parseBuckets('Listing buckets...\n'),[]);
 assert.throws(()=>parseBuckets(PRIVATE),error=>!error.message.includes(PRIVATE));
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
