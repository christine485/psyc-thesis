const CONNECTION_ERROR='暫時無法連接研究服務。你的未提交答案仍在本頁，請稍後重試，勿重新整理。';

// A deadline covers both response headers and the JSON body. The participant
// can retry with the original token, answers and draw nonce after a timeout.
export async function postStudy(apiBase,route,body,{fetchImpl=fetch,timeoutMs=30000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const controller=new AbortController();let timer;
 const request=(async()=>{
  let response,value;
  try{
   response=await fetchImpl(apiBase+route,{method:'POST',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   value=await response.json();
  }catch{throw Error(CONNECTION_ERROR);}
  if(!response.ok)throw Error(value.error||'未能提交，請重試。');
  return value;
 })();
 const deadline=new Promise((resolve,reject)=>{
  timer=setTimer(()=>{controller.abort();reject(Error(CONNECTION_ERROR));},timeoutMs);
 });
 try{return await Promise.race([request,deadline]);}
 finally{clearTimer(timer);}
}
