'use strict';
/* =========================================================================
   ШТУЧНА ЕВОЛЮЦІЯ — CORE ENGINE (v3.1 baseline)

   Портовано з artificial-evolution-v3.html (мітка в тому файлі: v3.0).
   Без залежності від DOM/Canvas — придатний і для браузера (через
   <script>, визначає window.EvoCore), і для Node (module.exports).

   Зміни відносно вихідного v3.0-файлу (інфраструктурні, фізику не чіпають):
     1. W/H/POP_CAP були mutable module-level `let` — спільний стан, який
        ламає детермінізм і паралельні прогони кількох Simulation в одному
        процесі (потрібно для порівняння 8+ seed'ів, розділ 12 специфікації
        v4.0). Тепер це поля екземпляра: sim.W, sim.H, sim.popCap.
     2. Уся випадковість (Genome.random/recombine/mutate, Environment,
        Entity, InteractionEngine, Simulation.init/movementPhase/bondPhase/
        interactionPhase) переведена з Math.random() на явний seeded RNG
        (core/rng.js), що передається як параметр або читається з sim.rng.
        Це дає детермінований replay при фіксованому seed.
     3. Додано checkpoint (Simulation#checkpoint / Simulation.fromCheckpoint)
        і JSONL-сумісний журнал подій (sim.drainEventLog()).
     4. Жодних змін фізики: формули, ваги, ймовірності, порядок фаз тіку —
        побітово ті самі, що у вихідному файлі. Відомий "мертвий" доданок
        (a.internalState+b.internalState)*0.1 у softmax (див. specification
        v4.0 §5) свідомо залишений як є — його оживлення заплановане як
        крок 1 v4.0, а не як частина v3.1-бази.
        Баг `absorb` без перевірки зв'язку (specification v4.0 §9) також
        свідомо залишений як є — його виправлення заплановане як крок 3
        v4.0, окремим кроком з власним прогоном для порівняння ефекту.
   ========================================================================= */

// Тіло загорнуте в IIFE: у браузері це класичний <script>, і без обгортки
// всі верхньорівневі class/const (RNG, Simulation, Genome, ...) потрапляли б
// у спільну глобальну лексичну область і конфліктували б із кодом сторінки.
// Назовні віддається лише EvoCore.
(function(){

// Залежність core/rng.js, розв'язана однаково для Node і для браузера
// (у браузері rng.js підключається <script>'ом раніше і кладе window.EvoRNG).
const RNG = (typeof module !== 'undefined' && module.exports)
  ? require('./rng.js').RNG
  : window.EvoRNG.RNG;

const GENE_TYPES = ['E','S','I','A','C','R'];

// 9 рівноправних локальних результатів взаємодії. 'construct' — народження
// нового елемента — такий самий результат, як і решта, без спеціального статусу.
const OUTCOMES = ['none','energyExchange','infoState','stateChange','repulsion','tempBond','stableBond','absorb','construct'];

const BASE_WEIGHTS = {
  E: [0.2,0.9,0.1,0.1,0.1,0.1,0.2,0.6,0.3],
  S: [0.2,0.1,0.2,0.9,0.2,0.4,0.3,0.1,0.2],
  I: [0.2,0.1,0.9,0.2,0.5,0.3,0.1,0.1,0.35],
  A: [0.1,0.4,0.1,0.2,0.7,0.1,0.1,0.7,0.1],
  C: [0.2,0.5,0.2,0.1,0.1,0.7,0.9,0.1,0.3],
  R: [0.5,0.3,0.1,0.1,0.1,0.1,0.1,0.1,0.9],
};

const MUTATION = {
  pointRate:0.15, pointStrength:0.15,
  typeChangeRate:0.04,
  chargeMutRate:0.03,
  insRate:0.045, delRate:0.04, dupRate:0.04,
  inversionRate:0.06,
};

const BOND_FLOW_RATE = 0.05;
const BOND_UPKEEP = 0.004;
const BOND_BREAK_PROB = 0.0006;
const BOND_FORM_COST = 0.15;
const SPRING_K = 0.015;

const ENERGY_STORAGE_K = 0.002;   // глобальний фізичний закон: вартість утримання накопиченої енергії
const ENERGY_STORAGE_EXP = 1.15;

// Вартість локального конструювання нового елемента — фізична дія двох
// сусідів, а не "розмноження організму". Немає жодного зв'язку з розміром
// чи наявністю зв'язної компоненти.
const CONSTRUCT_BASE_COST = 0.6;
const CONSTRUCT_GENE_COST = 0.5;   // за кожен ген у геномі нащадка
const CONSTRUCT_ENERGY_SHARE = 0.5; // частка вартості, що йде нащадку як стартова енергія

// --- Прапорці кроків v4.0 (специфікація, розділ 12) ------------------------
// Усі вимкнені = точна v3.1-база. Кожен крок вмикається окремо, щоб знати,
// що саме змінив саме цей крок. Прапорці фіксуються на створенні світу і не
// змінюються за час прогону — це "який набір фізичних законів діє", а не
// канал впливу ззовні. Observer їх не читає і не пише.
const FEATURE_DEFAULTS = {
  internalStateReadout: false, // крок 1: internalState отримує каузальний вихід
  envOscillation: false,       // крок 2: повільне глобальне коливання ресурсу
  absorbBondFix: false,        // крок 3: absorb між зв'язаними вузлами
  absorbBondBreak: false,      // підваріант кроку 3: спершу розірвати ребро
  charges: false,              // крок 4: заряди, валентність, насичення
  edgeModes: false,            // крок 5: провідність / домінування ребра
  chargeExpression: false,     // крок 6: експресія за зарядом
  neighborVector: false,       // крок 7: внесок сусідів (глибина 1)
  flowBondStability: false,    // крок 8: стабільність зв'язку з потоку
};

// Обернена "температура" softmax'у вибору результату взаємодії.
const SOFTMAX_BETA = 3;
const ENV_OSC_PERIOD = 12000;
const ENV_OSC_AMP = 0.5;

const RECORD_INTERVAL = 8;
const DEFAULT_POP_CAP = 550; // лише технічний запобіжник продуктивності, не еволюційне правило
const DEFAULT_W = 900, DEFAULT_H = 600;

function mod(n, m){ return ((n % m) + m) % m; }
const CHARGE_NAMES = ['r','g','b','R','G','B'];
const VALENCE_EPS = 1e-6;
const chargeColor = ch => ch % 3;
const chargeSign = ch => ch < 3 ? 1 : -1;
function netCharge(genes){
  const n = [0,0,0];
  for(const g of genes) n[chargeColor(g.charge)] += chargeSign(g.charge);
  return n;
}
function chargeResidual(n){
  const m = (n[0]+n[1]+n[2])/3;
  return n.map(v=>v-m);
}
function valence(n){ return Math.hypot(...chargeResidual(n)); }
function copyGene(g){
  return g.charge === undefined ? {type:g.type, value:g.value} : {type:g.type, value:g.value, charge:g.charge};
}
function randomGene(rng, charges){
  const g = {type:GENE_TYPES[Math.floor(rng.random()*GENE_TYPES.length)], value:rng.random()};
  if(charges) g.charge = Math.floor(rng.random()*6);
  return g;
}
function wrapDelta(d, size){ return mod(d + size/2, size) - size/2; }
function torusDist(x1,y1,x2,y2,w,h){
  const dx = wrapDelta(x2-x1, w), dy = wrapDelta(y2-y1, h);
  return Math.hypot(dx,dy);
}

class Genome {
  constructor(genes){ this.genes = genes; }

  static random(rng, minLen=4, maxLen=9, charges=false){
    const len = minLen + Math.floor(rng.random()*(maxLen-minLen+1));
    const genes = [];
    for(let i=0;i<len;i++) genes.push(randomGene(rng, charges));
    return new Genome(genes);
  }

  // Локальна операція крос-over'у двох геномів-сусідів (не "копія одного
  // батька"). Кожен нащадок бере префікс від одного генома і суфікс від
  // іншого — обидва читаються лише з двох конкретних локальних учасників.
  static recombine(rng, gA, gB, charges=false){
    const pA = Math.floor(rng.random()*(gA.genes.length+1));
    const pB = Math.floor(rng.random()*(gB.genes.length+1));
    const genes = [
      ...gA.genes.slice(0,pA).map(copyGene),
      ...gB.genes.slice(pB).map(copyGene),
    ];
    if(genes.length===0) genes.push(randomGene(rng, charges));
    return new Genome(genes);
  }

  clone(){ return new Genome(this.genes.map(copyGene)); }

  mutate(rng, charges=false){
    const originalLen = this.genes.length;
    let out = [];
    for(const g of this.genes){
      if(rng.random() < MUTATION.delRate && originalLen > 1){ continue; }
      let type = g.type, val = g.value;
      if(rng.random() < MUTATION.typeChangeRate){ type = GENE_TYPES[Math.floor(rng.random()*GENE_TYPES.length)]; }
      if(rng.random() < MUTATION.pointRate){
        val += (rng.random()-0.5) * MUTATION.pointStrength * 2;
        val = Math.min(1, Math.max(0, val));
      }
      const gene = {type, value:val};
      if(g.charge !== undefined) gene.charge = g.charge;
      if(charges && rng.random() < MUTATION.chargeMutRate) gene.charge = Math.floor(rng.random()*6);
      out.push(gene);
      if(rng.random() < MUTATION.dupRate){ out.push(copyGene(gene)); }
      if(rng.random() < MUTATION.insRate){
        out.push(randomGene(rng, charges));
      }
    }
    if(out.length === 0){ out.push(randomGene(rng, charges)); }
    if(out.length >= 3 && rng.random() < MUTATION.inversionRate){
      const a = Math.floor(rng.random()*out.length), b = Math.floor(rng.random()*out.length);
      const s = Math.min(a,b), e = Math.max(a,b);
      if(e - s >= 1){ const seg = out.slice(s, e+1).reverse(); out.splice(s, seg.length, ...seg); }
    }
    return new Genome(out);
  }

  typeAverages(){
    const sums={E:0,S:0,I:0,A:0,C:0,R:0}, counts={E:0,S:0,I:0,A:0,C:0,R:0};
    for(const g of this.genes){ sums[g.type]+=g.value; counts[g.type]++; }
    const avg={};
    for(const t of GENE_TYPES) avg[t] = counts[t] ? sums[t]/counts[t] : 0;
    return avg;
  }

  get length(){ return this.genes.length; }
  signature(){ return this.genes.map(g=>g.type).join(''); }

  outcomeVector(){
    const vec = new Array(OUTCOMES.length).fill(0);
    this.genes.forEach((g,i)=>{
      const w = BASE_WEIGHTS[g.type];
      const phase = Math.sin(i*0.7 + g.value*Math.PI);
      for(let j=0;j<OUTCOMES.length;j++) vec[j] += w[j]*g.value*(1+0.3*phase);
    });
    const n = Math.max(1, this.genes.length);
    for(let j=0;j<OUTCOMES.length;j++) vec[j] /= Math.sqrt(n);
    return vec;
  }
}

function computePhenotype(genome){
  const avg = genome.typeAverages();
  const n = genome.length;
  const costFactor = 1/(1+n*0.05);
  const size = 0.7 + avg.S*1.4 + n*0.04;
  const speed = ((avg.E*0.6 + avg.A*0.4) * costFactor) * (1.4/(0.5+size*0.5));
  const upkeep = 0.012 + n*0.0055 + size*0.008 + speed*0.01;
  const perception = Math.max(6, 10 + avg.I*45 - n*0.35);
  const sensitivity = avg.I*0.7 + avg.S*0.3;
  const energyGain = Math.max(0.05, 0.35 + avg.E*1.3 - size*0.05);
  const bondAffinity = avg.C;
  // "replicationDrive" тут — лише інформаційний показник (сер. значення R-гена)
  // для статистики/спостереження. Фізика construct НЕ читає це поле напряму —
  // вона читає genome.outcomeVector(), де R впливає лише як один з 6 компонентів.
  const replicationDrive = avg.R;
  const outcomeVector = genome.outcomeVector();
  return { size, speed, upkeep, perception, sensitivity, energyGain, bondAffinity, replicationDrive, outcomeVector, complexity:n };
}

class Entity {
  constructor(id, genome, x, y, energy, generation, rng){
    this.id = id;
    this.genome = genome;
    this.phenotype = computePhenotype(genome);
    this.x = x; this.y = y;
    this.vx = (rng.random()-0.5); this.vy = (rng.random()-0.5);
    this.energy = energy;
    this.age = 0;
    this.generation = generation || 0;
    this.bonds = new Set();
    this.internalState = 0;
    this.tempBondPartner = null; this.tempBondExpire = 0;
    this.lineage = genome.signature();
    this.lastStorageCost = 0;
  }
}

class Bond {
  constructor(id, a, b, tick){ this.id=id; this.a=a; this.b=b; this.createdTick=tick; }
}

// Структура — суто аналітичне поняття для Observer'а (зв'язна компонента
// графа Entity–Bond). Не має власного класу поведінки, геному, енергії чи
// таймера реплікації — усі властивості виникають з вузлів/ребер ззовні.
class Structure {
  constructor(id, nodes, edges){ this.id=id; this.nodes=nodes; this.edges=edges; }
}

class Environment {
  constructor(w,h,cellSize,rng){
    this.w=w; this.h=h; this.cellSize=cellSize;
    this.cols = Math.ceil(w/cellSize); this.rows = Math.ceil(h/cellSize);
    this.grid = new Float32Array(this.cols*this.rows);
    this.spots = [];
    const spotCount = Math.max(4, Math.round(4 * (w*h) / (900*600)));
    for(let i=0;i<spotCount;i++){
      this.spots.push({
        x: rng.random()*w, y: rng.random()*h, r: 80+rng.random()*120,
        strength: 0.6+rng.random()*0.6,
        dx: (rng.random()-0.5)*0.3, dy: (rng.random()-0.5)*0.3
      });
    }
    for(let i=0;i<this.grid.length;i++) this.grid[i] = rng.random()*1.5;
  }
  idx(cx,cy){ return mod(cy,this.rows)*this.cols + mod(cx,this.cols); }
  cellCoord(x,y){ return { cx: Math.floor(x/this.cellSize), cy: Math.floor(y/this.cellSize) }; }
  step(tickCount=0, oscillation=false){
    const osc = oscillation ? 1 + ENV_OSC_AMP*Math.sin(2*Math.PI*tickCount/ENV_OSC_PERIOD) : 1;
    for(const s of this.spots){ s.x = mod(s.x+s.dx, this.w); s.y = mod(s.y+s.dy, this.h); }
    for(let cy=0; cy<this.rows; cy++){
      for(let cx=0; cx<this.cols; cx++){
        const wx = cx*this.cellSize+this.cellSize/2, wy = cy*this.cellSize+this.cellSize/2;
        let target = 0.15*osc;
        for(const s of this.spots){
          const dx = wrapDelta(wx-s.x, this.w), dy = wrapDelta(wy-s.y, this.h);
          target += s.strength*osc*Math.exp(-(dx*dx+dy*dy)/(2*s.r*s.r));
        }
        const i = this.idx(cx,cy);
        this.grid[i] += (target-this.grid[i])*0.01;
        if(this.grid[i]<0) this.grid[i]=0;
      }
    }
  }
  valueAt(x,y){ const {cx,cy}=this.cellCoord(x,y); return this.grid[this.idx(cx,cy)]; }
  sampleGradient(x,y){
    const step=this.cellSize, c0=this.valueAt(x,y);
    return { gx: this.valueAt(x+step,y)-c0, gy: this.valueAt(x,y+step)-c0 };
  }
  consume(x,y,radius,rate){
    const {cx,cy}=this.cellCoord(x,y);
    const cr = Math.max(1, Math.ceil(radius/this.cellSize));
    let total=0;
    for(let dy=-cr; dy<=cr; dy++){
      for(let dx=-cr; dx<=cr; dx++){
        const i = this.idx(cx+dx, cy+dy);
        const take = Math.min(this.grid[i], rate*0.15);
        this.grid[i]-=take; total+=take;
      }
    }
    return total;
  }
  deposit(x,y,amount){ const {cx,cy}=this.cellCoord(x,y); this.grid[this.idx(cx,cy)] += amount; }
}

class SpatialIndex {
  constructor(cellSize, w, h){
    this.cellSize=cellSize;
    this.cols=Math.ceil(w/cellSize); this.rows=Math.ceil(h/cellSize);
    this.map=new Map();
  }
  cellCoord(x,y){ return { cx: mod(Math.floor(x/this.cellSize), this.cols), cy: mod(Math.floor(y/this.cellSize), this.rows) }; }
  key(cx,cy){ return cx+':'+cy; }
  clear(){ this.map.clear(); }
  insert(entity){
    const {cx,cy}=this.cellCoord(entity.x,entity.y);
    const k=this.key(cx,cy);
    if(!this.map.has(k)) this.map.set(k,[]);
    this.map.get(k).push(entity);
  }
  nearby(x,y,radius){
    const res=[]; const cr = Math.max(1, Math.ceil(radius/this.cellSize));
    const {cx,cy}=this.cellCoord(x,y);
    for(let dy=-cr; dy<=cr; dy++){
      for(let dx=-cr; dx<=cr; dx++){
        const arr = this.map.get(this.key(mod(cx+dx,this.cols), mod(cy+dy,this.rows)));
        if(arr) for(const e of arr) res.push(e);
      }
    }
    return res;
  }
}

// InteractionEngine — єдине місце фізики, що може створити новий елемент.
// 'construct' це рівноправний результат серед 9-ти, обраний softmax'ом над
// сумою векторів схильностей ДВОХ конкретних сусідів. Ніхто тут не знає про
// зв'язні компоненти, глобальну структуру чи "організм".
const InteractionEngine = {
  resolve(sim, a, b){
    const va = a.phenotype.outcomeVector, vb = b.phenotype.outcomeVector;
    let combined, beta;
    if(sim.features.internalStateReadout){
      // КРОК 1 (§5). У v3 доданок (a.internalState+b.internalState)*0.1 додавався
      // до ВСІХ компонент однаково, а softmax(x+c) === softmax(x) — тобто стан не
      // мав каузального виходу взагалі (перевірено: scripts/verify-internalstate-dead.js).
      // Тут стан отримує readout як поріг експресії: він модулює різкість вибору,
      // а не переваги. Збуджена пара (високий |стан|) чіткіше йде за найсильнішою
      // тенденцією власних геномів; спокійна — вибирає розмитіше, ближче до шуму.
      // Жодному з 9 результатів це не дає переваги — програмується не результат,
      // а лише те, наскільки строго геном себе виражає.
      combined = va.map((v,i)=> v + vb[i] + (sim.rng.random()-0.5)*0.15);
      const excitation = a.internalState + b.internalState;
      beta = SOFTMAX_BETA * (1 + Math.tanh(excitation*0.5)*0.5); // 1.5 .. 4.5
    } else {
      combined = va.map((v,i)=> v + vb[i] + (a.internalState+b.internalState)*0.1 + (sim.rng.random()-0.5)*0.15);
      beta = SOFTMAX_BETA;
    }
    const maxV = Math.max(...combined);
    const exps = combined.map(v=>Math.exp((v-maxV)*beta));
    const sum = exps.reduce((s,v)=>s+v,0);
    let r = sim.rng.random()*sum, idx=0;
    for(let i=0;i<exps.length;i++){ r -= exps[i]; if(r<=0){ idx=i; break; } }
    // Суто спостережний лічильник: фізика його ніколи не читає (write-only).
    sim.outcomeCounts[OUTCOMES[idx]]++;
    InteractionEngine.applyOutcome(sim, OUTCOMES[idx], a, b);
  },
  applyOutcome(sim, outcome, a, b){
    switch(outcome){
      case 'none': break;
      case 'energyExchange': {
        const rate = 0.12*(a.phenotype.bondAffinity + b.phenotype.bondAffinity + 0.2);
        const delta = (a.energy-b.energy)*rate;
        a.energy -= delta; b.energy += delta;
        break;
      }
      case 'infoState': {
        const nudge=0.15, as=a.internalState, bs=b.internalState;
        a.internalState += (bs-as)*nudge + (b.phenotype.replicationDrive-a.phenotype.replicationDrive)*0.05;
        b.internalState += (as-bs)*nudge;
        sim.infoOps++; // локальна операція копіювання інформаційного стану
        break;
      }
      case 'stateChange': {
        a.internalState += (sim.rng.random()-0.5)*b.phenotype.bondAffinity*0.5;
        b.internalState += (sim.rng.random()-0.5)*a.phenotype.bondAffinity*0.5;
        break;
      }
      case 'repulsion': {
        const dx = wrapDelta(a.x-b.x, sim.W), dy = wrapDelta(a.y-b.y, sim.H);
        const m = Math.hypot(dx,dy) || 1, f = 0.5;
        a.vx += dx/m*f; a.vy += dy/m*f;
        b.vx -= dx/m*f; b.vy -= dy/m*f;
        break;
      }
      case 'tempBond': {
        a.tempBondPartner = b.id; b.tempBondPartner = a.id;
        a.tempBondExpire = sim.tick_count+40; b.tempBondExpire = sim.tick_count+40;
        break;
      }
      case 'stableBond': {
        if(sim.features.charges && (sim.residualValence(a)<VALENCE_EPS || sim.residualValence(b)<VALENCE_EPS)) break;
        const bond = sim.addBondBetween(a.id, b.id);
        if(bond){
          a.energy -= BOND_FORM_COST; b.energy -= BOND_FORM_COST;
          sim._logEvent('bondForm', { bondId: bond.id, a: a.id, b: b.id });
        }
        break;
      }
      case 'absorb': {
        if(sim.features.absorbBondFix){
          const bond = [...a.bonds].map(id=>sim.bonds.get(id))
            .find(bond=>bond && (bond.a===b.id || bond.b===b.id));
          if(bond){
            if(sim.features.absorbBondBreak) sim.removeBond(bond.id, 'absorb');
            // Enabled prohibition intentionally skips the absorb RNG draws.
            // With the feature disabled the original stream is unchanged.
            else break;
          }
        }
        const powerA = a.phenotype.size*(1+a.energy*0.05), powerB = b.phenotype.size*(1+b.energy*0.05);
        const total = powerA+powerB;
        const aWins = sim.rng.random() < powerA/total;
        const winner = aWins? a: b, loser = aWins? b: a;
        const transfer = loser.energy*0.5;
        loser.energy -= transfer;
        winner.energy += transfer*0.8;
        if(loser.energy<0.3 && sim.rng.random()<0.3) loser.energy = 0;
        break;
      }
      case 'construct': {
        // Локальна фізична дія двох сусідів. НЕ "розмноження організму":
        // немає доступу до зв'язної компоненти, немає копіювання топології.
        if(sim.entities.size > sim.popCap) break; // технічний запобіжник, не еволюційне правило
        const combinedEnergy = a.energy + b.energy;
        if(combinedEnergy <= 0) break;
        const childGenome = Genome.recombine(sim.rng, a.genome, b.genome, sim.features.charges).mutate(sim.rng, sim.features.charges);
        sim.infoOps++; // рекомбінація — теж локальна операція копіювання інформації
        const cost = CONSTRUCT_BASE_COST + CONSTRUCT_GENE_COST * childGenome.length;
        if(combinedEnergy <= cost*1.5){ sim.constructAborted++; break; } // недостатньо енергії — дія не відбувається
        const shareA = a.energy/combinedEnergy, shareB = b.energy/combinedEnergy;
        a.energy -= cost*shareA; b.energy -= cost*shareB;
        const midX = mod(a.x + wrapDelta(b.x-a.x, sim.W)/2, sim.W);
        const midY = mod(a.y + wrapDelta(b.y-a.y, sim.H)/2, sim.H);
        const jAngle = sim.rng.random()*Math.PI*2, jDist = 4+sim.rng.random()*6;
        const spawnX = mod(midX+Math.cos(jAngle)*jDist, sim.W);
        const spawnY = mod(midY+Math.sin(jAngle)*jDist, sim.H);
        const childEnergy = Math.max(0.3, cost*CONSTRUCT_ENERGY_SHARE);
        const child = sim.spawnEntity(childGenome, spawnX, spawnY, childEnergy, Math.max(a.generation,b.generation)+1);
        child.internalState = (a.internalState+b.internalState)*0.25; // часткова, згасаюча передача локальної інформації
        // child.bonds лишається порожнім — жодного зв'язку від народження
        sim.births++; sim.constructSuccess++; sim.totalConstructCost += cost;
        sim._logEvent('birth', { childId: child.id, parentA: a.id, parentB: b.id, x: spawnX, y: spawnY, genomeLen: childGenome.length, generation: child.generation });
        break;
      }
    }
  }
};

// Observer — єдине місце, що аналізує граф (зв'язні компоненти, мотиви,
// схожість сусідів, тривалість життя конфігурацій). Читає лише sim.entities
// і sim.bonds; пише лише у sim.observer / sim.history / sim.lastStructures.
// Жодна фаза фізики нижче цей об'єкт не читає — Observer можна видалити з
// tick() без жодної зміни поведінки світу.
const Observer = {
  computeStructures(sim){
    const visited = new Set(); const comps = []; let sid=1;
    for(const id of sim.entities.keys()){
      if(visited.has(id)) continue;
      const stack=[id]; visited.add(id);
      const nodes=[]; const edgeSet=new Set();
      while(stack.length){
        const cur = stack.pop();
        nodes.push(cur);
        const ent = sim.entities.get(cur);
        if(!ent) continue;
        for(const bid of ent.bonds){
          const bond = sim.bonds.get(bid); if(!bond) continue;
          edgeSet.add(bid);
          const other = bond.a===cur ? bond.b : bond.a;
          if(!visited.has(other) && sim.entities.has(other)){ visited.add(other); stack.push(other); }
        }
      }
      comps.push(new Structure(sid++, nodes, [...edgeSet]));
    }
    return comps;
  },

  // Простий (свідомо неповний) інваріантний "відбиток" маленької конфігурації:
  // розмір, к-сть ребер, послідовність степенів вузлів + грубий генетичний
  // бакет. Лише для спостереження — ніколи не впливає на фізику.
  motifFingerprint(sim, st){
    const n = st.nodes.length;
    const degCount = new Map(); for(const id of st.nodes) degCount.set(id,0);
    for(const bid of st.edges){
      const b = sim.bonds.get(bid); if(!b) continue;
      degCount.set(b.a,(degCount.get(b.a)||0)+1);
      degCount.set(b.b,(degCount.get(b.b)||0)+1);
    }
    const degSeq = [...degCount.values()].sort((a,b)=>a-b).join('.');
    const sumAvg = {E:0,S:0,I:0,A:0,C:0,R:0};
    for(const id of st.nodes){
      const ent = sim.entities.get(id); if(!ent) continue;
      const av = ent.genome.typeAverages();
      for(const t of GENE_TYPES) sumAvg[t]+=av[t];
    }
    const bucket = GENE_TYPES.map(t=>(Math.round((sumAvg[t]/n)*5)/5).toFixed(1)).join(':');
    return `${n}n${st.edges.length}e[${degSeq}]${bucket}`;
  },

  trackLifetimes(sim, structures){
    const currentSigs = new Set();
    const lt = sim.observer.lifetimes;
    for(const st of structures){
      if(st.nodes.length < 2) continue; // одиночні елементи не рахуються як "конфігурація"
      const sig = st.nodes.slice().sort((a,b)=>a-b).join(',');
      currentSigs.add(sig);
      if(!lt.has(sig)) lt.set(sig, { first: sim.tick_count, last: sim.tick_count });
      else lt.get(sig).last = sim.tick_count;
    }
    for(const [sig, rec] of [...lt.entries()]){
      if(!currentSigs.has(sig)){
        sim.observer.completedLifetimes.push(rec.last - rec.first);
        if(sim.observer.completedLifetimes.length > 500) sim.observer.completedLifetimes.shift();
        lt.delete(sig);
      }
    }
  },

  trackMotifs(sim, structures){
    for(const st of structures){
      if(st.nodes.length < 2 || st.nodes.length > 6) continue; // "простий" трекер — лише малі конфігурації
      const fp = Observer.motifFingerprint(sim, st);
      const mc = sim.observer.motifCounts;
      mc.set(fp, (mc.get(fp)||0)+1);
    }
    if(sim.observer.motifCounts.size > 2000){ // технічне обмеження пам'яті спостерігача
      const top = [...sim.observer.motifCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,500);
      sim.observer.motifCounts = new Map(top);
    }
  },

  trackSimilarity(sim){
    let sumSim=0, count=0;
    for(const bond of sim.bonds.values()){
      const a=sim.entities.get(bond.a), b=sim.entities.get(bond.b);
      if(!a || !b) continue;
      const avA=a.genome.typeAverages(), avB=b.genome.typeAverages();
      let sq=0; for(const t of GENE_TYPES){ const d=avA[t]-avB[t]; sq+=d*d; }
      const dist = Math.sqrt(sq)/Math.sqrt(GENE_TYPES.length);
      sumSim += (1-dist); count++;
    }
    sim.observer.avgNeighborSimilarity = count ? sumSim/count : 0;
  },

  topMotifs(sim, k){
    return [...sim.observer.motifCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,k).map(([fp,count])=>({fp,count}));
  },

  recordHistory(sim, structures){
    const entities=[...sim.entities.values()];
    const n=entities.length||1;
    const avgLen=entities.reduce((s,e)=>s+e.genome.length,0)/n;
    const avgEnergy=entities.reduce((s,e)=>s+e.energy,0)/n;
    const avgStorageCost=entities.reduce((s,e)=>s+e.lastStorageCost,0)/n;
    const avgReplicationDrive=entities.reduce((s,e)=>s+e.phenotype.replicationDrive,0)/n;
    const maxStruct=structures.reduce((m,s)=>Math.max(m,s.nodes.length),0);
    const h=sim.history;
    h.population.push(entities.length);
    h.avgGenomeLen.push(avgLen);
    h.maxStructSize.push(maxStruct);
    h.bonds.push(sim.bonds.size);
    h.avgEnergy.push(entities.length ? avgEnergy : 0);
    h.avgStorageCost.push(entities.length ? avgStorageCost : 0);
    h.avgReplicationDrive.push(entities.length ? avgReplicationDrive : 0);
    h.avgNeighborSimilarity.push(sim.observer.avgNeighborSimilarity);
    h.constructRate.push(sim.constructSuccess - sim.observer.prevConstructSuccess);
    sim.observer.prevConstructSuccess = sim.constructSuccess;
    sim.observer.prevInfoOps = sim.infoOps;
    const cap=200;
    for(const k in h) if(h[k].length>cap) h[k].shift();
  },

  update(sim){
    const structures = Observer.computeStructures(sim);
    sim.lastStructures = structures;
    Observer.trackLifetimes(sim, structures);
    if(sim.tick_count % RECORD_INTERVAL === 0){
      Observer.trackMotifs(sim, structures);
      Observer.trackSimilarity(sim);
      Observer.recordHistory(sim, structures);
    }
  }
};

class Simulation {
  constructor(opts){
    opts = opts || {};
    const popSize = opts.popSize != null ? opts.popSize : 140;
    this.W = opts.width || DEFAULT_W;
    this.H = opts.height || DEFAULT_H;
    this.popCap = opts.popCap || DEFAULT_POP_CAP;
    const seed = opts.seed != null ? opts.seed : ((Date.now() ^ (Math.random()*0xffffffff)) >>> 0);
    this.seed = seed;
    this.features = Object.assign({}, FEATURE_DEFAULTS, opts.features || {});
    this.rng = new RNG(seed);
    this.env = new Environment(this.W, this.H, 20, this.rng);
    this.spatial = new SpatialIndex(30, this.W, this.H);
    this.init(popSize);
  }

  init(n){
    this.entities = new Map();
    this.bonds = new Map();
    this.entityIdCounter = 1; this.bondIdCounter = 1;
    this.tick_count = 0;
    this.births = 0; this.deaths = 0;
    this.constructSuccess = 0; this.constructAborted = 0; this.totalConstructCost = 0; this.infoOps = 0;
    this.outcomeCounts = {}; for(const o of OUTCOMES) this.outcomeCounts[o] = 0;
    this.observer = {
      lifetimes: new Map(), completedLifetimes: [], motifCounts: new Map(),
      avgNeighborSimilarity: 0, prevConstructSuccess: 0, prevInfoOps: 0,
    };
    this.history = {
      population:[], avgGenomeLen:[], maxStructSize:[], bonds:[], avgEnergy:[],
      avgStorageCost:[], avgReplicationDrive:[], avgNeighborSimilarity:[], constructRate:[],
    };
    this.eventLog = [];
    for(let i=0;i<n;i++){
      const genome = Genome.random(this.rng, 4, 9, this.features.charges);
      this.spawnEntity(genome, this.rng.random()*this.W, this.rng.random()*this.H, 3+this.rng.random()*2, 0);
    }
    this.lastStructures = Observer.computeStructures(this);
  }

  _logEvent(type, data){
    this.eventLog.push(Object.assign({ tick: this.tick_count, type }, data));
    if(this.eventLog.length > 20000) this.eventLog.splice(0, this.eventLog.length - 20000); // технічне обмеження пам'яті, як і в Observer
  }

  // Повертає й очищує накопичений журнал подій (для періодичного дозапису в JSONL).
  drainEventLog(){
    const out = this.eventLog;
    this.eventLog = [];
    return out;
  }

  spawnEntity(genome,x,y,energy,generation){
    const e = new Entity(this.entityIdCounter++, genome, x, y, energy, generation, this.rng);
    this.entities.set(e.id, e);
    return e;
  }

  residualValence(e){
    if(e._residualCache !== undefined) return e._residualCache;
    // A local star: each neighbor contributes its intrinsic residual once.
    // Never recurse into a neighbor's bonds or inspect the component.
    const d = chargeResidual(netCharge(e.genome.genes));
    for(const bid of [...e.bonds].sort((a,b)=>a-b)){
      const bond = this.bonds.get(bid);
      if(!bond) continue;
      const other = this.entities.get(bond.a===e.id ? bond.b : bond.a);
      if(!other) continue;
      const n = chargeResidual(netCharge(other.genome.genes));
      for(let i=0;i<3;i++) if(d[i]*n[i]<0){
        const amount = Math.min(Math.abs(d[i]), Math.abs(n[i]));
        const sign = Math.sign(d[i]);
        d[i] -= sign*amount;
        n[i] += sign*amount;
      }
    }
    return e._residualCache = Math.hypot(...d);
  }

  invalidateCharges(...ends){
    if(!this.features.charges) return;
    const affected = new Set(ends.filter(Boolean));
    for(const e of ends){
      if(!e) continue;
      for(const bid of e.bonds){
        const bond = this.bonds.get(bid);
        if(bond) affected.add(this.entities.get(bond.a===e.id ? bond.b : bond.a));
      }
    }
    for(const e of affected) if(e) delete e._residualCache;
  }

  addBondBetween(aId,bId){
    const a=this.entities.get(aId), b=this.entities.get(bId);
    if(!a || !b || aId===bId) return null;
    for(const bid of a.bonds){ const bd=this.bonds.get(bid); if(bd && (bd.a===bId||bd.b===bId)) return null; }
    const bond = new Bond(this.bondIdCounter++, aId, bId, this.tick_count);
    this.bonds.set(bond.id, bond);
    a.bonds.add(bond.id); b.bonds.add(bond.id);
    this.invalidateCharges(a,b);
    return bond;
  }
  removeBond(bid, reason){
    const bond = this.bonds.get(bid); if(!bond) return;
    this.bonds.delete(bid);
    const a=this.entities.get(bond.a); if(a) a.bonds.delete(bid);
    const b=this.entities.get(bond.b); if(b) b.bonds.delete(bid);
    this.invalidateCharges(a,b);
    this._logEvent('bondBreak', { bondId: bid, a: bond.a, b: bond.b, reason: reason||'unknown' });
  }

  // --- PHYSICS: єдині методи, що змінюють світ ---

  tick(){
    this.tick_count++;
    this.env.step(this.tick_count, this.features.envOscillation);
    this.rebuildSpatial();
    this.movementPhase();
    this.bondPhase();
    this.energyPhase();
    this.interactionPhase(); // тут же, локально, можуть народжуватись нові елементи
    this.deathPhase();
    Observer.update(this); // лише спостереження — можна видалити без зміни фізики
  }

  rebuildSpatial(){ this.spatial.clear(); for(const e of this.entities.values()) this.spatial.insert(e); }

  movementPhase(){
    for(const e of this.entities.values()){
      e.internalState *= 0.95;
      if(e.tempBondPartner && this.tick_count > e.tempBondExpire) e.tempBondPartner = null;
      let sx = (this.rng.random()-0.5)*0.4, sy = (this.rng.random()-0.5)*0.4;
      const grad = this.env.sampleGradient(e.x, e.y);
      sx += grad.gx * e.phenotype.sensitivity * 4;
      sy += grad.gy * e.phenotype.sensitivity * 4;
      if(e.tempBondPartner){
        const p = this.entities.get(e.tempBondPartner);
        if(p){ sx += (p.vx-e.vx)*0.3; sy += (p.vy-e.vy)*0.3; }
      }
      e.vx += sx*0.2; e.vy += sy*0.2;
    }
    for(const bond of this.bonds.values()){
      const a=this.entities.get(bond.a), b=this.entities.get(bond.b);
      if(!a || !b) continue;
      const dx = wrapDelta(b.x-a.x, this.W), dy = wrapDelta(b.y-a.y, this.H);
      const dist = Math.hypot(dx,dy) || 0.001;
      const rest = 6 + (a.phenotype.size+b.phenotype.size)*2.2;
      const f = (dist-rest)*SPRING_K;
      const ux = dx/dist, uy = dy/dist;
      a.vx += ux*f; a.vy += uy*f;
      b.vx -= ux*f; b.vy -= uy*f;
    }
    for(const e of this.entities.values()){
      const limit = e.phenotype.speed*1.2+0.05;
      const mag = Math.hypot(e.vx,e.vy) || 1;
      if(mag > limit){ e.vx = e.vx/mag*limit; e.vy = e.vy/mag*limit; }
      e.vx *= 0.94; e.vy *= 0.94;
      e.x = mod(e.x+e.vx, this.W); e.y = mod(e.y+e.vy, this.H);
      e.age++;
    }
  }

  bondPhase(){
    const toRemove = [];
    for(const bond of this.bonds.values()){
      const a=this.entities.get(bond.a), b=this.entities.get(bond.b);
      if(!a || !b){ toRemove.push(bond.id); continue; }
      const delta = (a.energy-b.energy)*BOND_FLOW_RATE;
      a.energy -= delta; b.energy += delta;
      a.energy -= BOND_UPKEEP; b.energy -= BOND_UPKEEP;
      if(this.rng.random() < BOND_BREAK_PROB) toRemove.push(bond.id);
    }
    for(const bid of toRemove) this.removeBond(bid, 'randomBreak');
  }

  energyPhase(){
    for(const e of this.entities.values()){
      const gain = this.env.consume(e.x, e.y, e.phenotype.perception*0.4, e.phenotype.energyGain);
      const storageCost = ENERGY_STORAGE_K * Math.pow(Math.max(0, e.energy), ENERGY_STORAGE_EXP);
      e.lastStorageCost = storageCost;
      e.energy += gain - e.phenotype.upkeep - storageCost;
    }
  }

  // Взаємодія береться зі снепшоту складу на початок фази, щоб щойно
  // сконструйований (цим самим тіком) елемент не тригерив ще одну взаємодію
  // в тому ж тіку — це технічна межа фази, а не правило про "організми".
  interactionPhase(){
    const seen = new Set();
    const snapshot = [...this.entities.values()];
    for(const e of snapshot){
      if(!this.entities.has(e.id)) continue;
      const radius = Math.max(e.phenotype.perception*0.5, 14);
      const neighbors = this.spatial.nearby(e.x, e.y, radius);
      for(const other of neighbors){
        if(other.id === e.id) continue;
        if(!this.entities.has(other.id)) continue;
        const key = e.id<other.id ? e.id+'-'+other.id : other.id+'-'+e.id;
        if(seen.has(key)) continue;
        const d = torusDist(e.x,e.y,other.x,other.y,this.W,this.H);
        const maxR = Math.max(e.phenotype.perception, other.phenotype.perception)*0.5;
        if(d > maxR) continue;
        seen.add(key);
        const chance = Math.max(0, 1-d/maxR)*0.5;
        if(this.rng.random() > chance) continue;
        InteractionEngine.resolve(this, e, other);
      }
    }
  }

  deathPhase(){
    const dead = [];
    for(const e of this.entities.values()) if(e.energy<=0) dead.push(e);
    for(const e of dead){
      for(const bid of [...e.bonds]) this.removeBond(bid, 'entityDeath');
      this.env.deposit(e.x, e.y, e.energy>0? e.energy*0.5 : 0.3);
      this.entities.delete(e.id);
      this.deaths++;
      this._logEvent('death', { id: e.id, energy: e.energy, age: e.age, x: e.x, y: e.y, generation: e.generation });
    }
  }

  // --- CHECKPOINT / DETERMINISTIC REPLAY ---
  // Повний знімок стану, достатній для побітового продовження симуляції.
  // JSON-серіалізовуваний (Map/Set/Float32Array конвертуються в масиви).

  checkpoint(){
    return {
      version: 1,
      W: this.W, H: this.H, popCap: this.popCap,
      seed: this.seed,
      features: Object.assign({}, this.features),
      rngState: this.rng.getState(),
      tick_count: this.tick_count,
      entityIdCounter: this.entityIdCounter, bondIdCounter: this.bondIdCounter,
      births: this.births, deaths: this.deaths,
      constructSuccess: this.constructSuccess, constructAborted: this.constructAborted,
      totalConstructCost: this.totalConstructCost, infoOps: this.infoOps,
      outcomeCounts: Object.assign({}, this.outcomeCounts),
      env: {
        cellSize: this.env.cellSize,
        grid: Array.from(this.env.grid),
        spots: this.env.spots.map(s=>({ x:s.x, y:s.y, r:s.r, strength:s.strength, dx:s.dx, dy:s.dy })),
      },
      entities: [...this.entities.values()].map(e=>({
        id: e.id,
        genes: e.genome.genes.map(copyGene),
        x: e.x, y: e.y, vx: e.vx, vy: e.vy, energy: e.energy, age: e.age, generation: e.generation,
        bonds: [...e.bonds], internalState: e.internalState,
        tempBondPartner: e.tempBondPartner, tempBondExpire: e.tempBondExpire,
        lineage: e.lineage, lastStorageCost: e.lastStorageCost,
      })),
      bonds: [...this.bonds.values()].map(b=>({ id:b.id, a:b.a, b:b.b, createdTick:b.createdTick })),
      observer: {
        lifetimes: [...this.observer.lifetimes.entries()],
        completedLifetimes: this.observer.completedLifetimes.slice(),
        motifCounts: [...this.observer.motifCounts.entries()],
        avgNeighborSimilarity: this.observer.avgNeighborSimilarity,
        prevConstructSuccess: this.observer.prevConstructSuccess,
        prevInfoOps: this.observer.prevInfoOps,
      },
      history: JSON.parse(JSON.stringify(this.history)),
    };
  }

  static fromCheckpoint(cp){
    const sim = Object.create(Simulation.prototype);
    sim.W = cp.W; sim.H = cp.H; sim.popCap = cp.popCap;
    sim.seed = cp.seed;
    sim.features = Object.assign({}, FEATURE_DEFAULTS, cp.features || {});
    sim.rng = new RNG(1); sim.rng.setState(cp.rngState);
    sim.tick_count = cp.tick_count;
    sim.entityIdCounter = cp.entityIdCounter; sim.bondIdCounter = cp.bondIdCounter;
    sim.births = cp.births; sim.deaths = cp.deaths;
    sim.constructSuccess = cp.constructSuccess; sim.constructAborted = cp.constructAborted;
    sim.totalConstructCost = cp.totalConstructCost; sim.infoOps = cp.infoOps;
    sim.outcomeCounts = {}; for(const o of OUTCOMES) sim.outcomeCounts[o] = (cp.outcomeCounts && cp.outcomeCounts[o]) || 0;

    sim.env = Object.create(Environment.prototype);
    sim.env.w = cp.W; sim.env.h = cp.H; sim.env.cellSize = cp.env.cellSize;
    sim.env.cols = Math.ceil(cp.W/cp.env.cellSize); sim.env.rows = Math.ceil(cp.H/cp.env.cellSize);
    sim.env.grid = Float32Array.from(cp.env.grid);
    sim.env.spots = cp.env.spots.map(s=>({ ...s }));

    sim.spatial = new SpatialIndex(30, cp.W, cp.H);

    sim.entities = new Map();
    for(const ed of cp.entities){
      const genome = new Genome(ed.genes.map(copyGene));
      const e = Object.create(Entity.prototype);
      e.id = ed.id; e.genome = genome; e.phenotype = computePhenotype(genome);
      e.x = ed.x; e.y = ed.y; e.vx = ed.vx; e.vy = ed.vy; e.energy = ed.energy; e.age = ed.age;
      e.generation = ed.generation; e.bonds = new Set(ed.bonds); e.internalState = ed.internalState;
      e.tempBondPartner = ed.tempBondPartner; e.tempBondExpire = ed.tempBondExpire;
      e.lineage = ed.lineage; e.lastStorageCost = ed.lastStorageCost;
      sim.entities.set(e.id, e);
    }
    sim.bonds = new Map();
    for(const bd of cp.bonds) sim.bonds.set(bd.id, new Bond(bd.id, bd.a, bd.b, bd.createdTick));

    sim.observer = {
      lifetimes: new Map(cp.observer.lifetimes.map(([k,v])=>[k,{...v}])),
      completedLifetimes: cp.observer.completedLifetimes.slice(),
      motifCounts: new Map(cp.observer.motifCounts),
      avgNeighborSimilarity: cp.observer.avgNeighborSimilarity,
      prevConstructSuccess: cp.observer.prevConstructSuccess,
      prevInfoOps: cp.observer.prevInfoOps,
    };
    sim.history = JSON.parse(JSON.stringify(cp.history));
    sim.eventLog = [];
    sim.lastStructures = Observer.computeStructures(sim);
    return sim;
  }

  // --- OBSERVER-facing: агрегація для UI, нічого не змінює у світі ---

  stats(){
    const entities=[...this.entities.values()];
    const n=entities.length||1;
    const structures=this.lastStructures||[];
    let sumLen=0,maxLen=0,sumSpeed=0,sumEnergy=0,maxEnergy=0,sumPerc=0,maxGen=0,sumDeg=0;
    let sumStorageCost=0,maxStorageCost=0,sumReplDrive=0;
    const lineages=new Set();
    for(const e of entities){
      sumLen+=e.genome.length; maxLen=Math.max(maxLen,e.genome.length);
      sumSpeed+=e.phenotype.speed; sumEnergy+=e.energy; maxEnergy=Math.max(maxEnergy,e.energy); sumPerc+=e.phenotype.perception;
      maxGen=Math.max(maxGen,e.generation);
      sumDeg+=e.bonds.size;
      sumStorageCost+=e.lastStorageCost; maxStorageCost=Math.max(maxStorageCost,e.lastStorageCost);
      sumReplDrive+=e.phenotype.replicationDrive;
      lineages.add(e.lineage);
    }
    const sizes=structures.map(s=>s.nodes.length);
    const maxStruct=sizes.length?Math.max(...sizes):0;
    const avgStruct=sizes.length?(sizes.reduce((a,b)=>a+b,0)/sizes.length):0;
    const sizeBuckets={};
    for(const s of sizes){ const b = s>=5?'5+':String(s); sizeBuckets[b]=(sizeBuckets[b]||0)+1; }
    const sizeDist = ['1','2','3','4','5+'].map(k=>sizeBuckets[k]||0).join('/');
    const avgLifetime = this.observer.completedLifetimes.length
      ? (this.observer.completedLifetimes.reduce((a,b)=>a+b,0)/this.observer.completedLifetimes.length) : 0;
    const topM = Observer.topMotifs(this,3).map(m=>`${m.count}×(${m.fp})`).join(' | ') || '—';
    return {
      tick:this.tick_count, generation:maxGen,
      entityCount:entities.length, structureCount:structures.length,
      avgGenomeLen:(sumLen/n).toFixed(2), maxGenomeLen:maxLen,
      avgBonds:(sumDeg/n).toFixed(2), bondsTotal:this.bonds.size,
      maxStructSize:maxStruct, avgStructSize:avgStruct.toFixed(2), sizeDist,
      lineageCount:lineages.size,
      avgEnergy:(sumEnergy/n).toFixed(2), maxEnergy:maxEnergy.toFixed(2),
      avgSpeed:(sumSpeed/n).toFixed(3), avgPerception:(sumPerc/n).toFixed(2),
      avgStorageCost:(sumStorageCost/n).toFixed(4), maxStorageCost:maxStorageCost.toFixed(4),
      avgReplicationDrive:(sumReplDrive/n).toFixed(3),
      births:this.births, deaths:this.deaths,
      constructSuccess:this.constructSuccess, constructAborted:this.constructAborted,
      avgConstructCost: this.constructSuccess ? (this.totalConstructCost/this.constructSuccess).toFixed(3) : '0.000',
      infoOps:this.infoOps,
      avgNeighborSimilarity:this.observer.avgNeighborSimilarity.toFixed(3),
      avgComponentLifetime:avgLifetime.toFixed(1),
      topMotifs:topM,
    };
  }
}

const CONSTANTS = {
  ENV_OSC_PERIOD, ENV_OSC_AMP, VALENCE_EPS,
  BOND_FLOW_RATE, BOND_UPKEEP, BOND_BREAK_PROB, BOND_FORM_COST, SPRING_K,
  ENERGY_STORAGE_K, ENERGY_STORAGE_EXP,
  CONSTRUCT_BASE_COST, CONSTRUCT_GENE_COST, CONSTRUCT_ENERGY_SHARE,
  RECORD_INTERVAL, DEFAULT_POP_CAP, DEFAULT_W, DEFAULT_H,
};

const EvoCore = {
  CHARGE_NAMES, VALENCE_EPS, chargeColor, chargeSign, netCharge, chargeResidual, valence,
  RNG, GENE_TYPES, OUTCOMES, BASE_WEIGHTS, MUTATION, CONSTANTS, FEATURE_DEFAULTS,
  mod, wrapDelta, torusDist,
  Genome, computePhenotype, Entity, Bond, Structure, Environment, SpatialIndex,
  InteractionEngine, Observer, Simulation,
};

if(typeof module !== 'undefined' && module.exports){
  module.exports = EvoCore;
} else if(typeof window !== 'undefined'){
  window.EvoCore = EvoCore;
}

})();
