import {World} from './core.mjs';

// State and measurements are tied to simulation ticks, never to drawing frequency.
export class Runner {
  constructor(config = {}) { this.reset(config); }
  reset(config) {
    const next = new World(config); // Validate before replacing a running world.
    this.world = next;
    this.history = [next.observe()];
  }
  advance(steps = 1) {
    for (let i = 0; i < steps; i++) {
      this.world.step();
      if (this.world.tick % 10 === 0) {
        this.history.push(this.world.observe());
        if (this.history.length > 300) this.history.shift();
      }
    }
  }
  snapshot(includeWorld = true, selected = null) {
    const w = this.world;
    const result = {
      config: {...w.config}, stats: w.observe(), history: this.history.slice(),
      selected: structuredClone(w.agents.find(a => a.id === selected) ?? null),
    };
    if (includeWorld) {
      // Copies only. Precision reduction is for pixels, not the simulation.
      result.field = Float32Array.from(w.field);
      result.agents = structuredClone(w.agents);
      result.bonds = structuredClone(w.bonds);
    }
    return result;
  }
}
