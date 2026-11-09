import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyServer} from '../../lib/study-core.ts';
import {createContactStore} from '../src/contact-store.ts';
import {sqliteD1} from './sqlite-d1.mjs';
import {PROTOCOL,CONSENT,STIMULI,ratingWords,rng} from '../../docs/modules/protocol.mjs';

// Override only SQLite's tie-breaking random() for reproducible arrival tests.
// The real allocation SQL, constraints, plan generation and submission handler run.
function fixture(seed){
 const research=sqliteD1(new URL('../migrations/0001_slots.sql',import.meta.url));
 const contacts=sqliteD1(new URL('../contact-migrations/0001_contacts.sql',import.meta.url));
 const random=rng(seed);research.sqlite.function('random',()=>Math.floor(random()*0x7fffffff));
 const server=createStudyServer(()=>({DB:research.DB,BUCKET:createContactStore(contacts.DB),DRAW_SECRET:'local-allocation-balance-test-key-32-characters'}));
 let sequence=0;
 async function allocate(){
  const token='00000000-0000-4000-8000-'+(++sequence).toString(16).padStart(12,'0');
  const body={token,mode:'live',protocol:PROTOCOL,consent:CONSENT,consented:true};
  const plan=await server.allocate(body);
  assert.equal(plan.trials.length,28);assert.equal(new Set(plan.trials.map(trial=>trial.stimulus)).size,28);
  const main=plan.trials.filter(trial=>trial.type==='main');assert.equal(main.length,27);
  assert.equal(new Set(main.map(trial=>STIMULI.find(stimulus=>stimulus.file===trial.stimulus).condition)).size,27);
  assert.equal(plan.trials.filter(trial=>trial.type==='attention').length,1);
  return {token,body,plan};
 }
 async function submit(session,{attentionPass=true,freeText='開心、緊張、害怕'}={}){
  const {body,plan}=session;
  const response={...body,drawNonce:'10000000-0000-4000-8000-'+sequence.toString(16).padStart(12,'0'),demographics:{gender:'其他',age:23,education:'學士'},device:{kind:'電腦',viewportWidth:1280,viewportHeight:800},responses:plan.trials.map(trial=>{
   const text=trial.type==='attention'?'2':freeText;
   return {type:trial.type,stimulus:trial.stimulus,freeText:text,ratings:Object.fromEntries(ratingWords(text,trial,plan.rowSeed).map(word=>[word,trial.type==='attention'?(attentionPass?2:3):4])),durationMs:8000,namingMs:3000,width:320,height:320};
  })};
  const receipt=await server.submit(response);assert.equal(receipt.submitted,true);assert.equal(receipt.eligible,attentionPass);
  return response;
 }
 function completed(){return research.sqlite.prepare('SELECT id,payload FROM slots WHERE mode=? AND submitted=1 ORDER BY id').all('live:'+PROTOCOL).map(row=>JSON.parse(row.payload));}
 return {research,contacts,allocate,submit,completed,close:()=>{research.sqlite.close();contacts.sqlite.close();}};
}
function coverage(records,{validOnly=false,ratings=false}={}){
 const counts=new Map(STIMULI.map(stimulus=>[stimulus.file,0]));
 for(const record of records){
  if(validOnly&&!record.validQuestionnaire)continue;
  for(const response of record.responses)if(response.type==='main')counts.set(response.stimulus,counts.get(response.stimulus)+(ratings?Object.keys(response.ratings).length:1));
 }
 const values=[...counts.values()],distribution={};for(const value of values)distribution[value]=(distribution[value]||0)+1;
 return {min:Math.min(...values),max:Math.max(...values),spread:Math.max(...values)-Math.min(...values),total:values.reduce((sum,n)=>sum+n,0),distribution};
}

test('137, 150 and 163 sequential completed questionnaires retain random allocation and near-equal main-image assessments',async t=>{
 const results=[];
 for(const target of [137,150,163]){
  const f=fixture('sequential-'+target);
  try{
   for(let index=0;index<target;index++)await f.submit(await f.allocate());
   const records=f.completed(),count=coverage(records);
   assert.equal(records.length,target);assert.equal(count.total,target*27);
   assert.equal(count.min,Math.floor(target/10));assert.equal(count.max,Math.ceil(target/10));
   assert.ok(count.spread<=1);assert.equal(f.contacts.sqlite.prepare('SELECT COUNT(*) AS n FROM contact_objects').get().n,0);
   results.push({completed:target,mainImageAssessments:count});
  }finally{f.close();}
 }
 t.diagnostic(JSON.stringify({scope:'local actual allocation and SQLite; no pending reservations',results}));
});

test('ongoing reservations can temporarily unbalance completions; expired holes are refilled before later cycles',async t=>{
 const results=[];
 for(const target of [137,150,163]){
  const f=fixture('pending-'+target),pending=[];let arrived=0,completed=0;
  try{
   while(completed<target){
    const session=await f.allocate();
    if(arrived++%4===0)pending.push(session);else{await f.submit(session);completed++;}
   }
   const during=coverage(f.completed()),mode='live:'+PROTOCOL;
   assert.equal(during.total,target*27);
   const slots=f.research.sqlite.prepare('SELECT COUNT(*) AS n FROM slots WHERE mode=?').get(mode).n;
   assert.ok(slots>=arrived);assert.ok(during.max<=Math.ceil(arrived/10));
   // Simulate the existing 12-hour deadline passing; production's deadline is unchanged.
   f.research.sqlite.prepare('UPDATE slots SET expires=0 WHERE mode=? AND submitted=0').run(mode);
   for(let refill=0;refill<slots-target;refill++){
    const session=await f.allocate();
    assert.ok(session.plan.slot<slots,'an earlier free cycle must be claimed before any new cycle');
    await f.submit(session);
   }
   const repaired=coverage(f.completed());assert.equal(f.completed().length,slots);
   assert.equal(repaired.min,slots/10);assert.equal(repaired.max,slots/10);assert.equal(repaired.spread,0);
   assert.equal(f.research.sqlite.prepare('SELECT COUNT(*) AS n FROM slots WHERE mode=?').get(mode).n,slots);
   // A reclaimed participant cannot overwrite the replacement's submitted answer.
   await assert.rejects(()=>f.submit(pending[0]),/找不到/);
   results.push({completedBeforeReclaim:target,heldReservations:pending.length,mainImageAssessmentsBeforeReclaim:during,completedAfterFillingExistingCycles:slots,mainImageAssessmentsAfterReclaim:repaired});
  }finally{f.close();}
 }
 t.diagnostic(JSON.stringify({scope:'local actual allocation and SQLite; every fourth arrival remains pending',results}));
});

test('balanced completion counts do not guarantee equal valid-only counts or equal word-rating rows',async t=>{
 const f=fixture('valid-and-word-ratings');
 try{
  for(let index=0;index<150;index++)await f.submit(await f.allocate(),{attentionPass:index%7!==0,freeText:index%3===0?'沒有感覺':'開心、緊張、害怕'});
  const records=f.completed(),all=coverage(records),valid=coverage(records,{validOnly:true}),ratings=coverage(records,{ratings:true});
  assert.equal(all.min,15);assert.equal(all.max,15);
  assert.equal(records.filter(record=>record.validQuestionnaire).length,128);
  assert.equal(valid.total,128*27);assert.ok(valid.spread>0);
  assert.equal(ratings.total,100*27*9);assert.ok(ratings.spread>0);
  t.diagnostic(JSON.stringify({scope:'local simulation; deliberately mixed attention and naming responses',completed:150,validQuestionnaires:128,allMainImageAssessments:all,validOnlyMainImageAssessments:valid,actualMainWordRatings:ratings}));
 }finally{f.close();}
});
