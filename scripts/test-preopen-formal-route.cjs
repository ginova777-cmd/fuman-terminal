'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const policy=require('../lib/daytrade-module-recovery-policy.cjs'),route=require('../lib/daytrade-formal-module-route.cjs'),registry=require('../data/contracts/mother-pool-a01-b24-module-registry-v1.json');
const at='2026-10-12T00:59:00Z',identity={trade_date:'2026-10-12',release_sha:'a'.repeat(40)};
const evaluate=p=>route.restrict(policy.evaluate(p,registry,identity),registry,at);
const base={contract:'daytrade_module_recovery_policy_v1',...identity,restored:[],probe:null};
let cases=0;
for(const id of route.supported){assert.equal(evaluate({...base,probe:id}).probe,id);cases++;}
for(const id of ['A03','A04','A14','A18','A19']){assert.equal(evaluate({...base,probe:id}).reason,'MODULE_ISOLATION_NOT_IMPLEMENTED');cases++;}
for(const p of [null,{...base,release_sha:'b'.repeat(40)},{...base,trade_date:'2026-10-11'},{...base,restored:['A02']},{...base,probe:'UNKNOWN'}]){assert.equal(evaluate(p).status,'PAUSED');cases++;}
const src=fs.readFileSync(require.resolve('./run-daytrade-source-writer.js'),'utf8');
const start=src.indexOf("      const inputs=[require('../lib/mother-pool-identity-source')");
const end=src.indexOf('      if(sideMinutes>=540){',start);assert(start>0&&end>start);
const block=src.slice(start,end)+'\n}\n';
const expected={A01:['mother-pool-identity-source'],A02:['mother-pool-identity-source','mother-pool-eligibility-source'],A05:['mother-pool-identity-source','mother-pool-daytrade-ratio'],A06:['mother-pool-identity-source','mother-pool-websocket-source'],A07:['mother-pool-identity-source','mother-pool-preopen-history'],A08:['mother-pool-identity-source','mother-pool-preopen-ma20'],A09:['mother-pool-identity-source','mother-pool-preopen-ma20'],A11:['mother-pool-identity-source','mother-pool-morning-module'],A12:['mother-pool-identity-source','mother-pool-morning-module'],A13:['mother-pool-identity-source','mother-pool-natural-trial'],A15:['mother-pool-identity-source','mother-pool-previous-ohlc'],A16:['mother-pool-identity-source','mother-pool-a16-module'],A17:['mother-pool-identity-source','mother-pool-trial-trajectory']};
for(const id of route.supported){
 const calls=[];const ctx={moduleWorkIds:()=>[id],identity,snapshot:{symbols:['2330']},sideAsOf:at,nowIso:()=>at,marketCalendarEvidence:{},writerLease:{},sideMinutes:539,activeSymbols:{sourceEvidence:{}},dailyVolumeMap:new Map(),quoteMap:new Map(),intradayMap:{preopenRawEvidence:{}},officialDaytradeSource:{},FUGLE_WS_STATUS_FILE:'isolated',readJson:()=>({}),preopenTrialHistory:[],runtimePath:()=>'/isolated',result:{payload:{module_persistence_errors:[]}},require:n=>{const name=n.replace('../lib/','');assert(expected[id].includes(name),'Unexpected producer '+name+' for '+id);return {collect:()=>{calls.push(name);return ['mother-pool-preopen-ma20','mother-pool-morning-module'].includes(name)?[]:{};}};}};
 vm.runInNewContext(block,ctx,{timeout:1000});assert.deepEqual(calls,expected[id]);assert.equal(ctx.result.payload.module_persistence_errors.length,0);cases++;
}
console.log(JSON.stringify({status:'FORMAL_POLICY_AND_PRODUCER_SELECTION_PASS',cases,scope:'isolated exact Writer input block; no IO; not whole Writer E2E'}));
