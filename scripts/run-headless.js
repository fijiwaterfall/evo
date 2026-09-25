'use strict';
/* =========================================================================
   Headless-прогін для порівняння розподілів між кроками v4.0 (розділ 12).

   Запуск:
     node scripts/run-headless.js --ticks=3000 --seeds=1,2,3,4,5,6,7,8
     node scripts/run-headless.js --ticks=3000 --seeds=1..8 --label=step0-baseline
     node scripts/run-headless.js --ticks=3000 --seeds=1..8 --events=data/run.jsonl

   Виводить по кожному seed: популяція, сер. довжина геному, розподіл
   розмірів компонент, розподіл дій; і зведення (медіана/середнє) по всіх.
   З --label=NAME зберігає data/NAME.json для подальшого diff'у між кроками.
   ========================================================================= */

const fs = require('fs');
const path = require('path');
const { Simulation, OUTCOMES, FEATURE_DEFAULTS, CONSTANTS } = require('../core/simulation-core.js');

function arg(name, def){
  const hit = process.argv.find(a=>a.startsWith('--'+name+'='));
  return hit ? hit.split('=').slice(1).join('=') : def;
}

const TICKS = parseInt(arg('ticks', '3000'), 10);
const POP = parseInt(arg('pop', '140'), 10);
const LABEL = arg('label', null);
const EVENTS = arg('events', null);
const MEASURE = arg('measure', 'false') === 'true';

// --features=internalStateReadout,envOscillation — вмикає кроки v4.0.
// Без прапорця — точна v3.1-база.
const FEATURES = {};
const featSpec = arg('features', '');
if(featSpec){
  for(const f of featSpec.split(',').map(s=>s.trim()).filter(Boolean)){
    if(!(f in FEATURE_DEFAULTS)){
      console.error('Невідомий feature-прапорець: ' + f + '\nДоступні: ' + Object.keys(FEATURE_DEFAULTS).join(', '));
      process.exit(2);
    }
    FEATURES[f] = true;
  }
}

function parseSeeds(spec){
  if(spec.includes('..')){
    const [a,b] = spec.split('..').map(Number);
    const out=[]; for(let i=a;i<=b;i++) out.push(i); return out;
  }
  return spec.split(',').map(Number);
}
const SEEDS = parseSeeds(arg('seeds', '1..8'));

// Розподіл розмірів зв'язних компонент — сирий, без бакетів "5+",
// бо саме дискретність цього розподілу перевіряє розділ 11 специфікації.
function componentSizeHistogram(sim){
  const hist = {};
  for(const st of (sim.lastStructures||[])){
    const n = st.nodes.length;
    hist[n] = (hist[n]||0) + 1;
  }
  return hist;
}

function genomeLenHistogram(sim){
  const hist = {};
  for(const e of sim.entities.values()) hist[e.genome.length] = (hist[e.genome.length]||0)+1;
  return hist;
}

function runSeed(seed, eventStream){
  const sim = new Simulation({ popSize: POP, seed, features: FEATURES });
  const componentSizeTimeHist = {}, timeSeries = [];
  let componentSamples = 0, timeMaxComponentSize = 0;
  for(let i=0;i<TICKS;i++){
    sim.tick();
    if(MEASURE && sim.tick_count % CONSTANTS.RECORD_INTERVAL === 0){
      if(sim.tick_count >= Math.ceil(TICKS*2/3)){
        componentSamples++;
        for(const [size,count] of Object.entries(componentSizeHistogram(sim))){
          componentSizeTimeHist[size] = (componentSizeTimeHist[size] || 0) + count;
          timeMaxComponentSize = Math.max(timeMaxComponentSize, Number(size));
        }
      }
      if(sim.tick_count % 200 === 0) timeSeries.push({tick:sim.tick_count,
        population:sim.entities.size,
        resource:sim.env.grid.reduce((a,b)=>a+b,0)/sim.env.grid.length});
    }
    if(eventStream && sim.eventLog.length >= 1000){
      for(const ev of sim.drainEventLog()) eventStream.write(JSON.stringify(Object.assign({seed}, ev))+'\n');
    }
  }
  if(eventStream){
    for(const ev of sim.drainEventLog()) eventStream.write(JSON.stringify(Object.assign({seed}, ev))+'\n');
  }
  const s = sim.stats();
  const totalOutcomes = OUTCOMES.reduce((acc,o)=>acc+sim.outcomeCounts[o], 0) || 1;
  const outcomeShare = {};
  for(const o of OUTCOMES) outcomeShare[o] = +(sim.outcomeCounts[o]/totalOutcomes).toFixed(5);
  return {
    seed,
    ...(MEASURE ? {componentSizeTimeHist, componentSamples, timeMaxComponentSize, timeSeries} : {}),
    ticks: TICKS,
    population: sim.entities.size,
    avgGenomeLen: +s.avgGenomeLen,
    maxGenomeLen: s.maxGenomeLen,
    bonds: sim.bonds.size,
    avgBonds: +s.avgBonds,
    componentCount: (sim.lastStructures||[]).length,
    maxComponentSize: s.maxStructSize,
    avgComponentLifetime: +s.avgComponentLifetime,
    avgEnergy: +s.avgEnergy,
    births: sim.births, deaths: sim.deaths,
    constructSuccess: sim.constructSuccess, constructAborted: sim.constructAborted,
    componentSizeHist: componentSizeHistogram(sim),
    genomeLenHist: genomeLenHistogram(sim),
    outcomeCounts: Object.assign({}, sim.outcomeCounts),
    outcomeShare,
    totalOutcomes,
  };
}

function median(xs){
  const s = xs.slice().sort((a,b)=>a-b);
  const m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}
function mean(xs){ return xs.reduce((a,b)=>a+b,0)/(xs.length||1); }

let eventStream = null;
if(EVENTS){
  const p = path.resolve(__dirname, '..', EVENTS);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  eventStream = fs.createWriteStream(p, { flags: 'w' });
}

const results = [];
for(const seed of SEEDS){
  const t0 = Date.now();
  const r = runSeed(seed, eventStream);
  results.push(r);
  console.log(`seed ${String(seed).padStart(3)}  pop=${String(r.population).padStart(4)}  genomeLen=${r.avgGenomeLen.toFixed(2)}  bonds=${String(r.bonds).padStart(4)}  maxComp=${String(r.maxComponentSize).padStart(3)}  births=${String(r.births).padStart(6)}  deaths=${String(r.deaths).padStart(6)}  (${((Date.now()-t0)/1000).toFixed(1)}s)`);
}
if(eventStream) eventStream.end();

const summary = {
  label: LABEL,
  features: Object.keys(FEATURES).length ? Object.keys(FEATURES) : ['(v3.1 base)'],
  ticks: TICKS, pop: POP, seeds: SEEDS,
  population:   { median: median(results.map(r=>r.population)),   mean: +mean(results.map(r=>r.population)).toFixed(2) },
  avgGenomeLen: { median: median(results.map(r=>r.avgGenomeLen)), mean: +mean(results.map(r=>r.avgGenomeLen)).toFixed(3) },
  bonds:        { median: median(results.map(r=>r.bonds)),        mean: +mean(results.map(r=>r.bonds)).toFixed(2) },
  maxComponentSize: { median: median(results.map(r=>r.maxComponentSize)), mean: +mean(results.map(r=>r.maxComponentSize)).toFixed(2) },
  avgEnergy:    { median: median(results.map(r=>r.avgEnergy)),    mean: +mean(results.map(r=>r.avgEnergy)).toFixed(3) },
  outcomeShare: {},
};
for(const o of OUTCOMES){
  summary.outcomeShare[o] = +mean(results.map(r=>r.outcomeShare[o])).toFixed(5);
}

console.log('\n--- ЗВЕДЕННЯ (' + SEEDS.length + ' seed×' + TICKS + ' тіків) ---');
console.log('популяція        median=' + summary.population.median + '  mean=' + summary.population.mean);
console.log('довжина геному   median=' + summary.avgGenomeLen.median + '  mean=' + summary.avgGenomeLen.mean);
console.log('зв\'язків         median=' + summary.bonds.median + '  mean=' + summary.bonds.mean);
console.log('макс. компонента median=' + summary.maxComponentSize.median + '  mean=' + summary.maxComponentSize.mean);
console.log('сер. енергія     median=' + summary.avgEnergy.median + '  mean=' + summary.avgEnergy.mean);
console.log('розподіл дій (частка):');
for(const o of OUTCOMES) console.log('  ' + o.padEnd(16) + (summary.outcomeShare[o]*100).toFixed(2) + '%');

if(LABEL){
  const outPath = path.resolve(__dirname, '..', 'data', LABEL + '.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2));
  console.log('\nЗбережено: data/' + LABEL + '.json');
}
