import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';

test('worker advances without any frames, supports pause/step/reset and detached snapshots',async()=>{
  const worker=new Worker(new URL('./worker.mjs',import.meta.url));let nextId=0;const pending=new Map();
  worker.on('message',message=>{const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error)):p.resolve(message);});
  const ask=(type,data={})=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>reject(Error('worker timeout')),10000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,type,...data});});
  try{
    await ask('running',{value:false});await ask('reset',{config:{size:16,initial:15}});
    const initial=await ask('snapshot',{includeWorld:true});assert.equal(initial.stats.tick,0);
    await ask('running',{value:true});await delay(300);const later=await ask('snapshot',{includeWorld:false});
    assert.ok(later.stats.tick>initial.stats.tick);assert.ok(!('field' in later));
    await ask('running',{value:false});const paused=await ask('snapshot');await delay(100);const same=await ask('snapshot');assert.equal(paused.stats.tick,same.stats.tick);
    const stepped=await ask('step');assert.equal(stepped.stats.tick,paused.stats.tick+1);assert.equal(stepped.running,false);
    const reset=await ask('reset',{config:{size:128}});assert.equal(reset.config.size,128);assert.equal(reset.stats.population,400);assert.equal(reset.stats.tick,0);assert.ok(reset.epoch>initial.epoch);
    await assert.rejects(ask('reset',{config:{size:999}}));const afterError=await ask('snapshot');assert.equal(afterError.config.size,128);
  }finally{for(const p of pending.values())clearTimeout(p.timer);await worker.terminate();}
});
