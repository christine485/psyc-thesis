import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {makePlan,validateSubmission,PROTOCOL,CONSENT,STIMULI,FAMILIES,normalizePhone,csv} from '../docs/modules/protocol.mjs';
export function bindings(){return env as unknown as {DB:D1Database;BUCKET:R2Bucket;ADMIN_EMAIL?:string;DRAW_SECRET?:string};}
export const mode=(x:unknown)=>x==='pilot'?'pilot':'live';
export const storageMode=(x:unknown)=>mode(x)+':'+PROTOCOL;
const siteOrigin='https://cloud-flow-emotion-study.christine040805.chatgpt.site';
export function allowedOrigin(req:Request){const origin=req.headers.get('origin');return origin===new URL(req.url).origin||origin===siteOrigin||origin==='https://christine485.github.io'||/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin||'');}
export function cors(req:Request){const h:Record<string,string>={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Vary':'Origin'};if(allowedOrigin(req)){h['Access-Control-Allow-Origin']=req.headers.get('origin')||new URL(req.url).origin;h['Access-Control-Allow-Methods']='POST, OPTIONS';h['Access-Control-Allow-Headers']='Content-Type';}return h;}
export function json(req:Request,value:unknown,status=200){return Response.json(value,{status,headers:cors(req)});}
export function options(req:Request){return new Response(null,{status:allowedOrigin(req)?204:403,headers:cors(req)});}
export async function readBody(req:Request){if(!allowedOrigin(req))throw Error('此頁面的來源未獲允許。');if(!req.headers.get('content-type')?.startsWith('application/json'))throw Error('資料格式不正確。');if(Number(req.headers.get('content-length')||0)>150000)throw Error('資料過大。');const text=await req.text();if(text.length>150000)throw Error('資料過大。');return JSON.parse(text);}
export async function hash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function token(value:unknown){if(typeof value!=='string'||! /^[a-f0-9-]{36}$/.test(value))throw Error('參與代碼不正確。');return value;}
export async function isAdmin(){const u=await getChatGPTUser();return !!(u&&bindings().ADMIN_EMAIL&&u.email.toLowerCase()===bindings().ADMIN_EMAIL!.toLowerCase());}
export const CLAIM_SQL='UPDATE slots SET token_hash=?,expires=?,plan=NULL WHERE mode=? AND id=(SELECT id FROM slots WHERE mode=? AND submitted=0 AND expires<? ORDER BY id/10,random() LIMIT 1) AND submitted=0 AND expires<? RETURNING *';
export async function allocate(body:any){
 if(body.consented!==true||body.protocol!==PROTOCOL||body.consent!==CONSENT)throw Error('請先閱讀並同意參與研究。');
 const db=bindings().DB,m=storageMode(body.mode),t=await hash(token(body.token)),now=Date.now();
 let row:any=await db.prepare('SELECT * FROM slots WHERE token_hash=? AND mode=?').bind(t,m).first();
 if(row?.submitted)throw Error('這次參與已提交。');
 if(!row)for(let attempt=0;attempt<20&&!row;attempt++){
  row=await db.prepare(CLAIM_SQL).bind(t,now+12*3600000,m,m,now,now).first();
  if(!row){const max:any=await db.prepare('SELECT MAX(id) AS n FROM slots WHERE mode=?').bind(m).first();const start=(max?.n??-1)+1;await db.batch(Array.from({length:10},(_,i)=>db.prepare('INSERT OR IGNORE INTO slots(mode,id) VALUES(?,?)').bind(m,start+i)));}
 }
 if(!row)throw Error('暫時無法準備圖片，請再試一次。');
 const plan=row.plan?JSON.parse(row.plan):makePlan(row.id,t,mode(body.mode));
 const result=await db.prepare('UPDATE slots SET plan=?,expires=? WHERE mode=? AND id=? AND token_hash=? AND submitted=0').bind(JSON.stringify(plan),now+12*3600000,m,row.id,t).run();
 if(!result.meta.changes)throw Error('圖片分配已更新，請重新開始。');
 return {...plan,rowSeed:t};
}
async function hmac(text:string){if(!bindings().DRAW_SECRET)throw Error('抽獎服務尚未設定。');return crypto.subtle.importKey('raw',new TextEncoder().encode(bindings().DRAW_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signPermit(nonce:string,m:string){token(nonce);const message=m+':'+nonce;const key=await hmac(message);const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message)))].map(x=>x.toString(16).padStart(2,'0')).join('');return message+':'+signature;}
async function verifyPermit(permit:unknown,m:string){if(typeof permit!=='string')return null;const parts=permit.split(':');if(parts.length!==3||parts[0]!==m||! /^[a-f0-9-]{36}$/.test(parts[1])||! /^[a-f0-9]{64}$/.test(parts[2]))return null;const key=await hmac('');const bytes=new Uint8Array(parts[2].match(/../g)!.map(x=>parseInt(x,16)));const ok=await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(m+':'+parts[1]));return ok?parts[1]:null;}
export async function submit(body:any){
 const db=bindings().DB,t=await hash(token(body.token)),m=storageMode(body.mode);
 const row:any=await db.prepare('SELECT * FROM slots WHERE token_hash=? AND mode=?').bind(t,m).first();
 if(!row)throw Error('找不到這次參與，請重新開始。');
 let valid:boolean;
 if(row.submitted){valid=JSON.parse(row.payload).validQuestionnaire;}else{
  if(row.expires<Date.now())throw Error('這次參與已超過12小時，請重新開始。');
  const plan=JSON.parse(row.plan),checked=validateSubmission(body,plan,t);valid=checked.validQuestionnaire;
  const payload=JSON.stringify({participantCode:crypto.randomUUID(),protocol:PROTOCOL,consent:CONSENT,classifier:plan.classifier,consented:true,plan,...checked,device:{kind:['手機','平板','電腦'].includes(body.device?.kind)?body.device.kind:'其他',viewportWidth:Number(body.device?.viewportWidth)||null,viewportHeight:Number(body.device?.viewportHeight)||null}});
  const result=await db.prepare('UPDATE slots SET payload=?,submitted=1 WHERE mode=? AND id=? AND token_hash=? AND submitted=0').bind(payload,m,row.id,t).run();
  if(!result.meta.changes){const r:any=await db.prepare('SELECT submitted,payload FROM slots WHERE token_hash=? AND mode=?').bind(t,m).first();if(!r?.submitted)throw Error('分配名額已逾時，無法提交。');valid=JSON.parse(r.payload).validQuestionnaire;}
 }
 // Client creates a separate random nonce. Neither it nor the signed permit is
 // persisted with research responses. Idempotent retries sign that same nonce.
 const drawPermit=valid?await signPermit(token(body.drawNonce),mode(body.mode)):null;
 return {submitted:true,eligible:valid,drawPermit};
}
export async function enterDraw(body:any){
 const m=mode(body.mode),nonce=await verifyPermit(body.permit,m),phone=normalizePhone(body.phone);
 if(!nonce)throw Error('未能確認有效問卷的抽獎資格。');if(!phone)throw Error('請輸入8位香港電話，或以＋國際區號開頭的電話。');
 const phoneHash=await hash(phone),bucket=bindings().BUCKET,claimKey=m+'/permits/'+await hash(nonce)+'.json';
 const claim=await bucket.put(claimKey,JSON.stringify({phoneHash}),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 if(!claim){const existing:any=await (await bucket.get(claimKey))?.json();if(existing?.phoneHash!==phoneHash)throw Error('這個抽獎資格已使用。');}
 await bucket.put(m+'/phones/'+phoneHash+'.json',JSON.stringify({phone}),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
 return {submitted:true};
}
export async function records(m:string){const result=await bindings().DB.prepare('SELECT id,payload FROM slots WHERE mode=? AND submitted=1 ORDER BY id').bind(storageMode(m)).all();return result.results.map((r:any)=>JSON.parse(r.payload));}
export async function researchCSV(m:string){
 const rows:any[][]=[['participant_code','protocol','valid_questionnaire','slot','trial','type','stimulus','condition','waviness_deg','disorder_sd_deg','grain_sigma_px','seed','free_text','named_words','classified_words','classifier_version','unmatched_words','rated_word','word_family','word_order','rating','attention_pass','naming_ms','duration_ms','display_width','display_height','gender','age','education','device','viewport_width','viewport_height']];
 for(const p of await records(m))for(const r of p.responses){const s=STIMULI.find((s:any)=>s.file===r.stimulus)!;for(const w of r.words.length?r.words:[''])rows.push([p.participantCode,p.protocol,p.validQuestionnaire,p.plan.slot,r.index+1,r.type,s.file,s.condition,s.waviness_deg,s.disorder_sd_deg,s.grain_sigma_px,s.seed,r.freeText,JSON.stringify(r.named),JSON.stringify(r.classified),p.classifier,r.classified.filter((x:any)=>!x.family).map((x:any)=>x.raw).join('、'),w,FAMILIES.find((f:any)=>f.selected.includes(w))?.id||'',w?r.words.indexOf(w)+1:'',w?r.ratings[w]:'',r.attentionPass,r.namingMs,r.durationMs,r.width,r.height,p.demographics.gender,p.demographics.age,p.demographics.education,p.device.kind,p.device.viewportWidth,p.device.viewportHeight]);}
 return csv(rows);
}
export async function drawCSV(m:string){const rows:any[][]=[['phone']];let cursor:string|undefined;do{const list=await bindings().BUCKET.list({prefix:m+'/phones/',cursor});for(const item of list.objects){const value:any=await(await bindings().BUCKET.get(item.key))?.json();if(value)rows.push([value.phone]);}cursor=list.truncated?list.cursor:undefined;}while(cursor);return csv(rows);}
