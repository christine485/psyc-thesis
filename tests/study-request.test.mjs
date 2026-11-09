import test from 'node:test';
import assert from 'node:assert/strict';
import {postStudy} from '../docs/modules/study-request.mjs';

const origin='https://experiment.example',route='/api/study/submit';
const body={token:'original-token',drawNonce:'original-nonce',responses:[{freeText:'開心',ratings:{開心:4}}]};
const connection=/暫時無法連接研究服務。你的未提交答案仍在本頁，請稍後重試，勿重新整理。/;
function fixture(fetchImpl){
 let callback,cleared=[];const calls=[];
 const options={fetchImpl:async(url,init)=>{calls.push({url,init});return fetchImpl(url,init);},setTimer:(fn,delay)=>{assert.equal(delay,30000);callback=fn;return 123;},clearTimer:id=>cleared.push(id)};
 return {calls,options,cleared,expire:()=>callback()};
}

test('successful requests preserve the original payload and browser credential settings, then clear the deadline',async()=>{
 const f=fixture(async()=>Response.json({submitted:true})),before=structuredClone(body);
 assert.deepEqual(await postStudy(origin,route,body,f.options),{submitted:true});
 const {url,init}=f.calls[0];assert.equal(url,origin+route);assert.equal(init.method,'POST');assert.equal(init.mode,'cors');assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');
 assert.deepEqual(init.headers,{'Content-Type':'application/json'});assert.equal(init.body,JSON.stringify(body));assert.equal(init.signal.aborted,false);
 assert.deepEqual(body,before);assert.deepEqual(f.cleared,[123]);
});

test('stalled response headers time out, abort the request and keep its retry payload intact',async()=>{
 const f=fixture(()=>new Promise(()=>{})),before=structuredClone(body);
 const pending=postStudy(origin,route,body,f.options);f.expire();await assert.rejects(pending,connection);
 assert.equal(f.calls[0].init.signal.aborted,true);assert.deepEqual(f.cleared,[123]);assert.deepEqual(body,before);
 const retry=fixture(async()=>Response.json({submitted:true}));await postStudy(origin,route,body,retry.options);
 assert.equal(retry.calls[0].init.body,f.calls[0].init.body);
});

test('the deadline also covers a stalled JSON response body',async()=>{
 let started;const reading=new Promise(resolve=>{started=resolve;});
 const f=fixture(async()=>({ok:true,json:()=>{started();return new Promise(()=>{});}}));
 const pending=postStudy(origin,route,body,f.options);await reading;f.expire();await assert.rejects(pending,connection);
 assert.equal(f.calls[0].init.signal.aborted,true);assert.deepEqual(f.cleared,[123]);
});

test('server refusals and invalid response bodies clear timers and expose appropriate retry messages',async()=>{
 for(const [response,message] of [
  [Response.json({error:'請完成全部試次。'},{status:400}),/請完成全部試次。/],
  [Response.json({},{status:503}),/未能提交，請重試。/],
  [new Response('invalid JSON'),connection]
 ]){
  const f=fixture(async()=>response);await assert.rejects(postStudy(origin,route,body,f.options),message);
  assert.deepEqual(f.cleared,[123]);assert.equal(f.calls[0].init.signal.aborted,false);
 }
});

test('an early network failure releases its deadline and never mutates research answers',async()=>{
 const f=fixture(async()=>{throw Error('network unavailable');}),before=structuredClone(body);
 await assert.rejects(postStudy(origin,route,body,f.options),connection);assert.deepEqual(f.cleared,[123]);assert.deepEqual(body,before);
});
