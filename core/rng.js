'use strict';
/* =========================================================================
   Seeded deterministic PRNG (mulberry32). Explicit, serializable state
   (a single uint32) so it can be checkpointed and restored exactly —
   unlike a closure-based generator whose internal state is opaque.

   Тіло загорнуте в IIFE: у браузері обидва core-файли підключаються як
   класичні <script> і ділять одну глобальну лексичну область, тож
   верхньорівневий `class RNG` тут конфліктував би з `const RNG` у
   simulation-core.js.
   ========================================================================= */

(function(){

class RNG {
  constructor(seed){
    this.state = (seed >>> 0) || 1; // avoid a zero state (degenerates the generator)
  }

  // Uniform float in [0,1) — drop-in replacement for Math.random() call sites.
  random(){
    this.state = (this.state + 0x6D2B79F5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  getState(){ return this.state; }
  setState(s){ this.state = s >>> 0; }
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = { RNG };
} else if(typeof window !== 'undefined'){
  window.EvoRNG = { RNG };
}

})();
