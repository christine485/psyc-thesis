#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {fetchHandler} from '../standalone/src/index.ts';
import {sqliteD1} from '../standalone/tests/sqlite-d1.mjs';
import {createStudyServer} from '../lib/study-core.ts';
import {createContactStore} from '../standalone/src/contact-store.ts';
import {PROTOCOL,CONSENT,ratingWords} from '../docs/modules/protocol.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const engine=(process.argv.find(value=>value.startsWith('--engine='))||'--engine=chromium').split('=')[1];
assert.ok(['chromium','firefox','webkit'].includes(engine));
const pw=process.env.PLAYWRIGHT_MODULE_PATH?await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href):await import('playwright-core');
const research=sqliteD1(new URL('../standalone/migrations/0001_slots.sql',import.meta.url)),contacts=sqliteD1(new URL('../standalone/contact-migrations/0001_contacts.sql',import.meta.url));
const secret='b'.repeat(64),env={DB:research.DB,CONTACTS_DB:contacts.DB,STAGING_ONLY:'1',DRAW_SECRET:'local-researcher-test-draw-secret-32-characters',ADMIN_TOKEN:secret};
const core=createStudyServer(()=>({DB:research.DB,BUCKET:createContactStore(contacts.DB),DRAW_SECRET:env.DRAW_SECRET}));
for(const mode of ['pilot','live']){
 const token=randomUUID(),plan=await core.allocate({token,mode,protocol:PROTOCOL,consent:CONSENT,consented:true});
 const responses=plan.trials.map(trial=>{const freeText=trial.type==='attention'?'2':'開心、緊張';return {type:trial.type,stimulus:trial.stimulus,freeText,ratings:Object.fromEntries(ratingWords(freeText,trial,plan.rowSeed).map(word=>[word,2])),durationMs:8000,namingMs:3000,width:320,height:320};});
 const submitted=await core.submit({token,drawNonce:randomUUID(),mode,protocol:PROTOCOL,consent:CONSENT,consented:true,responses,demographics:{gender:'其他',age:23,education:'學士'},device:{kind:'平板',viewportWidth:820,viewportHeight:1180}});
 if(mode==='pilot')await core.enterDraw({mode,permit:submitted.drawPermit,phone:'+85220000000'});
}
const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://'+req.headers.host);
  if(url.pathname.startsWith('/api/')){const response=await fetchHandler(new Request(url,{method:req.method,headers:req.headers}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  const name=url.pathname==='/researcher'?'researcher.html':path.basename(url.pathname);
  assert.ok(['researcher.html','researcher.js','researcher.css'].includes(name));
  res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript');
  res.setHeader('Cache-Control','no-store');if(name.endsWith('.html'))res.setHeader('Content-Security-Policy',policy);
  res.end(await fs.readFile(path.join(ROOT,'docs',name)));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await pw[engine].launch({headless:true,timeout:30000,...(engine==='chromium'?{args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
 const page=await context.newPage(),requests=[],errors=[];page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>requests.push({url:request.url(),authorization:request.headers().authorization}));
 await page.goto(origin+'/researcher');await page.locator('#admin-token:enabled').waitFor();
 assert.equal(await page.locator('#dashboard').isVisible(),false);
 assert.equal(await page.evaluate(async()=>{const response=await fetch('/api/admin/export-index?mode=pilot');return response.status;}),403);
 await page.locator('#setup').evaluate(node=>node.open=true);await page.locator('#generate-key').click();
 assert.match(await page.locator('#generated-key').inputValue(),/^[a-f0-9]{64}$/);
 await page.locator('#admin-token').fill('a'.repeat(64));await page.locator('#login').click();await page.locator('#error:not([hidden])').waitFor();
 assert.equal(await page.locator('#dashboard').isVisible(),false);
 async function login(){await page.locator('#admin-token').fill(secret);await page.locator('#login').click();await page.locator('#dashboard').waitFor();}
 await login();assert.equal(await page.locator('#submitted').textContent(),'1');
 assert.equal(await page.locator('#admin-token').inputValue(),'');assert.equal(await page.locator('#generated-key').inputValue(),'');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 for(const [mode,kind] of [['pilot','research'],['pilot','draw'],['live','research']]){
  await page.locator('#mode').selectOption(mode);
  const event=page.waitForEvent('download');await page.locator('#download-'+kind).click();const result=await event;
  assert.equal(result.suggestedFilename(),mode+'-'+kind+'.csv');
  const bytes=await fs.readFile(await result.path());
  assert.equal(bytes.toString(),await(kind==='draw'?core.drawCSV(mode):core.researchCSV(mode)),'Browser CSV changed source data');
 }
 // A late authenticated response must not revive a signed-out session or export.
 let release,started;const gate=new Promise(resolve=>started=resolve);
 await page.route('**/api/admin/export?**',async route=>{if(new URL(route.request().url()).searchParams.has('slot')){release=route;started();return;}await route.continue();});
 await page.locator('#download-research').click();await gate;await page.locator('#logout').click();
 await release.fulfill({status:200,contentType:'text/csv',body:await core.researchCSV('live')}).catch(()=>{});
 await page.waitForTimeout(100);
 assert.equal(await page.locator('#dashboard').isVisible(),false);assert.equal(await page.locator('#download-links a').count(),0);
 assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
 assert.deepEqual(await context.cookies(),[]);
 await page.unroute('**/api/admin/export?**');await login();await page.reload();await page.locator('#login').waitFor();assert.equal(await page.locator('#dashboard').isVisible(),false);
 assert.ok(requests.every(request=>!request.url.includes(secret)),'A credential reached a URL');
 assert.ok(requests.filter(request=>request.authorization).every(request=>request.url.startsWith(origin+'/api/admin/')),'A credential reached another resource');
 assert.deepEqual(errors,[]);
 // The copy hosted by GitHub Pages must never accept or send the admin secret.
 const wrong=await context.newPage();let wrongApiCalls=0;
 await wrong.route('**/*',async route=>{const url=new URL(route.request().url());if(url.pathname.includes('/api/'))wrongApiCalls++;const name=path.basename(url.pathname);if(!['researcher.html','researcher.js','researcher.css'].includes(name))return route.abort();await route.fulfill({status:200,contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile(path.join(ROOT,'docs',name))});});
 await wrong.goto('https://christine485.github.io/psyc-thesis/researcher.html');await wrong.locator('#wrong-host').waitFor();assert.equal(wrongApiCalls,0);assert.equal(await wrong.locator('#admin-token').isDisabled(),true);
 await context.close();
 console.log(JSON.stringify({ok:true,engine,version:browser.version(),researchAndDrawDownloads:true,csvBytesPreserved:true,modeIsolation:true,unauthenticatedDenied:true,logoutCancelsExport:true,noStoredCredentials:true,githubCredentialEntryBlocked:true,productionWrites:0}));
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));research.sqlite.close();contacts.sqlite.close();}
