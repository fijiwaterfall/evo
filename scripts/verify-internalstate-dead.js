'use strict';
/* =========================================================================
   Емпірична перевірка твердження §5 специфікації v4.0:

   "Доданок (a.internalState + b.internalState) * 0.1 у softmax математично
    скорочується (перевірено: прибирання доданка дає побітово ідентичний
    світ), а більше ніде стан не читається."

   Причина: softmax(x + c) === softmax(x) для будь-якої константи c, доданої
   до ВСІХ компонент. Тут c = (a.internalState+b.internalState)*0.1 —
   однакова для всіх 9 результатів, отже на вибір не впливає.

   Цей скрипт прогонює світ із доданком і без нього й порівнює стан.
   Запуск: node scripts/verify-internalstate-dead.js [ticks]
   ========================================================================= */

const Core = require('../core/simulation-core.js');
const { Simulation, InteractionEngine, OUTCOMES } = Core;

const TICKS = parseInt(process.argv[2], 10) || 500;

function fingerprint(sim){ return JSON.stringify(sim.checkpoint()); }

function run(seed, ticks){
  const sim = new Simulation({ popSize: 140, seed });
  for(let i=0;i<ticks;i++) sim.tick();
  return sim;
}

const originalResolve = InteractionEngine.resolve;

// Той самий resolve, але БЕЗ доданка internalState.
function resolveWithoutInternalState(sim, a, b){
  const va = a.phenotype.outcomeVector, vb = b.phenotype.outcomeVector;
  const combined = va.map((v,i)=> v + vb[i] + (sim.rng.random()-0.5)*0.15);
  const maxV = Math.max(...combined);
  const exps = combined.map(v=>Math.exp((v-maxV)*3));
  const sum = exps.reduce((s,v)=>s+v,0);
  let r = sim.rng.random()*sum, idx=0;
  for(let i=0;i<exps.length;i++){ r -= exps[i]; if(r<=0){ idx=i; break; } }
  sim.outcomeCounts[OUTCOMES[idx]]++;
  InteractionEngine.applyOutcome(sim, OUTCOMES[idx], a, b);
}

let mismatches = 0;
for(const seed of [1,2,3,4]){
  InteractionEngine.resolve = originalResolve;
  const withTerm = fingerprint(run(seed, TICKS));

  InteractionEngine.resolve = resolveWithoutInternalState;
  const withoutTerm = fingerprint(run(seed, TICKS));

  const same = withTerm === withoutTerm;
  if(!same) mismatches++;
  console.log(`seed ${seed}: ${same ? 'ІДЕНТИЧНО' : 'ВІДРІЗНЯЄТЬСЯ'} — доданок internalState ${same ? 'не впливає ні на що' : 'таки впливає'}`);
}
InteractionEngine.resolve = originalResolve;

// Друга частина: чи читається internalState десь іще у фізиці?
const src = require('fs').readFileSync(require('path').join(__dirname,'..','core','simulation-core.js'), 'utf8');
const reads = src.split('\n')
  .map((line,i)=>({ line: line.trim(), n: i+1 }))
  .filter(o=>o.line.includes('internalState'));
console.log('\nУсі згадки internalState у core:');
for(const o of reads) console.log(`  ${String(o.n).padStart(4)}: ${o.line}`);

console.log(`\nВисновок: ${mismatches === 0
  ? 'твердження §5 підтверджено — internalState не має каузального виходу'
  : 'твердження §5 НЕ підтверджено'} (ticks=${TICKS})`);
process.exit(mismatches === 0 ? 0 : 1);
