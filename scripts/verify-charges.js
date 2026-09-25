'use strict';
const assert = require('assert/strict');
const {Simulation, Genome, RNG, netCharge, valence, InteractionEngine} = require('../core/simulation-core');
const genome = charges => new Genome(charges.map(charge=>({type:'C',value:0.5,charge})));
for(const charges of [[0,3],[0,1,2],[3,4,5],[0,0,1,1,2,2]]) assert.equal(valence(netCharge(genome(charges).genes)),0);
assert.ok(valence(netCharge(genome([0]).genes))>0);
const parent = genome([0,3,2,1]);
assert.deepEqual(parent.clone().genes,parent.genes);
assert.equal(parent.signature(),'CCCC');
const rng = new RNG(42);
let g = parent;
for(let i=0;i<1000;i++){
  g = Genome.recombine(rng,g,parent,true).mutate(rng,true);
  assert.ok(g.genes.every(g=>Number.isInteger(g.charge) && g.charge>=0 && g.charge<6));
}
assert.deepEqual(parent.genes,genome([0,3,2,1]).genes);
const sim = new Simulation({popSize:0,seed:1,features:{charges:true}});
const a=sim.spawnEntity(genome([0]),0,0,5), b=sim.spawnEntity(genome([3]),0,0,5), c=sim.spawnEntity(genome([1]),0,0,5);
const initial=sim.residualValence(a);
const ab=sim.addBondBetween(a.id,b.id);
assert.equal(sim.residualValence(a),0);
assert.equal(sim.residualValence(b),0);
InteractionEngine.applyOutcome(sim,'stableBond',a,c);
assert.equal(sim.bonds.size,1);
sim.removeBond(ab.id);
assert.equal(sim.residualValence(a),initial);
const ac=sim.addBondBetween(a.id,c.id);
sim.residualValence(c);
sim.addBondBetween(a.id,b.id);
assert.equal(c._residualCache,undefined);
const cp=sim.checkpoint();
assert.ok(cp.entities.every(e=>!('_residualCache' in e)));
const restored=Simulation.fromCheckpoint(JSON.parse(JSON.stringify(cp)));
assert.equal(restored.residualValence(restored.entities.get(a.id)),sim.residualValence(a));
// Set insertion history does not determine cancellation order.
a.bonds=new Set([...a.bonds].reverse());
delete a._residualCache;
assert.equal(sim.residualValence(a),restored.residualValence(restored.entities.get(a.id)));
sim.removeBond(ac.id);
for(const mode of ['off','block','break']){
  const s=new Simulation({popSize:0,seed:12,features:{absorbBondFix:mode!=='off',absorbBondBreak:mode==='break'}});
  const x=s.spawnEntity(genome([0]),0,0,5), y=s.spawnEntity(genome([3]),0,0,5);
  s.addBondBetween(x.id,y.id);
  const state=s.rng.getState();
  InteractionEngine.applyOutcome(s,'absorb',x,y);
  assert.equal(x.energy+y.energy,mode==='block'?10:9.5);
  assert.equal(s.bonds.size,mode==='break'?0:1);
  assert.equal(s.rng.getState()===state,mode==='block');
}
console.log('PASS charge algebra, inheritance, mutation, saturation, invalidation, restoration and bond order');
