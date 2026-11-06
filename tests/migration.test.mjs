import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {stripTypeScriptTypes} from 'node:module';
import {spawnSync} from 'node:child_process';
import {validateSnapshot,snapshotSQL,prepareSnapshot} from '../scripts/import-study-snapshot.mjs';

const makeSnapshot=()=>{
 const bytes=Buffer.from('{"phone":"+85291234567"}');
 return {format:'psyc-study-snapshot-v1',createdAt:'2026-11-06T00:00:00Z',protocol:'test-protocol',slots:[{mode:'live:test-protocol',id:17,token_hash:'a'.repeat(64),expires:1000,plan:JSON.stringify({text:"'中文\u0000"}),submitted:1,payload:JSON.stringify({participantCode:'synthetic',freeText:"'開心"})},{mode:'pilot:test-protocol',id:2,token_hash:null,expires:0,plan:null,submitted:0,payload:null}],objects:[{key:'live/phones/test.json',bodyBase64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),httpMetadata:{contentType:'application/json'},customMetadata:{}}]};
};

test('snapshot SQL roundtrips all slot fields and refuses nonempty targets',()=>{
 const snapshot=makeSnapshot(),db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../drizzle/0000_overjoyed_texas_twister.sql',import.meta.url),'utf8'));
 db.exec(snapshotSQL(snapshot));const rows=db.prepare('SELECT * FROM slots ORDER BY mode,id').all().map(row=>({...row}));assert.deepEqual(rows,[...snapshot.slots].sort((a,b)=>a.mode.localeCompare(b.mode)));
 assert.throws(()=>db.exec(snapshotSQL(snapshot)),/CHECK constraint/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM slots').get().n,2);db.close();
});
test('preparer writes exact private object bytes, metadata, and safe filenames',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'study-migration-'));try{
  const snapshot=makeSnapshot(),out=path.join(root,'private');assert.deepEqual(prepareSnapshot(snapshot,out),{slots:2,objects:1});
  const manifest=JSON.parse(fs.readFileSync(path.join(out,'r2-manifest.json'),'utf8'));assert.deepEqual(fs.readFileSync(path.join(out,manifest.objects[0].file)),Buffer.from(snapshot.objects[0].bodyBase64,'base64'));assert.equal(manifest.objects[0].key,snapshot.objects[0].key);assert.deepEqual(manifest.objects[0].httpMetadata,snapshot.objects[0].httpMetadata);assert.equal(fs.statSync(path.join(out,'slots.sql')).mode&0o777,0o600);assert.throws(()=>prepareSnapshot(snapshot,out),/already exists/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('validation rejects corruption, duplicate records, and malformed state',()=>{
 for(const mutate of [s=>s.objects[0].sha256='0'.repeat(64),s=>s.slots.push(s.slots[0]),s=>s.slots[0].payload=null,s=>s.slots[0].id=-1,s=>s.objects.push(s.objects[0]),s=>s.slots[0].plan='not JSON']){const snapshot=makeSnapshot();mutate(snapshot);assert.throws(()=>validateSnapshot(snapshot));}
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
  const plan=JSON.parse(fs.readFileSync(path.join(out,'r2-upload-plan.json'),'utf8'));assert.equal(plan.commands.length,1);assert.ok(plan.commands[0].args.includes('new-study-bucket/live/phones/test.json'));assert.equal(plan.remoteWrites,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
