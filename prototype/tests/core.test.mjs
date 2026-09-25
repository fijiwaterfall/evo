import test from 'node:test';
import assert from 'node:assert/strict';
import {World,RNG,founderGenome,mutateGenome,validateGenome,DEFAULTS,delta} from '../core.mjs';
const fingerprint=w=>JSON.stringify(w.checkpoint());
// Геном, зібраний уручну, потребує полів v6. Мітки роздаються по колу, матриці
// нейтральні: повна провідність по ребрах, нульове маршрутизування.
const withLabels=(g,labels=DEFAULTS.labels)=>({display:Array.from({length:g.states},(_,i)=>i%labels),
  affinity:Array.from({length:labels},()=>new Array(labels).fill(1)),
  cross:Array.from({length:labels},()=>new Array(labels).fill(0)),...g});
test('seed replay, checkpoint continuation and read-only observer',()=>{
  const a=new World({pop:80,seed:17}),b=new World({pop:80,seed:17});
  for(let i=0;i<150;i++){a.step();b.step();b.snapshot();b.inspect(1);b.drainEvents();}
  assert.equal(fingerprint(a),fingerprint(b));
  const restored=World.restore(JSON.parse(fingerprint(a)));a.advance(100);restored.advance(100);
  assert.equal(fingerprint(a),fingerprint(restored));
  assert.notEqual(fingerprint(a),fingerprint(new World({pop:80,seed:18})));
});
test('founder reproduces without inherited bonds and pays child energy',()=>{
  const w=new World({pop:0,mutation:0}),g=w.registerGenome(founderGenome());
  const a=w.spawn(g,50,50,20,null,0),b=w.spawn(g,53.5,50,20,null,0);w.addBond(a,b);w.rebuild();
  const before=w.totalEnergy(),loss=w.budget.copy;
  assert.equal(w.execute(a,{action:'copy'},[]),true);
  const child=[...w.entities.values()].at(-1);
  assert.equal(child.parentId,a.id);assert.equal(child.generation,1);assert.equal(child.bonds.size,0);
  assert.equal(child.genomeId,a.genomeId);assert.equal(child.energy,w.config.childEnergy);
  assert.ok(Math.abs(w.totalEnergy()-before+w.budget.copy-loss)<1e-9);
});
test('SSA cannot double-spend carriers or energy; catalysts require a separate carrier',()=>{
  const w=new World({pop:0,carriers:1,source:0,mutation:0}),gid=w.registerGenome(withLabels({states:2,reactions:[
    {source:0,target:1,rate:8,catalyst:null,input:'none',action:'none',direction:0},
    {source:0,target:1,rate:8,catalyst:null,input:'none',action:'none',direction:0}]}));
  const e=w.spawn(gid,20,20,0.02,null,0);for(let i=0;i<100;i++)w.chemistry(e,[],0);
  assert.deepEqual(e.counts,[0,1]);assert.equal(w.counters.reactions,1);assert.ok(e.energy>=0);
  const id=w.registerGenome(withLabels({states:2,reactions:[{source:0,target:1,rate:8,catalyst:0,input:'none',action:'none',direction:0}]}));
  const x=w.spawn(id,30,30,10,null,0);for(let i=0;i<100;i++)w.chemistry(x,[],0);assert.deepEqual(x.counts,[1,0]);
});
test('mutations preserve valid references, change topology and leave parent immutable',()=>{
  const parent=founderGenome(),before=JSON.stringify(parent),rng=new RNG(42),cfg={...DEFAULTS,mutation:1};let g=parent;const ops=new Set();
  for(let i=0;i<3000;i++){const m=mutateGenome(g,rng,cfg);g=m.genome;validateGenome(g,cfg);ops.add(m.operation);}
  assert.equal(JSON.stringify(parent),before);assert.equal(ops.size,9);
});
test('torus neighbors across fractional last bucket and energy flow conservation',()=>{
  const w=new World({pop:0,drag:0}),gid=w.registerGenome(founderGenome());
  const a=w.spawn(gid,20,0,10,null,0),b=w.spawn(gid,20,316.7,2,null,0);a.vx=a.vy=b.vx=b.vy=0;w.rebuild();
  assert.ok(w.nearby(a).includes(b));assert.ok(Math.abs(delta(b.y-a.y,320)+3.3)<1e-10);
  w.addBond(a,b);const energy=a.energy+b.energy;w.mechanics();
  // Потік по ребру зберігає суму; утримання зв'язку знімає рівно свою ціну.
  assert.ok(Math.abs(a.energy+b.energy-(energy-w.config.bondUpkeep*w.config.dt))<1e-12);
  assert.ok(a.energy<10);assert.ok(b.energy>2);
});
test('signals arrive next tick; mechanical accounting and SSA state remain finite',()=>{
  const w=new World({pop:100,seed:2});w.advance(300);let carriers=0;
  for(const e of w.entities.values()){assert.ok(e.energy>=0&&Number.isFinite(e.energy));assert.equal(e.counts.reduce((a,b)=>a+b,0),w.config.carriers);carriers++;}
  assert.ok(carriers>100);assert.ok(w.counters.births>0);assert.ok(Math.abs(w.stats().energyResidual)<1e-6);assert.equal(w.counters.eventLimit,0);
  const [a,b]=[...w.entities.values()];w.addBond(a,b);w.execute(a,{action:'signal'},[]);assert.ok(b.pendingSignal>0);const old=b.signal;w.environment();assert.equal(b.pendingSignal,0);assert.ok(b.signal>old*Math.exp(-w.config.signalDecay*w.config.dt));
});
