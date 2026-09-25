import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import path from 'node:path';
import {World,VERSION} from './core.mjs';
export function runExperiment({config={},ticks=1000,out,sampleEvery=100,checkpointEvery=1000,checkpoint=null,onProgress=()=>{}}){
  const world=checkpoint?World.restore(checkpoint):new World(config),start=performance.now(),frames=[],startTick=world.tick;
  if(out)mkdirSync(out,{recursive:true});
  const write=(name,value)=>{if(out)writeFileSync(path.join(out,name),JSON.stringify(value));};
  if(out)writeFileSync(path.join(out,'events.jsonl'),'');
  write('config.json',{version:VERSION,...world.config,startTick,ticks,sampleEvery,checkpointEvery});
  function sample(){const frame=world.snapshot();delete frame.genomes;frame.details=[...world.entities.values()].map(e=>({id:e.id,parentId:e.parentId,genomeId:e.genomeId,generation:e.generation,energy:e.energy,age:e.age,signal:e.signal,counts:[...e.counts],reactionCounts:[...e.reactionCounts],lastReaction:e.lastReaction}));frames.push(frame);}
  sample();
  for(let i=1;i<=ticks;i++){
    world.step();
    if(i%sampleEvery===0||i===ticks){sample();onProgress({seed:world.config.seed,tick:world.tick,population:world.entities.size});}
    if(i%25===0||i===ticks){const events=world.drainEvents();if(out&&events.length)appendFileSync(path.join(out,'events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n')+'\n');}
    if(checkpointEvery>0 && i%checkpointEvery===0)write('checkpoint.json',world.checkpoint());
  }
  const seconds=(performance.now()-start)/1000,summary={...world.stats(),seed:world.config.seed,startTick,simulatedTicks:ticks,seconds,ticksPerSecond:ticks/seconds};
  const finalCheckpoint=world.checkpoint();write('checkpoint.json',finalCheckpoint);write('summary.json',summary);
  write('recording.json',{kind:'reaction-recording',version:VERSION,config:world.config,genomes:[...world.genomes.entries()],frames});
  return {summary,checkpoint:finalCheckpoint,frames};
}
