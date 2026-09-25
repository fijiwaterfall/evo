import {parentPort} from 'node:worker_threads';
import {World} from './core.mjs';
let world=new World(),running=false,speed=5,history=[],lastRate=0;
function sample(){history.push(world.stats());if(history.length>400)history.shift();world.drainEvents();}
sample();
parentPort.on('message',m=>{
  try{let result={};
    if(m.type==='state')result={snapshot:world.snapshot(),selected:world.inspect(m.selected),history,running,speed,ticksPerSecond:lastRate};
    else if(m.type==='run'){running=Boolean(m.running);speed=Math.max(1,Math.min(100,Number(m.speed)||5));result={running,speed};}
    else if(m.type==='step'){running=false;world.advance(Math.max(1,Math.min(100,Number(m.ticks)||1)));sample();}
    else if(m.type==='reset'){const next=new World(m.config);world=next;running=false;history=[];sample();}
    else if(m.type==='checkpoint')result=world.checkpoint();
    else if(m.type==='restore'){const next=World.restore(m.checkpoint);world=next;running=false;history=[];sample();}
    else throw Error('Невідома команда');
    parentPort.postMessage({id:m.id,result});
  }catch(error){parentPort.postMessage({id:m.id,error:error.message});}
});
function loop(){if(running){const start=performance.now();let count=0;do{world.step();count++;if(world.tick%25===0)sample();}while(count<speed&&performance.now()-start<100);lastRate=count/Math.max(.001,(performance.now()-start)/1000);if(!world.entities.size)running=false;}
  setTimeout(loop,running?0:30);
}
loop();
