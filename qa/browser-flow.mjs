#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {fetchHandler} from '../standalone/src/index.ts';
import {sqliteD1} from '../standalone/tests/sqlite-d1.mjs';
import {PROTOCOL,STIMULI,validateSubmission} from '../docs/modules/protocol.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url)),DOCS=path.join(ROOT,'docs');
const OUTPUT=path.join(ROOT,'work/browser-qa');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const option=(name,fallback)=>process.argv.find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3)||fallback;
const engines=option('engines','chromium,firefox,webkit').split(',');
const selectedDevices=option('devices','desktop,phone,small-phone,tablet').split(',');
const imageDelayMs=Number(option('image-delay-ms','150'));
assert.ok(Number.isFinite(imageDelayMs)&&imageDelayMs>=0&&imageDelayMs<=5000);
const DEVICES={
 desktop:{viewport:{width:1440,height:900},kind:'電腦',touch:false},
 phone:{viewport:{width:390,height:844},kind:'手機',touch:true},
 'small-phone':{viewport:{width:320,height:700},kind:'手機',touch:true},
 tablet:{viewport:{width:820,height:1180},kind:'平板',touch:true}
};
for(const engine of engines)assert.ok(['chromium','firefox','webkit'].includes(engine),'Unsupported engine');
for(const device of selectedDevices)assert.ok(DEVICES[device],'Unsupported device');

async function playwright(){
 if(process.env.PLAYWRIGHT_MODULE_PATH)return import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);
 return import('playwright-core');
}
const pw=await playwright();
const mime=file=>file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/javascript; charset=utf-8';
const imageFiles=new Set(STIMULI.map(image=>image.file));
for(const image of STIMULI){
 const bytes=await fs.readFile(path.join(DOCS,'stimuli',image.file));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256,'Original stimulus checksum changed');
 assert.equal(bytes.readUInt32BE(16),1024);assert.equal(bytes.readUInt32BE(20),1024);
}
await fs.mkdir(OUTPUT,{recursive:true,mode:0o700});

async function fixture(){
 const research=sqliteD1(new URL('../standalone/migrations/0001_slots.sql',import.meta.url));
 const contacts=sqliteD1(new URL('../standalone/contact-migrations/0001_contacts.sql',import.meta.url));
 const env={DB:research.DB,CONTACTS_DB:contacts.DB,STAGING_ONLY:'1',DRAW_SECRET:'local-qa-draw-key-at-least-32-characters',ADMIN_TOKEN:'local-qa-admin-key-at-least-32-characters'};
 const pngRequests=new Map(),apiCalls={start:0,submit:0,draw:0};
 let submission=null,firstSubmitResponseDropped=false;
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://'+req.headers.host),route=url.pathname;
   if(route.startsWith('/api/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=Buffer.concat(chunks);
    if(route==='/api/study/start')apiCalls.start++;
    if(route==='/api/study/submit'){apiCalls.submit++;submission=JSON.parse(body.toString());}
    if(route==='/api/draw')apiCalls.draw++;
    const response=await fetchHandler(new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:body}),env);
    // The database has saved the answer, but this one response is lost. The UI
    // must keep its answers and use the same session for its explicit retry.
    if(route==='/api/study/submit'&&response.status===200&&!firstSubmitResponseDropped){firstSubmitResponseDropped=true;res.destroy();return;}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   if(route==='/config.js'){res.setHeader('Content-Type','text/javascript');res.end("export const API_BASE=location.origin;export const STIMULUS_BASE=new URL('./stimuli/',import.meta.url).href;");return;}
   if(route==='/__qa/gallery'){
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><h1>Local image decoding check</h1></body></html>');return;
   }
   const file=path.resolve(DOCS,'.'+(route==='/'?'/index.html':decodeURIComponent(route)));
   if(!file.startsWith(DOCS+path.sep)){res.writeHead(404);res.end();return;}
   if(route.startsWith('/stimuli/')){
    const name=path.basename(file);assert.ok(imageFiles.has(name));pngRequests.set(name,(pngRequests.get(name)||0)+1);
    if(imageDelayMs)await sleep(imageDelayMs);
   }
   const bytes=await fs.readFile(file);res.setHeader('Content-Type',mime(file));
   res.setHeader('Cache-Control',route.startsWith('/stimuli/')?'public, max-age=0, must-revalidate':'no-cache');res.end(bytes);
  }catch{res.writeHead(500);res.end('Local QA server error');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 return {origin,pngRequests,apiCalls,research,contacts,getSubmission:()=>submission,close:async()=>{await new Promise(resolve=>server.close(resolve));research.sqlite.close();contacts.sqlite.close();}};
}

function userAgent(engine,device){
 if(device==='desktop')return undefined;
 if(engine==='webkit')return device==='tablet'?'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
 return device==='tablet'?'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36':'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36';
}
async function ready(page){
 await page.waitForFunction(()=>{const image=document.querySelector('#stimulus');return image?.naturalWidth===1024&&image.naturalHeight===1024&&getComputedStyle(image).visibility==='visible'&&document.querySelector('#image-status')?.hidden===true;},{timeout:10000});
}
async function layout(page,label){
 const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,image:document.querySelector('#stimulus')?.getBoundingClientRect().toJSON()}));
 assert.ok(result.scroll<=result.width+1,label+': horizontal overflow');
 if(result.image){assert.ok(result.image.width>0&&result.image.width<=440.5,label+': invalid stimulus size');assert.ok(Math.abs(result.image.width-result.image.height)<=1,label+': image is not square');}
}
function percentile(values,p){const sorted=[...values].sort((a,b)=>a-b);return Math.round(sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]||0);}

async function runCase(browser,engine,deviceName){
 const spec=DEVICES[deviceName],f=await fixture(),pageErrors=[],pngNetwork=[],imageWaitMs=[],ratingWaitMs=[];
 const context=await browser.newContext({viewport:spec.viewport,hasTouch:spec.touch,...(engine==='firefox'?{}:{isMobile:spec.touch}),...(userAgent(engine,deviceName)?{userAgent:userAgent(engine,deviceName)}:{})});
 const page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/stimuli/'))pngNetwork.push(new URL(request.url()).pathname);});
 const began=performance.now();
 try{
  await page.goto(f.origin+'/?mode=pilot',{waitUntil:'networkidle'});await layout(page,'consent');
  let transition=performance.now();await page.locator('#consent').click();
  for(let index=0;index<28;index++){
   await ready(page);imageWaitMs.push(performance.now()-transition);await layout(page,'trial '+(index+1));
   const question=await page.locator('.question').textContent(),attention=question.includes('注意力');
   await page.locator('#free-text').fill(attention?'2':'開心、緊張、害怕');
   if(index===0){
    const alternate={width:spec.viewport.height,height:spec.viewport.width};
    await page.setViewportSize(alternate);await layout(page,'rotated');
    assert.equal(await page.locator('#free-text').inputValue(),attention?'2':'開心、緊張、害怕');
    await page.setViewportSize(spec.viewport);await layout(page,'restored');
   }
   // A small reading interval gives the bounded next-image queue time to work.
   // It is much shorter than a human's real naming/rating time.
   await sleep(200);
   const ratingBegan=performance.now();await page.locator('#name-next').click();await ready(page);ratingWaitMs.push(performance.now()-ratingBegan);
   await layout(page,'rating');
   const rows=page.locator('.rating-row'),groups=await rows.count();
   assert.equal(groups,attention?3:9);
   for(let group=0;group<groups;group++){
    const row=rows.nth(group),labels=row.locator('.circle');assert.equal(await labels.count(),5);
    const boxes=await labels.evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height};}));
    assert.ok(boxes.every(box=>box.width>=24&&box.height>=44),'Rating target is too small');
    for(let j=1;j<boxes.length;j++)assert.ok(boxes[j].left>=boxes[j-1].right-0.5,'Rating targets overlap');
    await row.locator('input[value="2"]').check();
   }
   if(index===0){
    await page.locator('#pause').click();await page.locator('#resume').click();await ready(page);
    assert.equal(await page.locator('.rating-row input:checked').count(),groups,'Pause lost ratings');
    await page.screenshot({path:path.join(OUTPUT,engine+'-'+deviceName+'.png'),fullPage:true});
   }
   transition=performance.now();await page.locator('#trial-next').click();
  }
  await layout(page,'demographics');await page.locator('[name=gender][value="其他"]').check();await page.locator('#age').fill('23');await page.locator('#education').selectOption('學士');
  await page.locator('#demographics button').click();await layout(page,'debrief');await page.locator('[name=draw][value="no"]').check();
  await page.locator('#submit').click();await page.locator('#error:not([hidden])').waitFor();
  assert.equal(await page.locator('#submit').isEnabled(),true,'Submission error left retry disabled');
  await page.locator('#submit').click();await page.getByText('你的問卷已成功提交。',{exact:true}).waitFor();await layout(page,'done');
  assert.deepEqual(pageErrors,[],'Uncaught browser error');assert.equal(f.apiCalls.start,1);assert.equal(f.apiCalls.submit,2);assert.equal(f.apiCalls.draw,0);
  const saved=f.research.sqlite.prepare('SELECT payload FROM slots WHERE submitted=1').all();assert.equal(saved.length,1,'Retry duplicated the questionnaire');
  const payload=JSON.parse(saved[0].payload);assert.equal(payload.protocol,PROTOCOL);assert.equal(payload.responses.length,28);assert.equal(payload.validQuestionnaire,true);assert.equal(payload.device.kind,spec.kind);
  const raw=f.getSubmission();assert.equal(validateSubmission(raw,payload.plan,createHash('sha256').update(raw.token).digest('hex')).validQuestionnaire,true);
  assert.equal(f.contacts.sqlite.prepare('SELECT COUNT(*) AS n FROM contact_objects').get().n,0,'QA unexpectedly enrolled draw contact');
  assert.equal(f.pngRequests.size,28,'Unexpected stimulus set downloaded');
  const totalPngRequests=[...f.pngRequests.values()].reduce((sum,n)=>sum+n,0);
  assert.equal(totalPngRequests,28,'Displayed and preloaded trials fetched the same PNG repeatedly');
  return {engine,device:deviceName,viewport:spec.viewport,ok:true,trials:28,validQuestionnaire:true,localSavedQuestionnaires:1,idempotentRetry:true,phoneWrites:0,originalImages:28,pngServerRequests:totalPngRequests,pngBrowserRequests:pngNetwork.length,firstImageWaitMs:Math.round(imageWaitMs[0]),laterImageWaitMedianMs:percentile(imageWaitMs.slice(1),0.5),laterImageWaitP95Ms:percentile(imageWaitMs.slice(1),0.95),ratingImageWaitP95Ms:percentile(ratingWaitMs,0.95),elapsedMs:Math.round(performance.now()-began)};
 }finally{await context.close();await f.close();}
}

async function gallery(browser,engine){
 const f=await fixture(),context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(f.origin+'/__qa/gallery');
  const results=await page.evaluate(async files=>{
   let next=0,decoded=0;const failed=[];
   await Promise.all(Array.from({length:4},async()=>{
    while(next<files.length){const file=files[next++];
     try{await new Promise((resolve,reject)=>{const image=new Image();const timer=setTimeout(()=>{image.removeAttribute('src');reject(Error('timeout'));},10000);image.onload=async()=>{try{if(image.naturalWidth!==1024||image.naturalHeight!==1024)throw Error('dimensions');if(typeof image.decode==='function')await image.decode();resolve();}catch(error){reject(error);}finally{clearTimeout(timer);image.removeAttribute('src');}};image.onerror=()=>{clearTimeout(timer);image.removeAttribute('src');reject(Error('decode'));};image.src='/stimuli/'+file;});decoded++;}
     catch{failed.push(file);}
    }
   }));return {decoded,failed};
  },STIMULI.map(image=>image.file));
  assert.equal(results.decoded,270,engine+': some original PNGs did not decode');assert.deepEqual(results.failed,[]);
  return {engine,originalPngsDecoded:270,sha256Checked:270,ok:true};
 }finally{await context.close();await f.close();}
}

const report={checkedAt:new Date().toISOString(),scope:'isolated local Worker, dual SQLite and browser-engine viewport emulation',protocol:PROTOCOL,artificialImageDelayMs:imageDelayMs,productionWrites:0,hongKongNetworkVerified:false,realDeviceBrowserVerified:false,cases:[],galleries:[]};
let failure=null;
try{
 for(const engine of engines){
  const options={headless:true,timeout:30000,...(engine==='chromium'?{args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})}:{})};
  const browser=await pw[engine].launch(options);
  report.browserVersions??={};report.browserVersions[engine]=browser.version();
  try{
   for(const device of selectedDevices){const result=await runCase(browser,engine,device);report.cases.push(result);console.log(JSON.stringify(result));}
   const result=await gallery(browser,engine);report.galleries.push(result);console.log(JSON.stringify(result));
  }finally{await browser.close();}
 }
 report.ok=true;
}catch(error){report.ok=false;failure=error;report.failure={message:error.message};}
const reportFile=path.join(OUTPUT,'report-'+engines.join('-')+'.json');
await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
if(failure)throw failure;
console.log('Browser QA report: '+path.relative(ROOT,reportFile));
