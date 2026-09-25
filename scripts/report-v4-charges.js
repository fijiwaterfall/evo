'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const load=label=>JSON.parse(fs.readFileSync(path.join(root,'data',label+'.json'),'utf8'));
assert.deepEqual(load('step0-v4-final').results,load('step0-baseline').results);
const baselineSummary={...load('step0-baseline').summary};
const finalSummary={...load('step0-v4-final').summary};
delete baselineSummary.label; delete finalSummary.label;
// The archived step-0 artifact predates feature metadata.
if(!baselineSummary.features) baselineSummary.features=['(v3.1 base)'];
assert.deepEqual(finalSummary,baselineSummary);
console.log('PASS all baseline results and summary metrics match exactly (normalizing label and legacy feature metadata)');
for(const [a,b] of [['step1-internalstate','step2-env-oscillation'],['step2-env-oscillation','step3-absorb-block'],['step3-absorb-block','step3-absorb-break'],['step3-absorb-block','step4-charges']]){
  const output=execFileSync(process.execPath,[path.join(__dirname,'compare.js'),a,b],{encoding:'utf8'});
  fs.writeFileSync(path.join(root,'data',b+'-comparison.txt'),output);
}
const analysis=execFileSync(process.execPath,[path.join(__dirname,'analyze-charges.js')],{encoding:'utf8'});
fs.writeFileSync(path.join(root,'data','step4-acceptance.json'),analysis);
for(const r of load('step2-env-long').results){
  const samples=[3000,9000,15000,21000,27000].map(tick=>r.timeSeries.find(p=>p.tick===tick));
  console.log(JSON.stringify({seed:r.seed,cycleSamples:samples}));
}
