import {bindings,isAdmin} from '../../../../lib/server';
import {PROTOCOL} from '../../../../docs/modules/protocol.mjs';

// Owner-only disaster-recovery export. Never include secrets in this snapshot.
export async function GET(){
 const headers={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
 if(!await isAdmin())return Response.json({error:'僅研究團隊可下載。'},{status:403,headers});
 const settings=bindings();
 if(settings.STUDY_MAINTENANCE!=='1')return Response.json({error:'請先暫停所有研究及抽獎寫入，再下載備份。'},{status:409,headers});
 const {DB,BUCKET}=settings,slots:any[]=[],objects:any[]=[];
 const byteLimit=16*1024*1024,encoder=new TextEncoder();
 let lastMode='',lastId=-1,totalBytes=0;
 for(;;){
  const page=await DB.prepare('SELECT mode,id,token_hash,expires,plan,submitted,payload FROM slots WHERE mode>? OR (mode=? AND id>?) ORDER BY mode,id LIMIT 500').bind(lastMode,lastMode,lastId).all();
  if(!page.results.length)break;
  totalBytes+=encoder.encode(JSON.stringify(page.results)).byteLength;
  if(totalBytes>byteLimit)return Response.json({error:'資料量超過網頁匯出上限，請使用受保護的儲存備份。'},{status:413,headers});
  slots.push(...page.results);
  const last=page.results[page.results.length-1] as any;lastMode=last.mode;lastId=last.id;
  if(slots.length>100000)return Response.json({error:'資料量超過網頁匯出上限，請使用受保護的儲存備份。'},{status:413,headers});
 }
 let cursor:string|undefined;
 do{
  const page=await BUCKET.list({cursor,limit:100});
  for(const item of page.objects){
   const object=await BUCKET.get(item.key);
   if(!object)return Response.json({error:'備份期間資料有變動，請停止寫入後重試。'},{status:409,headers});
   // Check size before allocating object contents; base64 adds one third.
   if(totalBytes+Math.ceil(object.size/3)*4+2048>byteLimit)return Response.json({error:'資料量超過網頁匯出上限，請使用受保護的儲存備份。'},{status:413,headers});
   const bytes=new Uint8Array(await object.arrayBuffer());
   let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
   const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
   const exported={key:item.key,bodyBase64:btoa(binary),sha256,httpMetadata:object.httpMetadata,customMetadata:object.customMetadata};
   totalBytes+=encoder.encode(JSON.stringify(exported)).byteLength;
   if(totalBytes>byteLimit)return Response.json({error:'資料量超過網頁匯出上限，請使用受保護的儲存備份。'},{status:413,headers});
   objects.push(exported);
  }
  cursor=page.truncated?page.cursor:undefined;
 }while(cursor);
 const snapshot={format:'psyc-study-snapshot-v1',createdAt:new Date().toISOString(),protocol:PROTOCOL,slots,objects};
 return Response.json(snapshot,{headers:{...headers,'Content-Disposition':'attachment; filename="psyc-study-private-snapshot.json"'}});
}
