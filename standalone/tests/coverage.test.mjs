import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {studyCoverage} from '../src/coverage.ts';
import {createStudyServer} from '../../lib/study-core.ts';
import {createContactStore} from '../src/contact-store.ts';
import {sqliteD1} from './sqlite-d1.mjs';
import {PROTOCOL,CONSENT,STIMULI,ratingWords} from '../../docs/modules/protocol.mjs';

function fixture(){
  const research=sqliteD1(new URL('../migrations/0001_slots.sql',import.meta.url));
  const contacts=sqliteD1(new URL('../contact-migrations/0001_contacts.sql',import.meta.url));
  const study=createStudyServer(()=>({DB:research.DB,BUCKET:createContactStore(contacts.DB),DRAW_SECRET:'local-coverage-test-draw-key-at-least-32-characters'}));
  async function seed(mode,{freeText='開心',invalidAttention=false}={}){
    const token=randomUUID(),start={token,mode,protocol:PROTOCOL,consent:CONSENT,consented:true};
    const plan=await study.allocate(start);
    const body={...start,drawNonce:randomUUID(),demographics:{gender:'其他',age:23,education:'學士'},device:{kind:'電腦',viewportWidth:1280,viewportHeight:800},responses:plan.trials.map(trial=>{
      const text=trial.type==='attention'?'2':freeText;
      return {type:trial.type,stimulus:trial.stimulus,freeText:text,ratings:Object.fromEntries(ratingWords(text,trial,plan.rowSeed).map(word=>[word,trial.type==='attention'&&invalidAttention?3:2])),durationMs:8000,namingMs:3000,width:320,height:320};
    })};
    const result=await study.submit(body);return {plan,body,result};
  }
  const digest=()=>createHash('sha256').update(JSON.stringify(research.sqlite.prepare('SELECT * FROM slots ORDER BY mode,id').all())).digest('hex');
  return {research,contacts,study,seed,digest,close:()=>{research.sqlite.close();contacts.sqlite.close();}};
}

test('empty coverage fills every original image with zero in one read-only query',async()=>{
  const f=fixture();
  try{
    let queries=0,returnedRows=0;
    const database={...f.research.DB,prepare(sql){queries++;const statement=f.research.DB.prepare(sql);return {bind(...values){const bound=statement.bind(...values);return {async all(){const result=await bound.all();returnedRows=result.results.length;return result;}};}};}};
    const before=f.digest(),coverage=await studyCoverage(database,'pilot');
    assert.equal(queries,1);assert.equal(returnedRows,0);assert.equal(coverage.protocol,PROTOCOL);assert.equal(coverage.mode,'pilot');assert.equal(coverage.totalSubmitted,0);
    assert.equal(coverage.images.length,270);
    assert.deepEqual(coverage.images,STIMULI.map(stimulus=>({file:stimulus.file,condition:stimulus.condition,assessments:0,validAssessments:0,wordRatings:0})));
    assert.equal(f.digest(),before);
  }finally{f.close();}
});

test('coverage distinguishes image assessments, valid assessments and variable word ratings',async()=>{
  const f=fixture();
  try{
    const completed=[await f.seed('pilot'),await f.seed('pilot',{freeText:'開心、緊張、害怕',invalidAttention:true}),await f.seed('pilot',{freeText:'coverage_private_marker'})];
    await f.seed('live',{freeText:'平靜'});
    // An unfinished reservation and another protocol must not enter this study.
    await f.study.allocate({token:randomUUID(),mode:'pilot',protocol:PROTOCOL,consent:CONSENT,consented:true});
    f.research.sqlite.prepare('INSERT INTO slots(mode,id,submitted,payload) VALUES(?,?,1,?)').run('pilot:another-protocol',0,JSON.stringify({validQuestionnaire:true,responses:[{type:'main',stimulus:STIMULI[0].file,words:['private-legacy-word']}]}));
    const before=f.digest(),coverage=await studyCoverage(f.research.DB,'pilot');
    const expected=new Map(STIMULI.map(stimulus=>[stimulus.file,{assessments:0,validAssessments:0,wordRatings:0}]));
    for(const participant of completed)for(const response of participant.body.responses){
      if(response.type!=='main')continue;
      const image=expected.get(response.stimulus);image.assessments++;image.validAssessments+=participant.result.eligible?1:0;image.wordRatings+=Object.keys(response.ratings).length;
    }
    assert.equal(coverage.totalSubmitted,3);
    for(const image of coverage.images)assert.deepEqual({assessments:image.assessments,validAssessments:image.validAssessments,wordRatings:image.wordRatings},expected.get(image.file));
    assert.equal(coverage.images.reduce((sum,image)=>sum+image.assessments,0),81,'Attention trials must not add main-image assessments');
    assert.equal(coverage.images.reduce((sum,image)=>sum+image.validAssessments,0),54,'Attention-failed questionnaires remain visible separately');
    assert.equal(coverage.images.reduce((sum,image)=>sum+image.wordRatings,0),324,'Zero, three and nine-word trials must retain their actual rating counts');
    const live=await studyCoverage(f.research.DB,'live');assert.equal(live.totalSubmitted,1);assert.equal(live.images.reduce((sum,image)=>sum+image.assessments,0),27);
    assert.equal(f.digest(),before);
    assert.equal(f.contacts.sqlite.prepare('SELECT COUNT(*) AS n FROM contact_objects').get().n,0);
    const encoded=JSON.stringify(coverage);
    assert.ok(!encoded.includes('coverage_private_marker'));assert.ok(!encoded.includes('participantCode'));assert.ok(!encoded.includes('token_hash'));assert.ok(!encoded.includes('freeText'));
    assert.deepEqual(Object.keys(coverage.images[0]).sort(),['file','condition','assessments','validAssessments','wordRatings'].sort());
  }finally{f.close();}
});

test('a complete randomized ten-participant block produces exactly one assessment per image',async()=>{
  const f=fixture();
  try{
    for(let index=0;index<10;index++)await f.seed('live',{freeText:index%2?'沒有感覺':'開心'});
    const coverage=await studyCoverage(f.research.DB,'live');
    assert.equal(coverage.totalSubmitted,10);assert.ok(coverage.images.every(image=>image.assessments===1&&image.validAssessments===1));
    assert.equal(coverage.images.reduce((sum,image)=>sum+image.wordRatings,0),5*27*3);
    assert.ok(coverage.images.some(image=>image.wordRatings===0));assert.ok(coverage.images.some(image=>image.wordRatings===3));
  }finally{f.close();}
});

test('unknown modes are rejected before querying any data',async()=>{
  const database={prepare(){assert.fail('Invalid modes must not reach the database');}};
  for(const mode of ['',undefined,null,'all','PILOT','pilot:another-protocol',' pilot '])await assert.rejects(()=>studyCoverage(database,mode),/Invalid coverage mode/);
});
