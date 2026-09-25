'use strict';
// Instrument attempted bonds without changing any input, RNG draw, or result.
const {Simulation,InteractionEngine,VALENCE_EPS} = require('../core/simulation-core');
const original=InteractionEngine.applyOutcome;
const results=[];
for(let seed=1;seed<=8;seed++){
  const sim=new Simulation({seed,features:{internalStateReadout:true,envOscillation:true,absorbBondFix:true,charges:true}});
  let attempts=0,blocked=0,unproductive=0,formed=0;
  InteractionEngine.applyOutcome=function(s,outcome,a,b){
    if(outcome!=='stableBond') return original(s,outcome,a,b);
    attempts++;
    const before=s.residualValence(a)+s.residualValence(b), count=s.bonds.size;
    if(s.residualValence(a)<VALENCE_EPS || s.residualValence(b)<VALENCE_EPS) blocked++;
    original(s,outcome,a,b);
    if(s.bonds.size>count){
      formed++;
      if(s.residualValence(a)+s.residualValence(b)>=before-VALENCE_EPS) unproductive++;
    }
  };
  for(let t=0;t<3000;t++) sim.tick();
  results.push({seed,attempts,blocked,formed,unproductive});
}
InteractionEngine.applyOutcome=original;
console.log(JSON.stringify(results,null,2));
