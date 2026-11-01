import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const parent=path.dirname(process.cwd());fs.mkdirSync('docs/modules',{recursive:true});
const text=fs.readFileSync(path.join(parent,'emotional_words_pilot_analysis_zh.md'),'utf8');
const rows=text.split(/\r?\n/).filter(x=>/^\|[^|]+\|[A-Z]{3}\d{2}\|/.test(x)).map(line=>{const c=line.split('|');return {family:c[2].slice(0,3),id:c[2],word:c[3],mean:Number(c[4]),label:c[1]};});
if(rows.length!==100)throw Error('Expected exactly 100 original pilot words.');
const labels={HAP:'快樂',ANG:'憤怒',SAD:'悲傷',FEA:'恐懼',DIS:'厭惡',ANX:'焦慮',SUR:'驚訝',CON:'滿足',AMU:'愉快',SER:'平靜'};
const families=Object.entries(labels).map(([id,label])=>{const words=rows.filter(r=>r.family===id).sort((a,b)=>b.mean-a.mean||a.id.localeCompare(b.id));return {id,label,words,selected:words.slice(0,3).map(x=>x.word)};});
if(families.find(x=>x.id==='SAD').selected[2]!=='心痛')throw Error('Preserve user-approved tie choice.');
fs.writeFileSync('docs/modules/bank.mjs','// Original pilot; top three per family. SAD tie: user selected 心痛.\nexport const FAMILIES = '+JSON.stringify(families,null,2)+';\n');
const manifest=JSON.parse(fs.readFileSync(path.join(parent,'cloud-flow-stimuli-2026-10-20/manifest.json'),'utf8'));
const images=manifest.images;if(images.length!==270)throw Error('Expected 270 images.');
fs.mkdirSync('docs/stimuli',{recursive:true});
for(const item of images){const bytes=fs.readFileSync(path.join(parent,'cloud-flow-stimuli-2026-10-20/images',item.file));if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Image checksum failed: '+item.file);const dest=path.join('docs/stimuli',item.file);if(!fs.existsSync(dest))fs.writeFileSync(dest,bytes);}
fs.writeFileSync('docs/modules/stimuli.mjs','export const STIMULI = '+JSON.stringify(images.map(({file,condition,waviness_deg,disorder_sd_deg,grain_sigma_px,replicate,seed,sha256})=>({file,condition,waviness_deg,disorder_sd_deg,grain_sigma_px,replicate,seed,sha256})))+';\n');
fs.writeFileSync('docs/.nojekyll','');fs.mkdirSync('public/experiment',{recursive:true});fs.cpSync('docs','public/experiment',{recursive:true});
console.log(JSON.stringify({images:images.length,wordCount:rows.length,selected:families.map(({id,selected})=>({id,selected})),checksums:'all passed'}));