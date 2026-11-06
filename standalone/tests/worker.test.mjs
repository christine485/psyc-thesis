import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fetchHandler} from '../src/index.ts';
import {PROTOCOL,CONSENT,ratingWords} from '../../docs/modules/protocol.mjs';
const origin='https://christine485.github.io';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(new URL('../migrations/0001_slots.sql',import.meta.url),'utf8'));
  const statement=(sql,args=[])=>({bind(...next){return statement(sql,next);},first:async()=>sqlite.prepare(sql).get(...args)||null,run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}),all:async()=>({results:sqlite.prepare(sql).all(...args)})});
  const DB={prepare:sql=>statement(sql),async batch(items){sqlite.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const objects=new Map();const BUCKET={async put(key,value,opts){if(opts?.onlyIf&&objects.has(key))return null;objects.set(key,value);return {key};},async get(key){return objects.has(key)?{json:async()=>JSON.parse(objects.get(key))}:null;},async list({prefix,limit=1000}){return {objects:[...objects.keys()].filter(x=>x.startsWith(prefix)).slice(0,limit).map(key=>({key})),truncated:false};}};
  return {env:{DB,BUCKET,DRAW_SECRET:'synthetic-draw-key-at-least-32-characters',ADMIN_TOKEN:'synthetic-admin-token-at-least-32-characters'},sqlite,objects};
}
function req(path,body,extra={}){return new Request('https://api.example.test'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});}
function admin(path,env,extra={}){return new Request('https://api.example.test'+path,{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,...extra}});}
const start=token=>({token,mode:'pilot',protocol:PROTOCOL,consent:CONSENT,consented:true});
function complete(plan,token){return {...start(token),drawNonce:crypto.randomUUID(),demographics:{gender:'女',age:23,education:'學士'},device:{kind:'手機',viewportWidth:390,viewportHeight:844},responses:plan.trials.map(t=>{const freeText=t.type==='attention'?'2':'系統測試勿分析';return {type:t.type,stimulus:t.stimulus,freeText,ratings:Object.fromEntries(ratingWords(freeText,t,plan.rowSeed).map(w=>[w,2])),durationMs:8000,namingMs:3000,width:310,height:310};})};}

test('health checks actual schema and bucket without exposing records',async()=>{
  const {env}=fixture();const response=await fetchHandler(new Request('https://api.example.test/api/health'),env);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,protocol:PROTOCOL,images:270,configurationReady:true,storageReady:true,maintenance:false,stagingOnly:false});
  env.BUCKET.list=async()=>{throw Error('provider detail');};const failed=await fetchHandler(new Request('https://api.example.test/api/health'),env);assert.equal(failed.status,503);assert.equal((await failed.json()).storageReady,false);
});
test('GitHub origin preflight allowed, unknown origins and headers refused',async()=>{
  const {env}=fixture();const preflight=new Request('https://api.example.test/api/study/start',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
  const allowed=await fetchHandler(preflight,env);assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await fetchHandler(req('/api/study/start',{}, {Origin:'https://untrusted.example'}),env)).status,403);
  assert.equal((await fetchHandler(new Request(preflight,{headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'}}),env)).status,403);
});
test('admin export and counts require secret, reject cross-origin and secretless startup',async()=>{
  const {env}=fixture();assert.equal((await fetchHandler(new Request('https://api.example.test/api/admin/status'),env)).status,403);
  assert.equal((await fetchHandler(admin('/api/admin/status',env,{Authorization:'Bearer '+env.ADMIN_TOKEN+'wrong'}),env)).status,403);
  assert.equal((await fetchHandler(admin('/api/admin/status',env,{Origin:origin}),env)).status,403);
  assert.equal((await fetchHandler(admin('/api/admin/status',env),env)).status,200);
  assert.equal((await fetchHandler(admin('/api/admin/export?mode=typo&kind=draw',env),env)).status,400);
  env.DRAW_SECRET='';assert.equal((await fetchHandler(req('/api/study/start',start(crypto.randomUUID())),env)).status,503);
});
test('full pilot flow saves once, preserves live isolation, draw and research remain separate',async()=>{
  const {env,objects}=fixture(),token=crypto.randomUUID();const allocation=await fetchHandler(req('/api/study/start',start(token)),env);assert.equal(allocation.status,200);
  const plan=await allocation.json();assert.equal(plan.trials.length,28);const body=complete(plan,token);
  const first=await fetchHandler(req('/api/study/submit',body),env);assert.equal(first.status,200);const result=await first.json();assert.equal(result.submitted,true);assert.equal(result.eligible,true);
  const retry=await fetchHandler(req('/api/study/submit',body),env);assert.deepEqual(await retry.json(),result);
  const status=await(await fetchHandler(admin('/api/admin/status',env),env)).json();assert.equal(status.modes.pilot.submitted,1);assert.equal(status.modes.live.submitted,0);
  const research=await(await fetchHandler(admin('/api/admin/export?mode=pilot&kind=research',env),env)).text();assert.ok(research.includes('系統測試勿分析'));assert.ok(!research.includes(body.drawNonce));
  const draw=await fetchHandler(req('/api/draw',{mode:'pilot',permit:result.drawPermit,phone:'91234567'}),env);assert.equal(draw.status,200);
  assert.ok(!research.includes('91234567'));assert.ok(!JSON.stringify([...objects.values()]).includes(token));
  const phones=await(await fetchHandler(admin('/api/admin/export?mode=pilot&kind=draw',env),env)).text();assert.ok(phones.includes('91234567'));assert.ok(!phones.includes('participant_code'));
});
test('maintenance freezes all participant writes while authenticated status/export work',async()=>{
  const {env,sqlite}=fixture();env.STUDY_MAINTENANCE='1';
  for(const path of ['/api/study/start','/api/study/submit','/api/draw'])assert.equal((await fetchHandler(req(path,start(crypto.randomUUID())),env)).status,503);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM slots').get().n,0);
  assert.equal((await fetchHandler(admin('/api/admin/status',env),env)).status,200);
  assert.equal((await fetchHandler(admin('/api/admin/export?mode=pilot&kind=research',env),env)).status,200);
  assert.equal((await fetchHandler(new Request('https://api.example.test/api/health'),env)).status,503);
});
test('malformed and oversized requests refused before writing, unknown mode never becomes live',async()=>{
  const {env,sqlite}=fixture();assert.equal((await fetchHandler(req('/api/study/start',[]),env)).status,400);
  assert.equal((await fetchHandler(req('/api/study/start',{...start(crypto.randomUUID()),mode:'typo'}),env)).status,400);
  assert.equal((await fetchHandler(req('/api/study/start',{data:'x'.repeat(160000)}),env)).status,400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM slots').get().n,0);
});

test('isolated staging accepts its own frontend but refuses all live-mode writes',async()=>{
  const {env,sqlite}=fixture();
  const ownOrigin='https://api.example.test';
  assert.equal((await fetchHandler(req('/api/study/start',start(crypto.randomUUID()),{Origin:ownOrigin}),env)).status,403);
  env.STAGING_ONLY='1';
  const pilot=await fetchHandler(req('/api/study/start',start(crypto.randomUUID()),{Origin:ownOrigin}),env);
  assert.equal(pilot.status,200);assert.equal(pilot.headers.get('Access-Control-Allow-Origin'),ownOrigin);
  for(const path of ['/api/study/start','/api/study/submit','/api/draw'])assert.equal((await fetchHandler(req(path,{...start(crypto.randomUUID()),mode:'live'},{Origin:ownOrigin}),env)).status,400);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM slots WHERE mode LIKE 'live:%'").get().n,0);
  assert.equal((await fetchHandler(req('/api/study/start',start(crypto.randomUUID()),{Origin:'https://attacker.example'}),env)).status,403);
  const health=await(await fetchHandler(new Request(ownOrigin+'/api/health'),env)).json();assert.equal(health.stagingOnly,true);
});
