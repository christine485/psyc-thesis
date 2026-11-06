import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../app/chatgpt-auth';
import {createStudyServer} from './study-core';
export {mode,storageMode,hash} from './study-core';
export function bindings(){return env as unknown as {DB:D1Database;BUCKET:R2Bucket;ADMIN_EMAIL?:string;DRAW_SECRET?:string;STUDY_MAINTENANCE?:string};}
const siteOrigin='https://cloud-flow-emotion-study.christine040805.chatgpt.site';
export function allowedOrigin(req:Request){const origin=req.headers.get('origin');return origin===new URL(req.url).origin||origin===siteOrigin||origin==='https://christine485.github.io'||/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin||'');}
export function cors(req:Request){const h:Record<string,string>={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Vary':'Origin'};if(allowedOrigin(req)){h['Access-Control-Allow-Origin']=req.headers.get('origin')||new URL(req.url).origin;h['Access-Control-Allow-Methods']='POST, OPTIONS';h['Access-Control-Allow-Headers']='Content-Type';}return h;}
export function json(req:Request,value:unknown,status=200){return Response.json(value,{status,headers:cors(req)});}
export function options(req:Request){return new Response(null,{status:allowedOrigin(req)?204:403,headers:cors(req)});}
export async function readBody(req:Request){if(bindings().STUDY_MAINTENANCE==='1')throw Error('研究網站正在維護，請稍後再試。');if(!allowedOrigin(req))throw Error('此頁面的來源未獲允許。');if(!req.headers.get('content-type')?.startsWith('application/json'))throw Error('資料格式不正確。');if(Number(req.headers.get('content-length')||0)>150000)throw Error('資料過大。');const text=await req.text();if(text.length>150000)throw Error('資料過大。');return JSON.parse(text);}
export async function isAdmin(){const u=await getChatGPTUser();return !!(u&&bindings().ADMIN_EMAIL&&u.email.toLowerCase()===bindings().ADMIN_EMAIL!.toLowerCase());}
export const {allocate,submit,enterDraw,records,researchCSV,drawCSV,signPermit,CLAIM_SQL}=createStudyServer(bindings);
