import {Runner} from './runner.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const ticks=Number(args.ticks??2000),size=Number(args.size??64),seed=Number(args.seed??1);
if(!Number.isInteger(ticks)||ticks<0||ticks>1000000)throw Error('ticks must be 0..1000000');
const runner=new Runner({size,seed}),start=performance.now();runner.advance(ticks);
console.log(JSON.stringify({config:runner.world.config,elapsedSeconds:(performance.now()-start)/1000,stepsPerSecond:ticks/((performance.now()-start)/1000),...runner.world.observe()},null,2));
