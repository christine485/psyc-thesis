import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchHandler} from '../src/index.ts';
import {sqliteD1} from './sqlite-d1.mjs';
import {PROTOCOL,CONSENT,ratingWords} from '../../docs/modules/protocol.mjs';
const origin='https://christine485.github.io';
function fixture(){
  const {sqlite,DB}=sqliteD1(new URL('../migrations/0001_slots.sql',import.meta.url));
  const {sqlite:contacts,DB:CONTACTS_DB}=sqliteD1(new URL('../contact-migrations/0001_contacts.sql',import.meta.url));
  return {env:{DB,CONTACTS_DB,DRAW_SECRET:'synthetic-draw-key-at-least-32-characters',ADMIN_TOKEN:'synthetic-admin-token-at-least-32-characters'},sqlite,contacts};
}
function req(path,body,extra={}){return new Request('https://api.example.test'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});}
function admin(path,env,extra={}){return new Request('https://api.example.test'+path,{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,...extra}});}
const start=token=>({token,mode:'pilot',protocol:PROTOCOL,consent:CONSENT,consented:true});
function complete(plan,token){return {...start(token),drawNonce:crypto.randomUUID(),demographics:{gender:'女',age:23,education:'學士'},device:{kind:'手機',viewportWidth:390,viewportHeight:844},responses:plan.trials.map(t=>{const freeText=t.type==='attention'?'2':'系統測試勿分析';return {type:t.type,stimulus:t.stimulus,freeText,ratings:Object.fromEntries(ratingWords(freeText,t,plan.rowSeed).map(w=>[w,2])),durationMs:8000,namingMs:3000,width:310,height:310};})};}

test('health checks both actual database schemas without exposing records',async()=>{
  const {env,contacts}=fixture();const response=await fetchHandler(new Request('https://api.example.test/api/health'),env);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,protocol:PROTOCOL,images:270,configurationReady:true,storageReady:true,maintenance:false,stagingOnly:false});
  contacts.exec('DROP TABLE contact_objects');const failed=await fetchHandler(new Request('https://api.example.test/api/health'),env);assert.equal(failed.status,503);assert.equal((await failed.json()).storageReady,false);
});
test('GitHub origin preflight allowed, unknown origins and headers refused',async()=>{
  const {env}=fixture();const preflight=new Request('https://api.example.test/api/study/start',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
  const allowed=await fetchHandler(preflight,env);assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await fetchHandler(req('/api/study/start',{}, {Origin:'https://untrusted.example'}),env)).status,403);
  assert.equal((await fetchHandler(new Request(preflight,{headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'}}),env)).status,403);
});
test('admin export and counts require a secret and accept only the trusted website origins',async()=>{
  const {env}=fixture();assert.equal((await fetchHandler(new Request('https://api.example.test/api/admin/status'),env)).status,403);
  assert.equal((await fetchHandler(admin('/api/admin/status',env,{Authorization:'Bearer '+env.ADMIN_TOKEN+'wrong'}),env)).status,403);
  const website=await fetchHandler(admin('/api/admin/status',env,{Origin:origin}),env);assert.equal(website.status,200);assert.equal(website.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await fetchHandler(admin('/api/admin/status',env,{Origin:'https://untrusted.example'}),env)).status,403);
  assert.equal((await fetchHandler(admin('/api/admin/status',env),env)).status,200);
  assert.equal((await fetchHandler(admin('/api/admin/export?mode=typo&kind=draw',env),env)).status,400);
  const contacts=env.CONTACTS_DB;env.CONTACTS_DB=undefined;assert.equal((await fetchHandler(req('/api/study/start',start(crypto.randomUUID())),env)).status,503);env.CONTACTS_DB=contacts;
  env.DRAW_SECRET='';assert.equal((await fetchHandler(req('/api/study/start',start(crypto.randomUUID())),env)).status,503);
});
test('website admin preflight is read-only, origin-specific and does not bypass authorization',async()=>{
  const {env}=fixture();
  for(const route of ['/api/admin/status','/api/admin/export-index?mode=pilot','/api/admin/coverage?mode=pilot','/api/admin/export?mode=pilot&kind=research']){
    const url='https://api.example.test'+route;
    const request=extra=>new Request(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization',...extra}});
    const response=await fetchHandler(request(),env);assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(response.headers.get('Access-Control-Allow-Headers'),'Authorization');
    for(const extra of [{Origin:'https://attacker.example'},{Origin:''},{'Access-Control-Request-Method':'POST'},{'Access-Control-Request-Headers':'authorization, x-other'}])assert.equal((await fetchHandler(request(extra),env)).status,403);
    assert.equal((await fetchHandler(new Request(url,{headers:{Origin:origin}}),env)).status,403);
  }
  const denied=await fetchHandler(admin('/api/admin/coverage?mode=pilot',env,{Origin:'https://attacker.example'}),env);assert.equal(denied.status,403);
  const coverage=await fetchHandler(admin('/api/admin/coverage?mode=pilot',env,{Origin:origin}),env);assert.equal(coverage.status,200);assert.equal((await coverage.json()).images.length,270);
});
test('full pilot flow saves once, preserves live isolation, draw and research remain separate',async()=>{
  const {env,sqlite,contacts}=fixture(),token=crypto.randomUUID();const allocation=await fetchHandler(req('/api/study/start',start(token)),env);assert.equal(allocation.status,200);
  const plan=await allocation.json();assert.equal(plan.trials.length,28);const body=complete(plan,token);
  const first=await fetchHandler(req('/api/study/submit',body),env);assert.equal(first.status,200);const result=await first.json();assert.equal(result.submitted,true);assert.equal(result.eligible,true);
  const retry=await fetchHandler(req('/api/study/submit',body),env);assert.deepEqual(await retry.json(),result);
  const status=await(await fetchHandler(admin('/api/admin/status',env),env)).json();assert.equal(status.modes.pilot.submitted,1);assert.equal(status.modes.live.submitted,0);
  const research=await(await fetchHandler(admin('/api/admin/export?mode=pilot&kind=research',env),env)).text();assert.ok(research.includes('系統測試勿分析'));assert.ok(!research.includes(body.drawNonce));
  const draw=await fetchHandler(req('/api/draw',{mode:'pilot',permit:result.drawPermit,phone:'91234567'}),env);assert.equal(draw.status,200);
  assert.equal((await fetchHandler(req('/api/draw',{mode:'pilot',permit:result.drawPermit,phone:'91234567'}),env)).status,200);
  assert.equal((await fetchHandler(req('/api/draw',{mode:'pilot',permit:result.drawPermit,phone:'92345678'}),env)).status,400);
  const storedContacts=contacts.prepare('SELECT key,value FROM contact_objects').all();
  assert.equal(storedContacts.length,2);assert.ok(storedContacts.every(row=>row.key.startsWith('pilot/')));
  assert.ok(!research.includes('91234567'));assert.ok(!JSON.stringify(storedContacts).includes(token));
  const storedResearch=JSON.stringify(sqlite.prepare('SELECT * FROM slots').all());
  assert.ok(!storedResearch.includes('91234567'));assert.ok(!storedResearch.includes(body.drawNonce));assert.ok(!storedResearch.includes(result.drawPermit));
  assert.ok(!/participantCode|responses|rowSeed|token_hash/.test(JSON.stringify(storedContacts)));
  assert.throws(()=>contacts.prepare('SELECT * FROM slots'),/no such table/);assert.throws(()=>sqlite.prepare('SELECT * FROM contact_objects'),/no such table/);
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
  assert.equal((await fetchHandler(admin('/api/admin/status',env,{Origin:origin}),env)).status,403);
  assert.equal((await fetchHandler(new Request(ownOrigin+'/api/admin/status',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'Authorization'}}),env)).status,403);
});
