#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const columns=['mode','id','token_hash','expires','plan','submitted','payload'];
const fail=message=>{throw new Error(message);};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const jsonText=(value,label)=>{if(value!==null){if(typeof value!=='string')fail(label+' must be JSON text or null');try{JSON.parse(value);}catch{fail(label+' contains invalid JSON');}}};

export function validateSnapshot(value){
 if(!value||value.format!=='psyc-study-snapshot-v1'||typeof value.protocol!=='string'||!Array.isArray(value.slots)||!Array.isArray(value.objects))fail('Unsupported or incomplete snapshot');
 const keys=new Set(),tokens=new Set(),objectKeys=new Set();
 for(const row of value.slots){
  if(!row||Object.keys(row).sort().join('|')!==[...columns].sort().join('|'))fail('Unexpected slots columns');
  if(typeof row.mode!=='string'||!row.mode||!Number.isSafeInteger(row.id)||row.id<0||!Number.isSafeInteger(row.expires)||row.expires<0||![0,1].includes(row.submitted))fail('Invalid slot fields');
  if(row.token_hash!==null&&(typeof row.token_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.token_hash)))fail('Invalid session hash');
  const key=JSON.stringify([row.mode,row.id]);if(keys.has(key))fail('Duplicate slot');keys.add(key);
  if(row.token_hash!==null){if(tokens.has(row.token_hash))fail('Duplicate session hash');tokens.add(row.token_hash);}
  jsonText(row.plan,'plan');jsonText(row.payload,'payload');
  if(row.submitted===1&&(row.payload===null||row.plan===null||row.token_hash===null))fail('Incomplete submitted slot');
 }
 for(const item of value.objects){
  if(!item||typeof item.key!=='string'||!item.key||item.key.includes('\0')||Buffer.byteLength(item.key)>1024||typeof item.bodyBase64!=='string'||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.bodyBase64))fail('Invalid R2 object');
  if(objectKeys.has(item.key))fail('Duplicate R2 key');objectKeys.add(item.key);
  if(digest(Buffer.from(item.bodyBase64,'base64'))!==item.sha256)fail('R2 checksum mismatch');
  for(const metadata of [item.httpMetadata,item.customMetadata])if(metadata!==undefined&&(metadata===null||typeof metadata!=='object'||Array.isArray(metadata)))fail('Invalid object metadata');
 }
 return value;
}

const sqlValue=value=>value===null?'NULL':typeof value==='number'?String(value):"CAST(X'"+Buffer.from(value,'utf8').toString('hex')+"' AS TEXT)";
export function snapshotSQL(value){
 validateSnapshot(value);
 // The CHECK aborts import into a nonempty target before any slot writes.
 // This temporary, persistent-table guard is supported by D1's SQL executor.
 const start='-- PRIVATE RESEARCH DATA. Import only into an empty target after a write freeze.\nCREATE TABLE __psyc_import_empty_guard (n INTEGER NOT NULL CHECK(n=0));\nINSERT INTO __psyc_import_empty_guard SELECT COUNT(*) FROM slots;\nDROP TABLE __psyc_import_empty_guard;\n';
 return start+value.slots.map(row=>'INSERT INTO slots ('+columns.join(',')+') VALUES ('+columns.map(c=>sqlValue(row[c])).join(',')+');').join('\n')+'\n';
}

export function prepareSnapshot(value,out){
 validateSnapshot(value);
 if(fs.existsSync(out))fail('Output directory already exists; choose a new private directory');
 fs.mkdirSync(out,{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(out,'slots.sql'),snapshotSQL(value),{mode:0o600});
 fs.mkdirSync(path.join(out,'objects'),{mode:0o700});
 const objects=value.objects.map((item,i)=>{const file='objects/'+String(i).padStart(8,'0')+'.bin';fs.writeFileSync(path.join(out,file),Buffer.from(item.bodyBase64,'base64'),{mode:0o600});const {bodyBase64,...metadata}=item;return {...metadata,file};});
 fs.writeFileSync(path.join(out,'r2-manifest.json'),JSON.stringify({format:value.format,objects},null,2)+'\n',{mode:0o600});
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({format:value.format,protocol:value.protocol,slots:value.slots.length,submitted:value.slots.filter(r=>r.submitted).length,objects:objects.length,slotSQLSHA256:digest(fs.readFileSync(path.join(out,'slots.sql')))},null,2)+'\n',{mode:0o600});
 return {slots:value.slots.length,objects:objects.length};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--snapshot'||args[2]!=='--out')fail('Usage: node scripts/import-study-snapshot.mjs --snapshot /private/snapshot.json --out /private/new-import-directory');
  const snapshot=JSON.parse(fs.readFileSync(args[1],'utf8'));const summary=prepareSnapshot(snapshot,path.resolve(args[3]));
  console.log(JSON.stringify({...summary,prepared:true,remoteWrites:false}));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
