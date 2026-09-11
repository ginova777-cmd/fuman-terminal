const test = require('node:test');
const assert = require('node:assert/strict');
const { strategy4MobileAuthority } = require('../lib/strategy4-mobile-authority');
const day='20260911', runId='strategy4-20260911-20260911094841';
function valid() { return {runId,tradeDate:day,sourceDate:day,complete:true,publishAllowed:true,qualityStatus:'complete',fallbackUsed:false,mustPreserveLatest:false,blockedReason:'',issues:[],expectedTotal:1605,scannedCount:1605,resultCount:1,readbackCount:1,count:1,matches:[{runId,scanDate:day}],run_quality_at_publish:{acceptedTargetDateCompleteRun:true,fallbackUsed:false,preservePreviousGood:false}}; }
test('same-day independent daily-K run stays formal after intraday close',()=>assert.equal(strategy4MobileAuthority(valid(),day).displayMode,'TODAY_COMPLETE'));
test('healthy zero result remains explicit',()=>{const p={...valid(),resultCount:0,readbackCount:0,count:0,matches:[]};assert.equal(strategy4MobileAuthority(p,day).moduleStatus,'0-result');});
for(const [name,change] of Object.entries({stale:p=>p.sourceDate='20260910',partial:p=>p.scannedCount=1604,blocked:p=>p.publishAllowed=false,degraded:p=>p.qualityStatus='degraded',fallback:p=>p.fallbackUsed=true,preserved:p=>p.mustPreserveLatest=true,coverage:p=>p.run_quality_at_publish.acceptedTargetDateCompleteRun=false,missingRows:p=>p.matches=[],wrongRowRun:p=>p.matches[0].runId='other',readback:p=>p.readbackCount=0})) test('reject '+name,()=>{const p=valid();change(p);assert.equal(strategy4MobileAuthority(p,day),null);});
