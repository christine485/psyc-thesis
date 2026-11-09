// Keep only the displayed original PNG and its next two allocated stimuli.
// Reusing these Image elements also preserves decoded pixels across page renders.
export function createStimulusPool({createImage=()=>new Image(),ahead=2}={}){
 if(!Number.isInteger(ahead)||ahead<0||ahead>3)throw Error('Invalid preload window');
 const entries=new Map(),maximum=ahead+1;
 function remove(source){
  const entry=entries.get(source);if(!entry)return;
  entries.delete(source);entry.active=false;
  entry.image.removeEventListener('load',entry.decode);
  entry.image.removeAttribute('src');
 }
 function ensure(source){
  let entry=entries.get(source);if(entry)return entry;
  const image=createImage();
  image.decoding='async';image.fetchPriority='low';
  entry={image,active:true,decode:()=>{
   if(!entry.active||!image.naturalWidth||typeof image.decode!=='function')return;
   // Decode future images while the participant is still answering this trial.
   // Older browsers and decoding failures retain the normal image-load path.
   try{Promise.resolve(image.decode()).catch(()=>{});}catch{}
  }};
  image.addEventListener('load',entry.decode);entries.set(source,entry);
  while(entries.size>maximum)remove(entries.keys().next().value);
  return entry;
 }
 return {
  current(source){const entry=ensure(source);entry.image.fetchPriority='high';entry.image.loading='eager';return entry.image;},
  preload(sources){
   const selected=[...new Set(sources)].slice(0,maximum),wanted=new Set(selected);
   for(const source of entries.keys())if(!wanted.has(source))remove(source);
   selected.forEach((source,index)=>{
    const image=ensure(source).image;
    image.fetchPriority=index===0?'high':'low';
    // The displayed image belongs to watchStimulus, which binds before src.
    if(index>0&&!image.getAttribute('src'))image.src=source;
   });
  },
  clear(){for(const source of entries.keys())remove(source);},
  get size(){return entries.size;}
 };
}
