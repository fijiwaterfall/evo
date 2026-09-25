'use strict';
const fs = require('fs');
const path = require('path');
const load = label => JSON.parse(fs.readFileSync(path.join(__dirname,'..','data',label+'.json'),'utf8'));
const control=load(process.argv[2] || 'step3-absorb-block');
const treatment=load(process.argv[3] || 'step4-charges');
function shape(r){
  const h=r.componentSizeTimeHist;
  if(!h || !r.componentSamples) throw new Error('Run with --measure=true');
  const max=Math.max(...Object.keys(h).map(Number));
  const peaks=[];
  let monotone=true;
  for(let n=2;n<=max;n++){
    if((h[n]||0)>(h[n-1]||0)) monotone=false;
    if((h[n]||0)>(h[n-1]||0) && (h[n]||0)>(h[n+1]||0)) peaks.push(n);
  }
  return {peaks,monotone,max,histogram:h};
}
const results=treatment.results.map(r=>{
  const c=control.results.find(c=>c.seed===r.seed);
  if(!c || c.ticks!==r.ticks) throw new Error('Unpaired runs');
  const a=shape(c),b=shape(r);
  return {seed:r.seed,control:a,charges:b,passes:b.peaks.length>0 && a.monotone};
});
const report={criterion:'Strict local peak at size >=2, with monotonically nonincreasing paired control; at least 6/8 seeds.',
  passingSeeds:results.filter(r=>r.passes).length,results};
report.accepted=results.length===8 && report.passingSeeds>=6;
console.log(JSON.stringify(report,null,2));
