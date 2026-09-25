import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {World} from '../core.mjs';
// Золоті відбитки фіксують фізику. Оптимізації не мають їх міняти;
// свідома зміна правил має оновити константи окремим кроком.
// Перезнято свідомо під правку v6: мітки, провідність, комутатор, фіксована
// довжина спокою і плата за утримання зв'язку. Це зміна правил, а не
// рефакторинг, тому розбіжність із попередніми числами очікувана.
// Населення 824/2167/2034 проти 887/2339/2170 у v5, народження 895/2502/1894
// проти 947/2718/2085: нижче, бо зв'язки тепер коштують.
// Перезнято під смертність за віком, зв'язування за мітками та підібрані разом
// старіння й дохід. Це зміна правил, а не рефакторинг.
const GOLDEN=[[80,17,200,'159dc5925d57ed9436b278027f79aefc'],
  [150,3,300,'d73995ef37661eab4d61f94d0dff9947'],
  [400,5,150,'2d82c30703ea92bddc5a47594503769b']];
// Конфіг навмисно виключений: додавання параметра зі старим типовим значенням
// не міняє траєкторії й не має валити цей тест.
const fingerprint=w=>{const {config,...state}=w.checkpoint();
  return createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0,32);};
test('drained cells stay non-negative so dense checkpoints can resume',()=>{
  // Поділ поживи між претендентами вичерпує осередок націло; без затиску
  // поле йшло в -1e-17 і World.restore відкидав власний checkpoint.
  const w=new World({pop:600,seed:23,source:0.05,uptake:2});w.advance(120);
  assert.ok([...w.field].every(v=>v>=0),'поле має лишатись невід\'ємним');
  assert.ok(w.budget.fieldClamp>0,'тест має справді вичерпувати осередки');
  const back=World.restore(JSON.parse(JSON.stringify(w.checkpoint())));
  back.advance(20);w.advance(20);
  assert.equal(JSON.stringify(back.checkpoint()),JSON.stringify(w.checkpoint()));
});
test('physics fingerprints stay fixed across refactors',()=>{
  for(const [pop,seed,ticks,expected] of GOLDEN){
    const w=new World({pop,seed});w.advance(ticks);
    assert.equal(fingerprint(w),expected,`pop=${pop} seed=${seed} ticks=${ticks}`);
  }
});
