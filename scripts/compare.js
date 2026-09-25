'use strict';
/* =========================================================================
   Порівняння двох збережених прогонів (розділ 12 специфікації v4.0:
   "після кожного кроку — порівняння розподілів з попередньою версією
   на 8+ seed'ах").

   Оскільки обидва прогони йдуть на ОДНАКОВОМУ наборі seed'ів, порівняння
   парне: для кожного seed рахується різниця, і дивимось на знак різниці
   по всіх seed'ах (знаковий тест) — це чесніше, ніж порівнювати середні,
   бо міжseed'ова дисперсія тут величезна.

   Запуск: node scripts/compare.js step0-baseline step1-internalstate
   ========================================================================= */

const fs = require('fs');
const path = require('path');

const [aName, bName] = process.argv.slice(2);
if(!aName || !bName){
  console.error('Використання: node scripts/compare.js <label-A> <label-B>');
  process.exit(2);
}
const load = (name)=> JSON.parse(fs.readFileSync(path.resolve(__dirname,'..','data',name+'.json'),'utf8'));
const A = load(aName), B = load(bName);

const bySeedA = new Map(A.results.map(r=>[r.seed,r]));
const bySeedB = new Map(B.results.map(r=>[r.seed,r]));
const seeds = A.results.map(r=>r.seed).filter(s=>bySeedB.has(s));

function fmt(x){ return typeof x === 'number' ? (Number.isInteger(x)? String(x) : x.toFixed(3)) : String(x); }

console.log(`A = ${aName}  [${(A.summary.features||['?']).join(', ')}]`);
console.log(`B = ${bName}  [${(B.summary.features||['?']).join(', ')}]`);
console.log(`спільних seed'ів: ${seeds.length}, тіків: ${A.summary.ticks} vs ${B.summary.ticks}\n`);

const METRICS = ['population','avgGenomeLen','bonds','maxComponentSize','avgEnergy','births','deaths','constructSuccess','componentCount'];

console.log('ПАРНЕ ПОРІВНЯННЯ ПО SEED (B − A):');
console.log('метрика'.padEnd(18) + 'median A'.padStart(10) + 'median B'.padStart(10) + 'Δmedian'.padStart(10) + '  B>A  B<A  B=A');
for(const m of METRICS){
  const av = seeds.map(s=>bySeedA.get(s)[m]);
  const bv = seeds.map(s=>bySeedB.get(s)[m]);
  const med = xs=>{ const t=xs.slice().sort((x,y)=>x-y), i=Math.floor(t.length/2); return t.length%2? t[i] : (t[i-1]+t[i])/2; };
  let up=0, down=0, eq=0;
  for(let i=0;i<seeds.length;i++){
    if(bv[i] > av[i]) up++; else if(bv[i] < av[i]) down++; else eq++;
  }
  const mA = med(av), mB = med(bv);
  console.log(m.padEnd(18) + fmt(mA).padStart(10) + fmt(mB).padStart(10) + fmt(mB-mA).padStart(10) +
              '   ' + String(up).padStart(2) + '   ' + String(down).padStart(2) + '   ' + String(eq).padStart(2));
}

// Розподіл дій агрегується по мільйонах взаємодій, тому тут різниця
// в частках надійна навіть за великої міжseed'ової дисперсії.
console.log('\nРОЗПОДІЛ ДІЙ (частка всіх взаємодій):');
console.log('дія'.padEnd(18) + 'A'.padStart(9) + 'B'.padStart(9) + 'Δ п.п.'.padStart(10) + 'відносно'.padStart(11));
const outcomes = Object.keys(A.summary.outcomeShare);
for(const o of outcomes){
  const a = A.summary.outcomeShare[o], b = B.summary.outcomeShare[o];
  const rel = a ? ((b-a)/a*100) : 0;
  console.log(o.padEnd(18) + (a*100).toFixed(2).padStart(8) + '%' + (b*100).toFixed(2).padStart(8) + '%' +
              ((b-a)*100>=0?'+':'') + ((b-a)*100).toFixed(2).padStart(9) + (rel>=0?'+':'') + rel.toFixed(1).padStart(9) + '%');
}

// Розподіл розмірів компонент — головна перевірка §11 (дискретність).
function mergeHist(results, key){
  const out = {};
  for(const r of results) for(const [k,v] of Object.entries(r[key])) out[k] = (out[k]||0)+v;
  return out;
}
console.log('\nРОЗПОДІЛ РОЗМІРІВ КОМПОНЕНТ (сума по seed\'ах, знімок на останньому тіку):');
const hA = mergeHist(A.results,'componentSizeHist'), hB = mergeHist(B.results,'componentSizeHist');
const sizes = [...new Set([...Object.keys(hA), ...Object.keys(hB)])].map(Number).sort((x,y)=>x-y);
console.log('розмір'.padEnd(10) + 'A'.padStart(8) + 'B'.padStart(8));
for(const s of sizes){
  if(s === 1) continue; // одиночні вузли домінують і затінюють решту
  console.log(String(s).padEnd(10) + String(hA[s]||0).padStart(8) + String(hB[s]||0).padStart(8));
}
console.log('(розмір 1: A=' + (hA[1]||0) + ', B=' + (hB[1]||0) + ')');
