const $=id=>document.getElementById(id),fmt=n=>new Intl.NumberFormat('uk-UA',{maximumFractionDigits:1}).format(n);
let state=null,selected=null,recording=null,recordIndex=0,busy=false;
const worldCanvas=$('world'),ctx=worldCanvas.getContext('2d'),graph=$('network'),gc=graph.getContext('2d'),chart=$('chart'),cc=chart.getContext('2d');
const names={none:'Внутрішня реакція',copy:'Копіювання',impulse:'Імпульс',bind:'Зв’язування',unbind:'Від’єднання',signal:'Сигнал'};
const inputs={none:'без умови',energy:'енергія',contact:'контакт',strain:'навантаження',signal:'сигнал'};
const LABELS='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function error(e){$('error').textContent=e.message||String(e);$('error').hidden=false;setTimeout(()=>$('error').hidden=true,7000);}
async function api(path,body){const res=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await res.json();if(!res.ok)throw Error(data.error||'Помилка сервера');return data;}
async function command(type,props={}){await api('/api/control',{type,...props});await refresh();}
function size(canvas){const r=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);return [r.width,r.height];}
function color(p){switch($('layer').value){case 'genome':return `hsl(${(p[5]*137.5)%360} 65% 68%)`;case 'generation':return `hsl(${150-Math.min(130,p[4]*9)} 75% 66%)`;case 'signal':return `hsl(38 85% ${25+Math.min(55,p[6]*25)}%)`;default:return `hsl(158 65% ${23+Math.min(59,p[3]*5)}%)`;}}
function drawWorld(){if(!state)return;const s=state.snapshot,[w,h]=size(worldCanvas),scale=Math.min(w/s.config.width,h/s.config.height),ox=(w-s.config.width*scale)/2,oy=(h-s.config.height*scale)/2;
  ctx.fillStyle='#081117';ctx.fillRect(0,0,w,h);ctx.save();ctx.translate(ox,oy);ctx.scale(scale,scale);
  const cw=s.config.cellSize,ch=cw;for(let y=0;y<s.rows;y++)for(let x=0;x<s.cols;x++){const e=s.field[y*s.cols+x];ctx.fillStyle=`rgba(70,140,117,${Math.min(.22,e*.025)})`;ctx.fillRect(x*cw,y*ch,Math.min(cw,s.config.width-x*cw),Math.min(ch,s.config.height-y*ch));}
  const byId=new Map(s.particles.map(p=>[p[0],p]));
  for(const b of s.bonds){const a=byId.get(b[1]),e=byId.get(b[2]);if(!a||!e)continue;let dx=e[1]-a[1],dy=e[2]-a[2];dx-=Math.round(dx/s.config.width)*s.config.width;dy-=Math.round(dy/s.config.height)*s.config.height;
    ctx.strokeStyle=selected===a[0]||selected===e[0]?'#e8c183':'#426d69';ctx.lineWidth=1/scale;for(const tx of [-s.config.width,0,s.config.width])for(const ty of [-s.config.height,0,s.config.height]){ctx.beginPath();ctx.moveTo(a[1]+tx,a[2]+ty);ctx.lineTo(a[1]+dx+tx,a[2]+dy+ty);ctx.stroke();}}
  for(const p of s.particles){ctx.beginPath();ctx.arc(p[1],p[2],Math.max(s.config.radius,1.6/scale),0,Math.PI*2);ctx.fillStyle=color(p);ctx.fill();if(p[0]===selected){ctx.strokeStyle='#ffe1a9';ctx.lineWidth=1.5/scale;ctx.beginPath();ctx.arc(p[1],p[2],s.config.radius+5/scale,0,Math.PI*2);ctx.stroke();}}
  ctx.restore();worldCanvas._projection={scale,ox,oy};
}
function drawNetwork(e){const [w,h]=size(graph);gc.clearRect(0,0,w,h);const g=e.genome,radius=Math.min(w,h)*.31,points=Array.from({length:g.states},(_,i)=>{const a=i/g.states*2*Math.PI-Math.PI/2;return [w/2+Math.cos(a)*radius,h/2+Math.sin(a)*radius];});
  for(let i=0;i<g.reactions.length;i++){const r=g.reactions[i],[x,y]=points[r.source],[tx,ty]=points[r.target];gc.strokeStyle=i===e.lastReaction?'#67e2bc':'#46656b';gc.lineWidth=i===e.lastReaction?2:1;gc.beginPath();if(r.source===r.target){gc.arc(x+12,y-13,15,0,Math.PI*1.7);}else{const dx=tx-x,dy=ty-y,n=Math.hypot(dx,dy),bend=(i%3-1)*22,mx=(x+tx)/2-dy/n*bend,my=(y+ty)/2+dx/n*bend;gc.moveTo(x,y);gc.quadraticCurveTo(mx,my,tx,ty);const angle=Math.atan2(ty-my,tx-mx),ax=tx-Math.cos(angle)*17,ay=ty-Math.sin(angle)*17;gc.moveTo(ax-Math.cos(angle-.5)*7,ay-Math.sin(angle-.5)*7);gc.lineTo(ax,ay);gc.lineTo(ax-Math.cos(angle+.5)*7,ay-Math.sin(angle+.5)*7);}gc.stroke();}
  // Вузол підписаний номером стану, під ним носії, а праворуч публічна мітка.
  // Літера є міткою, а не станом: стани локальні для геному, мітки спільні.
  points.forEach(([x,y],i)=>{const count=e.counts?.[i]??0,r=13+Math.sqrt(count);gc.fillStyle='#153c35';gc.strokeStyle='#67e2bc';gc.lineWidth=1;gc.beginPath();gc.arc(x,y,r,0,Math.PI*2);gc.fill();gc.stroke();gc.textAlign='center';gc.fillStyle='#e2ebe9';gc.font='14px Segoe UI';gc.fillText(String(i),x,y+4);gc.fillStyle='#9dafb5';gc.font='12px Consolas';gc.fillText(String(count),x,y+r+15);
    const label=g.display?.[i];if(label!==undefined){gc.fillStyle='#e8c183';gc.font='bold 12px Consolas';gc.fillText(LABELS[label]??'?',x+r+8,y+4);}});
}
function inspector(){const e=state?.selected;$('emptyInspector').hidden=!!e;$('entityContent').hidden=!e;
  $('entityTitle').textContent=e?`Частинка #${e.id}`:selected?'Частинка вже зникла':'Обери частинку';if(!e)return;
  $('entityStats').innerHTML=[['Енергія',fmt(e.energy)],['Покоління',e.generation],['Геном',`#${e.genomeId}`],['Батько',e.parentId?`#${e.parentId}`:'засновник'],['Вік',fmt(e.age)],['Сигнал',fmt(e.signal)]].map(([k,v])=>`<span>${k}<b>${v}</b></span>`).join('');
  drawNetwork(e);$('reactions').replaceChildren();e.genome.reactions.forEach((r,i)=>{const el=document.createElement('div');el.className='reaction'+(e.lastReaction===i?' active':'');const b=document.createElement('b');b.textContent=`${r.source} → ${r.target} · ${names[r.action]}`;const count=document.createElement('span');count.className='count';count.textContent=`${e.reactionCounts?.[i]??'—'}×`;const note=document.createElement('small');note.textContent=`k=${r.rate.toFixed(2)} · ${inputs[r.input]}${r.catalyst!==null?` · каталізатор ${r.catalyst}`:''}`;el.append(b,count,note);$('reactions').append(el);});
}
function drawChart(){const [w,h]=size(chart),data=state?.history||[];cc.clearRect(0,0,w,h);if(!data.length)return;const max=Math.max(1,...data.map(d=>d.population)),min=0,pad=25;cc.font='12px Consolas';cc.textAlign='left';cc.fillStyle='#9dafb5';cc.fillText(fmt(max),10,14);cc.fillText('0',10,h-9);cc.strokeStyle='#263842';cc.beginPath();cc.moveTo(pad,h-pad);cc.lineTo(w-pad,h-pad);cc.stroke();const points=data.map((d,i)=>[pad+i/Math.max(1,data.length-1)*(w-2*pad),h-pad-(d.population-min)/(max-min)*(h-2*pad)]);cc.beginPath();cc.moveTo(points[0][0],h-pad);for(const [x,y] of points)cc.lineTo(x,y);cc.lineTo(points.at(-1)[0],h-pad);cc.fillStyle='#67e2bc13';cc.fill();cc.beginPath();points.forEach(([x,y],i)=>i?cc.lineTo(x,y):cc.moveTo(x,y));cc.strokeStyle='#67e2bc';cc.lineWidth=1.7;cc.stroke();$('trendRange').textContent=`${fmt(data[0].time)} — ${fmt(data.at(-1).time)}`;}
function render(){if(!state)return;const s=state.snapshot.stats;for(const [id,key] of [['population','population'],['births','births'],['generation','maxGeneration'],['genomes','genomes'],['bonds','bonds'],['time','time']])$(id).textContent=fmt(s[key]);
  $('status').textContent=recording?'Перегляд запису':state.running?'Симуляція працює':'Пауза';$('lamp').classList.toggle('active',state.running&&!recording);$('play').textContent=state.running?'Ⅱ Пауза':'▶ Запустити';$('play').disabled=!!recording;$('step').disabled=!!recording;
  $('tick').textContent=`Крок ${fmt(s.tick)}`;$('rate').textContent=recording?'Збережений кадр':`${fmt(state.ticksPerSecond||0)} кроків/с`;
  $('diagnostic').textContent=`Похибка обліку: ${s.energyResidual.toExponential(1)} · ліміти ${s.eventLimit+s.genomeLimit+s.populationLimit+s.pairLimit}`;
  $('routing').textContent=`Провідність ${fmt(s.meanConductance)} · закритих ребер ${fmt(s.closedBonds*100)}% · комутатор ${fmt(s.meanCross)} · транзит ${fmt(s.transit.cross/Math.max(1e-9,s.transit.edge+s.transit.cross)*100)}% · розкид у комплексі ${fmt(s.componentSpread)}`;
  drawWorld();inspector();drawChart();
}
async function refresh(){if(busy||recording)return;busy=true;try{state=await api(`/api/state?selected=${selected||0}`);render();}catch(e){error(e);}finally{busy=false;}}
function playback(){const frame=recording.frames[recordIndex];state={snapshot:{...frame,genomes:recording.genomes},history:recording.frames.slice(0,recordIndex+1).map(f=>f.stats),running:false,selected:null};
  if(selected){const p=frame.particles.find(p=>p[0]===selected),detail=frame.details?.find(d=>d.id===selected);if(p&&detail)state.selected={...detail,genome:new Map(recording.genomes).get(p[5])};}render();}
worldCanvas.addEventListener('click',async ev=>{if(!state)return;const r=worldCanvas.getBoundingClientRect(),{scale,ox,oy}=worldCanvas._projection,x=(ev.clientX-r.left-ox)/scale,y=(ev.clientY-r.top-oy)/scale;let dist=12/scale,best=null;for(const p of state.snapshot.particles){const d=Math.hypot(p[1]-x,p[2]-y);if(d<dist){dist=d;best=p[0];}}if(best){selected=best;recording?playback():await refresh();}});
$('pick').onclick=()=>{if(!state?.snapshot.particles.length)return;selected=state.snapshot.particles[0][0];recording?playback():refresh();};
$('play').onclick=()=>command('run',{running:!state?.running,speed:Number($('speed').value)}).catch(error);
$('step').onclick=()=>command('step',{ticks:1}).catch(error);
$('speed').onchange=()=>{if(!recording)command('run',{running:!!state?.running,speed:Number($('speed').value)}).catch(error);};
$('reset').onclick=async()=>{try{recording=null;$('timelineBox').hidden=true;selected=null;await command('reset',{config:{seed:Number($('seed').value),pop:Number($('pop').value)}});}catch(e){error(e);}};
$('layer').onchange=()=>{$('legend').textContent={energy:'Темний → світлий: менше → більше енергії',genome:'Однаковий колір — однакова будова мережі',generation:'Зелений → теплий: глибина родоводу',signal:'Яскравість — сила отриманого сигналу'}[$('layer').value];drawWorld();};
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('save').onclick=async()=>{try{download('reaction-checkpoint.json',await api('/api/checkpoint'));}catch(e){error(e);}};
$('load').onchange=async ev=>{try{const file=ev.target.files[0];if(!file)return;const data=JSON.parse(await file.text());await command('run',{running:false});
    if(data.kind==='reaction-recording'&&Array.isArray(data.frames)&&data.frames.length){recording=data;recordIndex=0;selected=null;$('timelineBox').hidden=false;$('timeline').max=data.frames.length-1;$('timeline').value=0;playback();}
    else {recording=null;$('timelineBox').hidden=true;await command('restore',{checkpoint:data});}
  }catch(e){error(e);}finally{ev.target.value='';}};
$('timeline').oninput=()=>{recordIndex=Number($('timeline').value);playback();};$('live').onclick=()=>{recording=null;selected=null;$('timelineBox').hidden=true;refresh();};
new ResizeObserver(()=>{if(state)render();}).observe(document.querySelector('.workspace'));
await refresh();setInterval(refresh,500);
