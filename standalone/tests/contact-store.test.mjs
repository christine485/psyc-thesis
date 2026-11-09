import test from 'node:test';
import assert from 'node:assert/strict';
import {createContactStore,exportDrawCSV} from '../src/contact-store.ts';
import {createStudyServer} from '../../lib/study-core.ts';
import {fetchHandler} from '../src/index.ts';
import {sqliteD1} from './sqlite-d1.mjs';

function fixture(t){
  const {sqlite,DB}=sqliteD1(new URL('../contact-migrations/0001_contacts.sql',import.meta.url));
  t.after(()=>sqlite.close());
  return {sqlite,DB,store:createContactStore(DB)};
}
const createOnly={onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}};

test('conditional contact claims have exactly one winner and preserve original JSON',async t=>{
  const {sqlite,store}=fixture(t),key='pilot/permits/synthetic-permit-hash.json';
  const values=Array.from({length:16},(_,i)=>JSON.stringify({phoneHash:'synthetic-phone-hash-'+i}));
  const results=await Promise.all(values.map(value=>store.put(key,value,createOnly)));
  const winners=results.flatMap((result,i)=>result?[i]:[]);
  assert.equal(winners.length,1);
  assert.equal(sqlite.prepare('SELECT value FROM contact_objects WHERE key=?').get(key).value,values[winners[0]]);
  assert.deepEqual(await(await store.get(key)).json(),JSON.parse(values[winners[0]]));
  assert.equal(await store.put(key,'{"phoneHash":"different"}',createOnly),null);
  assert.equal(await store.get('pilot/permits/missing.json'),null);
  const raw=' { "phone" : "91234567" }\n';
  await store.put('pilot/phones/synthetic-phone-hash.json',raw,createOnly);
  assert.equal(sqlite.prepare('SELECT value FROM contact_objects WHERE key=?').get('pilot/phones/synthetic-phone-hash.json').value,raw);
  assert.deepEqual(await(await store.get('pilot/phones/synthetic-phone-hash.json')).json(),{phone:'91234567'});
});

test('contact listing paginates sorted keys without mixing modes, permits or literal prefixes',async t=>{
  const {store}=fixture(t);
  const expected=['pilot/phones/a.json','pilot/phones/b.json','pilot/phones/c.json','pilot/phones/d.json','pilot/phones/e.json'];
  const keys=[...expected,'live/phones/a.json','pilot/permits/a.json','pilot/phones_extra/a.json','pilot/%_/a.json','pilot/ab/a.json'].reverse();
  await Promise.all(keys.map(key=>store.put(key,'{}',createOnly)));
  const found=[];let cursor;const pages=[];
  do{
    const page=await store.list({prefix:'pilot/phones/',limit:2,cursor});pages.push(page);
    found.push(...page.objects.map(item=>item.key));cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
  assert.deepEqual(found,expected);assert.deepEqual(pages.map(page=>page.objects.length),[2,2,1]);
  assert.equal(pages.at(-1).truncated,false);assert.equal(pages.at(-1).cursor,undefined);
  assert.deepEqual((await store.list({prefix:'pilot/%_/'})).objects,[{key:'pilot/%_/a.json'}]);
  assert.deepEqual(await store.list({prefix:'absent/'}),{objects:[],truncated:false});
  await assert.rejects(store.list({prefix:'live/phones/',cursor:pages[0].cursor}),/cursor/);
  await assert.rejects(store.list({cursor:'untrusted'}),/cursor/);
  await assert.rejects(store.list({limit:0}),/page size/);
  await assert.rejects(store.list({limit:1001}),/page size/);
});

test('draw schema and database contain no research table or participant linkage',async t=>{
  const {sqlite,store}=fixture(t);
  const {sqlite:research}=sqliteD1(new URL('../migrations/0001_slots.sql',import.meta.url));t.after(()=>research.close());
  await store.put('live/phones/synthetic-phone-hash.json','{"phone":"91234567"}',createOnly);
  await store.put('live/permits/synthetic-permit-hash.json','{"phoneHash":"synthetic-phone-hash"}',createOnly);
  assert.deepEqual(sqlite.prepare('PRAGMA table_info(contact_objects)').all().map(column=>column.name),['key','value']);
  assert.deepEqual(sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name),['contact_objects']);
  assert.throws(()=>sqlite.prepare('SELECT * FROM slots'),/no such table/);
  assert.throws(()=>research.prepare('SELECT * FROM contact_objects'),/no such table/);
  const stored=sqlite.prepare('SELECT key,value FROM contact_objects ORDER BY key').all();
  assert.deepEqual(stored.map(row=>JSON.parse(row.value)),[{phoneHash:'synthetic-phone-hash'},{phone:'91234567'}]);
  assert.ok(!/participant|token_hash|responses|rowSeed|protocol/.test(JSON.stringify(stored)));
});

test('150 phone exports use one indexed query and match the legacy phone-only CSV exactly',async t=>{
  const {sqlite,DB,store}=fixture(t);
  const research=sqliteD1(new URL('../migrations/0001_slots.sql',import.meta.url));t.after(()=>research.sqlite.close());
  const insert=sqlite.prepare('INSERT INTO contact_objects(key,value) VALUES(?,?)');
  for(let index=0;index<150;index++){
    const id=String(149-index).padStart(3,'0');
    insert.run('pilot/phones/synthetic-phone-'+id+'.json',JSON.stringify({phone:'+852'+(20000000+index),ignored:'not-for-export'}));
    insert.run('pilot/permits/synthetic-permit-'+id+'.json',JSON.stringify({phoneHash:'synthetic-phone-'+id}));
  }
  insert.run('live/phones/other.json',JSON.stringify({phone:'+85222000000'}));
  insert.run('pilot/phones_extra/other.json',JSON.stringify({phone:'+85223000000'}));
  const before=sqlite.prepare('SELECT key,value FROM contact_objects ORDER BY key').all();
  const queries=[];
  const tracked={...DB,prepare(sql){queries.push(sql);return DB.prepare(sql);}};
  const exported=await exportDrawCSV(tracked,'pilot');
  assert.equal(queries.length,1);assert.ok(queries[0].includes('WHERE key>=? AND key<? ORDER BY key'));
  const legacy=createStudyServer(()=>({DB:research.DB,BUCKET:store,DRAW_SECRET:'synthetic-draw-key-at-least-32-characters'}));
  assert.equal(exported,await legacy.drawCSV('pilot'));
  assert.equal(exported.split('\r\n').length,151);assert.ok(exported.startsWith('\uFEFF"phone"'));
  assert.ok(!exported.includes('+85222000000'));assert.ok(!exported.includes('+85223000000'));
  assert.ok(!/phoneHash|participant_code|ignored|not-for-export/.test(exported));
  assert.deepEqual(sqlite.prepare('SELECT key,value FROM contact_objects ORDER BY key').all(),before);
  queries.length=0;
  const adminToken='synthetic-admin-export-token-at-least-32-characters';
  const response=await fetchHandler(new Request('https://api.example.test/api/admin/export?mode=pilot&kind=draw',{headers:{Authorization:'Bearer '+adminToken}}),{DB:research.DB,CONTACTS_DB:tracked,DRAW_SECRET:'synthetic-draw-key',ADMIN_TOKEN:adminToken});
  assert.equal(response.status,200);assert.equal(queries.length,1,'The actual Worker endpoint must also use one D1 query');
  assert.equal(Buffer.from(await response.arrayBuffer()).toString('utf8'),exported);
  assert.equal(await exportDrawCSV(DB,'live'),await legacy.drawCSV('live'));
  await assert.rejects(exportDrawCSV(DB,'typo'),/mode/);
});

test('empty phone exports contain the same header as the legacy storage adapter',async t=>{
  const {DB}=fixture(t);assert.equal(await exportDrawCSV(DB,'pilot'),'\uFEFF"phone"');
});
