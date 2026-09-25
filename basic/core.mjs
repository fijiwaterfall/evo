// Minimal, deterministic replicator ecology. The renderer never changes the world.
export const GENES = ['Рух', 'Чутливість до УМП', 'Поглинання', 'Зв’язування', 'Тривалість життя'];
export const LIFESPAN_GENE = 4;
export const INITIAL_LIFESPAN = 1000;
const clamp = x => Math.max(0, Math.min(1, x));
export class World {
  constructor({seed = 1, size = 64, initial = Math.round(100 * (size / 64) ** 2), concentration = 2, renewal = 0.002, mutation = 0.08, zeroBonds = false} = {}) {
    if (!Number.isInteger(seed) || !Number.isInteger(size) || size < 8 || size > 256 || !Number.isInteger(initial) || initial < 0 || initial > size * size || !Number.isFinite(concentration) || concentration < 0 || concentration > 100 || !Number.isFinite(renewal) || renewal < 0 || renewal > 1 || !Number.isFinite(mutation) || mutation < 0 || mutation > 1) throw Error('Некоректні параметри світу');
    this.config = {seed, size, initial, concentration, renewal, mutation, zeroBonds};
    this.bonds = []; this.formed = 0; this.broken = 0;
    this.state = seed >>> 0; this.tick = 0; this.nextId = 1;
    this.births = 0; this.deaths = 0; this.mutations = 0;
    this.oldAgeDeaths = 0; this.starvationDeaths = 0;
    this.input = 0; this.outflow = 0; this.dissipated = 0; this.lastInput = 0; this.lastOutflow = 0;
    this.field = new Float64Array(size * size).fill(concentration);
    this.buffer = new Float64Array(size * size);
    // Fixed topology: resolve wraparound once, not four times per cell per tick.
    this.neighbors = new Int32Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const k = (y * size + x) * 4;
      this.neighbors[k] = y * size + (x ? x - 1 : size - 1);
      this.neighbors[k + 1] = y * size + (x + 1 === size ? 0 : x + 1);
      this.neighbors[k + 2] = (y ? y - 1 : size - 1) * size + x;
      this.neighbors[k + 3] = (y + 1 === size ? 0 : y + 1) * size + x;
    }
    this.agents = Array.from({length: initial}, () => this.makeAgent());
    this.initialEnergy = this.totalEnergy();
  }
  random() {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  wrap(x) { const n = this.config.size; return (x % n + n) % n; }
  index(x, y) { return Math.floor(this.wrap(y)) * this.config.size + Math.floor(this.wrap(x)); }
  makeAgent() {
    return {id: this.nextId++, parent: null, generation: 0, age: 0,
      x: this.random() * this.config.size, y: this.random() * this.config.size,
      angle: this.random() * Math.PI * 2, energy: 12,
      genes: [this.random(), this.random(), this.random(), this.config.zeroBonds ? 0 : this.random()*0.15, INITIAL_LIFESPAN]};
  }
  totalEnergy() { return this.field.reduce((a, b) => a + b, 0) + this.agents.reduce((a, b) => a + b.energy, 0); }
  step() {
    // Uniform exchange with an external nutrient reservoir. Depletion creates
    // local replenishment; surplus exits instead of accumulating indefinitely.
    this.lastInput = 0; this.lastOutflow = 0;
    for (let i = 0; i < this.field.length; i++) {
      const exchange = this.config.renewal * (this.config.concentration - this.field[i]);
      this.field[i] += exchange;
      if (exchange >= 0) this.lastInput += exchange; else this.lastOutflow -= exchange;
    }
    this.input += this.lastInput; this.outflow += this.lastOutflow;
    // Conservative diffusion on a torus, using a separate buffer.
    const field = this.field, neighbors = this.neighbors, buffer = this.buffer;
    for (let i = 0; i < field.length; i++) {
      const k = i * 4;
      buffer[i] = 0.84 * field[i] + 0.04 * (field[neighbors[k]] + field[neighbors[k+1]] + field[neighbors[k+2]] + field[neighbors[k+3]]);
    }
    [this.field, this.buffer] = [this.buffer, this.field];
    // Shuffle competition order so older IDs have no permanent priority.
    const order = this.agents.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const survivors = [], children = [];
    for (const a of order) {
      const g = a.genes;
      const dx = this.field[this.index(a.x+1,a.y)] - this.field[this.index(a.x-1,a.y)];
      const dy = this.field[this.index(a.x,a.y+1)] - this.field[this.index(a.x,a.y-1)];
      const desired = Math.atan2(dy, dx);
      const turn = Math.atan2(Math.sin(desired-a.angle), Math.cos(desired-a.angle));
      a.angle += turn * g[1] * Math.min(1, Math.hypot(dx,dy)) + (this.random()-0.5) * 0.6;
      const speed = 0.05 + g[0] * 0.8;
      a.x = this.wrap(a.x + Math.cos(a.angle)*speed); a.y = this.wrap(a.y + Math.sin(a.angle)*speed);
      const cell = this.index(a.x, a.y), food = Math.min(this.field[cell], 0.08 + 0.65*g[2]);
      this.field[cell] -= food; a.energy += food; a.age++;
      // Maintenance costs remain unchanged; the lifetime limit is inherited.
      const cost = 0.035 + 0.055*speed*speed + 0.025*g[1] + 0.035*g[2]*g[2];
      const paid = Math.min(a.energy, cost); a.energy -= paid; this.dissipated += paid;
      const oldAge = a.age >= g[LIFESPAN_GENE];
      if (oldAge || a.energy <= 0.5) {
        this.field[cell] += a.energy; this.deaths++;
        if (oldAge) this.oldAgeDeaths++; else this.starvationDeaths++;
        continue; // Expired individuals cannot divide on their final tick.
      }
      if (a.energy >= 26) {
        // No population cap and no fitness score: a real resource cost pays for division.
        const fee = 2; a.energy -= fee; this.dissipated += fee;
        const share = a.energy*0.5; a.energy -= share;
        const genes = g.map((value, i) => {
          if (this.random() >= this.config.mutation) return value;
          const delta = (this.random()-0.5)*0.2;
          // The existing +/-0.1 mutation step, expressed in units of 1000
          // ticks for lifetime. 1000 is the founder value, not a lifespan cap.
          const next = i === LIFESPAN_GENE
            ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value + delta * INITIAL_LIFESPAN)))
            : clamp(value + delta);
          if (next !== value) this.mutations++;
          return next;
        });
        const angle = this.random()*Math.PI*2, distance = 1;
        children.push({id:this.nextId++, parent:a.id, generation:a.generation+1, age:0, energy:share, genes,
          x:this.wrap(a.x+Math.cos(angle)*distance), y:this.wrap(a.y+Math.sin(angle)*distance), angle});
        this.births++;
      }
      survivors.push(a);
    }
    this.agents = survivors.concat(children); this.updateBonds(); this.tick++;
  }
  delta(x) { const n=this.config.size; return x-Math.round(x/n)*n; }
  updateBonds() {
    const byId=new Map(this.agents.map(a=>[a.id,a]));
    const kept=[];
    for(const bond of this.bonds){
      const a=byId.get(bond.a),b=byId.get(bond.b);
      if(!a||!b||Math.hypot(this.delta(b.x-a.x),this.delta(b.y-a.y))>3){this.broken++;continue;}
      kept.push(bond);
    }
    this.bonds=kept;
    const existing=new Set(kept.map(b=>`${b.a}:${b.b}`));
    // Spatial buckets limit contact searches to nearby cells, including wrapped edges.
    const bins=new Map(), size=this.config.size;
    for(const a of this.agents){const key=this.index(a.x,a.y);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(a);}
    for(const a of this.agents){
      const ax=Math.floor(a.x),ay=Math.floor(a.y);
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        let x=ax+dx,y=ay+dy;
        if(x<0)x+=size;else if(x>=size)x-=size;
        if(y<0)y+=size;else if(y>=size)y-=size;
        const nearby=bins.get(y*size+x);if(!nearby)continue;
        for(const b of nearby){
          if(a.id>=b.id||existing.has(`${a.id}:${b.id}`))continue;
          if(Math.hypot(this.delta(b.x-a.x),this.delta(b.y-a.y))>1.5)continue;
          if(this.random()<a.genes[3]*b.genes[3]){this.bonds.push({a:a.id,b:b.id});existing.add(`${a.id}:${b.id}`);this.formed++;}
        }
      }
    }
    // Simultaneous, degree-normalized spring motion avoids update-order bias.
    const degree=new Map(),moves=new Map();
    for(const b of this.bonds){degree.set(b.a,(degree.get(b.a)||0)+1);degree.set(b.b,(degree.get(b.b)||0)+1);}
    for(const bond of this.bonds){
      const a=byId.get(bond.a),b=byId.get(bond.b),dx=this.delta(b.x-a.x),dy=this.delta(b.y-a.y),d=Math.hypot(dx,dy);
      const force=d?0.3*(d-1)/d/Math.max(degree.get(a.id),degree.get(b.id)):0;
      for(const [agent,sign] of [[a,1],[b,-1]]){const m=moves.get(agent.id)||[0,0];m[0]+=sign*dx*force;m[1]+=sign*dy*force;moves.set(agent.id,m);}
    }
    for(const a of this.agents){const m=moves.get(a.id)||[0,0];a.x=this.wrap(a.x+m[0]);a.y=this.wrap(a.y+m[1]);}
  }
  observe() {
    const count = this.agents.length, means = GENES.map((_, i) => this.agents.reduce((s,a)=>s+a.genes[i],0)/(count || 1));
    // Normalize lifetime units so a value measured in ticks does not swamp
    // the four dimensionless traits in the diversity measurement.
    const diversity = Math.sqrt(this.agents.reduce((s,a)=>s+a.genes.reduce((v,g,i)=>v+((g-means[i])/(i===LIFESPAN_GENE?INITIAL_LIFESPAN:1))**2,0),0)/(GENES.length*(count || 1)));
    return {tick:this.tick, population:count, births:this.births, deaths:this.deaths, mutations:this.mutations,
      oldAgeDeaths:this.oldAgeDeaths, starvationDeaths:this.starvationDeaths,
      bonds:this.bonds.length, formed:this.formed, broken:this.broken,
      generation:this.agents.reduce((s,a)=>Math.max(s,a.generation),0), diversity, means,
      input:this.input, outflow:this.outflow, dissipated:this.dissipated, lastInput:this.lastInput, lastOutflow:this.lastOutflow,
      resource:this.field.reduce((s,v)=>s+v,0), balanceError:this.totalEnergy()+this.dissipated+this.outflow-this.initialEnergy-this.input};
  }
}
