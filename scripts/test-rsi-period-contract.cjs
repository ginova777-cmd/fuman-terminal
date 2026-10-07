'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {verifyAuthority, verifyRow} = require('../lib/verify-rsi-period-contract.cjs');
const actual = require('../lib/technical-indicators');
const out = process.argv[2];
if (!out) throw Error('An isolated output directory is required');
fs.mkdirSync(out, {recursive:true});
// Test-only producer executes explicitly selected periods using the existing rolling RSI primitive.
// It is not substituted into any production module or claimed to be the institution producer.
function fixtureProducer(fast, slow) {
  const PARAMETERS = {rsiFast:fast,rsiSlow:slow,rsiMethod:'rolling-gain-loss'};
  const CONTRACT = `test-only-rsi-${fast}-${slow}`;
  return {PARAMETERS,CONTRACT,indicatorTrend(bars) {
    const c=bars.map(b=>b.close), i=c.length-1;
    return {available:true,contract:CONTRACT,parameters:PARAMETERS,
      rsi5:actual.rsiAt(c,i,fast),rsi5Prev:actual.rsiAt(c,i-1,fast),
      rsi15:actual.rsiAt(c,i,slow),rsi15Prev:actual.rsiAt(c,i-1,slow)};
  }};
}
const bars = Array.from({length:41},(_,i)=>({close:100+i*.3+5*Math.sin(i),high:110+i*.3,low:90+i*.3}));
const good=fixtureProducer(5,15), old=fixtureProducer(3,6);
const row={...good.indicatorTrend(bars),rsiVerificationBars:bars};
const renamed={...old.indicatorTrend(bars),contract:good.CONTRACT,parameters:good.PARAMETERS,rsiVerificationBars:bars};
const cases=[
 ['true5_15',row,good,true],
 ['renamed3_6_even_with_forged_metadata',renamed,good,false],
 ['wrong_metadata',{...row,parameters:old.PARAMETERS},good,false],
 ['missing_period_no_algorithm_evidence',{rsi5:50,rsi15:60},good,false],
 ['matching_authoritative_algorithm_without_metadata',{...row,parameters:undefined},good,true],
 ['metadata_only_no_input',{...row,rsiVerificationBars:undefined},good,false],
 ['producer_contract_mismatch',row,old,false],
 ['wrong_contract',{...row,contract:'wrong'},good,false],
 ['current_real_producer',row,actual,false]
];
const results=cases.map(([name,input,producer,pass])=>{
 const errors=verifyRow(input,producer);assert.equal(errors.length===0,pass,name);
 fs.writeFileSync(path.join(out,name+'.fixture.json'),JSON.stringify({input,producerContract:producer.CONTRACT,producerParameters:producer.PARAMETERS,expectedPass:pass,errors},null,2));
 return {name,expectedPass:pass,errors,test:'PASS'};
});
assert.deepEqual(verifyAuthority(actual),['RSI_PRODUCER_PERIOD_MISMATCH']);
// Authority rejection must happen before an API request, including source-unavailable structural fallback.
const run=spawnSync(process.execPath,[path.join(__dirname,'verify-buy-sell-field-contract.js')],{encoding:'utf8',timeout:10000,env:{SystemRoot:process.env.SystemRoot}});
fs.writeFileSync(path.join(out,'verifier.stdout.txt'),run.stdout||'');
fs.writeFileSync(path.join(out,'verifier.stderr.txt'),run.stderr||'');
assert.equal(run.status,1);assert.match(run.stderr,/RSI_PRODUCER_PERIOD_MISMATCH/);
fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({verificationFixTests:'PASS',D:'BLOCKED',actualProducer:actual.PARAMETERS,actualProducerContract:actual.CONTRACT,results,verifierExitCode:run.status,reason:'Existing institution producer uses RSI3/6; trading algorithm deliberately unchanged'},null,2));
console.log('PASS '+results.length+' contract cases; actual candidate producer correctly BLOCKED before HTTP');
