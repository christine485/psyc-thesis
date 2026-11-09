import {FAMILIES,PILOT} from './bank.mjs';import {STIMULI} from './stimuli.mjs';
export {FAMILIES,STIMULI,PILOT};
export const PROTOCOL='cloud-flow-naming-fit-v3-hk20261104',CONSENT='cloud-flow-consent-20261104-v2-hk',CLASSIFIER='tc-lexicon-conservative-v1',TOTAL=28;
export const EDUCATION=['幼稚園','小學','初中','高中','文憑／高級文憑／副學士','學士','研究生（碩士／博士）'];
export const SCALE=['完全不配合','稍微配合','中等程度配合','頗為配合','非常配合'];
export function rng(seed){let x=2166136261;for(const c of String(seed))x=Math.imul(x^c.charCodeAt(0),16777619);return()=>{x+=0x6D2B79F5;let t=Math.imul(x^x>>>15,1|x);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
export function shuffle(xs,random=Math.random){const a=[...xs];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function makePlan(slot,seed,mode='live'){
 const cycle=Math.floor(slot/10),offset=slot%10,random=rng(seed),groups=Object.create(null);
 for(const stimulus of STIMULI)(groups[stimulus.condition]??=[]).push(stimulus);
 const main=Object.entries(groups).map(([condition,items])=>({type:'main',stimulus:shuffle(items,rng(PROTOCOL+':'+mode+':'+cycle+':'+condition))[offset].file}));
 const trials=shuffle(main,random),excluded=new Set(main.map(t=>t.stimulus)),attentionImage=shuffle(STIMULI.filter(s=>!excluded.has(s.file)),random)[0],attentionFamily=shuffle(FAMILIES,random)[0];
 trials.splice(7+Math.floor(random()*14),0,{type:'attention',stimulus:attentionImage.file,words:shuffle(attentionFamily.selected,random)});
 return {protocol:PROTOCOL,consent:CONSENT,classifier:CLASSIFIER,slot,mainTrials:27,total:TOTAL,trials};
}
const aliases={
 HAP:['開懷大笑','開心到飛起','好開心','好高興','好幸福','喜出望外','開開心心','開心愉快','开心','快乐','高兴','兴奋','幸福感','喜悦','欣喜若狂','happy','happiness','joy','joyful','excited'],
 ANG:['嬲','好嬲','嬲怒','發嬲','發火','火滾','火大','激氣','忟憎','忟','忿怒','愤怒','生气','烦躁','angry','anger','irritated','irritable'],
 SAD:['唔開心','不開心','唔开心','不开心','不快樂','不快乐','唔快樂','唔高興','不高興','心情差','難受','想喊','想哭','好想喊','傷感','悲哀','忧伤','伤心','难过','失望','憂傷','sad','sadness','unhappy','depressed','hopeless'],
 FEA:['驚','好驚','驚驚','驚青','驚到震','膽怯','可怕','嚇親','恐惧','惊恐','惊慌','恐怖','驚悚','fear','afraid','scared','frightened','terrified'],
 DIS:['唔鍾意','不喜歡','討人厭','好憎','反胃','想嘔','作嘔感','恶心','讨厌','厌恶','disgust','disgusted','disgusting','repulsed'],
 ANX:['壓力','壓迫感','心急','忐忑不安','坐立不安','心緒不寧','心神不寧','焦躁','心慌慌','擔憂','担心','忧虑','紧张','焦虑','有壓力','好緊張','好擔心','anxious','anxiety','nervous','worried','stressed','uneasy'],
 SUR:['估唔到','意想不到','出乎意料','大吃一驚','嘩','驚嘆','詫愕','惊讶','惊喜','惊奇','震惊','surprise','surprised','shocked','astonished'],
 CON:['好滿足','好滿意','心滿意足','如釋重負','鬆一口氣','满足','满意','庆幸','充实','欣慰感','content','contentment','satisfied','satisfaction','relieved'],
 AMU:['好好笑','好笑','搞笑','有趣','趣味','逗趣','覺得好笑','笑意','笑','快感','愉悦','欢愉','欢乐','欢快','amused','amusement','fun','funny','delighted'],
 SER:['好舒服','好輕鬆','好放鬆','好平靜','心境平靜','心情平靜','心平氣和','無憂無慮','無壓力','冇壓力','舒服晒','寧謐','安寧','舒適','舒緩','輕鬆自在','轻松','放松','宁静','平静','calm','relaxed','peaceful','serene','comfortable']
};
const exact=new Map();for(const f of FAMILIES)for(const w of f.words)exact.set(w.word,f.id);
const aliasMap=new Map();for(const [family,words] of Object.entries(aliases))for(const word of words)aliasMap.set(word.toLowerCase(),family);
const clean=value=>String(value).normalize('NFKC').toLowerCase().trim().replace(/^[「『“"']|[」』”"'。.!！?？]$/g,'').trim();
export function parseWords(raw){const text=String(raw??'').trim();if(!text||text.length>120)throw Error('請輸入一至三個情緒詞語（最多120字）。');const words=text.split(/[、，,；;\n\r\t\s]+/u).filter(Boolean);if(words.length<1||words.length>3||words.some(w=>w.length>40))throw Error('請輸入一至三個情緒詞語，並以頓號、逗號或空格分隔。');return words;}
export function classifyWord(raw){
 const word=clean(raw);let family=exact.get(word),method='exact';
 if(!family){family=aliasMap.get(word);method='alias';}
 if(!family){const stripped=word.replace(/^(感到|感覺到|感覺|覺得|令人|讓人|使人|有點|有啲|有些|十分|非常|很|好|極之|特別|相當|比較|超級|超)+/u,'').replace(/(的感覺|嘅感覺|的情緒|嘅情緒|感|呀|啊|呢|啦|了)+$/u,'');if(stripped!==word){family=exact.get(stripped)||aliasMap.get(stripped);method='phrase';}}
 return {raw,family:family||null,method:family?method:'unmatched'};
}
export function classify(raw){return parseWords(raw).map(classifyWord);}
export function ratingWords(raw,trial,seed){if(trial.type==='attention')return [...trial.words];const groups=[...new Set(classify(raw).map(x=>x.family).filter(Boolean))];return shuffle(groups.flatMap(id=>FAMILIES.find(f=>f.id===id).selected),rng(seed+':'+trial.stimulus+':rows'));}
export function normalizePhone(value){const s=String(value??'').normalize('NFKC').replace(/[\s().-]/g,'');const match=s.match(/^(?:\+?852)?([2-9]\d{7})$/);return match?'+852'+match[1]:null;}
export function validateSubmission(body,plan,seed){
 if(body.protocol!==PROTOCOL||body.consent!==CONSENT||body.consented!==true)throw Error('同意紀錄或研究版本不正確。');
 const d=body.demographics;if(!d||!['男','女','其他'].includes(d.gender)||!Number.isInteger(d.age)||d.age<18||d.age>120||!EDUCATION.includes(d.education))throw Error('請完整填寫背景資料；參加者須年滿18歲。');
 if(!Array.isArray(body.responses)||body.responses.length!==plan.total)throw Error('請完成全部試次。');
 const responses=body.responses.map((r,index)=>{
  const trial=plan.trials[index];if(r.stimulus!==trial.stimulus||r.type!==trial.type)throw Error('試次次序不正確。');
  const named=parseWords(r.freeText),classified=named.map(classifyWord),words=ratingWords(r.freeText,trial,seed);
  if(!r.ratings||!words.every(w=>Number.isInteger(r.ratings[w])&&r.ratings[w]>=1&&r.ratings[w]<=5)||Object.keys(r.ratings).length!==words.length)throw Error('請完成所有詞語評分。');
  if(!Number.isFinite(r.durationMs)||r.durationMs<0||!Number.isFinite(r.namingMs)||r.namingMs<0||r.namingMs>r.durationMs+10||!Number.isFinite(r.width)||r.width<1||r.width>600||!Number.isFinite(r.height)||Math.abs(r.width-r.height)>1)throw Error('試次顯示或時間資料不正確。');
  const attentionPass=trial.type==='attention'?String(r.freeText).normalize('NFKC').trim()==='2'&&words.every(w=>r.ratings[w]===2):null;
  return {index,type:trial.type,stimulus:trial.stimulus,freeText:r.freeText,named,classified,words,ratings:Object.fromEntries(words.map(w=>[w,r.ratings[w]])),durationMs:Math.round(r.durationMs),namingMs:Math.round(r.namingMs),width:r.width,height:r.height,attentionPass};
 });
 return {responses,validQuestionnaire:responses.filter(x=>x.type==='attention').every(x=>x.attentionPass),demographics:{gender:d.gender,age:d.age,education:d.education}};
}
export function csv(rows){const safe=v=>{const s=String(v??'');return /^[=+@\-\t\r]/.test(s)?"'"+s:s;};return '\uFEFF'+rows.map(row=>row.map(v=>'"'+safe(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');}
