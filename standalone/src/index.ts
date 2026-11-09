import {createStudyServer} from '../../lib/study-core.ts';
import {PROTOCOL, STIMULI} from '../../docs/modules/protocol.mjs';
import {createContactStore,exportDrawCSV} from './contact-store.ts';

export interface Env {
  DB: D1Database;
  CONTACTS_DB: D1Database;
  DRAW_SECRET: string;
  ADMIN_TOKEN: string;
  STUDY_MAINTENANCE?: string;
  STAGING_ONLY?: string;
}
const PARTICIPANT_ORIGIN = 'https://christine485.github.io';
const MAX_BODY_BYTES = 150_000;
const participantPaths = new Set(['/api/study/start', '/api/study/submit', '/api/draw']);
const safeHeaders = {'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Origin'};
function headers(req:Request):Record<string,string> {
  const origin=req.headers.get('Origin');
  return origin === PARTICIPANT_ORIGIN || origin === new URL(req.url).origin
    ? {...safeHeaders,'Access-Control-Allow-Origin':origin}
    : {...safeHeaders};
}
function json(req:Request, value:unknown, status=200) {return Response.json(value,{status,headers:headers(req)});}
function configured(env:Env) {return !!(env.DB && env.CONTACTS_DB && env.DRAW_SECRET?.length>0 && env.ADMIN_TOKEN?.length>=32);}
function studyServer(env:Env) {return createStudyServer(()=>({DB:env.DB,BUCKET:createContactStore(env.CONTACTS_DB),DRAW_SECRET:env.DRAW_SECRET}));}
export async function authorized(req:Request,env:Env) {
  if(!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length<32) return false;
  const auth=req.headers.get('Authorization');
  if(!auth?.startsWith('Bearer ') || auth.length>2048) return false;
  const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const [expected,actual]=await Promise.all([digest(env.ADMIN_TOKEN),digest(auth.slice(7))]);
  // Compare fixed-size digests; never compare secret strings with early-exit equality.
  let difference=0;for(let i=0;i<expected.length;i++)difference|=expected[i]^actual[i];
  return difference===0;
}
async function readBody(req:Request) {
  if(!req.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw Error('資料格式不正確。');
  if(Number(req.headers.get('Content-Length')||0)>MAX_BODY_BYTES)throw Error('資料過大。');
  if(!req.body)throw Error('資料格式不正確。');
  const reader=req.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;
    if(length>MAX_BODY_BYTES){await reader.cancel();throw Error('資料過大。');}chunks.push(item.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const value=JSON.parse(new TextDecoder().decode(bytes));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('資料格式不正確。');return value;
}
function adminOriginAllowed(req:Request,url:URL){const origin=req.headers.get('Origin');return !origin||origin===url.origin;}
export async function fetchHandler(req:Request,env:Env):Promise<Response> {
  const url=new URL(req.url),path=url.pathname;
  if(path==='/api/health' && req.method==='GET') {
    const configurationReady=configured(env);let storageReady=false;
    if(configurationReady)try{await env.DB.prepare('SELECT mode,id,token_hash,expires,plan,submitted,payload FROM slots LIMIT 1').first();await env.CONTACTS_DB.prepare('SELECT key,value FROM contact_objects LIMIT 1').first();storageReady=true;}catch{}
    const ready=configurationReady&&storageReady&&env.STUDY_MAINTENANCE!=='1';
    return json(req,{ok:ready,protocol:PROTOCOL,images:STIMULI.length,configurationReady,storageReady,maintenance:env.STUDY_MAINTENANCE==='1',stagingOnly:env.STAGING_ONLY==='1'},ready?200:503);
  }
  if(path==='/api/admin/export'||path==='/api/admin/status'||path==='/api/admin/export-index') {
    if(req.method!=='GET')return json(req,{error:'Method not allowed'},405);
    if(!adminOriginAllowed(req,url)||!await authorized(req,env))return json(req,{error:'僅研究團隊可下載。'},403);
    if(!configured(env))return json(req,{error:'研究服務尚未準備好。'},503);
    try{
      if(path==='/api/admin/status') {
        const modes:Record<string,unknown>={};
        for(const mode of ['pilot','live']) {
          const row=await env.DB.prepare('SELECT COUNT(*) AS allocated, COALESCE(SUM(CASE WHEN submitted=1 THEN 1 ELSE 0 END),0) AS submitted FROM slots WHERE mode=? AND token_hash IS NOT NULL').bind(mode+':'+PROTOCOL).first();
          modes[mode]=row;
        }
        return json(req,{protocol:PROTOCOL,maintenance:env.STUDY_MAINTENANCE==='1',modes});
      }
      const mode=url.searchParams.get('mode'),kind=url.searchParams.get('kind');
      if(path==='/api/admin/export-index') {
        if(!['pilot','live'].includes(mode||''))return json(req,{error:'請指定 mode=pilot 或 live。'},400);
        return json(req,{protocol:PROTOCOL,mode,...await studyServer(env).researchIndex(mode!)});
      }
      if(!['pilot','live'].includes(mode||'')||!['research','draw'].includes(kind||''))return json(req,{error:'請指定 mode=pilot 或 live，以及 kind=research 或 draw。'},400);
      let slot:number|undefined;
      if(url.searchParams.has('slot')) {
        const value=url.searchParams.get('slot')!;
        if(kind!=='research'||url.searchParams.getAll('slot').length!==1||!/^(0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value)))return json(req,{error:'問卷名額不正確。'},400);
        slot=Number(value);
      }
      const data=await(kind==='draw'?exportDrawCSV(env.CONTACTS_DB,mode!):studyServer(env).researchCSV(mode!,slot));
      return new Response(data,{headers:{...safeHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${mode}-${kind}.csv"`}});
    }catch{return json(req,{error:'暫時無法讀取研究資料。'},503);}
  }
  if(!participantPaths.has(path))return json(req,{error:'Not found'},404);
  const origin=req.headers.get('Origin');
  if(origin!==PARTICIPANT_ORIGIN&&!(env.STAGING_ONLY==='1'&&origin===url.origin))return json(req,{error:'此頁面的來源未獲允許。'},403);
  if(req.method==='OPTIONS') {
    if(req.headers.get('Access-Control-Request-Method')!=='POST')return json(req,{error:'Method not allowed'},405);
    const requested=(req.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(h=>h.trim()).filter(Boolean);
    if(requested.some(h=>h!=='content-type'))return json(req,{error:'Headers not allowed'},403);
    return new Response(null,{status:204,headers:{...headers(req),'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
  }
  if(req.method!=='POST')return json(req,{error:'Method not allowed'},405);
  if(env.STUDY_MAINTENANCE==='1')return json(req,{error:'研究網站正在維護，請稍後再試。'},503);
  if(!configured(env))return json(req,{error:'研究服務尚未準備好，請稍後再試。'},503);
  let body:any;try{body=await readBody(req);}catch{return json(req,{error:'資料格式不正確或資料過大。'},400);}
  if(!['pilot','live'].includes(body.mode))return json(req,{error:'研究模式不正確。'},400);
  if(env.STAGING_ONLY==='1'&&body.mode!=='pilot')return json(req,{error:'此網站只供試測，不能接收正式研究資料。'},400);
  try{
    const study=studyServer(env);
    const value=path==='/api/study/start'?await study.allocate(body):path==='/api/study/submit'?await study.submit(body):await study.enterDraw(body);return json(req,value);
  }catch(error){const message=error instanceof Error?error.message:'';
    return /[\u3400-\u9fff]/.test(message)?json(req,{error:message},400):json(req,{error:'研究服務暫時無法儲存，請稍後再試。'},503);}
}
export default {fetch:fetchHandler};
