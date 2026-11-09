import test from 'node:test';
import assert from 'node:assert/strict';
import {watchStimulus} from '../docs/modules/image-loader.mjs';

const SOURCE='https://experiment.example/stimuli/original.png';
class FakeImage extends EventTarget {
 isConnected=true;complete=false;naturalWidth=0;requests=[];listeners=new Map();
 addEventListener(type,handler){super.addEventListener(type,handler);this.listeners.set(type,(this.listeners.get(type)||0)+1);}
 removeEventListener(type,handler){super.removeEventListener(type,handler);this.listeners.set(type,(this.listeners.get(type)||0)-1);}
 set src(value){this.requests.push(value);this.complete=false;this.naturalWidth=0;this.onRequest?.(this,value);}
 get src(){return this.requests.at(-1);}
 succeed(){this.complete=true;this.naturalWidth=1024;this.dispatchEvent(new Event('load'));}
 fail(){this.complete=true;this.naturalWidth=0;this.dispatchEvent(new Event('error'));}
}
function fixture(onRequest){
 const image=new FakeImage();image.onRequest=onRequest;
 const scheduled=new Map(),cancelled=[],events=[];let next=0;
 const watcher=watchStimulus(image,SOURCE,{onReady:()=>events.push('ready'),onFailure:reason=>events.push(reason),timeoutMs:20000,retryStamp:()=>1234,
  setTimer:(fn,delay)=>{const id=++next;scheduled.set(id,{fn,delay});return id;},clearTimer:id=>{cancelled.push(id);scheduled.delete(id);}});
 return {image,watcher,events,scheduled,cancelled};
}

test('handlers exist before assigning src, including an immediate successful cache load',()=>{
 const f=fixture(image=>{assert.equal(image.listeners.get('load'),1);assert.equal(image.listeners.get('error'),1);image.succeed();});
 assert.deepEqual(f.events,['ready']);assert.equal(f.scheduled.size,0);assert.deepEqual(f.image.requests,[SOURCE]);
 f.image.dispatchEvent(new Event('load'));assert.deepEqual(f.events,['ready']);
});

test('cached success and failure are recognized even without event dispatch',()=>{
 for(const succeeds of [true,false]){
  const f=fixture(image=>{image.complete=true;image.naturalWidth=succeeds?1024:0;});
  assert.deepEqual(f.events,[succeeds?'ready':'error']);assert.equal(f.scheduled.size,0);
 }
});

test('stalled request reaches a finite deadline and retry uses the same PNG',()=>{
 const f=fixture(),deadline=[...f.scheduled.values()][0];assert.equal(deadline.delay,20000);
 deadline.fn();assert.deepEqual(f.events,['timeout']);assert.equal(f.scheduled.size,0);
 f.watcher.retry();const retry=new URL(f.image.src),original=new URL(SOURCE);
 assert.equal(retry.origin,original.origin);assert.equal(retry.pathname,original.pathname);assert.equal(retry.searchParams.get('retry'),'1234-2');
 assert.equal(f.scheduled.size,1);f.image.succeed();assert.deepEqual(f.events,['timeout','ready']);assert.equal(f.scheduled.size,0);
 // A callback already queued for an older request cannot fail the ready image.
 deadline.fn();assert.deepEqual(f.events,['timeout','ready']);
});

test('explicit request errors support multiple retries and successful late arrival',()=>{
 const f=fixture();f.image.fail();assert.deepEqual(f.events,['error']);
 f.watcher.retry();f.image.fail();assert.deepEqual(f.events,['error','error']);
 f.watcher.retry();[...f.scheduled.values()][0].fn();f.image.succeed();
 assert.deepEqual(f.events,['error','error','timeout','ready']);
});

test('rerender disposal and detached images cannot change the active trial',()=>{
 const f=fixture(),oldDeadline=[...f.scheduled.values()][0];f.watcher.dispose();
 assert.equal(f.scheduled.size,0);assert.equal(f.image.listeners.get('load'),0);assert.equal(f.image.listeners.get('error'),0);
 f.image.succeed();oldDeadline.fn();f.watcher.retry();assert.deepEqual(f.events,[]);assert.equal(f.image.requests.length,1);
 const detached=fixture();detached.image.isConnected=false;detached.image.succeed();
 assert.deepEqual(detached.events,[]);assert.equal(detached.scheduled.size,0);
 assert.equal(detached.image.listeners.get('load'),0);
});
