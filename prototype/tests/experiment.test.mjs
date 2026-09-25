import test from 'node:test';
import assert from 'node:assert/strict';
import {runExperiment} from '../experiment.mjs';
import {World} from '../core.mjs';
test('recording samples do not affect physics; resume preserves genealogy and genomes',()=>{
  const a=runExperiment({config:{pop:35,seed:7},ticks:100,sampleEvery:10,checkpointEvery:0});
  const b=runExperiment({config:{pop:35,seed:7},ticks:100,sampleEvery:33,checkpointEvery:0});
  assert.deepEqual(a.checkpoint,b.checkpoint);assert.equal(a.frames.length,11);
  const c=runExperiment({checkpoint:JSON.parse(JSON.stringify(a.checkpoint)),ticks:50,sampleEvery:50,checkpointEvery:0});
  const continuous=new World({pop:35,seed:7});continuous.advance(150);assert.deepEqual(c.checkpoint,continuous.checkpoint());
  assert.ok(a.frames[0].details.length===35);assert.ok(a.frames.at(-1).stats.births>0);
});
