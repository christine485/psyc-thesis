import test from 'node:test';
import assert from 'node:assert/strict';
import {createContactStore} from '../src/contact-store.ts';
import {sqliteD1} from './sqlite-d1.mjs';

function fixture(t){
  const {sqlite,DB}=sqliteD1(new URL('../contact-migrations/0001_contacts.sql',import.meta.url));
  t.after(()=>sqlite.close());
  return {sqlite,store:createContactStore(DB)};
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
