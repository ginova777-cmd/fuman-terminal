const test = require('node:test');
const assert = require('node:assert/strict');
const { strategy4MobileAuthority } = require('../lib/strategy4-mobile-authority');
const day='20260911', runId='strategy4-20260911-20260911094841';
function valid() {
 const {RESULT_CONTRACT,GATE_CONTRACT}=require('../lib/strategy4-v3-evidence');
 const g={contract:GATE_CONTRACT,ok:true,kdK:70,kdD:60,kdPrevK:60,kdPrevD:55,rsi14:60,rsi14Prev:55,rsi4:70,rsi6:60,kdTrendUp:true,rsiTrendUp:true,kdGoldenCross:false,rsiGoldenCross:false};
 const row={runId,scanDate:day,dailyTechnicalGate:g,mutakiV17:{...g,dailyTechnicalGateOk:true},actionable:true,resultClass:'formal_actionable',actionableSignals:[{id:'bull_attack'}]};
 return {runId,resultContract:RESULT_CONTRACT,tradeDate:day,sourceDate:day,complete:true,publishAllowed:true,qualityStatus:'complete',fallbackUsed:false,mustPreserveLatest:false,blockedReason:'',issues:[],expectedTotal:1605,scannedCount:1605,resultCount:1,readbackCount:1,count:1,matches:[row],run_quality_at_publish:{acceptedTargetDateCompleteRun:true,fallbackUsed:false,preservePreviousGood:false}};
}
test('same-day independent daily-K run stays formal after intraday close',()=>assert.equal(strategy4MobileAuthority(valid(),day).displayMode,'TODAY_COMPLETE'));
test('healthy zero result remains explicit',()=>{const p={...valid(),resultCount:0,readbackCount:0,count:0,matches:[]};assert.equal(strategy4MobileAuthority(p,day).moduleStatus,'0-result');});
for(const [name,change] of Object.entries({stale:p=>p.sourceDate='20260910',partial:p=>p.scannedCount=1604,blocked:p=>p.publishAllowed=false,degraded:p=>p.qualityStatus='degraded',fallback:p=>p.fallbackUsed=true,preserved:p=>p.mustPreserveLatest=true,coverage:p=>p.run_quality_at_publish.acceptedTargetDateCompleteRun=false,missingRows:p=>p.matches=[],wrongRowRun:p=>p.matches[0].runId='other',readback:p=>p.readbackCount=0})) test('reject '+name,()=>{const p=valid();change(p);assert.equal(strategy4MobileAuthority(p,day),null);});
for(const [name,change] of Object.entries({oldV2:p=>p.resultContract='strategy4_actionable_patterns_avg5_3000_v2',missingGate:p=>delete p.matches[0].dailyTechnicalGate,missingNumeric:p=>delete p.matches[0].dailyTechnicalGate.rsi6,mirrorMismatch:p=>p.matches[0].mutakiV17.kdK=10,fallingRsi:p=>{p.matches[0].dailyTechnicalGate.rsi14=50;p.matches[0].mutakiV17.rsi14=50;},gateOnly:p=>p.matches[0].actionableSignals=[{id:'daily_kd_rsi_trend_up'}]})) test('v3 reject '+name,()=>{const p=valid();change(p);assert.equal(strategy4MobileAuthority(p,day),null);});
