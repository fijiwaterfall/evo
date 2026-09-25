import {GENES, LIFESPAN_GENE} from './core.mjs';
const $ = id => document.getElementById(id);
const worker = new Worker(new URL('./worker.mjs', import.meta.url), {type:'module'});
const canvas=$('world'),ctx=canvas.getContext('2d'),chart=$('chart').getContext('2d');
const fieldCanvas=document.createElement('canvas'),fieldContext=fieldCanvas.getContext('2d');
let fieldImage,world=null,selected=null,nextId=0,pending=new Map();
let epoch=-1,running=true,requestInFlight=false,failed=false,renderPending=null,pollTimer;
GENES.forEach((name,i)=>{const row=document.createElement('div');row.className=i===LIFESPAN_GENE?'gene lifetime-gene':'gene';row.innerHTML=i===LIFESPAN_GENE?`<span>${name}</span><span id="value${i}"></span>`:`<span>${name}</span><span class="bar"><i id="bar${i}"></i></span><span id="value${i}"></span>`;$('genes').append(row);});
function command(type,data={}){
  return new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('Обчислення не відповідають. Спробуй перезавантажити сторінку.'));},15000);
    pending.set(id,{resolve,reject,timer});worker.postMessage({id,type,selected,...data});
  });
}
worker.onmessage=({data})=>{const callback=pending.get(data.id);if(!callback)return;pending.delete(data.id);clearTimeout(callback.timer);data.error?callback.reject(Error(data.error)):callback.resolve(data);};
worker.onerror=event=>{failed=true;$('error').textContent=`Не вдалося запустити обчислення: ${event.message}`;for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(Error(event.message));}pending.clear();};
function accept(snapshot){
  if(snapshot.epoch<epoch)return;
  epoch=snapshot.epoch;running=snapshot.running;
  if(snapshot.field){world=snapshot;if(Number($('fps').value))renderPending=snapshot;}
  const s=snapshot.stats;
  $('population').textContent=s.population;$('generation').textContent=s.generation;$('events').textContent=`${s.births} / ${s.deaths}`;$('tick').textContent=s.tick;
  $('pause').textContent=running?'Пауза':'Продовжити';
  $('status').textContent=!running?'Симуляція на паузі':!s.population?'Популяція вимерла · поле оновлюється':'Симуляція працює';
  $('performance').textContent=`Розрахунок: ${snapshot.actualRate.toFixed(0)} кроків/с · графіка: ${Number($('fps').value)?`до ${$('fps').value} кадрів/с`:'вимкнена'}`;
  $('worldSize').textContent=`${snapshot.config.size} × ${snapshot.config.size} · замкнені краї`;
  $('bondStats').textContent=`Зв’язків: ${s.bonds} · утворено: ${s.formed} · розірвано: ${s.broken}`;
  const a=snapshot.selected;
  $('selection').textContent=a?`Істота #${a.id} · покоління ${a.generation} · вік ${a.age} / ${a.genes[LIFESPAN_GENE]} кроків · енергія ${a.energy.toFixed(1)} · предок ${a.parent??'—'}`:selected?'Обрана істота померла. Показано середній геном.':'Середній геном популяції. Натисни на істоту, щоб дослідити її.';
  (a?.genes??s.means).forEach((v,i)=>{if(i===LIFESPAN_GENE){$(`value${i}`).textContent=`${Math.round(v)} кроків`;}else{$(`bar${i}`).style.width=`${v*100}%`;$(`value${i}`).textContent=v.toFixed(2);}});
  $('mortality').textContent=`Смерті: від старості ${s.oldAgeDeaths} · від виснаження ${s.starvationDeaths}`;
  $('details').textContent=`Різноманітність: ${s.diversity.toFixed(3)} · мутацій: ${s.mutations}. УМП: ${s.resource.toFixed(1)}. Похибка балансу: ${s.balanceError.toExponential(1)}.`;
  $('budget').textContent=`Приплив / відтік за крок: ${s.lastInput.toFixed(2)} / ${s.lastOutflow.toFixed(2)}. Усього надійшло ${s.input.toFixed(1)}, вийшло ${s.outflow.toFixed(1)}, розсіяно ${s.dissipated.toFixed(1)}.`;
  const history=snapshot.history,max=Math.max(1,...history.map(h=>h.population));
  chart.clearRect(0,0,480,140);chart.strokeStyle='#bbd590';chart.lineWidth=2;chart.beginPath();
  history.forEach((h,i)=>{const x=10+i/Math.max(1,history.length-1)*460,y=115-h.population/max*100;i?chart.lineTo(x,y):chart.moveTo(x,y);});
  chart.stroke();chart.fillStyle='#91a69a';chart.font='11px system-ui';chart.fillText(`0 — ${max} істот · кроки ${history[0]?.tick??0}–${history.at(-1)?.tick??0}`,10,136);
}
function draw(snapshot){
  const n=snapshot.config.size,scale=canvas.width/n,delta=x=>x-Math.round(x/n)*n;
  if(fieldCanvas.width!==n){fieldCanvas.width=n;fieldCanvas.height=n;fieldImage=fieldContext.createImageData(n,n);}
  const pixels=fieldImage.data;
  for(let i=0;i<snapshot.field.length;i++){const t=Math.min(1,snapshot.field[i]/5);pixels[i*4]=10+56*t;pixels[i*4+1]=25+93*t;pixels[i*4+2]=18+62*t;pixels[i*4+3]=255;}
  fieldContext.putImageData(fieldImage,0,0);ctx.imageSmoothingEnabled=false;ctx.drawImage(fieldCanvas,0,0,canvas.width,canvas.height);
  const byId=new Map(snapshot.agents.map(a=>[a.id,a]));
  ctx.strokeStyle='#9ecdad';ctx.lineWidth=1.25;ctx.beginPath();
  for(const bond of snapshot.bonds){const a=byId.get(bond.a),b=byId.get(bond.b);if(!a||!b)continue;const dx=delta(b.x-a.x),dy=delta(b.y-a.y);
    for(const ox of [-n,0,n])for(const oy of [-n,0,n]){const x=(a.x+ox)*scale,y=(a.y+oy)*scale;ctx.moveTo(x,y);ctx.lineTo(x+dx*scale,y+dy*scale);}}
  ctx.stroke();
  for(const a of snapshot.agents){ctx.beginPath();ctx.arc(a.x*scale,a.y*scale,Math.max(1.1,(2.3+Math.min(2,a.energy/18))*Math.sqrt(64/n)),0,Math.PI*2);ctx.fillStyle=`hsl(${35+a.genes[0]*220} 65% 75%)`;ctx.fill();if(a.id===selected){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(a.x*scale,a.y*scale,8,0,Math.PI*2);ctx.stroke();}}
}
async function poll(){
  clearTimeout(pollTimer);if(failed||requestInFlight)return;requestInFlight=true;
  try{accept(await command('snapshot',{includeWorld:Number($('fps').value)>0}));}catch(e){$('error').textContent=e.message;}
  finally{requestInFlight=false;pollTimer=setTimeout(poll,Number($('fps').value)?1000/Number($('fps').value):250);}
}
function frame(){if(renderPending&&Number($('fps').value)){draw(renderPending);renderPending=null;}requestAnimationFrame(frame);}
async function perform(type,data){try{const result=await command(type,data);accept(result);$('error').textContent='';return result;}catch(e){$('error').textContent=e.message;return null;}}
$('pause').onclick=()=>perform('running',{value:!running});$('step').onclick=()=>perform('step');
$('speed').onchange=()=>perform('rate',{value:Number($('speed').value)});
$('fps').onchange=()=>{renderPending=null;$('viewStatus').textContent=Number($('fps').value)?'':'Промальовування вимкнене. На полотні останній кадр; обчислення тривають.';poll();};
function updateScaleHint(){const size=Number($('size').value);$('scaleHint').textContent=`Початково ${Math.round(100*(size/64)**2)} істот. Площа ×${(size/64)**2}; початкова щільність незмінна.`;}
$('size').onchange=updateScaleHint;
$('reset').onclick=async()=>{
  if(!['seed','concentration','renewal'].every(id=>$(id).checkValidity()&&$(id).value!=='')){$('error').textContent='Перевір параметри експерименту.';return;}
  const size=Number($('size').value),result=await perform('reset',{config:{seed:Number($('seed').value),size,concentration:Number($('concentration').value),renewal:Number($('renewal').value)/100,mutation:Number($('mutation').value),zeroBonds:$('bondStart').value==='zero'}});
  if(result){selected=null;world=null;renderPending=null;ctx.clearRect(0,0,canvas.width,canvas.height);poll();}
};
$('clear').onclick=()=>{selected=null;poll();};
canvas.onclick=e=>{if(!world||!Number($('fps').value))return;const rect=canvas.getBoundingClientRect(),n=world.config.size,x=(e.clientX-rect.left)/rect.width*n,y=(e.clientY-rect.top)/rect.height*n;let nearest=null,best=10/rect.width*n;for(const a of world.agents){const d=Math.hypot(a.x-x,a.y-y);if(d<best){nearest=a.id;best=d;}}selected=nearest;poll();};
$('export').onclick=async()=>{const snapshot=await perform('export');if(!snapshot)return;const blob=new Blob([JSON.stringify({version:3,config:snapshot.config,current:snapshot.stats,history:snapshot.history},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`evo-seed-${snapshot.config.seed}-tick-${snapshot.stats.tick}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
updateScaleHint();poll();requestAnimationFrame(frame);
