const $=id=>document.getElementById(id);
const allowed=!location.hostname.endsWith('.github.io')&&(location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname));
const pending=new Set(),urls=new Set();
let token='',generation=0,status=null,busy=false;
function error(message=''){$('error').textContent=message;$('error').hidden=!message;}
function controls(){for(const id of ['mode','refresh','download-research','download-draw'])$(id).disabled=busy;}
function clearDownloads(){for(const url of urls)URL.revokeObjectURL(url);urls.clear();$('download-links').replaceChildren();$('download-status').textContent='';}
function logout(){generation++;for(const controller of pending)controller.abort();pending.clear();token='';status=null;busy=false;$('admin-token').value='';$('generated-key').value='';$('generated-wrap').hidden=true;$('show-key').checked=false;$('generated-key').type='password';$('copy-status').textContent='';$('dashboard').hidden=true;$('sign-in').hidden=!allowed;$('submitted').textContent='—';$('allocated').textContent='—';$('login').disabled=!allowed;$('admin-token').disabled=!allowed;clearDownloads();controls();error();}
async function api(path,format='json',key=token){
 const current=generation,controller=new AbortController();pending.add(controller);
 const timer=setTimeout(()=>controller.abort(),30000);
 try{
  const response=await fetch(new URL(path,location.origin),{method:'GET',headers:key?{Authorization:'Bearer '+key}:{},credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
  if(!response.ok){if(response.status===403)throw Error('管理密碼不正確，或你未獲授權。請確認 Cloudflare 的 ADMIN_TOKEN 已儲存及部署。');throw Error('暫時未能讀取資料，請稍後重試。');}
  if(format==='csv'&&!(response.headers.get('Content-Type')||'').toLowerCase().startsWith('text/csv'))throw Error('下載格式不正確，請重試。');
  const value=await(format==='csv'?response.text():response.json());
  if(current!==generation)throw Error('操作已取消。');
  return value;
 }catch(cause){if(current!==generation)throw Error('操作已取消。');if(cause.name==='AbortError'||cause instanceof TypeError)throw Error('連線未完成，請重試。資料仍保留在伺服器。');throw cause;}
 finally{clearTimeout(timer);pending.delete(controller);}
}
function counts(){const mode=$('mode').value,row=status?.modes?.[mode];for(const key of ['submitted','allocated'])$(key).textContent=Number.isSafeInteger(row?.[key])?String(row[key]):'—';}
async function refresh(){const current=generation;busy=true;controls();error();try{const value=await api('/api/admin/status');if(current!==generation)return;status=value;counts();}catch(cause){if(current===generation)error(cause.message);}finally{if(current===generation){busy=false;controls();}}}
function download(parts,filename){
 const blob=new Blob(parts,{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);urls.add(url);
 const link=document.createElement('a');link.href=url;link.download=filename;link.textContent='如未自動下載，按這裏下載 '+filename;
 $('download-links').append(link);link.click();$('download-status').textContent='CSV 已準備好：'+filename+'。iPad 可在「檔案」→「下載項目」尋找。';
}
async function exportCSV(kind){
 const current=generation,mode=$('mode').value;if(!token||busy||!['pilot','live'].includes(mode))return;
 busy=true;controls();error();clearDownloads();
 try{
  const base='/api/admin/export?mode='+mode+'&kind='+kind;
  if(kind==='draw'){const value=await api(base,'csv');if(current===generation)download(['\uFEFF',value.replace(/^\uFEFF/,'')],mode+'-draw.csv');return;}
  const index=await api('/api/admin/export-index?mode='+mode);
  if(index.mode!==mode||!Array.isArray(index.slots)||!index.slots.every(id=>Number.isSafeInteger(id)&&id>=0)||new Set(index.slots).size!==index.slots.length||typeof index.header!=='string'||!index.header.startsWith('\uFEFF"participant_code"')||/[\r\n]/.test(index.header))throw Error('資料索引格式不正確，請重試。');
  const header=index.header.replace(/^\uFEFF/,''),parts=[index.header];let completed=0;
  for(const slot of index.slots){
   $('download-status').textContent='正在準備研究答案：'+completed+' ／ '+index.slots.length+' 份…';
   const page=(await api(base+'&slot='+slot,'csv')).replace(/^\uFEFF/,'');
   const split=page.indexOf('\r\n'),pageHeader=split<0?page:page.slice(0,split);
   if(pageHeader!==header)throw Error('資料欄位不一致，下載已停止。請重新下載。');
   if(split>=0)parts.push('\r\n',page.slice(split+2));completed++;
  }
  if(current===generation)download(parts,mode+'-research.csv');
 }catch(cause){if(current===generation){$('download-status').textContent='未完成下載。請再按一次下載按鈕。';error(cause.message);}}
 finally{if(current===generation){busy=false;controls();}}
}
if(!allowed){$('sign-in').hidden=true;$('wrong-host').hidden=false;$('service-status').textContent='請使用研究後端的管理頁。';}
else{
 $('admin-token').disabled=false;$('login').disabled=false;$('generate-key').disabled=false;
 api('/api/health','json','').then(health=>{if(!token)$('mode').value=health.stagingOnly?'pilot':'live';$('service-status').textContent=health.stagingOnly?'此服務目前只收集試測資料（pilot）。正式研究尚未啟用。':'此服務已啟用正式研究。請確認選取所需資料類型。';}).catch(()=>{$('service-status').textContent='服務狀態暫時未能讀取；你仍可嘗試登入。';});
 $('login-form').addEventListener('submit',async event=>{
  event.preventDefault();const candidate=$('admin-token').value.trim();if(candidate.length<32||candidate.length>1900)return;
  const current=generation;token=candidate;$('admin-token').value='';$('login').disabled=true;$('admin-token').disabled=true;error();
  try{const value=await api('/api/admin/status');if(current!==generation)return;status=value;$('generated-key').value='';$('generated-wrap').hidden=true;$('show-key').checked=false;$('generated-key').type='password';$('sign-in').hidden=true;$('dashboard').hidden=false;counts();}
  catch(cause){if(current===generation){token='';error(cause.message);}}
  finally{if(current===generation){$('login').disabled=false;$('admin-token').disabled=false;}}
 });
 $('mode').addEventListener('change',()=>{clearDownloads();counts();});$('refresh').addEventListener('click',refresh);$('logout').addEventListener('click',logout);
 $('download-research').addEventListener('click',()=>exportCSV('research'));$('download-draw').addEventListener('click',()=>exportCSV('draw'));
 $('generate-key').addEventListener('click',()=>{$('generated-key').value=Array.from(crypto.getRandomValues(new Uint8Array(32)),value=>value.toString(16).padStart(2,'0')).join('');$('generated-wrap').hidden=false;$('copy-status').textContent='請先自行保存，再貼到 Cloudflare 的 ADMIN_TOKEN。';});
 $('show-key').addEventListener('change',()=>{$('generated-key').type=$('show-key').checked?'text':'password';});
 $('copy-key').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('generated-key').value);$('copy-status').textContent='已複製。請存到自己的密碼管理器，並貼到 Cloudflare。';}catch{$('show-key').checked=true;$('generated-key').type='text';$('generated-key').focus();$('generated-key').select();$('copy-status').textContent='請長按新密碼欄，選擇「複製」。';}});
 window.addEventListener('pagehide',logout);
}
