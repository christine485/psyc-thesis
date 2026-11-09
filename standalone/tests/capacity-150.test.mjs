import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchHandler} from '../src/index.ts';
import {sqliteD1} from './sqlite-d1.mjs';
import {PROTOCOL,CONSENT,STIMULI,ratingWords} from '../../docs/modules/protocol.mjs';

const origin='https://christine485.github.io';
function request(path,body){
  return new Request('https://api.example.test'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
}
function start(token,mode='live'){
  return {token,mode,protocol:PROTOCOL,consent:CONSENT,consented:true};
}
function submission(plan,token,index){
  return {...start(token),drawNonce:crypto.randomUUID(),demographics:{gender:['女','男','其他'][index%3],age:18+index%70,education:'學士'},
    device:{kind:'手機',viewportWidth:390,viewportHeight:844},
    responses:plan.trials.map(trial=>{
      // Exercise the largest designed rating count: three named families and
      // nine ratings on every main trial, rather than an empty-rating shortcut.
      const freeText=trial.type==='attention'?'2':'開心、緊張、害怕';
      const words=ratingWords(freeText,trial,plan.rowSeed);
      if(trial.type==='main')assert.equal(words.length,9);
      return {type:trial.type,stimulus:trial.stimulus,freeText,ratings:Object.fromEntries(words.map(word=>[word,trial.type==='attention'?2:4])),durationMs:8000,namingMs:3000,width:310,height:310};
    })};
}

test('150 complete questionnaires persist once with balanced coverage and separate contact storage',async t=>{
  const research=sqliteD1(new URL('../migrations/0001_slots.sql',import.meta.url));
  const contacts=sqliteD1(new URL('../contact-migrations/0001_contacts.sql',import.meta.url));
  const env={DB:research.DB,CONTACTS_DB:contacts.DB,DRAW_SECRET:'synthetic-capacity-key-at-least-32-characters',ADMIN_TOKEN:'synthetic-capacity-admin-at-least-32-characters'};
  const tokens=[],drawNonces=[];
  for(let participant=0;participant<150;participant++){
    const token=crypto.randomUUID();tokens.push(token);
    const allocated=await fetchHandler(request('/api/study/start',start(token)),env);
    assert.equal(allocated.status,200,'allocation '+participant);
    const plan=await allocated.json();
    assert.equal(plan.trials.length,28);
    assert.equal(plan.trials.filter(trial=>trial.type==='main').length,27);
    assert.equal(plan.trials.filter(trial=>trial.type==='attention').length,1);
    assert.equal(new Set(plan.trials.map(trial=>trial.stimulus)).size,28);
    const body=submission(plan,token,participant);drawNonces.push(body.drawNonce);
    const submitted=await fetchHandler(request('/api/study/submit',body),env);
    assert.equal(submitted.status,200,'submission '+participant);
    const receipt=await submitted.json();
    assert.equal(receipt.submitted,true);assert.equal(receipt.eligible,true);
    const retried=await fetchHandler(request('/api/study/submit',body),env);
    assert.equal(retried.status,200,'retry '+participant);
    assert.deepEqual(await retried.json(),receipt,'retry receipt '+participant);
  }

  const rows=research.sqlite.prepare('SELECT id,token_hash,submitted,payload FROM slots WHERE mode=? ORDER BY id').all('live:'+PROTOCOL);
  assert.equal(rows.length,150);assert.ok(rows.every(row=>row.submitted===1));
  assert.equal(new Set(rows.map(row=>row.id)).size,150);
  assert.equal(new Set(rows.map(row=>row.token_hash)).size,150);
  const records=rows.map(row=>JSON.parse(row.payload));
  assert.equal(new Set(records.map(record=>record.participantCode)).size,150);
  assert.ok(records.every(record=>record.validQuestionnaire===true&&record.responses.length===28));
  const coverage=new Map(STIMULI.map(stimulus=>[stimulus.file,0]));
  let trialCount=0,ratingCount=0;
  for(const record of records)for(const response of record.responses){
    trialCount++;ratingCount+=response.words.length;
    if(response.type==='main')coverage.set(response.stimulus,coverage.get(response.stimulus)+1);
  }
  assert.equal(trialCount,4200);assert.equal(ratingCount,36900);
  assert.equal(coverage.size,270);assert.ok([...coverage.values()].every(count=>count===15));

  // A separate pilot allocation must not alter the completed formal cohort.
  const pilot=await fetchHandler(request('/api/study/start',start(crypto.randomUUID(),'pilot')),env);
  assert.equal(pilot.status,200);
  const status=await fetchHandler(new Request('https://api.example.test/api/admin/status',{headers:{Authorization:'Bearer '+env.ADMIN_TOKEN}}),env);
  assert.equal(status.status,200);
  const counts=await status.json();assert.equal(counts.modes.live.submitted,150);assert.equal(counts.modes.pilot.submitted,0);
  assert.equal(research.sqlite.prepare('SELECT COUNT(*) AS n FROM slots WHERE mode=? AND submitted=1').get('pilot:'+PROTOCOL).n,0);
  assert.equal(contacts.sqlite.prepare('SELECT COUNT(*) AS n FROM contact_objects').get().n,0);
  assert.throws(()=>research.sqlite.prepare('SELECT * FROM contact_objects'),/no such table/);
  assert.throws(()=>contacts.sqlite.prepare('SELECT * FROM slots'),/no such table/);
  const payloads=rows.map(row=>row.payload).join('\n');
  assert.ok(tokens.every(token=>!payloads.includes(token)));
  assert.ok(drawNonces.every(nonce=>!payloads.includes(nonce)));
  const payloadBytes=rows.reduce((sum,row)=>sum+Buffer.byteLength(row.payload,'utf8'),0);
  const researchDatabaseBytes=research.sqlite.prepare('PRAGMA page_count').get().page_count*research.sqlite.prepare('PRAGMA page_size').get().page_size;
  const researchSlots=research.sqlite.prepare('SELECT COUNT(*) AS n FROM slots').get().n;
  t.diagnostic(JSON.stringify({simulation:'local-sqlite-only',completedQuestionnaires:150,submissionRetries:150,formalSlots:rows.length,totalSlotsIncludingPilotReservation:researchSlots,storedTrials:trialCount,storedRatings:ratingCount,mainAssessmentsPerImage:15,researchPayloadBytes:payloadBytes,researchDatabaseBytes,contactRecords:0,remoteCloudflareVerified:false}));
  research.sqlite.close();contacts.sqlite.close();
});
