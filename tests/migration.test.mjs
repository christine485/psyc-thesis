import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {stripTypeScriptTypes} from 'node:module';
import {spawnSync} from 'node:child_process';
import {validateSnapshot,snapshotSQL,contactsSQL,prepareSnapshot} from '../scripts/import-study-snapshot.mjs';

const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const contactObject=(key,text)=>{const bytes=Buffer.from(text);return {key,bodyBase64:bytes.toString('base64'),sha256:digest(bytes),httpMetadata:{contentType:'application/json'},customMetadata:{}};};
const phoneKey=(mode,phone)=>mode+'/phones/'+digest(Buffer.from(phone))+'.json';
const contactSchema=()=>fs.readFileSync(new URL('../standalone/contact-migrations/0001_contacts.sql',import.meta.url),'utf8');

const makeSnapshot=()=>{
 return {format:'psyc-study-snapshot-v1',createdAt:'2026-11-06T00:00:00Z',protocol:'test-protocol',slots:[{mode:'live:test-protocol',id:17,token_hash:'a'.repeat(64),expires:1000,plan:JSON.stringify({text:"'中文\u0000"}),submitted:1,payload:JSON.stringify({participantCode:'synthetic',freeText:"'開心"})},{mode:'pilot:test-protocol',id:2,token_hash:null,expires:0,plan:null,submitted:0,payload:null}],objects:[contactObject(phoneKey('live','+85291234567'),'{"phone":"+85291234567"}')]};
};

test('snapshot SQL roundtrips all slot fields and refuses nonempty targets',()=>{
 const snapshot=makeSnapshot(),db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../drizzle/0000_overjoyed_texas_twister.sql',import.meta.url),'utf8'));
 db.exec(snapshotSQL(snapshot));const rows=db.prepare('SELECT * FROM slots ORDER BY mode,id').all().map(row=>({...row}));assert.deepEqual(rows,[...snapshot.slots].sort((a,b)=>a.mode.localeCompare(b.mode)));
 assert.throws(()=>db.exec(snapshotSQL(snapshot)),/CHECK constraint/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM slots').get().n,2);db.close();
});
test('contact SQL roundtrips live and pilot keys and raw JSON in a separate database',()=>{
 const snapshot=makeSnapshot();
 snapshot.objects=[
  contactObject(phoneKey('live','+85291234567'),'{\n "phone" : "+85291234567"\n}\n'),
  contactObject(phoneKey('pilot','+85292345678'),' {"ph\\u006fne":"+85292345678"} '),
  contactObject('live/permits/'+'c'.repeat(64)+'.json','{"phoneHash":"'+digest(Buffer.from('+85291234567'))+'"}'),
  contactObject('pilot/permits/'+'d'.repeat(64)+'.json',' { "phoneHash": "'+'e'.repeat(64)+'" }\n')
 ];
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(contactSchema());
  const sql=contactsSQL(snapshot);assert.doesNotMatch(sql,/INSERT OR REPLACE|\bslots\b/);
  db.exec(sql);
  const rows=db.prepare('SELECT key,value FROM contact_objects ORDER BY key').all().map(row=>({...row}));
  assert.deepEqual(rows,snapshot.objects.map(item=>({key:item.key,value:Buffer.from(item.bodyBase64,'base64').toString('utf8')})).sort((a,b)=>a.key.localeCompare(b.key)));
  for(const row of rows)assert.deepEqual(Buffer.from(row.value),Buffer.from(snapshot.objects.find(item=>item.key===row.key).bodyBase64,'base64'));
  assert.throws(()=>db.exec(sql),/CHECK constraint/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contact_objects').get().n,4);
  assert.deepEqual(db.prepare('SELECT key,value FROM contact_objects ORDER BY key').all().map(row=>({...row})),rows);
  const researchSQL=snapshotSQL(snapshot);
  for(const item of snapshot.objects){
   assert.ok(!researchSQL.includes(item.key));
   assert.ok(!researchSQL.includes(Buffer.from(item.key).toString('hex')));
   assert.ok(!researchSQL.includes(Buffer.from(item.bodyBase64,'base64').toString('hex')));
  }
  assert.ok(!researchSQL.includes(Buffer.from('+85291234567').toString('hex')));
 }finally{db.close();}
});
test('contact SQL refuses any nonempty destination without replacing existing contacts',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(contactSchema());
  db.exec("INSERT INTO contact_objects VALUES ('existing', '{\"phone\":\"kept\"}')");
  assert.throws(()=>db.exec(contactsSQL(makeSnapshot())),/CHECK constraint/);
  assert.deepEqual({...db.prepare('SELECT key,value FROM contact_objects').get()},{key:'existing',value:'{"phone":"kept"}'});
 }finally{db.close();}
});
test('preparer writes separate private imports and exact archival object bytes with safe filenames',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'study-migration-'));try{
  const snapshot=makeSnapshot(),out=path.join(root,'private');assert.deepEqual(prepareSnapshot(snapshot,out),{slots:2,objects:1,contacts:1});
  const manifest=JSON.parse(fs.readFileSync(path.join(out,'r2-manifest.json'),'utf8'));assert.deepEqual(fs.readFileSync(path.join(out,manifest.objects[0].file)),Buffer.from(snapshot.objects[0].bodyBase64,'base64'));assert.equal(manifest.objects[0].key,snapshot.objects[0].key);assert.deepEqual(manifest.objects[0].httpMetadata,snapshot.objects[0].httpMetadata);
  for(const name of ['slots.sql','contacts.sql','summary.json','r2-manifest.json',manifest.objects[0].file])assert.equal(fs.statSync(path.join(out,name)).mode&0o777,0o600);
  assert.equal(fs.statSync(out).mode&0o777,0o700);assert.equal(fs.statSync(path.join(out,'objects')).mode&0o777,0o700);
  const summary=JSON.parse(fs.readFileSync(path.join(out,'summary.json'),'utf8'));
  assert.equal(summary.contactStorage,'separate-d1');assert.equal(summary.contacts,1);assert.equal(summary.contactsSQLSHA256,digest(fs.readFileSync(path.join(out,'contacts.sql'))));
  assert.equal(fs.readFileSync(path.join(out,'contacts.sql'),'utf8'),contactsSQL(snapshot));assert.throws(()=>prepareSnapshot(snapshot,out),/already exists/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('validation rejects corruption, duplicate records, and malformed state',()=>{
 for(const mutate of [s=>s.objects[0].sha256='0'.repeat(64),s=>s.slots.push(s.slots[0]),s=>s.slots[0].payload=null,s=>s.slots[0].id=-1,s=>s.objects.push(s.objects[0]),s=>s.slots[0].plan='not JSON']){const snapshot=makeSnapshot();mutate(snapshot);assert.throws(()=>validateSnapshot(snapshot));}
});
test('contact import rejects corruption, duplicates and unsupported data before creating files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'study-invalid-contact-'));
 const replaceBytes=(snapshot,bytes)=>{snapshot.objects[0].bodyBase64=bytes.toString('base64');snapshot.objects[0].sha256=digest(bytes);};
 try{
  const mutations=[
   s=>s.objects[0].sha256='0'.repeat(64),
   s=>s.objects.push(s.objects[0]),
   s=>replaceBytes(s,Buffer.from([0xc3,0x28])),
   s=>replaceBytes(s,Buffer.from('not JSON')),
   s=>replaceBytes(s,Buffer.from('{"phone":"+85291234567","researchId":17}')),
   s=>replaceBytes(s,Buffer.from('{"phone":"+85292345678"}')),
   s=>s.objects[0].key='live/unknown/'+'a'.repeat(64)+'.json',
   s=>s.objects[0].key='live/phones/test.json',
   s=>s.objects[0].key='live/phones/../../escape.json',
   s=>s.objects[0].customMetadata={participant:'synthetic'},
   s=>s.objects[0].httpMetadata.contentEncoding='gzip',
   s=>s.objects[0].httpMetadata.contentType='application/octet-stream',
   s=>{s.objects[0]=contactObject('pilot/permits/'+'f'.repeat(64)+'.json','{"phoneHash":"invalid"}');}
  ];
  for(const [i,mutate] of mutations.entries()){
   const snapshot=makeSnapshot();mutate(snapshot);const out=path.join(root,'case-'+i);
   assert.throws(()=>contactsSQL(snapshot));assert.throws(()=>prepareSnapshot(snapshot,out));assert.equal(fs.existsSync(out),false);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('snapshot export is owner-only, requires a maintenance freeze, and preserves raw records',async()=>{
 let admin=false,maintenance='0',queries=0,oversized=false;
 const snapshot=makeSnapshot();let returned=false;
 const testDB={prepare(){queries++;return {bind(){return {all:async()=>{if(returned)return {results:[]};returned=true;return {results:oversized?[{...snapshot.slots[0],payload:'x'.repeat(17*1024*1024)}]:snapshot.slots};}};}};}};
 const testBucket={list:async()=>({objects:snapshot.objects.map(x=>({key:x.key})),truncated:false}),get:async()=>({size:Buffer.from(snapshot.objects[0].bodyBase64,'base64').length,arrayBuffer:async()=>Buffer.from(snapshot.objects[0].bodyBase64,'base64'),httpMetadata:snapshot.objects[0].httpMetadata,customMetadata:{}})};
 globalThis.__migrationTest={isAdmin:async()=>admin,bindings:()=>({STUDY_MAINTENANCE:maintenance,DB:testDB,BUCKET:testBucket})};
 const source=fs.readFileSync(new URL('../app/api/admin/migration/route.ts',import.meta.url),'utf8').replace("import {bindings,isAdmin} from '../../../../lib/server';",'const {bindings,isAdmin}=globalThis.__migrationTest;').replace("import {PROTOCOL} from '../../../../docs/modules/protocol.mjs';","const PROTOCOL='test-protocol';");
 const route=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
 assert.equal((await route.GET()).status,403);assert.equal(queries,0);
 admin=true;assert.equal((await route.GET()).status,409);assert.equal(queries,0);
 maintenance='1';const response=await route.GET();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store, private');const exported=await response.json();assert.deepEqual(exported.slots,snapshot.slots);assert.equal(exported.objects[0].bodyBase64,snapshot.objects[0].bodyBase64);validateSnapshot(exported);
 returned=false;oversized=true;assert.equal((await route.GET()).status,413);
 delete globalThis.__migrationTest;
});

test('R2 upload preparer writes a reviewable plan without executing a CLI',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'study-r2-plan-'));try{
  const out=path.join(root,'private');prepareSnapshot(makeSnapshot(),out);
  const result=spawnSync(process.execPath,[new URL('../scripts/prepare-study-r2-upload.mjs',import.meta.url).pathname,'--manifest',path.join(out,'r2-manifest.json'),'--bucket','new-study-bucket','--wrangler',path.join(root,'does-not-exist.js'),'--config',path.join(root,'wrangler.jsonc')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const plan=JSON.parse(fs.readFileSync(path.join(out,'r2-upload-plan.json'),'utf8'));assert.equal(plan.commands.length,1);assert.ok(plan.commands[0].args.includes('new-study-bucket/'+makeSnapshot().objects[0].key));assert.equal(plan.remoteWrites,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
