import {PROTOCOL,CONSENT,TOTAL,SCALE,EDUCATION,parseWords,ratingWords,normalizePhone,makePlan} from './modules/protocol.mjs?v=hk-speed-20261109';
import {watchStimulus} from './modules/image-loader.mjs?v=hk-speed-20261109';
import {createStimulusPool} from './modules/image-preload.mjs?v=hk-speed-20261109';
import {postStudy} from './modules/study-request.mjs?v=hk-speed-20261109';
import {API_BASE,STIMULUS_BASE} from './config.js?v=backend-1794280473961';import {TITLE,CONFIRM,contacts,CONSENT_HTML,DEBRIEF_HTML} from './forms.js?v=hk-formal-20261104';
const root=document.querySelector('#app'),query=new URLSearchParams(location.search);
const stimulusURL=file=>STIMULUS_BASE+file;
const mode=query.get('mode')==='pilot'?'pilot':'live',preview=query.get('preview')==='1';
const state={page:'consent',plan:null,index:0,phase:'naming',freeText:'',words:[],ratings:{},responses:[],loaded:false,busy:false,error:'',paused:false,t0:0,namingMs:0,pauseAt:0,token:crypto.randomUUID(),drawNonce:crypto.randomUUID(),researchDone:false,drawPermit:null,eligible:null,drawChoice:'no',phone:'',drawDone:false,demographics:{gender:'',age:'',education:''}};
let disposeImage=()=>{};
const stimulusPool=createStimulusPool();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const banner=()=>preview?'<div class="test-banner">預覽模式：不會提交研究資料或登記抽獎。</div>':mode==='pilot'?'<div class="test-banner">試測模式：答案會與正式研究資料分開儲存。</div>':'';
const trial=()=>state.plan?.trials[state.index];
function post(route,body){return postStudy(API_BASE,route,body);}
function setError(message){state.error=message;const e=document.querySelector('#error');if(e){e.textContent=message;e.hidden=!message;}}
function jump(page){state.page=page;state.error='';render();window.scrollTo(0,0);document.querySelector('h1')?.focus();}
function render(){
 disposeImage();disposeImage=()=>{};
 if(state.page!=='trials')stimulusPool.clear();
 let html=banner();
 if(state.page==='consent')html+='<div class="eyebrow">研究參與邀請</div><h1 tabindex="-1">圖案、情緒與你的感受</h1><p class="lede">請先閱讀以下資料，再決定是否參與。</p><div class="facts"><span>年滿18歲</span><span>27張主圖＋1次注意力測試</span><span>預計約15分鐘</span></div><section class="card"><h2>研究資料及參與同意書</h2><p class="study-title">'+TITLE+'</p><div class="contacts">'+contacts+'</div><div class="document">'+CONSENT_HTML+'</div><div class="note">參與完全自願。在最後提交前，你可關閉此頁退出。</div><button id="consent" class="primary consent-button" '+(state.busy?'disabled':'')+'>'+CONFIRM+'</button></section>';
 if(state.page==='trials'){
  const t=trial(),attention=t.type==='attention';
  html+='<div class="trial-header"><div><div class="eyebrow">圖像與感受</div><h1 tabindex="-1">第 '+(state.index+1)+' ／ '+state.plan.total+' 張</h1></div><button id="pause" class="text-button">'+(state.paused?'繼續作答':'稍作休息')+'</button></div><div class="progress" role="progressbar" aria-label="研究進度" aria-valuemin="0" aria-valuemax="'+state.plan.total+'" aria-valuenow="'+state.index+'"><div style="width:'+state.index/state.plan.total*100+'%"></div></div>';
  if(state.paused)html+='<section class="card"><h2>請按自己的步調休息</h2><p>請保留此頁開啟，準備好時按「繼續作答」。</p><button id="resume" class="primary">繼續作答</button></section>';
  else{
   html+='<section class="card image-card"><div class="image-wrap"><img id="stimulus" alt="本次試驗的抽象灰階圖案" style="visibility:hidden"><div id="image-status" class="image-status" role="status">正在載入圖片…</div></div><p class="caption">請觀看圖案，按你自己的感受作答。</p></section>';
   if(state.phase==='naming')html+='<section class="card"><h2 class="question">'+(attention?'這是注意力測試。請在下方輸入「2」。':'觀看這幅圖像時，你產生了甚麼情緒？請輸入一至三個情緒詞語。')+'</h2><label class="form-label" for="free-text">'+(attention?'請輸入「2」':'你的答案')+'</label><textarea id="free-text" maxlength="120" autocomplete="off" spellcheck="false" aria-describedby="naming-help">'+esc(state.freeText)+'</textarea><p id="naming-help" class="help">'+(attention?'本試次請只輸入數字2；下一步的每項評分也請選擇2。':'多於一個詞時，請用頓號、逗號或空格分隔。沒有明顯情緒亦可照實填寫。請勿輸入個人資料。')+'</p><div class="actions"><span class="help">請先填寫，再繼續。</span><button id="name-next" class="primary" disabled>繼續</button></div></section>';
   else html+='<section class="card"><h2 class="question">'+(attention?'本試次請在每一項評分選擇「2」。':'以下詞語與這個圖案所呈現的視覺印象有多配合？')+'</h2><p class="help">'+(attention?'請為下列每一項選擇2。':'請為每個詞語選擇一個答案。請按詞語與圖像的配合程度評分。')+'</p>'+(state.words.length?'<div class="scale-legend">'+SCALE.map((s,i)=>'<div><b>'+String(i+1)+'</b>'+s+'</div>').join('')+'</div>'+state.words.map((w,j)=>'<div class="rating-row" role="group" aria-labelledby="rating-word-'+j+'"><span class="rating-word" id="rating-word-'+j+'">'+w+'</span>'+SCALE.map((s,i)=>'<label class="circle"><input type="radio" name="rating-'+j+'" data-word="'+esc(w)+'" value="'+(i+1)+'" aria-label="'+w+'：'+(i+1)+'，'+s+'" '+(state.ratings[w]===i+1?'checked':'')+'></label>').join('')+'</div>').join(''):'<div class="note">本次輸入已保留。請繼續觀看下一張圖像。</div>')+'<div class="actions"><span id="rating-count" class="help">'+Object.keys(state.ratings).length+' ／ '+state.words.length+' 項已完成</span><button id="trial-next" class="primary" disabled>'+(state.index===state.plan.total-1?'填寫背景資料':'下一張')+'</button></div></section>';
  }
 }
 if(state.page==='demographics')html+='<section class="card"><div class="eyebrow">最後幾個問題</div><h1 tabindex="-1">背景資料</h1><p class="muted">請完成以下三題。</p><form id="demographics"><fieldset class="choice-group"><legend>性別</legend>'+['男','女','其他'].map(g=>'<label class="choice"><input type="radio" name="gender" value="'+g+'" required '+(state.demographics.gender===g?'checked':'')+'>'+g+'</label>').join('')+'</fieldset><label class="form-label" for="age">年齡</label><input id="age" name="age" type="number" inputmode="numeric" min="18" max="120" step="1" required value="'+esc(state.demographics.age)+'"><label class="form-label" for="education">最高已完成教育程度</label><select id="education" name="education" required><option value="">請選擇</option>'+EDUCATION.map(e=>'<option '+(state.demographics.education===e?'selected':'')+'>'+e+'</option>').join('')+'</select><div class="actions"><span></span><button class="primary">繼續閱讀研究解說</button></div></form></section>';
 if(state.page==='debrief')html+='<section class="card"><div class="eyebrow">感謝你的參與</div><h1 tabindex="-1">研究解說</h1><div class="document">'+DEBRIEF_HTML+'</div><form id="finish"><div class="draw-panel"><h2>自願參加抽獎</h2><p>共20名得獎者，每人獲得<strong>港幣200元</strong>。</p><p>參加抽獎必須提供有效香港電話號碼。中獎後會以轉數快（FPS）或 PayMe 轉帳發放獎金，研究團隊會聯絡中獎者安排。</p><div class="note">只有完整提交所有必答題，並於注意力測試輸入「2」及在每一項評分選擇「2」的有效問卷，才符合抽獎資格。未通過的研究答案仍會保留供分析。</div><p class="help">電話透過獨立程序提交，不會與研究答案一同儲存。每個電話號碼只登記一次。</p><fieldset class="choice-group"><legend>你希望參加抽獎嗎？</legend><label class="choice"><input type="radio" name="draw" value="yes" '+(state.drawChoice==='yes'?'checked':'')+'>希望參加抽獎</label><label class="choice"><input type="radio" name="draw" value="no" '+(state.drawChoice==='no'?'checked':'')+'>不參加，只提交問卷</label></fieldset><div id="phone-wrap" '+(state.drawChoice==='yes'?'':'hidden')+'><label class="form-label" for="phone">抽獎聯絡電話</label><input id="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="28" value="'+esc(state.phone)+'" '+(state.drawChoice==='yes'?'required':'')+'><small>只接受香港電話號碼：請填寫8位數字，或在前面加上＋852。中獎獎金以轉數快（FPS）或 PayMe 轉帳發放。</small></div></div>'+(state.researchDone?'<div class="note">研究答案已成功提交。重試只會提交獨立的抽獎登記。</div>':'')+'<div class="actions"><span class="help">不參加抽獎可留空電話。</span><button id="submit" class="primary" '+(state.busy?'disabled':'')+'>'+(state.busy?'正在提交…':state.researchDone?'重試抽獎登記':'提交')+'</button></div></form></section>';
 if(state.page==='done')html+='<section class="card"><div class="eyebrow">研究已完成</div><h1 tabindex="-1">感謝你的時間與分享</h1><div class="success">'+(preview?'這是預覽，沒有提交任何資料。':'你的問卷已成功提交。')+'</div>'+(state.drawChoice==='yes'?'<p style="margin-top:20px">'+(preview?'預覽模式不會登記抽獎。':state.drawDone?'你的抽獎電話已透過獨立程序登記。':'這份問卷未符合前述有效問卷要求，因此未登記抽獎；研究答案已保留供分析。')+'</p>':'')+'<p style="margin-top:20px">你現在可以關閉此頁。</p><a href="mailto:1155193515@link.cuhk.edu.hk">聯絡研究團隊</a></section>';
 root.innerHTML=html+'<div id="error" class="error" role="alert" '+(state.error?'':'hidden')+'>'+esc(state.error)+'</div>';
 bind();if(state.page==='trials'&&!state.paused)watchImage();
}
function watchImage(){
 state.loaded=false;const placeholder=document.querySelector('#stimulus'),status=document.querySelector('#image-status');if(!placeholder||!status)return;
 const image=stimulusPool.current(stimulusURL(trial().stimulus));
 image.id='stimulus';image.alt=placeholder.alt;image.style.visibility='hidden';placeholder.replaceWith(image);
 const watcher=watchStimulus(image,stimulusURL(trial().stimulus),{
  onReady:()=>{state.loaded=true;image.style.visibility='visible';status.hidden=true;if(!state.t0)state.t0=performance.now();updateButtons();preload();},
  onFailure:()=>{state.loaded=false;image.style.visibility='hidden';status.innerHTML='<span>圖片未能載入，請重試。你已填寫的答案會保留。</span><button id="retry-image" class="secondary">重新載入圖片</button>';status.hidden=false;document.querySelector('#retry-image').onclick=()=>{state.loaded=false;image.style.visibility='hidden';status.textContent='正在重新載入…';status.hidden=false;watcher.retry();updateButtons();};updateButtons();}
 });
 disposeImage=watcher.dispose;
}
function updateButtons(){const naming=document.querySelector('#name-next');if(naming){let valid=false;try{parseWords(document.querySelector('#free-text').value);valid=true;}catch{}naming.disabled=!state.loaded||!valid||state.busy;}const next=document.querySelector('#trial-next');if(next)next.disabled=!state.loaded||!state.words.every(w=>Number.isInteger(state.ratings[w]));const count=document.querySelector('#rating-count');if(count)count.textContent=Object.keys(state.ratings).length+' ／ '+state.words.length+' 項已完成';}
function bind(){
 document.querySelector('#consent')?.addEventListener('click',begin);
 document.querySelector('#pause')?.addEventListener('click',pause);document.querySelector('#resume')?.addEventListener('click',pause);
 document.querySelector('#free-text')?.addEventListener('input',e=>{state.freeText=e.target.value;updateButtons();setError('');});
 document.querySelector('#name-next')?.addEventListener('click',()=>{try{parseWords(state.freeText);state.words=ratingWords(state.freeText,trial(),state.plan.rowSeed);state.ratings={};state.namingMs=performance.now()-state.t0;state.phase='rating';render();document.querySelector('.question')?.scrollIntoView({block:'center'});}catch(e){setError(e.message);}});
 document.querySelectorAll('[data-word]').forEach(input=>input.addEventListener('change',e=>{state.ratings[e.target.dataset.word]=Number(e.target.value);updateButtons();}));
 document.querySelector('#trial-next')?.addEventListener('click',nextTrial);
 document.querySelector('#demographics')?.addEventListener('submit',e=>{e.preventDefault();const data=new FormData(e.target);state.demographics={gender:data.get('gender'),age:Number(data.get('age')),education:data.get('education')};jump('debrief');});
 document.querySelectorAll('[name=draw]').forEach(input=>input.addEventListener('change',e=>{state.drawChoice=e.target.value;document.querySelector('#phone-wrap').hidden=state.drawChoice!=='yes';document.querySelector('#phone').required=state.drawChoice==='yes';if(state.drawChoice==='no'){state.phone='';document.querySelector('#phone').value='';}}));
 document.querySelector('#phone')?.addEventListener('input',e=>{state.phone=e.target.value;});
 document.querySelector('#finish')?.addEventListener('submit',e=>{e.preventDefault();finish();});
}
async function begin(){if(state.busy)return;state.busy=true;setError('');render();try{if(preview){state.plan={...makePlan(0,state.token,'pilot'),rowSeed:state.token};}else state.plan=await post('/api/study/start',{token:state.token,mode,consented:true,protocol:PROTOCOL,consent:CONSENT});state.index=0;state.t0=0;state.busy=false;jump('trials');}catch(e){state.busy=false;state.error=e.message;render();}}
function preload(){stimulusPool.preload(state.plan.trials.slice(state.index,state.index+3).map(t=>stimulusURL(t.stimulus)));}
function nextTrial(){if(state.page!=='trials'||state.phase!=='rating'||!state.loaded||!state.words.every(w=>Number.isInteger(state.ratings[w])))return;const box=document.querySelector('#stimulus').getBoundingClientRect();state.responses.push({type:trial().type,stimulus:trial().stimulus,freeText:state.freeText,ratings:{...state.ratings},durationMs:performance.now()-state.t0,namingMs:state.namingMs,width:box.width,height:box.height});state.freeText='';state.words=[];state.ratings={};state.phase='naming';state.t0=0;state.namingMs=0;if(state.index===state.plan.total-1)jump('demographics');else{state.index++;jump('trials');}}
function pause(){if(state.paused){state.t0+=performance.now()-state.pauseAt;state.paused=false;}else{if(!state.loaded)return;state.pauseAt=performance.now();state.paused=true;}render();}
async function finish(){
 if(state.busy)return;if(state.drawChoice==='yes'&&!normalizePhone(state.phone)){setError('抽獎只接受香港電話號碼，請輸入8位數字或＋852及8位數字。');return;}
 state.busy=true;state.error='';render();
 try{
  if(preview){state.researchDone=true;state.busy=false;jump('done');return;}
  if(!state.researchDone){const r=await post('/api/study/submit',{token:state.token,drawNonce:state.drawNonce,mode,protocol:PROTOCOL,consent:CONSENT,consented:true,demographics:state.demographics,responses:state.responses,device:{kind:/iPad|Tablet/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&Math.min(screen.width,screen.height)>=600)?'平板':/Mobi|Android/i.test(navigator.userAgent)?'手機':'電腦',viewportWidth:innerWidth,viewportHeight:innerHeight}});state.researchDone=r.submitted;state.drawPermit=r.drawPermit;state.eligible=r.eligible;state.responses=[];}
  if(state.drawChoice==='yes'&&state.eligible){await post('/api/draw',{mode,permit:state.drawPermit,phone:state.phone});state.drawDone=true;}
  state.phone='';state.drawPermit=null;state.busy=false;jump('done');
 }catch(e){state.busy=false;state.error=(state.researchDone?'研究答案已成功提交。抽獎登記尚未完成，請重試。 ':'')+e.message;render();}
}
window.addEventListener('beforeunload',e=>{if(state.plan&&!state.researchDone){e.preventDefault();e.returnValue='';}});
render();
