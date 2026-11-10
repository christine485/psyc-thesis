import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchHandler} from '../src/index.ts';
import {createStudyServer} from '../../lib/study-core.ts';
import {createContactStore} from '../src/contact-store.ts';
import {sqliteD1} from './sqlite-d1.mjs';
import {PROTOCOL,CONSENT,ratingWords} from '../../docs/modules/protocol.mjs';

const origin='https://api.example.test';
function fixture(){
 const research=sqliteD1(new URL('../migrations/0001_slots.sql',import.meta.url));
 const contacts=sqliteD1(new URL('../contact-migrations/0001_contacts.sql',import.meta.url));
 const env={DB:research.DB,CONTACTS_DB:contacts.DB,DRAW_SECRET:'synthetic-export-draw-key-at-least-32-characters',ADMIN_TOKEN:'synthetic-export-admin-key-at-least-32-characters'};
 const study=createStudyServer(()=>({DB:env.DB,BUCKET:createContactStore(env.CONTACTS_DB),DRAW_SECRET:env.DRAW_SECRET}));
 const api=(route,headers={})=>fetchHandler(new Request(origin+route,{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN,...headers}}),env);
 async function seed(mode='pilot',{freeText='開心、緊張、害怕',invalidAttention=false}={}){
  const token=crypto.randomUUID(),start={token,mode,protocol:PROTOCOL,consent:CONSENT,consented:true};
  const plan=await study.allocate(start);
  const body={...start,drawNonce:crypto.randomUUID(),demographics:{gender:'其他',age:23,education:'學士'},device:{kind:'電腦',viewportWidth:1280,viewportHeight:800},responses:plan.trials.map(trial=>{
   const text=trial.type==='attention'?'2':freeText;
   return {type:trial.type,stimulus:trial.stimulus,freeText:text,ratings:Object.fromEntries(ratingWords(text,trial,plan.rowSeed).map(word=>[word,trial.type==='attention'?(invalidAttention?3:2):4])),durationMs:8000,namingMs:3000,width:320,height:320};
  })};
  const submitted=await study.submit(body);return {slot:plan.slot,submitted};
 }
 const rows=()=>research.sqlite.prepare('SELECT * FROM slots ORDER BY mode,id').all();
 return {env,api,seed,study,rows,research,contacts,close:()=>{research.sqlite.close();contacts.sqlite.close();}};
}
const csvText=async response=>Buffer.from(await response.arrayBuffer()).toString('utf8');
function combine(index,pages){
 let output=index.header;
 for(const page of pages){
  const boundary=page.indexOf('\r\n');
  const header=boundary===-1?page:page.slice(0,boundary);
  assert.equal(header,index.header,'Every page must have exactly the same shared header');
  if(boundary!==-1)output+='\r\n'+page.slice(boundary+2);
 }
 return output;
}

test('one-questionnaire CSV pages exactly reproduce legacy export bytes and keep modes separate',async()=>{
 const f=fixture();
 try{
  await f.seed('pilot',{freeText:'「開心」\n緊張、陌生"詞'});
  await f.seed('pilot');
  await f.seed('pilot',{freeText:'=SUM(1)',invalidAttention:true});
  await f.seed('live',{freeText:'平靜'});
  // A token-assigned but unsubmitted reservation must never enter the export.
  await f.study.allocate({token:crypto.randomUUID(),mode:'pilot',protocol:PROTOCOL,consent:CONSENT,consented:true});
  const before=f.rows();
  const response=await f.api('/api/admin/export-index?mode=pilot');assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const index=await response.json();assert.equal(index.protocol,PROTOCOL);assert.equal(index.mode,'pilot');
  assert.equal(index.slots.length,3);assert.deepEqual(index.slots,[...index.slots].sort((a,b)=>a-b));
  assert.ok(index.header.startsWith('\uFEFF'));assert.equal(index.header.includes('\r\n'),false);
  assert.equal(index.header.slice(1).split(',').length,32);
  const queries=[],original=f.env.DB;
  f.env.DB={...original,prepare(sql){queries.push(sql);return original.prepare(sql);}};
  const pages=[];
  for(const slot of index.slots){
   const page=await f.api('/api/admin/export?mode=pilot&kind=research&slot='+slot);
   assert.equal(page.status,200);assert.equal(page.headers.get('Cache-Control'),'no-store');
   assert.equal(page.headers.get('Content-Disposition'),'attachment; filename="pilot-research.csv"');
   pages.push(await csvText(page));
  }
  assert.equal(queries.length,3);assert.ok(queries.every(sql=>sql.includes('mode=? AND id=? AND submitted=1')),'Page reads must filter the primary key, not parse every response');
  f.env.DB=original;
  const full=await csvText(await f.api('/api/admin/export?mode=pilot&kind=research'));
  assert.equal(combine(index,pages),full);
  assert.ok(full.includes('「開心」\n緊張、陌生""詞'),'Quoted multiline free text must survive CSV batching');
  assert.ok(full.includes("'=SUM(1)"),'Existing CSV formula protection must be preserved');
  assert.ok(full.includes('"false"'),'Attention-failed submissions remain available');
  assert.equal((await(await f.api('/api/admin/export-index?mode=live')).json()).slots.length,1);
  assert.deepEqual(f.rows(),before,'Export must not alter assignments, answers or timestamps');
  assert.equal(f.contacts.sqlite.prepare('SELECT COUNT(*) AS n FROM contact_objects').get().n,0);
 }finally{f.close();}
});

test('capturing submitted IDs keeps a later submission out of the in-progress download',async()=>{
 const f=fixture();
 try{
  await f.seed();await f.seed();
  const index=await(await f.api('/api/admin/export-index?mode=pilot')).json();
  const snapshot=await csvText(await f.api('/api/admin/export?mode=pilot&kind=research'));
  await f.seed();
  const pages=[];for(const slot of index.slots)pages.push(await csvText(await f.api('/api/admin/export?mode=pilot&kind=research&slot='+slot)));
  assert.equal(combine(index,pages),snapshot);
  const refreshed=await(await f.api('/api/admin/export-index?mode=pilot')).json();assert.equal(refreshed.slots.length,3);
  assert.notEqual(await csvText(await f.api('/api/admin/export?mode=pilot&kind=research')),snapshot);
 }finally{f.close();}
});

test('empty research snapshots carry the exact header without using a bulk export',async()=>{
 const f=fixture();
 try{
  const index=await(await f.api('/api/admin/export-index?mode=pilot')).json();
  assert.deepEqual(index.slots,[]);
  assert.equal(combine(index,[]),await f.study.researchCSV('pilot'));
  const zero=await f.api('/api/admin/export?mode=pilot&kind=research&slot=0');assert.equal(zero.status,200);
  assert.equal(await csvText(zero),index.header);
 }finally{f.close();}
});

test('the index and individual exports require authorization, trusted origins and valid slot IDs',async()=>{
 const f=fixture();
 try{
  let reads=0;const original=f.env.DB;
  f.env.DB={...original,prepare(sql){reads++;return original.prepare(sql);}};
  for(const route of ['/api/admin/export-index?mode=pilot','/api/admin/export?mode=pilot&kind=research&slot=0']){
   assert.equal((await fetchHandler(new Request(origin+route),f.env)).status,403);
   assert.equal((await f.api(route,{Authorization:'Bearer wrong-token'})).status,403);
   assert.equal((await f.api(route,{Origin:'https://untrusted.example'})).status,403);
   const method=await fetchHandler(new Request(origin+route,{method:'POST',headers:{Authorization:'Bearer '+f.env.ADMIN_TOKEN}}),f.env);assert.equal(method.status,405);
  }
  assert.equal(reads,0,'Denied exports must never read the research database');
  assert.equal((await f.api('/api/admin/export-index?mode=pilot',{Origin:'https://christine485.github.io'})).status,200);
  for(const kind of ['research','draw']){
   const exported=await f.api('/api/admin/export?mode=pilot&kind='+kind,{Origin:'https://christine485.github.io'});
   assert.equal(exported.status,200);assert.equal(exported.headers.get('Access-Control-Allow-Origin'),'https://christine485.github.io');assert.equal(exported.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(exported.headers.get('Cache-Control'),'no-store');
  }
  assert.equal((await f.api('/api/admin/export-index?mode=pilot',{Origin:origin})).status,200);
  for(const route of ['/api/admin/export-index','/api/admin/export-index?mode=typo','/api/admin/export?mode=pilot&kind=draw&slot=0','/api/admin/export?mode=pilot&kind=research&slot=0&slot=1'])assert.equal((await f.api(route)).status,400);
  for(const slot of ['', '-1','-0','01','1.5','1e2','Infinity','NaN','9007199254740992','0%20OR%201=1'])assert.equal((await f.api('/api/admin/export?mode=pilot&kind=research&slot='+slot)).status,400);
 }finally{f.close();}
});
