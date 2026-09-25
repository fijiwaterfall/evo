import test from 'node:test';
import assert from 'node:assert/strict';
import {World,RNG,founderGenome,mutateGenome,validateGenome,DEFAULTS} from '../core.mjs';

const square=(n,v)=>Array.from({length:n},()=>new Array(n).fill(v));
// Три частинки в ряд: середня зв'язана з обома крайніми, крайні між собою ні.
function chain(options={}){
  const w=new World({pop:0,source:0,mutation:0,drag:0,bondUpkeep:0,...options}),L=w.config.labels;
  const make=(affinity,cross)=>w.registerGenome({states:1,display:[0],affinity,cross,
    reactions:[{source:0,target:0,rate:1,catalyst:null,input:'none',action:'none',direction:0}]});
  return {w,make,L,square};
}

test('closed ports block the edge flow and zero cross blocks transit',()=>{
  const {w,make,L}=chain();
  const open=make(square(L,1),square(L,0)),shut=make(square(L,0),square(L,0));
  const a=w.spawn(open,40,40,10,null,0),b=w.spawn(shut,43.2,40,0,null,0);
  a.vx=a.vy=b.vx=b.vy=0;w.rebuild();w.addBond(a,b);
  w.mechanics();
  assert.equal(a.energy,10);assert.equal(b.energy,0);
  assert.equal(w.transit.edge,0);assert.equal(w.transit.cross,0);
});

test('a switched particle moves energy between neighbours that cannot reach each other',()=>{
  const {w,make,L}=chain();
  // Середня частинка не торгує сама (affinity 0), але комутатор відкритий.
  const ends=make(square(L,1),square(L,0)),middle=make(square(L,0),square(L,1));
  const left=w.spawn(ends,40,40,12,null,0),hub=w.spawn(middle,43.2,40,5,null,0),right=w.spawn(ends,46.4,40,0,null,0);
  for(const e of [left,hub,right])e.vx=e.vy=0;
  w.rebuild();w.addBond(left,hub);w.addBond(hub,right);
  const before={left:left.energy,hub:hub.energy,right:right.energy};
  w.mechanics();
  assert.equal(hub.energy,before.hub,'посередник не є сховищем на шляху');
  assert.ok(left.energy<before.left,'енергія пішла з багатшого кінця');
  assert.ok(right.energy>before.right,'і прийшла в бідніший');
  assert.ok(Math.abs(left.energy+hub.energy+right.energy-(before.left+before.hub+before.right))<1e-12);
  assert.equal(w.transit.edge,0,'ребра закриті, отже це саме комутатор');
  assert.ok(w.transit.cross>0);
});

test('transfer does not depend on which endpoint is listed first',()=>{
  const runChain=swap=>{const {w,make,L}=chain();
    const ends=make(square(L,1),square(L,0)),middle=make(square(L,0),square(L,1));
    const first=w.spawn(ends,40,40,swap?0:12,null,0),hub=w.spawn(middle,43.2,40,5,null,0),second=w.spawn(ends,46.4,40,swap?12:0,null,0);
    for(const e of [first,hub,second])e.vx=e.vy=0;
    w.rebuild();w.addBond(first,hub);w.addBond(hub,second);w.mechanics();
    return swap?[second.energy,first.energy]:[first.energy,second.energy];};
  assert.deepEqual(runChain(false),runChain(true));
});

test('energy spread inside a component never grows over a transfer pass',()=>{
  const w=new World({pop:400,seed:31,mutation:.5});
  const spreadOf=()=>{let sum=0,n=0;const seen=new Set();
    for(const e of w.entities.values()){if(seen.has(e.id))continue;
      const stack=[e.id];seen.add(e.id);const pool=[];
      while(stack.length){const id=stack.pop(),node=w.entities.get(id);pool.push(node.energy);
        for(const bid of node.bonds){const b=w.bonds.get(bid),other=b.a===id?b.b:b.a;if(!seen.has(other)){seen.add(other);stack.push(other);}}}
      if(pool.length<2)continue;const mean=pool.reduce((x,y)=>x+y,0)/pool.length;
      sum+=pool.reduce((x,y)=>x+(y-mean)**2,0);n++;}
    return n?sum:0;};
  // Ізолюємо переноси: без джерела, витрат і руху лишається сама лише передача.
  w.advance(120);
  Object.assign(w.config,{source:0,uptake:0,leakage:0,fieldDecay:0,diffusion:0,spring:0,drag:0,bondUpkeep:0});
  let checked=0;
  for(let i=0;i<40;i++){const before=spreadOf();w.mechanics();const after=spreadOf();
    assert.ok(after<=before+1e-9,`дисперсія зросла: ${before} -> ${after}`);if(before>0)checked++;}
  assert.ok(checked>0,'тест має справді мати що зменшувати');
});

test('energy stays non-negative with maximal matrices on a dense hub',()=>{
  const L=DEFAULTS.labels,w=new World({pop:0,source:0,mutation:0,crossFlow:1.25,flow:1.25});
  const gid=w.registerGenome({states:1,display:[0],affinity:square(L,1),cross:square(L,1),
    reactions:[{source:0,target:0,rate:1,catalyst:null,input:'none',action:'none',direction:0}]});
  const hub=w.spawn(gid,60,60,.05,null,0);hub.vx=hub.vy=0;
  const ring=[];for(let i=0;i<24;i++){const a=i/24*Math.PI*2;
    const e=w.spawn(gid,60+Math.cos(a)*3.2,60+Math.sin(a)*3.2,i%2?9:0,null,0);e.vx=e.vy=0;ring.push(e);}
  w.rebuild();for(const e of ring)w.addBond(hub,e);
  for(let i=0;i<50;i++){w.mechanics();
    for(const e of w.entities.values())assert.ok(e.energy>=0&&Number.isFinite(e.energy),`запас ${e.energy}`);}
  assert.ok(w.counters.pairLimit>0,'степінь 24 має впертись у maxPairs');
});

test('labels and cross symmetry survive any sequence of mutations',()=>{
  const cfg={...DEFAULTS,mutation:1},rng=new RNG(9);let g=founderGenome(cfg.labels);const ops=new Set();
  for(let i=0;i<4000;i++){const m=mutateGenome(g,rng,cfg);g=m.genome;validateGenome(g,cfg);ops.add(m.operation);
    assert.equal(g.display.length,g.states);
    for(let l=0;l<cfg.labels;l++)for(let n=0;n<cfg.labels;n++)assert.equal(g.cross[l][n],g.cross[n][l]);}
  for(const op of ['label','affinity','cross'])assert.ok(ops.has(op),`операція ${op} не трапилась`);
});

test('binding follows the same matrix as conduction, and needs both sides',()=>{
  const L=DEFAULTS.labels,w=new World({pop:0,source:0,mutation:0});
  const gene=(label,affinity)=>w.registerGenome({states:1,display:[label],affinity,cross:square(L,0),
    reactions:[{source:0,target:0,rate:1,catalyst:null,input:'none',action:'none',direction:0}]});
  // Вибірковий: приймає партнера з міткою A, відмовляє партнеру з міткою B.
  const picky=square(L,1);picky[0][1]=0;
  const me=w.spawn(gene(0,picky),60,60,40,null,0);
  const showsA=w.spawn(gene(0,square(L,1)),63.2,60,10,null,0);
  const showsB=w.spawn(gene(1,square(L,1)),60,63.2,10,null,0);
  for(const e of [me,showsA,showsB])e.vx=e.vy=0;
  w.rebuild();const contacts=[showsA,showsB];
  assert.equal(w.execute(me,{action:'bind'},contacts),true);
  assert.ok(w.bonded(me,showsA),'мав зв\'язатися з тим, кого приймає');
  assert.ok(!w.bonded(me,showsB));
  // Лишився тільки небажаний партнер: зв'язування має відмовити, а не взяти його.
  assert.equal(w.execute(me,{action:'bind'},contacts),false);
  assert.equal(w.counters.bindRefused,1);
  assert.ok(!w.bonded(me,showsB));
});

test('aging is an explicit toll that grows with age and clears the ledger',()=>{
  const w=new World({pop:0,source:0,uptake:0,leakage:0,mutation:0,agingCost:0.01});
  const gid=w.registerGenome(founderGenome(w.config.labels));
  const young=w.spawn(gid,30,30,20,null,0),old=w.spawn(gid,90,90,20,null,0);
  young.age=0;old.age=50;w.rebuild();
  const before=young.energy+old.energy;
  w.environment();
  assert.equal(young.energy,20,'нуль віку не коштує нічого');
  assert.ok(old.energy<20,'старий платить');
  assert.ok(Math.abs(before-(young.energy+old.energy)-w.budget.aging)<1e-12,'бюджет сходиться');
  // Вимкнене старіння не списує нічого навіть із дуже старої частинки.
  const calm=new World({pop:0,source:0,uptake:0,leakage:0,mutation:0,agingCost:0});
  const e=calm.spawn(calm.registerGenome(founderGenome(calm.config.labels)),30,30,20,null,0);
  e.age=500;calm.rebuild();calm.environment();
  assert.equal(e.energy,20);assert.equal(calm.budget.aging,0);
});

test('the founder is neutral: full conductance, no routing, ledger closes',()=>{
  const w=new World({pop:250,seed:4});w.advance(150);
  const s=w.stats();
  assert.ok(Math.abs(s.energyResidual)<1e-6,`залишок ${s.energyResidual}`);
  assert.ok(s.transit.edge>0,'обмін по ребрах працює');
  assert.ok(s.budget.bondUpkeep>0,'утримання зв\'язків списується');
  const founder=founderGenome(w.config.labels);
  assert.ok(founder.affinity.every(r=>r.every(v=>v===1)));
  assert.ok(founder.cross.every(r=>r.every(v=>v===0)));
});
