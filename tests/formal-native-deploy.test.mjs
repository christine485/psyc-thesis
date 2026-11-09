import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {deployCloudflareFormal,formalDeploymentOrigin,FORMAL,PARTICIPANT_ENTRY} from '../scripts/deploy-cloudflare-formal.mjs';
import {STAGING} from '../scripts/deploy-hk-staging.mjs';
import {PROTOCOL} from '../docs/modules/protocol.mjs';

const ACCOUNT='a'.repeat(32),DB='01234567-89ab-cdef-0123-456789abcdef',CONTACTS='12345678-9abc-def0-1234-56789abcdef0';
const STAGE_DB='23456789-abcd-ef01-2345-6789abcdef01',STAGE_CONTACTS='3456789a-bcde-f012-3456-789abcdef012';
const ORIGIN='https://'+FORMAL.worker+'.actual-build-account.workers.dev',PRIVATE='synthetic-private-output-never-print';
const HEALTH={ok:true,stagingOnly:false,configurationReady:true,storageReady:true,maintenance:false,protocol:PROTOCOL,images:270};

function harness({existing=false,secrets=[],health=HEALTH,cors=true,adminCors=true,collision=null,hideCreated=false,deployment=ORIGIN,migrationFails=false}={}){
 let dbExists=existing,contactsExists=existing,temp;
 const values=new Map(secrets.map(name=>[name,'preserved-'+name])),runs=[],reports=[],requests=[];
 return {runs,reports,requests,values,get temp(){return temp;},report:value=>reports.push(value),pause:async()=>{},
  fetchImpl:async(url,options)=>{
   requests.push({url,options});assert.equal(options.redirect,'error');assert.ok(options.signal);
   if(url===ORIGIN+'/api/health')return Response.json(health);
   if(url===ORIGIN+'/api/admin/status'){
    assert.equal(options.method,'OPTIONS');assert.equal(options.headers.Origin,new URL(PARTICIPANT_ENTRY).origin);assert.equal(options.headers['Access-Control-Request-Method'],'GET');
    return new Response(null,{status:adminCors?204:403,headers:adminCors?{'Access-Control-Allow-Origin':new URL(PARTICIPANT_ENTRY).origin,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization'}:{}});
   }
   assert.equal(url,ORIGIN+'/api/study/start');assert.equal(options.method,'OPTIONS');
   assert.equal(options.headers.Origin,new URL(PARTICIPANT_ENTRY).origin);assert.equal(options.headers['Access-Control-Request-Method'],'POST');
   return new Response(null,{status:cors?204:403,headers:cors?{'Access-Control-Allow-Origin':new URL(PARTICIPANT_ENTRY).origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}:{}});
  },
  run:async(args,options)=>{
   const file=args[args.indexOf('--config')+1],config=JSON.parse(await fs.readFile(file,'utf8'));temp=path.dirname(file);
   assert.equal(config.name,FORMAL.worker);assert.equal(options.env.WRANGLER_CI_OVERRIDE_NAME,FORMAL.worker);assert.equal(options.env.WRANGLER_CI_MATCH_TAG,'preserved-ci-project-tag');
   assert.equal(await fs.readlink(options.env.WRANGLER_LOG_PATH),os.devNull);assert.ok(options.env.WRANGLER_LOG_PATH.endsWith('.log'));
   assert.ok(!args.includes('delete'));assert.ok(['whoami','d1','deploy','secret'].includes(args[0]));
   runs.push({args:[...args],input:options.input});
   if(args[0]==='whoami')return JSON.stringify({loggedIn:true,email:PRIVATE,accounts:[{id:ACCOUNT,name:PRIVATE}]});
   assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID,ACCOUNT);
   if(args[0]==='d1'&&args[1]==='list')return JSON.stringify([
    {name:STAGING.database,uuid:STAGE_DB},{name:STAGING.contactsDatabase,uuid:collision==='stage-pair'?STAGE_DB:STAGE_CONTACTS},
    ...(dbExists&&!hideCreated?[{name:FORMAL.database,uuid:collision==='stage-research'?STAGE_DB:DB}]:[]),
    ...(contactsExists?[{name:FORMAL.contactsDatabase,uuid:collision==='formal-pair'?DB:CONTACTS}]:[])
   ]);
   if(args[0]==='d1'&&args[1]==='create'){
    assert.ok([FORMAL.database,FORMAL.contactsDatabase].includes(args[2]));assert.ok(args.includes('--no-update-config'));
    if(args[2]===FORMAL.database)dbExists=true;else contactsExists=true;return PRIVATE;
   }
   assert.equal(config.account_id,ACCOUNT);assert.equal(config.vars.STAGING_ONLY,'0');assert.equal(config.workers_dev,true);assert.equal(Object.hasOwn(config,'r2_buckets'),false);
   assert.deepEqual(config.d1_databases,[
    {binding:'DB',database_name:FORMAL.database,database_id:DB,migrations_dir:path.resolve('standalone/migrations')},
    {binding:'CONTACTS_DB',database_name:FORMAL.contactsDatabase,database_id:CONTACTS,migrations_dir:path.resolve('standalone/contact-migrations')}
   ]);
   if(args[0]==='d1'){
    assert.deepEqual(args.slice(0,3),['d1','migrations','apply']);assert.ok([FORMAL.database,FORMAL.contactsDatabase].includes(args[3]));assert.ok(args.includes('--remote'));
    if(migrationFails)throw Error(PRIVATE);return PRIVATE;
   }
   if(args[0]==='deploy'){
    assert.ok(args.includes('--keep-vars'));const app=await fs.readFile(path.join(config.assets.directory,'app.js'),'utf8');
    assert.ok(app.includes("const mode=query.get('mode')==='pilot'?'pilot':'live',preview="));assert.ok(!app.includes("const mode='pilot',preview="));
    assert.equal((await fs.readdir(path.join(config.assets.directory,'stimuli'))).filter(file=>file.endsWith('.png')).length,270);
    assert.ok((await fs.readFile(path.join(config.assets.directory,'config.js'),'utf8')).includes('API_BASE=location.origin'));
    assert.ok((await fs.readFile(path.join(config.assets.directory,'researcher.html'),'utf8')).includes('login-form'));
    const landing=await fs.readFile(path.join(config.assets.directory,'index.html'),'utf8');assert.ok(landing.includes(PARTICIPANT_ENTRY));assert.ok(landing.includes('href="./researcher"'));assert.ok(!landing.includes('id="app"'));
    return 'Uploaded formal worker\n  \u001b[1m'+deployment+'\u001b[0m\nCurrent Version: example';
   }
   if(args[0]==='secret'&&args[1]==='list')return JSON.stringify([...values.keys()].map(name=>({name,type:'secret_text'})));
   if(args[0]==='secret'&&args[1]==='bulk'){
    for(const[name,value]of Object.entries(JSON.parse(options.input))){assert.ok(['DRAW_SECRET','ADMIN_TOKEN'].includes(name));assert.equal(values.has(name),false);assert.match(value,/^[a-f0-9]{64}$/);assert.ok(!args.join(' ').includes(value));assert.ok(!JSON.stringify(config).includes(value));values.set(name,value);}return PRIVATE+' '+options.input;
   }
   throw Error('Unexpected command');
  }
 };
}
const options=h=>({env:{WRANGLER_CI_OVERRIDE_NAME:FORMAL.worker,WRANGLER_CI_MATCH_TAG:'preserved-ci-project-tag'},...h});

test('fresh formal build provisions only its independent resources and verifies the actual URL, health and GitHub CORS',async()=>{
 const h=harness(),result=await deployCloudflareFormal(options(h));
 assert.deepEqual(result,{url:ORIGIN,adminURL:ORIGIN+'/researcher',participantURL:PARTICIPANT_ENTRY,databaseId:DB,contactsDatabaseId:CONTACTS,createdDatabase:true,createdContactsDatabase:true,stagingChanged:false,productionFrontendChanged:false});
 assert.deepEqual(h.runs.filter(run=>run.args[1]==='create').map(run=>run.args[2]),[FORMAL.database,FORMAL.contactsDatabase]);
 assert.equal(h.runs.filter(run=>run.args[1]==='list'&&run.args[0]==='d1').length,3);
 assert.deepEqual(h.runs.filter(run=>run.args[1]==='migrations').map(run=>run.args[3]),[FORMAL.database,FORMAL.contactsDatabase]);
 assert.equal(h.requests.length,3);assert.equal(h.values.size,2);assert.ok(h.reports.some(line=>line==='Formal backend ready: '+ORIGIN));
 assert.ok(!h.reports.join('').includes(PRIVATE));for(const value of h.values.values())assert.ok(!h.reports.join('').includes(value));
 await assert.rejects(()=>fs.access(h.temp));
});

test('repeat formal deployment preserves all existing secrets and does not recreate resources',async()=>{
 const h=harness({existing:true,secrets:['DRAW_SECRET','ADMIN_TOKEN','EXTRA_KEY']}),before=[...h.values];
 const result=await deployCloudflareFormal(options(h));assert.equal(result.createdDatabase,false);assert.equal(result.createdContactsDatabase,false);
 assert.deepEqual([...h.values],before);assert.ok(!h.runs.some(run=>run.args.includes('create')||run.args.includes('bulk')));
});

test('a missing admin key is generated privately without rotating an existing draw key',async()=>{
 const h=harness({existing:true,secrets:['DRAW_SECRET']});await deployCloudflareFormal(options(h));
 const bulk=h.runs.find(run=>run.args[1]==='bulk');assert.deepEqual(Object.keys(JSON.parse(bulk.input)),['ADMIN_TOKEN']);assert.equal(h.values.get('DRAW_SECRET'),'preserved-DRAW_SECRET');
});

test('the staging or another connected CI project fails before any authentication or mutation',async()=>{
 for(const name of [STAGING.worker,'unrelated-worker','']){
  const h=harness();await assert.rejects(()=>deployCloudflareFormal({...options(h),env:{WRANGLER_CI_OVERRIDE_NAME:name}}),/separate Cloudflare project/);
  assert.equal(h.runs.length,0);assert.equal(h.requests.length,0);assert.equal(h.temp,undefined);
 }
});

test('any formal/staging ID collision stops before migrations, deployment or secret handling',async()=>{
 for(const collision of ['stage-pair','stage-research','formal-pair']){
  const h=harness({existing:true,collision});await assert.rejects(()=>deployCloudflareFormal(options(h)),/different IDs/);
  assert.ok(!h.runs.some(run=>run.args[1]==='migrations'||run.args[0]==='deploy'||run.args[0]==='secret'));assert.equal(h.requests.length,0);
 }
});

test('creation must be verified by an authoritative relist and migration errors are redacted',async()=>{
 const missing=harness({hideCreated:true});await assert.rejects(()=>deployCloudflareFormal(options(missing)),/not found after creation/);
 assert.ok(!missing.runs.some(run=>run.args[1]==='migrations'||run.args[0]==='deploy'));
 const failed=harness({existing:true,migrationFails:true});await assert.rejects(()=>deployCloudflareFormal(options(failed)),error=>/formal D1 operation failed/.test(error.message)&&!error.message.includes(PRIVATE));
 assert.ok(!failed.runs.some(run=>run.args[0]==='deploy'||run.args[0]==='secret'));assert.equal(failed.requests.length,0);
});

test('only the exact, unambiguous formal Worker URL is accepted from Wrangler output',()=>{
 assert.equal(formalDeploymentOrigin('  '+ORIGIN+'/\n'),ORIGIN);
 for(const output of ['https://'+STAGING.worker+'.actual-build-account.workers.dev','https://preview-'+FORMAL.worker+'.actual-build-account.workers.dev',ORIGIN+'.evil.test',ORIGIN+'/other',ORIGIN+'\nhttps://'+FORMAL.worker+'.second-account.workers.dev'])assert.throws(()=>formalDeploymentOrigin(output),/No URL was guessed/);
});

test('pilot-only, unhealthy or maintenance deployments never report ready, even if upload succeeds',async()=>{
 for(const health of [{...HEALTH,stagingOnly:true},{...HEALTH,storageReady:false},{...HEALTH,maintenance:true},{...HEALTH,protocol:'different-protocol'}]){
  const h=harness({existing:true,secrets:['DRAW_SECRET','ADMIN_TOKEN'],health});await assert.rejects(()=>deployCloudflareFormal(options(h)),/health check is not ready/);
  assert.equal(h.requests.length,6);assert.ok(!h.reports.some(line=>line.startsWith('Formal backend ready:')));
 }
});

test('a formal backend without the exact GitHub preflight permission is not ready for cutover',async()=>{
 const h=harness({existing:true,secrets:['DRAW_SECRET','ADMIN_TOKEN'],cors:false});await assert.rejects(()=>deployCloudflareFormal(options(h)),/GitHub participant origin/);
 assert.equal(h.requests.length,2);assert.ok(!h.reports.some(line=>line.startsWith('Formal backend ready:')));
});

test('a formal backend must permit authenticated website reads before reporting ready',async()=>{
 const h=harness({existing:true,secrets:['DRAW_SECRET','ADMIN_TOKEN'],adminCors:false});await assert.rejects(()=>deployCloudflareFormal(options(h)),/GitHub researcher origin/);
 assert.equal(h.requests.length,3);assert.ok(!h.reports.some(line=>line.startsWith('Formal backend ready:')));
});
