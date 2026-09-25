// Reference engine. No DOM, clock, filesystem or observer feedback.
export const VERSION = 'reaction-lab-0.2';
export const ACTIONS = ['none','impulse','bind','unbind','signal','copy'];
export const INPUTS = ['none','energy','contact','strain','signal'];
export const DEFAULTS = Object.freeze({seed:1,pop:2000,width:480,height:320,dt:0.2,
  radius:1.6,cellSize:12,source:1.5,fieldDecay:0.08,diffusion:0.12,uptake:0.48,
  leakage:0.012,drag:0.15,spring:0.7,flow:0.16,signalDecay:1,
  reactionCost:0.015,impulse:0.16,actionCost:0.025,bondCost:0.06,halfEnergy:4,
  childEnergy:3,copyBase:2,copyPerState:0.12,copyPerReaction:0.08,
  carriers:32,mutation:0.12,maxStates:32,maxReactions:128,maxPopulation:8000,
  maxEvents:128,logEvents:true,
  // Старіння і дохід підібрані разом, бо поодинці обидва провалюються: саме
  // старіння вбиває раніше за перше розмноження, сам дохід упирається в стелю
  // популяції й зупиняє покоління. Разом дають справжній обіг: медіанний вік
  // падає з 198 до 78 при часі світу 240, а частка засновника з 80% до 43%.
  labels:3,crossFlow:0.12,bondUpkeep:0.01,maxPairs:64,agingCost:0.003});
export const LABEL_NAMES='ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class RNG {
  constructor(seed){this.state=seed>>>0;}
  next(){let t=this.state=(this.state+0x6D2B79F5)>>>0;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}
  int(n){return Math.floor(this.next()*n);}
}
export const wrap=(x,w)=>((x%w)+w)%w;
export const delta=(x,w)=>wrap(x+w/2,w)-w/2;
const clone=x=>structuredClone(x);
const square=(n,v)=>Array.from({length:n},()=>new Array(n).fill(v));
// Засновник нейтральний: повна провідність по ребрах і нульове маршрутизування,
// тобто рівно поведінка v5. Будь-яка структура має бути результатом мутацій.
export function founderGenome(labels=DEFAULTS.labels){return {states:2,
  display:[0,1%labels],affinity:square(labels,1),cross:square(labels,0),reactions:[
  {source:0,target:1,rate:2,catalyst:null,input:'none',action:'copy',direction:0},
  // Цикл мусить обертатися незалежно від енергії. Поки єдиний перехід 0→1
  // належав копіюванню, а воно не по кишені, носії лишались у стані 0 назавжди:
  // 92% частинок стояли з розподілом [32,0], і чотири з шести реакцій були
  // недосяжні. Ця дешева ланка і є те, що робить мережу мережею.
  {source:0,target:1,rate:1.5,catalyst:null,input:'none',action:'none',direction:0},
  {source:1,target:0,rate:2,catalyst:null,input:'none',action:'none',direction:0},
  {source:0,target:0,rate:0.5,catalyst:null,input:'none',action:'impulse',direction:0},
  {source:0,target:0,rate:0.25,catalyst:null,input:'contact',action:'bind',direction:0},
  {source:1,target:1,rate:0.25,catalyst:null,input:'energy',action:'signal',direction:0},
  {source:1,target:1,rate:0.06,catalyst:null,input:'strain',action:'unbind',direction:0}
]};}
export function validateGenome(g,cfg=DEFAULTS){
  if(!g || !Number.isInteger(g.states)||g.states<1||g.states>cfg.maxStates||!Array.isArray(g.reactions)||g.reactions.length>cfg.maxReactions) throw Error('Некоректна будова геному');
  const L=cfg.labels;
  if(!Array.isArray(g.display)||g.display.length!==g.states) throw Error('Некоректний список міток');
  for(const l of g.display) if(!Number.isInteger(l)||l<0||l>=L) throw Error('Некоректна мітка стану');
  for(const name of ['affinity','cross']){const m=g[name];
    if(!Array.isArray(m)||m.length!==L) throw Error(`Некоректний розмір ${name}`);
    for(const row of m){if(!Array.isArray(row)||row.length!==L) throw Error(`Некоректний розмір ${name}`);
      for(const v of row) if(!Number.isFinite(v)||v<0||v>1) throw Error(`Некоректне значення ${name}`);}}
  // cross має лишатись симетричною, інакше перенос залежав би від порядку обходу.
  for(let l=0;l<L;l++)for(let m=l+1;m<L;m++) if(g.cross[l][m]!==g.cross[m][l]) throw Error('cross несиметрична');
  for(const r of g.reactions){
    for(const n of [r.source,r.target,...(r.catalyst===null?[]:[r.catalyst])]) if(!Number.isInteger(n)||n<0||n>=g.states) throw Error('Некоректний індекс стану');
    if(!ACTIONS.includes(r.action)||!INPUTS.includes(r.input)||!Number.isFinite(r.rate)||r.rate<=0||r.rate>8||!Number.isFinite(r.direction)) throw Error('Некоректна реакція');
  }
}
export function mutateGenome(original,rng,cfg){
  const g=clone(original);let operation='none',limited=false;
  if(rng.next()>=cfg.mutation) return {genome:g,operation,limited};
  const choice=rng.int(9), rs=g.reactions, L=cfg.labels;
  const nudge=v=>Math.max(0,Math.min(1,v+(rng.next()*2-1)*0.35));
  const randomReaction=()=>({source:rng.int(g.states),target:rng.int(g.states),rate:0.2+rng.next()*2,
    catalyst:rng.next()<0.5?null:rng.int(g.states),input:INPUTS[rng.int(INPUTS.length)],action:ACTIONS[rng.int(ACTIONS.length)],direction:(rng.next()*2-1)*Math.PI});
  if(choice===0 && rs.length){
    const r=rs[rng.int(rs.length)];operation='parameter';
    switch(rng.int(7)){
      case 0:r.rate=Math.max(0.02,Math.min(8,r.rate*Math.exp((rng.next()-.5)*1.2)));break;
      case 1:r.source=rng.int(g.states);break;case 2:r.target=rng.int(g.states);break;
      case 3:r.catalyst=rng.next()<.4?null:rng.int(g.states);break;
      case 4:r.input=INPUTS[rng.int(INPUTS.length)];break;
      case 5:r.action=ACTIONS[rng.int(ACTIONS.length)];break;
      case 6:r.direction=(rng.next()*2-1)*Math.PI;break;
    }
  } else if(choice===1 || !rs.length){operation='add-reaction';if(rs.length<cfg.maxReactions)rs.push(randomReaction());else limited=true;
  } else if(choice===2){operation='delete-reaction';rs.splice(rng.int(rs.length),1);
  } else if(choice===3){operation='add-state';if(g.states<cfg.maxStates && rs.length+2<=cfg.maxReactions){
    const old=rng.int(g.states),n=g.states++;g.display.push(rng.int(L));
    rs.push({...randomReaction(),source:old,target:n},{...randomReaction(),source:n,target:old});
  }else limited=true;
  } else if(choice===4){operation='delete-state';if(g.states>1){const n=1+rng.int(g.states-1);g.states--;g.display.splice(n,1);
    for(const r of rs)for(const key of ['source','target','catalyst'])if(r[key]!==null)r[key]=r[key]===n?0:r[key]>n?r[key]-1:r[key];
  }else limited=true;
  } else if(choice===5){operation='duplicate-reaction';if(rs.length<cfg.maxReactions)rs.push(clone(rs[rng.int(rs.length)]));else limited=true;
  } else if(choice===6){operation='label';g.display[rng.int(g.states)]=rng.int(L);
  } else if(choice===7){operation='affinity';const l=rng.int(L),m=rng.int(L);g.affinity[l][m]=nudge(g.affinity[l][m]);
  } else {operation='cross';const l=rng.int(L),m=rng.int(L),v=nudge(g.cross[l][m]);g.cross[l][m]=v;g.cross[m][l]=v;}
  validateGenome(g,cfg);return {genome:g,operation,limited};
}

export class World {
  constructor(options={}){
    this.config={...DEFAULTS,...options};this.validateConfig();const c=this.config;
    this.rng=new RNG(c.seed);this.tick=0;this.nextId=1;this.nextBond=1;
    this.entities=new Map();this.bonds=new Map();this.genomes=new Map();this.genomeKeys=new Map();this.nextGenome=1;
    this.cols=Math.ceil(c.width/c.cellSize);this.rows=Math.ceil(c.height/c.cellSize);
    this.field=new Float64Array(this.cols*this.rows).fill(3);this.fieldScratch=new Float64Array(this.field.length);
    this.supply=new Float64Array(this.field.length);
    for(let y=0;y<this.rows;y++)for(let x=0;x<this.cols;x++)this.supply[y*this.cols+x]=c.source*(0.7+0.6*Math.sin(x/this.cols*Math.PI*2)**2*Math.cos(y/this.rows*Math.PI*2)**2);
    this.counters={births:0,deaths:0,mutations:0,reactions:0,signals:0,bondForms:0,bondBreaks:0,
      populationLimit:0,genomeLimit:0,eventLimit:0,copyNoSpace:0,pairLimit:0,bindNoEnergy:0,bindRefused:0};
    this.budget={source:0,fieldLoss:0,uptake:0,leakage:0,reactions:0,actions:0,copy:0,drag:0,bondLoss:0,death:0,mechanicalError:0,fieldClamp:0,bondUpkeep:0,aging:0};
    this.transit={edge:0,cross:0};
    // Комірка дорівнює найдальшій взаємодії, яку шукають через сітку (контакт
    // 2.8R, зіткнення 2R). Більша комірка лише додає кандидатів на відсів.
    this.events=[];this.contactReach=2.8*c.radius;this.bucketSize=this.contactReach;
    this.gridCols=Math.ceil(c.width/this.bucketSize);this.gridRows=Math.ceil(c.height/this.bucketSize);
    this.bucketWidth=c.width/this.gridCols;this.bucketHeight=c.height/this.gridRows;
    // validateConfig гарантує width>=24*radius, тому gridCols/gridRows>=4 і
    // дев'ять сусідніх комірок ніколи не повторюються через тор.
    this.grid=Array.from({length:this.gridCols*this.gridRows},()=>[]);
    const gid=this.registerGenome(founderGenome(c.labels));
    for(let i=0;i<c.pop;i++)this.spawn(gid,this.rng.next()*c.width,this.rng.next()*c.height,8,null,0);
    this.rebuild();this.initialEnergy=this.totalEnergy();
  }
  validateConfig(){const c=this.config;
    // halfEnergy стоїть у знаменнику E/(E+halfEnergy), тому строго додатний.
    for(const key of ['width','height','dt','radius','cellSize','carriers','maxPopulation','maxStates','maxReactions','maxEvents','halfEnergy','labels','maxPairs'])if(!Number.isFinite(c[key])||c[key]<=0)throw Error(`Некоректний параметр ${key}`);
    for(const key of ['source','fieldDecay','diffusion','uptake','leakage','drag','spring','flow','signalDecay','reactionCost','impulse','actionCost','bondCost','childEnergy','copyBase','copyPerState','copyPerReaction','crossFlow','bondUpkeep','agingCost'])if(!Number.isFinite(c[key])||c[key]<0)throw Error(`Некоректний параметр ${key}`);
    if(!Number.isInteger(c.pop)||c.pop<0||c.pop>c.maxPopulation||c.dt>1||c.diffusion*c.dt>.24||c.width<24*c.radius||c.height<24*c.radius||c.mutation<0||c.mutation>1)throw Error('Неприпустима конфігурація');
    // Частка переносу мусить лишатись строго нижчою за половину різниці, інакше
    // знак розриву змінюється і дисперсія може зрости, тобто з'явиться циркуляція.
    if(c.flow*c.dt>.25||c.crossFlow*c.dt>.25)throw Error('Завелика частка переносу енергії');
    if(c.labels>LABEL_NAMES.length)throw Error('Забагато міток');
    for(const k of ['carriers','maxPopulation','maxStates','maxReactions','maxEvents','labels','maxPairs'])if(!Number.isInteger(c[k]))throw Error(`Потрібне ціле ${k}`);
  }
  registerGenome(g){validateGenome(g,this.config);const key=JSON.stringify(g);if(this.genomeKeys.has(key))return this.genomeKeys.get(key);
    const id=this.nextGenome++;this.genomes.set(id,clone(g));this.genomeKeys.set(key,id);return id;}
  spawn(genomeId,x,y,energy,parentId,generation){
    const g=this.genomes.get(genomeId),counts=new Array(g.states).fill(0);counts[0]=this.config.carriers;
    const a=this.rng.next()*Math.PI*2,e={id:this.nextId++,parentId,generation,genomeId,x:wrap(x,this.config.width),y:wrap(y,this.config.height),vx:Math.cos(a)*.3,vy:Math.sin(a)*.3,orientation:a,energy,age:0,counts,signal:0,pendingSignal:0,bonds:new Set(),reactionCounts:new Array(g.reactions.length).fill(0),lastReaction:-1};
    this.entities.set(e.id,e);return e;
  }
  log(type,data){if(this.config.logEvents)this.events.push({tick:this.tick,type,...data});}
  drainEvents(){const out=this.events;this.events=[];return out;}
  displacement(a,b){return [delta(b.x-a.x,this.config.width),delta(b.y-a.y,this.config.height)];}
  // Ті самі числа без алокації пари, для циклів, що йдуть по всіх зв'язках.
  sepX(a,b){const W=this.config.width,hw=W/2,d=b.x-a.x+hw;return ((d%W)+W)%W-hw;}
  sepY(a,b){const H=this.config.height,hh=H/2,d=b.y-a.y+hh;return ((d%H)+H)%H-hh;}
  // sqrt замість hypot: координати обмежені розміром світу, тому захист від
  // переповнення не потрібен, а коштує він близько 11% часу кроку. Різниця
  // лише в останньому розряді. Єдине джерело довжини зв'язку в рушії, щоб
  // rest і поточний проміжок рахувались тим самим виразом.
  span(a,b){const x=this.sepX(a,b),y=this.sepY(a,b);return Math.sqrt(x*x+y*y);}
  bucket(x,y){return wrap(Math.floor(y/this.bucketHeight),this.gridRows)*this.gridCols+wrap(Math.floor(x/this.bucketWidth),this.gridCols);}
  insert(e){this.grid[this.bucket(e.x,e.y)].push(e);}
  rebuild(){for(const cell of this.grid)cell.length=0;for(const e of this.entities.values())this.insert(e);}
  // Порядок обходу дев'яти комірок визначає, якого партнера обере bind,
  // тому він частина фізики: y зовні, x усередині, як і раніше.
  nearby(e,out=[]){const bx=Math.floor(e.x/this.bucketWidth),by=Math.floor(e.y/this.bucketHeight);
    for(let y=-1;y<=1;y++){const row=wrap(by+y,this.gridRows)*this.gridCols;
      for(let x=-1;x<=1;x++){const cell=this.grid[row+wrap(bx+x,this.gridCols)];
        for(let i=0;i<cell.length;i++)if(cell[i].id!==e.id)out.push(cell[i]);}}return out;}
  // Той самий вираз, що й displacement, розписаний скалярами: гарячі цикли
  // не мають алокувати пару на кожного кандидата.
  contacts(e,reach){const out=[],r2=reach*reach,W=this.config.width,H=this.config.height,hw=W/2,hh=H/2;
    const bx=Math.floor(e.x/this.bucketWidth),by=Math.floor(e.y/this.bucketHeight);
    for(let y=-1;y<=1;y++){const row=wrap(by+y,this.gridRows)*this.gridCols;
      for(let x=-1;x<=1;x++){const cell=this.grid[row+wrap(bx+x,this.gridCols)];
        for(let i=0;i<cell.length;i++){const n=cell[i];if(n.id===e.id)continue;
          let dx=n.x-e.x+hw;dx=((dx%W)+W)%W-hw;let dy=n.y-e.y+hh;dy=((dy%H)+H)%H-hh;
          if(dx*dx+dy*dy<r2)out.push(n);}}}return out;}
  bonded(a,b){for(const id of a.bonds){const bond=this.bonds.get(id);if(bond && (bond.a===b.id||bond.b===b.id))return true;}return false;}
  // Що частинка показує сусідам: частка носіїв під кожною публічною міткою.
  // Мітка не діє всередині частинки й не входить у жодну реакцію.
  labelMix(e){const g=this.genomes.get(e.genomeId),L=this.config.labels,out=new Float64Array(L);
    for(let k=0;k<e.counts.length;k++)out[g.display[k]]+=e.counts[k];
    for(let l=0;l<L;l++)out[l]/=this.config.carriers;return out;}
  // Згортка матриці міток двох показів. Для affinity перший аргумент це власний
  // показ, для cross — показ першого із двох сусідів.
  gate(matrix,first,second,L){let s=0;
    for(let l=0;l<L;l++){const w=first[l];if(w===0)continue;const row=matrix[l];
      for(let m=0;m<L;m++)s+=row[m]*w*second[m];}
    return s;}
  strain(e){let s=0;for(const id of e.bonds){const b=this.bonds.get(id),n=this.entities.get(b.a===e.id?b.b:b.a);if(n)s+=Math.abs(this.span(e,n)-b.rest);}return s;}
  bondEnergy(b){const a=this.entities.get(b.a),e=this.entities.get(b.b);if(!a||!e)return 0;return .5*this.config.spring*(this.span(a,e)-b.rest)**2;}
  totalEnergy(){let sum=0;for(const x of this.field)sum+=x;for(const e of this.entities.values())sum+=e.energy+.5*(e.vx**2+e.vy**2);for(const b of this.bonds.values())sum+=this.bondEnergy(b);return sum;}
  // Довжина спокою фіксована контактом, а не поточною відстанню, тому зв'язок
  // народжується натягнутим: вхід strain означає щось із першої миті, а пружна
  // енергія, створена зв'язуванням, є справжньою і має бути сплачена.
  bondElastic(a,b){return .5*this.config.spring*(this.span(a,b)-2*this.config.radius)**2;}
  addBond(a,b){if(a===b||this.bonded(a,b))return null;const bond={id:this.nextBond++,a:a.id,b:b.id,rest:2*this.config.radius,createdTick:this.tick,flow:0};
    this.bonds.set(bond.id,bond);a.bonds.add(bond.id);b.bonds.add(bond.id);this.counters.bondForms++;this.log('bond',{...bond});return bond;}
  removeBond(id){const b=this.bonds.get(id);if(!b)return;this.budget.bondLoss+=this.bondEnergy(b);this.entities.get(b.a)?.bonds.delete(id);this.entities.get(b.b)?.bonds.delete(id);this.bonds.delete(id);this.counters.bondBreaks++;this.log('unbind',{id});}
  environment(){const c=this.config,dt=c.dt;let added=0,lost=0;
    for(let y=0;y<this.rows;y++)for(let x=0;x<this.cols;x++){
      const i=y*this.cols+x,v=this.field[i],source=this.supply[i]*dt,loss=v*(1-Math.exp(-c.fieldDecay*dt));
      const near=this.field[y*this.cols+wrap(x-1,this.cols)]+this.field[y*this.cols+wrap(x+1,this.cols)]+this.field[wrap(y-1,this.rows)*this.cols+x]+this.field[wrap(y+1,this.rows)*this.cols+x];
      const next=v+source-loss+c.diffusion*dt*(near-4*v);
      // validateConfig тримає diffusion*dt<=0.24, тож явна схема лишається
      // додатною. Перевірка ловить випадок, коли межу колись послаблять.
      if(!(next>=0))throw Error(`Поле стало від'ємним у ${i} на кроці ${this.tick}`);
      this.fieldScratch[i]=next;added+=source;lost+=loss;
    }
    this.budget.source+=added;this.budget.fieldLoss+=lost;
    [this.field,this.fieldScratch]=[this.fieldScratch,this.field];
    const bins=new Map();for(const e of this.entities.values()){const i=Math.min(this.rows-1,Math.floor(e.y/c.cellSize))*this.cols+Math.min(this.cols-1,Math.floor(e.x/c.cellSize));if(!bins.has(i))bins.set(i,[]);bins.get(i).push(e);}
    // portion*es.length може перевищити field[i] на останній розряд, коли
    // осередок вичерпано націло. Без затиску поле йде в -1e-17 і checkpoint
    // потім не проходить перевірку. Затиснуте йде окремим рядком бюджету.
    let drawn=0,clamped=0;
    for(const [i,es] of bins){const portion=Math.min(c.uptake*dt,this.field[i]/es.length),taken=portion*es.length;
      const rest=this.field[i]-taken;this.field[i]=rest<0?0:rest;if(rest<0)clamped-=rest;
      drawn+=taken;for(const e of es)e.energy+=portion;}
    this.budget.uptake+=drawn;this.budget.fieldClamp+=clamped;
    // Старіння як звичайна витрата, що росте з віком, а не жорсткий граничний
    // вік. Так воно є таким самим тиском, як решта витрат, і геном може на нього
    // відповідати. Смерть настає через наявний поріг виснаження.
    let leaked=0,aged=0;
    for(const e of this.entities.values()){const loss=e.energy*(1-Math.exp(-c.leakage*dt));e.energy-=loss;leaked+=loss;
      if(c.agingCost>0){const toll=Math.min(Math.max(0,e.energy),c.agingCost*e.age*dt);e.energy-=toll;aged+=toll;}
      e.signal=e.signal*Math.exp(-c.signalDecay*dt)+e.pendingSignal;e.pendingSignal=0;e.age+=dt;}
    this.budget.leakage+=leaked;this.budget.aging+=aged;
  }
  mechanics(){const c=this.config,dt=c.dt,L=c.labels;let before=0;for(const e of this.entities.values())before+=.5*(e.vx**2+e.vy**2);for(const b of this.bonds.values())before+=this.bondEnergy(b);
    // Покази заморожені на крок, як контакти й навантаження: це те саме
    // операторне розщеплення, що вже діє в решті рушія.
    const mix=new Map();for(const e of this.entities.values())mix.set(e.id,this.labelMix(e));
    let moved=0;
    for(const b of this.bonds.values()){
      const a=this.entities.get(b.a),e=this.entities.get(b.b),dx=this.sepX(a,e),dy=this.sepY(a,e),dist=Math.sqrt(dx*dx+dy*dy)||1e-8,f=c.spring*(dist-b.rest)*dt;
      a.vx+=f*dx/dist;a.vy+=f*dy/dist;e.vx-=f*dx/dist;e.vy-=f*dy/dist;
      const ma=mix.get(a.id),me=mix.get(e.id);
      const G=this.gate(this.genomes.get(a.genomeId).affinity,ma,me,L)*this.gate(this.genomes.get(e.genomeId).affinity,me,ma,L);
      const flow=(a.energy-e.energy)*Math.min(.5,c.flow*dt*G);a.energy-=flow;e.energy+=flow;b.flow=flow/dt;moved+=Math.abs(flow);
    }
    this.transit.edge+=moved;
    if(c.crossFlow>0)this.route(mix,L);
    // Підсумок за крок накопичується локально й додається до бюджету один раз.
    // Мільйони дрібних додавань до великої суми втрачають розряди й псують
    // залишок балансу, за яким ми й судимо про коректність.
    if(c.bondUpkeep>0){const share=c.bondUpkeep*dt/2;let paid=0;
      for(const b of this.bonds.values())for(const id of [b.a,b.b]){const e=this.entities.get(id);if(!e)continue;
        const pay=Math.min(share,Math.max(0,e.energy));e.energy-=pay;paid+=pay;}
      this.budget.bondUpkeep+=paid;}
    // Відсів за квадратом відстані з запасом 1.0001 ніколи не розходиться з
    // точним порівнянням: корінь точний до одиниць останнього розряду, тобто
    // на десять порядків менше за запас.
    const buf=[],W=c.width,H=c.height,hw=W/2,hh=H/2,cut=(2*c.radius)**2*1.0001;
    for(const a of this.entities.values()){buf.length=0;this.nearby(a,buf);
     for(const b of buf)if(b.id>a.id){
      let dx=b.x-a.x+hw;dx=((dx%W)+W)%W-hw;let dy=b.y-a.y+hh;dy=((dy%H)+H)%H-hh;
      const d2=dx*dx+dy*dy;if(d2>cut)continue;
      const dist=Math.sqrt(d2);
      if(dist<2*c.radius){const ux=dist>1e-8?dx/dist:1,uy=dist>1e-8?dy/dist:0,closing=(a.vx-b.vx)*ux+(a.vy-b.vy)*uy;
        if(closing>0){a.vx-=closing*ux;a.vy-=closing*uy;b.vx+=closing*ux;b.vy+=closing*uy;}
        const shift=(2*c.radius-dist)*.5;a.x=wrap(a.x-ux*shift,c.width);a.y=wrap(a.y-uy*shift,c.height);b.x=wrap(b.x+ux*shift,c.width);b.y=wrap(b.y+uy*shift,c.height);
      }}}
    for(const e of this.entities.values()){e.x=wrap(e.x+e.vx*dt,c.width);e.y=wrap(e.y+e.vy*dt,c.height);}
    let after=0;for(const e of this.entities.values())after+=.5*(e.vx**2+e.vy**2);for(const b of this.bonds.values())after+=this.bondEnergy(b);this.budget.mechanicalError+=after-before;
    let damped=0;
    for(const e of this.entities.values()){const old=.5*(e.vx**2+e.vy**2),f=Math.exp(-c.drag*dt);e.vx*=f;e.vy*=f;damped+=old-.5*(e.vx**2+e.vy**2);}
    this.budget.drag+=damped;
    for(const b of [...this.bonds.values()])if(this.span(this.entities.get(b.a),this.entities.get(b.b))>b.rest+8*c.radius)this.removeBond(b.id);
    this.rebuild();
  }
  // Комутатор: частинка переносить енергію напряму між парою своїх сусідів,
  // лишаючись одним скаляром. Матриця індексується мітками сусідів, а не
  // номерами портів: ребра не успадковуються, тому номер порту не спадковий.
  // Порядок пар детермінований сортуванням id, бо переноси йдуть на місці.
  route(mix,L){const c=this.config,dt=c.dt;let moved=0;
    for(const i of this.entities.values()){
      if(i.bonds.size<2)continue;
      const cross=this.genomes.get(i.genomeId).cross;
      // Нульова матриця дала б нульовий перенос на кожній парі, тому обхід пар,
      // квадратичний за степенем, для неї просто пропускається.
      let open=false;for(let l=0;l<L&&!open;l++)for(let m=0;m<L;m++)if(cross[l][m]>0){open=true;break;}
      if(!open)continue;
      const ids=[...i.bonds].sort((x,y)=>x-y);let pairs=0;
      outer: for(let p=0;p<ids.length;p++)for(let q=p+1;q<ids.length;q++){
        if(pairs++>=c.maxPairs){this.counters.pairLimit++;break outer;}
        const ba=this.bonds.get(ids[p]),bb=this.bonds.get(ids[q]);
        const a=this.entities.get(ba.a===i.id?ba.b:ba.a),b=this.entities.get(bb.a===i.id?bb.b:bb.a);
        if(!a||!b||a.id===b.id)continue;
        const k=this.gate(cross,mix.get(a.id),mix.get(b.id),L);
        if(k<=0)continue;
        const t=(a.energy-b.energy)*Math.min(.5,c.crossFlow*dt*k);
        a.energy-=t;b.energy+=t;moved+=Math.abs(t);
      }
    }
    this.transit.cross+=moved;
  }
  copyCost(g){const c=this.config;return c.childEnergy+c.copyBase+c.copyPerState*g.states+c.copyPerReaction*g.reactions.length+.045;}
  impulseWork(e,r){const a=e.orientation+r.direction,p=this.config.impulse;return e.vx*Math.cos(a)*p+e.vy*Math.sin(a)*p+.5*p*p;}
  actionCost(e,r){const c=this.config;
    if(r.action==='copy')return this.copyCost(this.genomes.get(e.genomeId));
    if(r.action==='impulse')return c.actionCost+Math.max(0,this.impulseWork(e,r));
    return r.action==='none'?0:r.action==='bind'?c.bondCost:c.actionCost;
  }
  chemistry(e,contacts,strain){const c=this.config,g=this.genomes.get(e.genomeId);let time=0,eventCount=0;
    const weights=new Float64Array(g.reactions.length);
    while(time<c.dt){let sum=0;
      for(let i=0;i<g.reactions.length;i++){const r=g.reactions[i];let w=r.rate*e.counts[r.source]/c.carriers;
        if(r.catalyst!==null)w*=Math.max(0,e.counts[r.catalyst]-(r.catalyst===r.source?1:0))/c.carriers;
        if(r.input==='energy')w*=e.energy/(e.energy+c.halfEnergy);else if(r.input==='contact')w*=contacts.length?1:0;else if(r.input==='strain')w*=strain/(1+strain);else if(r.input==='signal')w*=e.signal/(1+e.signal);
        if(e.energy+1e-12<c.reactionCost+this.actionCost(e,r))w=0;
        if(r.action==='bind'&&!contacts.some(b=>!this.bonded(e,b)))w=0;
        if((r.action==='unbind'||r.action==='signal')&&!e.bonds.size)w=0;
        weights[i]=w;sum+=w;
      }
      if(sum<=0)break;
      time+=-Math.log(1-this.rng.next())/sum;if(time>c.dt)break;
      if(eventCount++>=c.maxEvents){this.counters.eventLimit++;break;}
      let choice=this.rng.next()*sum,index=weights.length-1;for(let i=0;i<weights.length;i++){choice-=weights[i];if(choice<0){index=i;break;}}
      const r=g.reactions[index];
      if(!this.execute(e,r,contacts))continue;
      e.counts[r.source]--;e.counts[r.target]++;e.energy-=c.reactionCost;this.budget.reactions+=c.reactionCost;e.reactionCounts[index]++;e.lastReaction=index;this.counters.reactions++;
    }
  }
  execute(e,r,contacts){const c=this.config;
    if(r.action==='copy'){
      if(this.entities.size>=c.maxPopulation){this.counters.populationLimit++;return false;}
      let pos=null;const angle=this.rng.next()*Math.PI*2;
      for(let i=0;i<8;i++){const a=angle+i*Math.PI/4,p={x:wrap(e.x+Math.cos(a)*c.radius*2.4,c.width),y:wrap(e.y+Math.sin(a)*c.radius*2.4,c.height),id:-1};
        if(!this.nearby(p).some(n=>{const [x,y]=this.displacement(p,n);return x*x+y*y<(2*c.radius)**2;})){pos=p;break;}}
      if(!pos){this.counters.copyNoSpace++;return false;}
      const m=mutateGenome(this.genomes.get(e.genomeId),this.rng,c),cost=this.copyCost(m.genome);
      if(e.energy<cost+c.reactionCost)return false;
      const gid=this.registerGenome(m.genome),child=this.spawn(gid,pos.x,pos.y,c.childEnergy,e.id,e.generation+1);this.insert(child);
      e.energy-=cost;this.budget.copy+=cost-c.childEnergy-.045;this.counters.births++;
      if(gid!==e.genomeId)this.counters.mutations++;if(m.limited)this.counters.genomeLimit++;
      this.log('birth',{id:child.id,parentId:e.id,genomeId:gid,generation:child.generation,mutation:m.operation});return true;
    }
    if(r.action==='bind'){const available=contacts.filter(b=>!this.bonded(e,b));if(!available.length)return false;
      // Партнер обирається зважено за тією самою матрицею, що керує провідністю:
      // з ким я взагалі маю справу. Взаємно, як і потік, тому зв'язок не можна
      // нав'язати тому, хто його не приймає. Однорідна матриця засновника дає
      // рівномірний вибір, тобто стартова поведінка не змінюється.
      const L=c.labels,mine=this.labelMix(e),affinity=this.genomes.get(e.genomeId).affinity;
      const weights=available.map(b=>{const theirs=this.labelMix(b);
        return this.gate(affinity,mine,theirs,L)*this.gate(this.genomes.get(b.genomeId).affinity,theirs,mine,L);});
      let total=0;for(const x of weights)total+=x;
      if(!(total>0)){this.counters.bindRefused++;return false;}
      let pick=this.rng.next()*total,index=weights.length-1;
      for(let i=0;i<weights.length;i++){pick-=weights[i];if(pick<0){index=i;break;}}
      const partner=available[index],elastic=this.bondElastic(e,partner);
      // Пружна енергія не втрата: вона переходить у зв'язок і лишається в totalEnergy.
      if(e.energy<c.reactionCost+c.bondCost+elastic){this.counters.bindNoEnergy++;return false;}
      this.addBond(e,partner);e.energy-=c.bondCost+elastic;this.budget.actions+=c.bondCost;
    } else if(r.action==='unbind'){if(!e.bonds.size)return false;const ids=[...e.bonds].sort((a,b)=>a-b);this.removeBond(ids[this.rng.int(ids.length)]);e.energy-=c.actionCost;this.budget.actions+=c.actionCost;
    } else if(r.action==='signal'){if(!e.bonds.size)return false;const amount=1/e.bonds.size;for(const id of e.bonds){const b=this.bonds.get(id);this.entities.get(b.a===e.id?b.b:b.a).pendingSignal+=amount;}e.energy-=c.actionCost;this.budget.actions+=c.actionCost;this.counters.signals++;
    } else if(r.action==='impulse'){const work=this.impulseWork(e,r),a=e.orientation+r.direction;e.vx+=Math.cos(a)*c.impulse;e.vy+=Math.sin(a)*c.impulse;e.energy-=c.actionCost+Math.max(0,work);this.budget.actions+=c.actionCost+Math.max(0,-work);}
    return true;
  }
  step(){this.tick++;this.environment();this.mechanics();const entities=[...this.entities.values()];
    // External contact/strain inputs are frozen for this split step.
    const contexts=new Map();
    for(const e of entities)contexts.set(e.id,{contacts:this.contacts(e,this.contactReach),strain:this.strain(e)});
    for(let i=entities.length-1;i>0;i--){const j=this.rng.int(i+1);[entities[i],entities[j]]=[entities[j],entities[i]];}
    for(const e of entities){const ctx=contexts.get(e.id);this.chemistry(e,ctx.contacts,ctx.strain);}
    for(const e of this.entities.values())if(e.energy<.025){for(const id of [...e.bonds])this.removeBond(id);this.budget.death+=e.energy+.5*(e.vx**2+e.vy**2);this.entities.delete(e.id);this.counters.deaths++;this.log('death',{id:e.id});}
  }
  advance(n){for(let i=0;i<n;i++)this.step();}
  stats(){const n=this.entities.size,seen=new Set(),hist={},gens=[],genomes=new Set();let energy=0,maxSize=0,states=0,reactions=0,spread=0,spreadWeight=0;
    for(const e of this.entities.values()){energy+=e.energy;gens.push(e.generation);genomes.add(e.genomeId);const g=this.genomes.get(e.genomeId);states+=g.states;reactions+=g.reactions.length;
      if(seen.has(e.id))continue;const stack=[e.id];seen.add(e.id);let size=0,sum=0,sumSq=0;
      while(stack.length){const id=stack.pop(),node=this.entities.get(id);size++;sum+=node.energy;sumSq+=node.energy*node.energy;
        for(const bid of node.bonds){const b=this.bonds.get(bid),other=b.a===id?b.b:b.a;if(!seen.has(other)){seen.add(other);stack.push(other);}}}
      hist[size]=(hist[size]||0)+1;maxSize=Math.max(maxSize,size);
      // Розкид запасів усередині компоненти. За однорідної провідності він
      // майже нуль: компонента є спільним казаном. Стійкий розкид означає,
      // що ворітця справді розділяють запаси.
      if(size>1){spreadWeight+=size;spread+=size*Math.max(0,sumSq/size-(sum/size)**2);}
    }
    gens.sort((a,b)=>a-b);const b=this.budget,loss=b.fieldLoss+b.leakage+b.reactions+b.actions+b.copy+b.drag+b.bondLoss+b.death+b.bondUpkeep+b.aging;
    return {tick:this.tick,time:this.tick*this.config.dt,population:n,bonds:this.bonds.size,genomes:genomes.size,meanEnergy:energy/(n||1),meanStates:states/(n||1),meanReactions:reactions/(n||1),maxGeneration:gens.at(-1)||0,medianGeneration:gens[Math.floor(n/2)]||0,maxComponent:maxSize,componentHist:hist,...this.counters,budget:{...b},transit:{...this.transit},
      componentSpread:spreadWeight?spread/spreadWeight:0,...this.routingStats(),
      energyResidual:this.totalEnergy()-this.initialEnergy-b.source+loss-b.mechanicalError-b.fieldClamp};
  }
  // Спостереження, не фізика: RNG не споживається, стан не міняється.
  routingStats(){const L=this.config.labels,mix=new Map();let conduct=0,closed=0,kin=0,degree=0,maxDegree=0,cross=0;
    for(const e of this.entities.values()){mix.set(e.id,this.labelMix(e));degree+=e.bonds.size;maxDegree=Math.max(maxDegree,e.bonds.size);
      const m=this.genomes.get(e.genomeId).cross;let s=0;for(let l=0;l<L;l++)for(let n=0;n<L;n++)s+=m[l][n];cross+=s/(L*L);}
    for(const b of this.bonds.values()){const a=this.entities.get(b.a),e=this.entities.get(b.b);if(!a||!e)continue;
      const ma=mix.get(a.id),me=mix.get(e.id);
      const G=this.gate(this.genomes.get(a.genomeId).affinity,ma,me,L)*this.gate(this.genomes.get(e.genomeId).affinity,me,ma,L);
      conduct+=G;if(G<.01)closed++;if(a.genomeId===e.genomeId)kin++;}
    const nb=this.bonds.size||1,n=this.entities.size||1;
    return {meanConductance:conduct/nb,closedBonds:closed/nb,kinBonds:kin/nb,
      meanCross:cross/n,meanDegree:degree/n,maxDegree};}
  snapshot(){return {version:VERSION,config:{...this.config},stats:this.stats(),cols:this.cols,rows:this.rows,field:Array.from(this.field),
    particles:[...this.entities.values()].map(e=>[e.id,e.x,e.y,e.energy,e.generation,e.genomeId,e.signal,e.orientation]),
    bonds:[...this.bonds.values()].map(b=>[b.id,b.a,b.b,b.flow]),genomes:[...this.genomes.entries()]};}
  inspect(id){const e=this.entities.get(Number(id));return e?{...e,bonds:[...e.bonds],genome:clone(this.genomes.get(e.genomeId))}:null;}
  checkpoint(){return {version:VERSION,config:{...this.config},tick:this.tick,rng:this.rng.state,nextId:this.nextId,nextBond:this.nextBond,nextGenome:this.nextGenome,
    genomes:[...this.genomes.entries()].map(([id,g])=>[id,clone(g)]),field:Array.from(this.field),supply:Array.from(this.supply),entities:[...this.entities.values()].map(e=>({...clone(e),bonds:[...e.bonds]})),bonds:[...this.bonds.values()].map(clone),counters:{...this.counters},budget:{...this.budget},transit:{...this.transit},initialEnergy:this.initialEnergy};}
  static restore(cp){
    if(cp?.version!==VERSION)throw Error('Несумісна версія checkpoint');    // Злиття з DEFAULTS: checkpoint, записаний до появи нового параметра,
    // читається далі й дістає його типове значення замість помилки.
    const w=new World({...DEFAULTS,...cp.config,pop:0});w.config={...DEFAULTS,...cp.config};w.validateConfig();
    if(!Array.isArray(cp.entities)||cp.entities.length>w.config.maxPopulation||cp.field.length!==w.field.length||cp.supply.length!==w.field.length)throw Error('Некоректний розмір checkpoint');
    w.genomes.clear();w.genomeKeys.clear();for(const [id,g] of cp.genomes){validateGenome(g,w.config);w.genomes.set(id,clone(g));w.genomeKeys.set(JSON.stringify(g),id);}
    w.entities.clear();for(const e of cp.entities){const g=w.genomes.get(e.genomeId);if(!g||e.counts.length!==g.states||e.counts.some(n=>!Number.isInteger(n)||n<0)||e.counts.reduce((a,b)=>a+b,0)!==w.config.carriers||![e.x,e.y,e.vx,e.vy,e.energy,e.signal,e.pendingSignal].every(Number.isFinite)||e.energy<0)throw Error('Некоректна частинка checkpoint');w.entities.set(e.id,{...clone(e),bonds:new Set(e.bonds)});}
    w.bonds=new Map(cp.bonds.map(b=>[b.id,clone(b)]));for(const b of w.bonds.values())if(!w.entities.has(b.a)||!w.entities.has(b.b))throw Error('Некоректне ребро checkpoint');
    // Допуск на похибку останнього розряду: checkpoint, записаний до затиску
    // поживи, містить осередки близько -1e-17. Справжнє пошкодження лишається
    // помилкою.
    for(const v of [...cp.field,...cp.supply])if(!Number.isFinite(v)||v<-1e-9)throw Error('Некоректне поле checkpoint');
    for(const k of ['tick','nextId','nextBond','nextGenome','initialEnergy'])w[k]=cp[k];w.rng.state=cp.rng>>>0;
    w.field.set(cp.field.map(v=>v<0?0:v));w.supply.set(cp.supply);
    // Злиття, а не заміна: лічильники, додані після запису checkpoint,
    // лишаються нулями замість undefined.
    w.counters={...w.counters,...cp.counters};w.budget={...w.budget,...cp.budget};w.transit={...w.transit,...cp.transit};w.events=[];w.rebuild();return w;
  }
}
