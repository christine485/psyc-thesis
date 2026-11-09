import test from 'node:test';
import assert from 'node:assert/strict';
import {createStimulusPool} from '../docs/modules/image-preload.mjs';
import {watchStimulus} from '../docs/modules/image-loader.mjs';

const source=n=>'https://experiment.example/stimuli/original-'+n+'.png';
class FakeImage extends EventTarget {
 isConnected=true;complete=false;naturalWidth=0;requests=[];removed=0;decodes=0;
 set src(value){this.value=value;this.requests.push(value);this.complete=false;this.naturalWidth=0;}
 get src(){return this.value||'';}
 getAttribute(name){return name==='src'?this.value||null:null;}
 removeAttribute(name){if(name==='src'){this.removed++;this.value='';this.complete=false;this.naturalWidth=0;}}
 decode(){this.decodes++;return Promise.resolve();}
 succeed(){this.complete=true;this.naturalWidth=1024;this.dispatchEvent(new Event('load'));}
 fail(){this.complete=true;this.naturalWidth=0;this.dispatchEvent(new Event('error'));}
}
function fixture(){
 const images=[];
 const pool=createStimulusPool({createImage:()=>{const image=new FakeImage();images.push(image);return image;}});
 return {pool,images};
}

test('current stimulus gets priority before only the next two allocated images preload',()=>{
 const {pool,images}=fixture(),current=pool.current(source(0));
 assert.equal(current.fetchPriority,'high');assert.equal(current.decoding,'async');
 assert.deepEqual(current.requests,[],'the displayed-image watcher must assign src after its listeners');
 current.src=source(0);current.succeed();
 pool.preload(Array.from({length:270},(_,index)=>source(index)));
 assert.equal(pool.size,3);assert.equal(images.length,3);
 assert.deepEqual(images.map(image=>image.requests),[[source(0)],[source(1)],[source(2)]]);
 assert.deepEqual(images.map(image=>image.fetchPriority),['high','low','low']);
 assert.equal(current.decodes,1);
 pool.clear();
});

test('naming, rating and resume reuse the same decoded element and successful retry URL',()=>{
 const {pool,images}=fixture(),current=pool.current(source(0));
 current.src=source(0)+'?retry=123-2';current.succeed();
 pool.preload([source(0),source(1),source(2)]);
 const events=[];
 for(let render=0;render<3;render++){
  const image=pool.current(source(0));assert.equal(image,current);
  const watcher=watchStimulus(image,source(0),{onReady:()=>events.push('ready'),onFailure:()=>assert.fail('ready original image must remain usable')});
  pool.preload([source(0),source(1),source(2)]);watcher.dispose();
 }
 assert.deepEqual(events,['ready','ready','ready']);
 assert.deepEqual(current.requests,[source(0)+'?retry=123-2']);
 assert.deepEqual(images.slice(1).map(image=>image.requests),[[source(1)],[source(2)]]);
 pool.clear();
});

test('advancing trials releases old pixels and retains the next decoded image',()=>{
 const {pool,images}=fixture();
 const first=pool.current(source(0));first.src=source(0);first.succeed();pool.preload([source(0),source(1),source(2)]);
 const prepared=images[1];prepared.succeed();
 assert.equal(pool.current(source(1)),prepared);assert.equal(prepared.fetchPriority,'high');
 pool.preload([source(1),source(2),source(3)]);
 assert.equal(pool.size,3);assert.equal(first.removed,1);assert.equal(first.src,'');
 const oldDecodes=first.decodes;first.succeed();assert.equal(first.decodes,oldDecodes,'released image listeners must be removed');
 assert.deepEqual(prepared.requests,[source(1)]);
 for(let index=2;index<28;index++){
  const current=pool.current(source(index));current.succeed();pool.preload([source(index),source(index+1),source(index+2)]);
  assert.ok(pool.size<=3);
 }
 pool.clear();assert.equal(pool.size,0);assert.ok(images.every(image=>!image.src));
});

test('a failed preload does not block its neighbour and the displayed image remains retryable',()=>{
 const {pool,images}=fixture(),first=pool.current(source(0));first.src=source(0);first.succeed();pool.preload([source(0),source(1),source(2)]);
 const failed=images[1],neighbour=images[2];failed.fail();neighbour.succeed();
 const events=[],current=pool.current(source(1));
 const watcher=watchStimulus(current,source(1),{onReady:()=>events.push('ready'),onFailure:reason=>events.push(reason),retryStamp:()=>123});
 assert.deepEqual(events,['error']);assert.equal(current,failed);
 watcher.retry();current.succeed();assert.deepEqual(events,['error','ready']);
 assert.equal(new URL(current.src).pathname,new URL(source(1)).pathname);
 assert.equal(new URL(current.src).searchParams.get('retry'),'123-2');
 assert.equal(neighbour.naturalWidth,1024);
 watcher.dispose();pool.clear();
});

test('older browsers and rejected background decode retain the normal load path',async()=>{
 const {pool,images}=fixture();pool.current(source(0));pool.preload([source(0),source(1),source(2)]);
 images[1].decode=undefined;images[1].succeed();
 images[2].decode=()=>Promise.reject(Error('decode unsupported for this image'));images[2].succeed();
 await Promise.resolve();await Promise.resolve();
 assert.equal(pool.current(source(1)).naturalWidth,1024);assert.equal(pool.current(source(2)).naturalWidth,1024);
 pool.clear();
});
