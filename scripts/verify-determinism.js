'use strict';
/* =========================================================================
   Перевірка детермінізму (вимога розділу 0 специфікації v4.0).

   Три тести:
     A. Два незалежні прогони з однаковим seed → побітово однаковий стан.
     B. Різні seed → різний стан (інакше RNG не працює взагалі).
     C. Checkpoint у середині прогону → відновлення → продовження дає
        побітово той самий стан, що й безперервний прогін.

   Запуск: node scripts/verify-determinism.js [ticks]
   ========================================================================= */

const { Simulation } = require('../core/simulation-core.js');

const TICKS = parseInt(process.argv[2], 10) || 400;
const POP = 140;
const features = Object.fromEntries((process.argv.find(a=>a.startsWith('--features=')) || '').slice(11).split(',').filter(Boolean).map(f=>[f,true]));

function run(seed, ticks){
  const sim = new Simulation({ popSize: POP, seed, features });
  for(let i=0;i<ticks;i++) sim.tick();
  return sim;
}

// Канонічний серіалізований стан. Виключаємо лише eventLog (він за
// побудовою дренується назовні й не є частиною стану світу).
function fingerprint(sim){
  return JSON.stringify(sim.checkpoint());
}

let failures = 0;
function check(name, ok, detail){
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if(!ok) failures++;
}

// --- A: однаковий seed → однаковий світ ---
const a1 = fingerprint(run(12345, TICKS));
const a2 = fingerprint(run(12345, TICKS));
check('A. seed 12345 двічі → ідентичний стан', a1 === a2, `${a1.length} байт`);

// --- B: різний seed → різний світ ---
const b1 = fingerprint(run(999, TICKS));
check('B. seed 999 ≠ seed 12345', b1 !== a1);

// --- C: checkpoint / restore / continue ---
const half = Math.floor(TICKS/2);
const contSim = new Simulation({ popSize: POP, seed: 777, features });
for(let i=0;i<TICKS;i++) contSim.tick();
const continuous = fingerprint(contSim);

const partSim = new Simulation({ popSize: POP, seed: 777, features });
for(let i=0;i<half;i++) partSim.tick();
const cp = JSON.parse(JSON.stringify(partSim.checkpoint()));
const restored = Simulation.fromCheckpoint(cp);
for(let i=half;i<TICKS;i++) restored.tick();
check('C. checkpoint@' + half + ' → restore → continue == безперервний прогін',
      fingerprint(restored) === continuous);

// --- D: Observer не впливає на фізику ---
// Прогін із вимкненим Observer'ом має дати ті самі фізичні величини.
const { Observer } = require('../core/simulation-core.js');
const realUpdate = Observer.update;
Observer.update = function(sim){ sim.lastStructures = []; }; // Observer знеструмлено
const noObs = new Simulation({ popSize: POP, seed: 12345, features });
for(let i=0;i<TICKS;i++) noObs.tick();
Observer.update = realUpdate;

const withObs = run(12345, TICKS);
const physOnly = (sim)=> {
  const cp = sim.checkpoint();
  delete cp.observer; delete cp.history;
  return JSON.stringify(cp);
};
check('D. Observer вимкнено → фізика побітово та сама', physOnly(noObs) === physOnly(withObs));

console.log(`\n${failures === 0 ? 'Усі перевірки пройдено' : failures + ' перевірок провалено'} (ticks=${TICKS})`);
process.exit(failures === 0 ? 0 : 1);
