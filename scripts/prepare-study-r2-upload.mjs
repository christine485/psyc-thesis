#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Prepare private argv arrays for operator review; NEVER execute remote writes.
// Before running the plan, verify a new empty destination bucket and freeze
// both services. Wrangler's object-put command has no conditional-write flag.
const options=new Map();const args=process.argv.slice(2);
for(let i=0;i<args.length;i+=2)options.set(args[i],args[i+1]);
const expected=['--manifest','--bucket','--wrangler','--config'];
try{
 if(args.length!==expected.length*2||expected.some(key=>!options.get(key)))throw Error('Usage: node scripts/prepare-study-r2-upload.mjs --manifest /private/import/r2-manifest.json --bucket NAME --wrangler /absolute/wrangler.js --config /absolute/wrangler.jsonc');
 const bucket=options.get('--bucket');if(!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(bucket))throw Error('Invalid bucket name');
 const manifestPath=path.resolve(options.get('--manifest')),base=path.dirname(manifestPath),manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 if(manifest.format!=='psyc-study-snapshot-v1'||!Array.isArray(manifest.objects))throw Error('Invalid R2 manifest');
 // Validate every file before the first remote write.
 const commands=[];
 for(const item of manifest.objects){
  if(typeof item.key!=='string'||!item.key||typeof item.file!=='string'||!/^objects\/\d{8}\.bin$/.test(item.file))throw Error('Invalid R2 manifest entry');
  const bytes=fs.readFileSync(path.join(base,item.file));if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('R2 file checksum mismatch');
  // Current study objects have only JSON content type. Refuse silent metadata loss.
  if(Object.keys(item.customMetadata||{}).length||Object.keys(item.httpMetadata||{}).some(k=>k!=='contentType'))throw Error('Unsupported R2 metadata; use Cloudflare SDK migration to preserve it');
 }
 for(const item of manifest.objects){
  const command=[path.resolve(options.get('--wrangler')),'r2','object','put',bucket+'/'+item.key,'--file',path.join(base,item.file),'--remote','--config',path.resolve(options.get('--config'))];
  if(item.httpMetadata?.contentType)command.push('--content-type',item.httpMetadata.contentType);
  commands.push({executable:process.execPath,args:command});
 }
 const planPath=path.join(base,'r2-upload-plan.json');
 fs.writeFileSync(planPath,JSON.stringify({remoteWrites:false,preconditions:['Both services in maintenance mode','Dedicated target bucket verified empty','No other administrator uploads during import','Verify every uploaded object checksum before cutover'],commands},null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({plannedObjects:manifest.objects.length,remoteWrites:false}));
}catch(e){console.error(e.message);process.exitCode=1;}
