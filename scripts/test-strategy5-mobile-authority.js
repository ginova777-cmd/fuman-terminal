"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { strategy5MobileAuthority } = require('../lib/strategy5-mobile-authority');
const day = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei'}).format(new Date()).replace(/\D/g,'');
const runId = `strategy5-${day}-${day}130230`;
function valid() {
  return {ok:true, runId, tradeDate:day, sourceDate:day, complete:true, fullScan:true,
    qualityStatus:'complete', evidenceStatus:'complete', unattendedStatus:'YES', publishAllowed:true,
    preservePreviousGood:false, fallbackUsed:false, issues:[], source_status_at_run:{ok:true},
    selectionCoverage:{ok:true}, expectedTotal:1949, scannedCount:1949, resultCount:56, count:56,
    returnedCount:1, matches:[{code:'2330',name:'fixture',matches:[{id:'momentum'}]}],
    run_quality_at_publish:{runId,publishAllowed:true,preservePreviousGood:false,fallbackUsed:false,readbackCount:56},
    transport:{runId,resultReadbackCount:56,fallbackUsed:false},
    terminalAuthority:{formalDisplayAllowed:false,todayAuthoritative:false,displayMode:'PREVIOUS_GOOD_DEGRADED',displayBlockReason:'market_closed_previous_good_not_today_success'}};
}
test('same-day complete nightly run overrides stale aggregate authority',()=>assert.equal(strategy5MobileAuthority(valid(),day).displayMode,'TODAY_COMPLETE'));
for (const [name, change] of Object.entries({
  stale:p=>p.sourceDate='20000101', partial:p=>p.scannedCount--, blocked:p=>p.publishAllowed=false,
  degraded:p=>p.qualityStatus='degraded', fallback:p=>p.fallbackUsed=true, preserved:p=>p.preservePreviousGood=true,
  missingEvidence:p=>delete p.source_status_at_run, badCoverage:p=>p.selectionCoverage.ok=false,
  wrongRun:p=>p.transport.runId='other', readback:p=>p.run_quality_at_publish.readbackCount--,
  empty:p=>{p.matches=[];p.returnedCount=0;}, missingGate:p=>delete p.publishAllowed,
  issues:p=>p.issues=['source_stale'], unpublished:p=>p.run_quality_at_publish.publishAllowed=false
})) test('fails closed: '+name,()=>{const p=valid();change(p);assert.equal(strategy5MobileAuthority(p,day),null);});
test('prior day never claims today authority',()=>assert.equal(strategy5MobileAuthority(valid(),'20991231'),null));
test('readback count remains full count when transport limits visible rows',()=>assert.equal(strategy5MobileAuthority(valid(),day).formalDisplayAllowed,true));
function zero() {const p=valid();p.resultCount=p.count=p.returnedCount=p.run_quality_at_publish.readbackCount=p.transport.resultReadbackCount=0;p.matches=[];return p;}
test('healthy zero result is complete',()=>assert.equal(strategy5MobileAuthority(zero(),day).moduleStatus,'0-result'));

// Render the actual fragment without network enrichment. Only the unrelated cost
// and three-gate services are stubbed; authority and status rendering stay real.
const file=path.resolve(__dirname,'../api/mobile-fragment.js');
const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
mod._compile(fs.readFileSync(file,'utf8')+'\nattachMainForceCosts=async (tab,p)=>p; attachThreeGatePrices=async (tab,p)=>p; module.exports.renderForTest=renderFragment;',file);
const render=p=>mod.exports.renderForTest('strategy5',{title:'綜合',subtitle:'完整掃描',points:[]},p);
test('complete fragment has no contradictory blocked or preserved label',async()=>{const html=await render(valid());assert.match(html,/data-formal-display-allowed="1"/);assert.match(html,/data-today-authoritative="1"/);assert.doesNotMatch(html,/mobile-terminal-blocked|preserve previous good|PREVIOUS_GOOD_DEGRADED/);});
test('blocked/degraded state remains visible',async()=>{const p=valid();p.publishAllowed=false;p.qualityStatus='degraded';p.blockedReason='strategy5_source_incomplete';p.terminalAuthority.displayBlockReason=p.blockedReason;const html=await render(p);assert.match(html,/mobile-terminal-blocked/);assert.match(html,/strategy5_source_incomplete/);assert.match(html,/quality degraded/);assert.match(html,/data-formal-display-allowed="0"/);});
test('zero-result and empty states render deliberately',async()=>{const html=await render(zero());assert.match(html,/TODAY_ZERO_RESULT_COMPLETE/);assert.match(html,/empty-state/);const p=valid();p.complete=false;p.matches=[];p.returnedCount=0;const empty=await render(p);assert.match(empty,/empty-state/);assert.match(empty,/data-formal-display-allowed="0"/);});
test('API preservation reflects publication decision',()=>{
  const api=require('../api/strategy5-latest')._test;
  for(const allowed of [true,false]) {
    const p=api.strategy5RunTimeSourceEvidence({run:{run_id:runId,readback_count:56,payload:{}},sourceHealth:{},sourceDate:day,expectedTotal:1949,scannedCount:1949,resultCount:56,apiState:{publishGate:{publishAllowed:allowed},fallback:{used:false},retention:{ok:allowed},writeBudget:{}}});
    assert.equal(p.run_quality_at_publish.preservePreviousGood,!allowed);
  }
});
