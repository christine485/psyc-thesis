import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {deployStaging,requireCredentials,STAGING} from '../scripts/deploy-hk-staging.mjs';
import {PROTOCOL} from '../docs/modules/protocol.mjs';

const env={CLOUDFLARE_API_TOKEN:'synthetic-token-not-used-on-network',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32)};
const ok=result=>Response.json({success:true,result});
function harness({existing=false,secrets=[]}={}){
 const requests=[],runs=[],reports=[];
 let capturedConfig;
 return {requests,runs,reports,get config(){return capturedConfig;},
  fetchImpl:async(url,opts={})=>{
   requests.push({url,method:opts.method||'GET',body:opts.body});
   if(url.endsWith('/api/health'))return Response.json({ok:true,stagingOnly:true,configurationReady:true,storageReady:true,protocol:PROTOCOL,images:270});
   assert.equal(opts.headers.Authorization,'Bearer '+env.CLOUDFLARE_API_TOKEN);
   if(url.endsWith('/workers/subdomain'))return ok({subdomain:'synthetic-staging'});
   if(url.includes('/d1/database?'))return ok(existing?[{name:STAGING.database,uuid:'existing-db'}]:[]);
   if(url.endsWith('/d1/database')){assert.equal(opts.method,'POST');assert.deepEqual(JSON.parse(opts.body),{name:STAGING.database});return ok({uuid:'new-db'});}
   if(url.endsWith('/r2/buckets')){if(opts.method==='POST'){assert.deepEqual(JSON.parse(opts.body),{name:STAGING.bucket});return ok({name:STAGING.bucket});}return ok({buckets:existing?[{name:STAGING.bucket}]:[]});}
   if(url.endsWith('/secrets'))return ok(secrets.map(name=>({name,type:'secret_text'})));
   throw Error('Unexpected test API path');
  },
  run:async(args,options)=>{
   const configPath=args[args.indexOf('--config')+1];
   if(args[0]==='deploy')assert.ok(args.includes('--keep-vars'),'Reruns must preserve existing Worker secrets.');
   capturedConfig=JSON.parse(await fs.readFile(configPath,'utf8'));
   const cfg=capturedConfig;
   assert.equal(cfg.name,STAGING.worker);assert.equal(cfg.vars.STAGING_ONLY,'1');assert.deepEqual(cfg.assets.run_worker_first,['/api/*']);
   const app=await fs.readFile(cfg.assets.directory+'/app.js','utf8');assert.ok(app.includes("const mode='pilot',preview="));
   const config=await fs.readFile(cfg.assets.directory+'/config.js','utf8');assert.ok(config.includes('API_BASE=location.origin'));assert.ok(!config.includes('chatgpt.site'));
   assert.ok(!JSON.stringify(cfg).includes(env.CLOUDFLARE_API_TOKEN));assert.ok(!args.join(' ').includes(env.CLOUDFLARE_API_TOKEN));
   assert.equal(await fs.readlink(options.env.WRANGLER_LOG_PATH),'/dev/null');
   runs.push({args,input:options.input});
  },report:value=>reports.push(value)};
}

test('staging credentials fail before any remote operation',async()=>{
 assert.throws(()=>requireCredentials({}),/repository secret/);
 assert.throws(()=>requireCredentials({CLOUDFLARE_API_TOKEN:'x'}),/account ID/);
 let calls=0;await assert.rejects(()=>deployStaging({env:{},fetchImpl:async()=>{calls++;}}));assert.equal(calls,0);
});
test('fresh staging provisions isolated resources, generates secrets only through stdin, and publishes a pilot-only asset copy',async()=>{
 const h=harness(),result=await deployStaging({env,fetchImpl:h.fetchImpl,run:h.run,report:h.report});
 assert.equal(result.productionChanged,false);assert.equal(result.createdDatabase,true);assert.equal(result.createdBucket,true);
 assert.equal(result.url,'https://'+STAGING.worker+'.synthetic-staging.workers.dev/?mode=pilot');
 assert.equal(h.runs.length,3);const secretRun=h.runs[2],secrets=JSON.parse(secretRun.input);
 assert.deepEqual(Object.keys(secrets).sort(),['ADMIN_TOKEN','DRAW_SECRET']);assert.equal(secrets.ADMIN_TOKEN.length,64);assert.equal(secrets.DRAW_SECRET.length,64);
 for(const value of Object.values(secrets)){assert.ok(!h.reports.join('').includes(value));assert.ok(!h.runs.map(r=>r.args.join(' ')).join('').includes(value));}
 await assert.rejects(()=>fs.access(h.config.assets.directory));
});
test('rerun reuses exact staging resources and never rotates existing secret values',async()=>{
 const h=harness({existing:true,secrets:['DRAW_SECRET','ADMIN_TOKEN']});
 const result=await deployStaging({env,fetchImpl:h.fetchImpl,run:h.run,report:h.report});
 assert.equal(result.createdDatabase,false);assert.equal(result.createdBucket,false);assert.equal(h.runs.length,2);assert.ok(!h.requests.some(x=>x.method==='POST'));
});
test('API refusal fails closed without revealing returned messages or credentials',async()=>{
 const output=[];
 await assert.rejects(()=>deployStaging({env,fetchImpl:async()=>Response.json({success:false,errors:[{code:10000,message:'untrusted '+env.CLOUDFLARE_API_TOKEN}]},{status:403}),report:x=>output.push(x)}),error=>error.message.includes('HTTP 403')&&!error.message.includes(env.CLOUDFLARE_API_TOKEN));
 assert.deepEqual(output,[]);
});
