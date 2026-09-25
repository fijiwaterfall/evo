import test from 'node:test';
import assert from 'node:assert/strict';
import {World, GENES, LIFESPAN_GENE, INITIAL_LIFESPAN} from './core.mjs';
import {Runner} from './runner.mjs';
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('seed replay and observation frequency leave the entire world unchanged',()=>{
  const a=new Runner({size:16,initial:15}),b=new Runner({size:16,initial:15});
  for(let i=0;i<300;i++){a.advance();a.snapshot(i%3===0);b.advance();}
  assert.deepEqual(a.world,b.world);assert.deepEqual(a.history,b.history);
  const shot=a.snapshot();shot.field.fill(0);shot.agents[0].energy=999;assert.deepEqual(a.world,b.world);
});
test('resource ledger balances and traits remain bounded through reproduction and deaths',()=>{
  for(const seed of [1,2,3]){
    const w=new World({seed,size:24,initial:30});
    for(let i=0;i<2000;i++)w.step();const s=w.observe();
    near(s.balanceError,0,1e-6);assert.equal(s.deaths,s.oldAgeDeaths+s.starvationDeaths);assert.ok(s.births>0);assert.ok(s.deaths>0);assert.ok(s.mutations>0);
    assert.ok(w.field.every(v=>Number.isFinite(v)&&v>=0));
    assert.ok(w.agents.every(a=>a.energy>0&&a.genes.length===5&&a.genes.slice(0,4).every(g=>g>=0&&g<=1)&&Number.isSafeInteger(a.genes[LIFESPAN_GENE])&&a.genes[LIFESPAN_GENE]>=1&&a.age<a.genes[LIFESPAN_GENE]));
  }
});
test('zero mutation copies all five genes; a child starts without inherited bonds',()=>{
  const w=new World({size:8,initial:1,renewal:0,mutation:0});w.agents[0].genes[3]=0;w.agents[0].genes[LIFESPAN_GENE]=1234;w.agents[0].age=200;w.agents[0].energy=100;
  const genes=w.agents[0].genes.slice();w.step();
  assert.equal(w.births,1);assert.deepEqual(w.agents[1].genes,genes);assert.equal(w.agents[1].parent,w.agents[0].id);assert.equal(w.agents[1].age,0);assert.equal(w.mutations,0);assert.equal(w.bonds.length,0);assert.equal(GENES.length,5);assert.equal(w.agents[0].age,201);assert.equal(w.agents[1].genes[LIFESPAN_GENE],1234);
});
test('starvation returns remaining energy and an empty world never respawns',()=>{
  const w=new World({size:8,initial:1,renewal:0});w.field.fill(0);w.agents[0].energy=0.4;
  const before=w.totalEnergy();w.step();assert.equal(w.deaths,1);assert.equal(w.agents.length,0);
  near(w.totalEnergy()+w.dissipated,before);w.step();assert.equal(w.agents.length,0);
});
test('without renewal the finite stock is eventually exhausted',()=>{
  const w=new World({size:8,initial:8,renewal:0});for(let i=0;i<10000;i++)w.step();assert.equal(w.agents.length,0);
});
test('springs move agents but never transfer UMP, even with unequal stocks',()=>{
  const w=new World({size:8,initial:2,renewal:0}),[a,b]=w.agents;
  Object.assign(a,{x:2,y:2,energy:20,genes:[0,0,0,0,1000]});Object.assign(b,{x:4,y:2,energy:10,genes:[0,0,0,0,1000]});
  w.bonds=[{a:a.id,b:b.id}];const before=w.totalEnergy();w.updateBonds();
  assert.ok(a.x>2&&b.x<4);assert.equal(a.energy,20);assert.equal(b.energy,10);near(w.totalEnergy(),before);
  assert.ok(!('transferred' in w.observe()));assert.ok(!('flow' in w.bonds[0]));
  b.x=6;w.updateBonds();assert.equal(w.bonds.length,0);
});
test('contact requires both participants and works across wrapped boundaries',()=>{
  const w=new World({size:8,initial:2}),[a,b]=w.agents;
  Object.assign(a,{x:0.2,y:2,genes:[0,0,0,1,1000]});Object.assign(b,{x:7.2,y:2,genes:[0,0,0,0,1000]});
  w.updateBonds();assert.equal(w.bonds.length,0);b.genes[3]=1;w.updateBonds();assert.equal(w.bonds.length,1);
  w.agents=[a];w.updateBonds();assert.equal(w.bonds.length,0);
});
test('zero-start control has no connections without mutation',()=>{
  const w=new World({size:16,initial:20,zeroBonds:true,mutation:0});for(let i=0;i<200;i++)w.step();assert.equal(w.formed,0);
});
test('uniform replenishment has no privileged center; surplus is exported',()=>{
  const w=new World({size:16,initial:0});w.field.fill(0);w.initialEnergy=0;w.step();
  for(const v of w.field)near(v,0.004);near(w.lastInput,256*0.004);near(w.observe().balanceError,0);
  w.field.fill(4);w.initialEnergy=w.totalEnergy();w.input=0;w.outflow=0;w.step();
  for(const v of w.field)near(v,3.996);near(w.lastOutflow,256*0.004);near(w.observe().balanceError,0);
});
test('cached diffusion exactly matches the original stencil including periodic edges',()=>{
  const w=new World({size:8,initial:0,renewal:0});
  for(let i=0;i<w.field.length;i++)w.field[i]=(i*13)%17;
  const expected=Float64Array.from(w.field,(v,i)=>{const x=i%8,y=Math.floor(i/8);return 0.84*v+0.04*(w.field[w.index(x-1,y)]+w.field[w.index(x+1,y)]+w.field[w.index(x,y-1)]+w.field[w.index(x,y+1)]);});
  w.step();assert.deepEqual(w.field,expected);
});
test('world sizes preserve initial population density and resource exchange per area',()=>{
  for(const size of [32,64,128,256]){
    const w=new World({size});assert.equal(w.agents.length,100*(size/64)**2);near(w.field[0],2);
    const empty=new World({size,initial:0});empty.field.fill(0);empty.step();near(empty.lastInput/(size*size),0.004);
  }
});
test('invalid settings are rejected before replacing the running world',()=>{
  const runner=new Runner();const original=runner.world;
  for(const config of [{size:257},{concentration:NaN},{renewal:1.1},{initial:-1}])assert.throws(()=>runner.reset(config));
  assert.equal(runner.world,original);
});

test('every founder starts with lifetime 1000 regardless of seed, scale or other settings',()=>{
  assert.equal(INITIAL_LIFESPAN,1000);
  for(const seed of [0,1,98765])for(const size of [32,64,128,256])for(const zeroBonds of [false,true]){
    const w=new World({seed,size,zeroBonds,mutation:seed===0?0:1,concentration:seed===1?0:3,renewal:seed===0?0:0.002});
    assert.ok(w.agents.every(a=>a.age===0&&a.genes[LIFESPAN_GENE]===1000));assert.equal(w.observe().means[LIFESPAN_GENE],1000);
  }
});
test('age 999 lives, age 1000 dies with energy remaining and releases its bonds',()=>{
  const w=new World({size:8,initial:2,renewal:0,mutation:0}),[a,b]=w.agents;
  w.field.fill(0);Object.assign(a,{x:2,y:2,age:998,energy:10,genes:[0,0,0,0,1000]});Object.assign(b,{x:3,y:2,age:0,energy:10,genes:[0,0,0,0,1000]});
  w.bonds=[{a:a.id,b:b.id}];w.initialEnergy=w.totalEnergy();
  w.step();assert.ok(w.agents.includes(a));assert.equal(a.age,999);assert.equal(w.oldAgeDeaths,0);
  const stock=w.field.reduce((sum,v)=>sum+v,0);w.step();assert.ok(!w.agents.includes(a));assert.equal(w.oldAgeDeaths,1);assert.equal(w.starvationDeaths,0);assert.equal(w.deaths,1);assert.equal(w.bonds.length,0);assert.ok(w.field.reduce((sum,v)=>sum+v,0)>stock);near(w.observe().balanceError,0);
});
test('death uses the individual lifetime gene, including values above 1000',()=>{
  const w=new World({size:8,initial:2,renewal:0,mutation:0}),[short,long]=w.agents;w.field.fill(0);
  Object.assign(short,{age:899,energy:5});short.genes[LIFESPAN_GENE]=900;
  Object.assign(long,{age:1098,energy:5});long.genes[LIFESPAN_GENE]=1100;
  w.step();assert.ok(!w.agents.includes(short));assert.ok(w.agents.includes(long));assert.equal(long.age,1099);
  w.step();assert.equal(w.agents.length,0);assert.equal(w.oldAgeDeaths,2);
});
test('an expired organism cannot reproduce even with a large energy reserve',()=>{
  const w=new World({size:8,initial:1,renewal:0});w.agents[0].age=999;w.agents[0].energy=100;w.initialEnergy=w.totalEnergy();
  w.step();assert.equal(w.births,0);assert.equal(w.oldAgeDeaths,1);assert.equal(w.agents.length,0);near(w.observe().balanceError,0);
});
test('offspring lifetime mutations can go in both directions while parents retain their gene',()=>{
  const lengths=[];
  for(let seed=0;seed<64;seed++){
    const w=new World({seed,size:8,initial:1,renewal:0,mutation:1}),parent=w.agents[0];parent.energy=100;w.step();
    const child=w.agents.find(a=>a.parent===parent.id);assert.ok(child);assert.equal(parent.genes[LIFESPAN_GENE],1000);
    const life=child.genes[LIFESPAN_GENE];assert.ok(Number.isSafeInteger(life)&&life>=900&&life<=1100);lengths.push(life);
  }
  assert.ok(lengths.some(n=>n<1000));assert.ok(lengths.some(n=>n>1000));
});
test('simultaneous starvation and old age count as a single death',()=>{
  const w=new World({size:8,initial:1,renewal:0});w.field.fill(0);w.agents[0].age=999;w.agents[0].energy=0.1;w.step();
  assert.equal(w.deaths,1);assert.equal(w.oldAgeDeaths,1);assert.equal(w.starvationDeaths,0);
});
