import {Worker} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return i<0?[a.replace(/^--/,''),true]:[a.slice(2,i),a.slice(i+1)];}));
if(args.help){console.log('node cli.mjs --seeds=1..4 --pop=2000 --ticks=3000 --workers=2 --out=runs/example --sampleEvery=100 --checkpointEvery=1000\nnode cli.mjs --resume=runs/example/seed-1/checkpoint.json --ticks=1000 --out=runs/continued\nOptional: --dt=0.1 --mutation=0 --source=0.75\nКонтролі v6: --crossFlow=0 (без комутатора) --bondUpkeep=0 (без плати за ребра)');process.exit(0);}
const integer=(key,def,min=1)=>{const n=Number(args[key]??def);if(!Number.isInteger(n)||n<min)throw Error(`Некоректне --${key}`);return n;};
const spec=String(args.seeds??args.seed??1);let seeds;
if(spec.includes('..')){const [a,b]=spec.split('..').map(Number);if(!Number.isInteger(a)||!Number.isInteger(b)||b<a||b-a>1000)throw Error('Некоректний діапазон seed');seeds=Array.from({length:b-a+1},(_,i)=>a+i);}else seeds=spec.split(',').map(Number);
if(!seeds.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff)||new Set(seeds).size!==seeds.length)throw Error('Seed мають бути унікальними uint32');
const ticks=integer('ticks',1000),workers=Math.min(seeds.length,integer('workers',Math.max(1,Math.min(4,availableParallelism()-1))));
const base=path.resolve(args.out||`runs/run-${new Date().toISOString().replace(/[:.]/g,'-')}`);mkdirSync(base,{recursive:true});
const checkpoint=args.resume?JSON.parse(readFileSync(args.resume,'utf8')):null;if(checkpoint&&seeds.length!==1)throw Error('Resume відновлює один світ');
const cfg={pop:integer('pop',2000,0)};for(const k of ['dt','mutation','source','crossFlow','bondUpkeep','flow','labels','maxPairs'])if(args[k]!==undefined)cfg[k]=Number(args[k]);
let next=0;const summaries=[];
async function slot(){while(next<seeds.length){const seed=seeds[next++],out=path.join(base,`seed-${checkpoint?.config.seed??seed}`);
  const summary=await new Promise((resolve,reject)=>{const worker=new Worker(new URL('./batch-worker.mjs',import.meta.url),{workerData:{config:{...cfg,seed},checkpoint,ticks,out,sampleEvery:integer('sampleEvery',100),checkpointEvery:integer('checkpointEvery',1000,0)}});let done=false;
    worker.on('message',m=>{if(m.type==='progress')console.log(`seed=${m.seed} tick=${m.tick} population=${m.population}`);else if(m.type==='done'){done=true;resolve(m.summary);}else if(m.type==='error')reject(Error(m.error));});worker.on('error',reject);worker.on('exit',code=>{if(code!==0||!done)reject(Error(`Worker завершився з кодом ${code}`));});
  });summaries.push(summary);console.log(`DONE seed=${summary.seed} generations=${summary.maxGeneration} births=${summary.births} ticks/s=${summary.ticksPerSecond.toFixed(1)}`);
}}
await Promise.all(Array.from({length:workers},slot));summaries.sort((a,b)=>a.seed-b.seed);
writeFileSync(path.join(base,'summary.json'),JSON.stringify({workers,summaries},null,2));console.log(`Збережено: ${base}`);
