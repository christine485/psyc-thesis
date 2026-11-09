// Watch one displayed stimulus. A stalled request must not leave the participant
// waiting forever; retry always requests the same image, with a fresh cache key.
export function watchStimulus(image,source,{onReady,onFailure,timeoutMs=20000,setTimer=setTimeout,clearTimer=clearTimeout,retryStamp=Date.now}={}){
 let disposed=false,timer=null,attempt=0,phase='loading';
 const clearDeadline=()=>{if(timer!==null){clearTimer(timer);timer=null;}};
 function dispose(){if(disposed)return;disposed=true;clearDeadline();image.removeEventListener('load',ready);image.removeEventListener('error',failed);}
 function current(){if(disposed)return false;if(!image.isConnected){dispose();return false;}return true;}
 function ready(){if(!current()||!image.naturalWidth||phase==='ready')return;phase='ready';clearDeadline();onReady();}
 function fail(reason){if(!current()||phase!=='loading')return;phase='error';clearDeadline();onFailure(reason);}
 function failed(){fail('error');}
 function alreadyRequested(){
  if(!image.src)return false;
  try{
   const actual=new URL(image.src),expected=new URL(source);
   // Keep a successful user retry when rating or resuming the same stimulus.
   actual.searchParams.delete('retry');expected.searchParams.delete('retry');
   return actual.href===expected.href;
  }catch{return false;}
 }
 function start(retry){
  if(!current())return;
  clearDeadline();phase='loading';const request=++attempt;
  timer=setTimer(()=>{if(request===attempt)fail('timeout');},timeoutMs);
  let url=source;
  if(retry){const fresh=new URL(source);fresh.searchParams.set('retry',retryStamp()+'-'+attempt);url=fresh.href;}
  // A prepared Image may already be downloaded/decoded or still in flight.
  // Assigning the same URL again would restart/revalidate that request.
  if(retry||!alreadyRequested())image.src=url;
  // Cached success/error events may have fired before a browser dispatches them
  // to this task. Check both outcomes after assigning the source.
  if(image.complete){if(image.naturalWidth)ready();else failed();}
 }
 image.addEventListener('load',ready);image.addEventListener('error',failed);
 start(false);
 return {retry:()=>start(true),dispose};
}
