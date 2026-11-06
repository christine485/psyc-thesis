import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {DatabaseSync} from 'node:sqlite';import {stripTypeScriptTypes} from 'node:module';
import {PROTOCOL,CONSENT,ratingWords} from '../docs/modules/protocol.mjs';
const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../drizzle/0000_overjoyed_texas_twister.sql',import.meta.url),'utf8'));
const d1={prepare(sql){return {bind(...args){return {first:async()=>db.prepare(sql).get(...args)||null,run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}}),all:async()=>({results:db.prepare(sql).all(...args)})};},run:async()=>({meta:{changes:Number(db.prepare(sql).run().changes)}})};},async batch(items){db.exec('BEGIN');try{const result=[];for(const p of items)result.push(await p.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
const objects=new Map();const r2={async put(key,value,opts){if(opts?.onlyIf&&objects.has(key))return null;objects.set(key,value);return {key};},async get(key){return objects.has(key)?{json:async()=>JSON.parse(objects.get(key))}:null;},async list({prefix}){return {objects:[...objects.keys()].filter(x=>x.startsWith(prefix)).map(key=>({key})),truncated:false};}};
globalThis.__studyTestBindings={DB:d1,BUCKET:r2,ADMIN_EMAIL:'owner@example.test',DRAW_SECRET:'synthetic-test-key-not-used-in-production'};
globalThis.__studyTestUser=null;
const coreURL=pathToFileURL(path.resolve('lib/study-core.ts')).href;
let source=fs.readFileSync(new URL('../lib/server.ts',import.meta.url),'utf8').replace(/import \{env\} from 'cloudflare:workers';/,"const env=globalThis.__studyTestBindings;").replace(/import \{getChatGPTUser\} from '..\/app\/chatgpt-auth';/,"const getChatGPTUser=async()=>globalThis.__studyTestUser;").replaceAll("'./study-core'",JSON.stringify(coreURL));
source=stripTypeScriptTypes(source);
const server=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const uid=()=>crypto.randomUUID();
function bodyFor(plan,token,valid=true){return {token,drawNonce:uid(),mode:'pilot',protocol:PROTOCOL,consent:CONSENT,consented:true,demographics:{gender:'女',age:23,education:'學士'},device:{kind:'手機',viewportWidth:390,viewportHeight:844},responses:plan.trials.map((t,i)=>{const freeText=t.type==='attention'?(valid?'2':'1'):i%3===0?'沒有感覺':i%3===1?'開心、緊張':'唔開心';return {type:t.type,stimulus:t.stimulus,freeText,ratings:Object.fromEntries(ratingWords(freeText,t,plan.rowSeed).map(w=>[w,t.type==='attention'?2:4])),durationMs:8000,namingMs:3000,width:310,height:310};})};}

test('valid draw permit cannot register an overseas number',async()=>{const permit=await server.signPermit(uid(),'pilot');const before=objects.size;await assert.rejects(()=>server.enterDraw({mode:'pilot',permit,phone:'+447700900123'}),/香港電話/);assert.equal(objects.size,before);});
test('real schema: ten allocations balanced, reclaimed expired slot reused',async()=>{
 const plans=[];for(let i=0;i<10;i++)plans.push(await server.allocate({token:uid(),mode:'pilot',protocol:PROTOCOL,consent:CONSENT,consented:true}));
 assert.equal(new Set(plans.flatMap(p=>p.trials.filter(t=>t.type==='main').map(t=>t.stimulus))).size,270);
 db.prepare('UPDATE slots SET expires=0 WHERE mode=? AND id=?').run('pilot:'+PROTOCOL,plans[0].slot);
 const replacement=await server.allocate({token:uid(),mode:'pilot',protocol:PROTOCOL,consent:CONSENT,consented:true});assert.equal(replacement.slot,plans[0].slot);
 assert.deepEqual(replacement.trials.filter(t=>t.type==='main').map(t=>t.stimulus).sort(),plans[0].trials.filter(t=>t.type==='main').map(t=>t.stimulus).sort());
});
test('submission idempotence, failed attention preserved, eligible permit, separate contact data',async()=>{
 const token=uid(),plan=await server.allocate({token,mode:'pilot',protocol:PROTOCOL,consent:CONSENT,consented:true}),body=bodyFor(plan,token);
 const a=await server.submit(body),b=await server.submit(body);assert.equal(a.submitted,true);assert.equal(a.drawPermit,b.drawPermit);
 assert.equal((await server.records('pilot')).length,1);assert.equal((await server.records('live')).length,0);
 await server.enterDraw({mode:'pilot',permit:a.drawPermit,phone:'+85291234567'});await server.enterDraw({mode:'pilot',permit:a.drawPermit,phone:'91234567'});
 const storedResearch=JSON.stringify(await server.records('pilot'));assert.ok(!storedResearch.includes('91234567'));assert.ok(!storedResearch.includes(body.drawNonce));assert.ok(!storedResearch.includes('drawPermit'));
 const phoneObject=JSON.parse([...objects.entries()].find(([key])=>key.includes('/phones/'))[1]);assert.deepEqual(phoneObject,{phone:'+85291234567'});
 const contactText=JSON.stringify([...objects.values()]);assert.ok(!contactText.includes(token));assert.ok(!contactText.includes('participantCode'));
 await assert.rejects(()=>server.enterDraw({mode:'pilot',permit:a.drawPermit,phone:'92345678'}));
 const token2=uid(),p2=await server.allocate({token:token2,mode:'pilot',protocol:PROTOCOL,consent:CONSENT,consented:true}),bad=await server.submit(bodyFor(p2,token2,false));assert.equal(bad.eligible,false);assert.equal(bad.drawPermit,null);assert.equal((await server.records('pilot')).length,2);
 await assert.rejects(()=>server.enterDraw({mode:'pilot',permit:null,phone:'93456789'}));
 const research=await server.researchCSV('pilot');assert.ok(research.includes('沒有感覺'));assert.ok(research.includes('false'));const draw=await server.drawCSV('pilot');assert.ok(draw.includes('91234567'));assert.ok(!draw.includes('participant'));
});
test('CORS and private researcher boundary; forged or cross-mode permits rejected',async()=>{
 const req=new Request('https://example.test/api/study/start',{method:'POST',headers:{origin:'https://christine485.github.io','content-type':'application/json'},body:'{}'});
 assert.deepEqual(await server.readBody(req),{});assert.equal(server.options(req).status,204);assert.equal(server.cors(req)['Access-Control-Allow-Origin'],'https://christine485.github.io');
 const bad=new Request('https://example.test/api/study/start',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{}'});await assert.rejects(()=>server.readBody(bad));assert.equal(server.options(bad).status,403);
 assert.equal(await server.isAdmin(),false);globalThis.__studyTestUser={email:'not-owner@example.test'};assert.equal(await server.isAdmin(),false);globalThis.__studyTestUser={email:'owner@example.test'};assert.equal(await server.isAdmin(),true);globalThis.__studyTestUser=null;
 await assert.rejects(()=>server.enterDraw({mode:'live',permit:'pilot:'+uid()+':'+('0'.repeat(64)),phone:'94567890'}));
});

test('maintenance prevents all Sites participant request bodies while admin remains authorized',async()=>{
 globalThis.__studyTestBindings.STUDY_MAINTENANCE='1';globalThis.__studyTestUser={email:'owner@example.test'};
 for(const path of ['/api/study/start','/api/study/submit','/api/draw']){const req=new Request('https://example.test'+path,{method:'POST',headers:{origin:'https://christine485.github.io','content-type':'application/json'},body:'{}'});await assert.rejects(()=>server.readBody(req),/維護/);}
 assert.equal(await server.isAdmin(),true);delete globalThis.__studyTestBindings.STUDY_MAINTENANCE;globalThis.__studyTestUser=null;
});
