'use strict';
const assert=require('node:assert/strict'),{KEYS,bind,inspect}=require('../lib/mother-pool-scorecard-source');
const date='2026-09-18',asOf='2026-09-21T06:00:00+08:00';
function fixture(){return {contract:'scorecard88-terminal-canonical-collector-v1',ok:true,latestDate:date,updatedAt:date+'T22:00:00+08:00',
 sourceReports:KEYS.map(key=>({key,ok:true,complete:true,status:'PASS',runId:key+'-run',tradeDate:date,desktopStatus:'PASS',mobileStatus:'PASS',desktopRunId:key+'-run',mobileRunId:key+'-run',resultCount:1})),
 records:KEYS.map((key,i)=>{const ticker=String(1101+i);return {...bind({key},{runId:key+'-run'},{code:ticker,run_id:key+'-run'},date),ticker,record_date:date,source:'terminal-complete-run-scorecard',rule_key:key+':test'};})};}
const verify=payload=>inspect({payload,expectedSourceDate:date,asOf});let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('five bound source runs accepted',()=>{const r=verify(fixture());assert.equal(r.status,'READY');assert.equal(r.symbols.length,5);});
for(const [name,change] of [
 ['record run',p=>p.records[0].source_run_id='other'],['report run',p=>p.sourceReports[0].runId='other'],
 ['record symbol',p=>p.records[0].ticker='9999'],['record date',p=>p.records[0].record_date='2026-09-17'],
 ['report date',p=>p.sourceReports[0].tradeDate='2026-09-17'],['report count',p=>p.sourceReports[0].resultCount=2],
 ['missing record',p=>p.records.shift()],['missing report',p=>p.sourceReports.shift()],
 ['old unbound row',p=>delete p.records[0].source_binding_contract],['future snapshot',p=>p.updatedAt='2099-01-01T00:00:00Z'],
 ['failed mobile',p=>p.sourceReports[0].mobileStatus='BLOCKED'],['duplicate report',p=>p.sourceReports.push(p.sourceReports[0])]
])test(name+' rejected',()=>{const p=fixture();change(p);const r=verify(p);assert.equal(r.status,'BLOCKED');assert.deepEqual(r.symbols,[]);});
test('zero rows require matching zero complete reports',()=>{const p=fixture();p.records=[];p.sourceReports.forEach(r=>r.resultCount=0);assert.equal(verify(p).status,'READY');});
test('Strategy1 never enters source union',()=>{const p=fixture();p.records.push({...bind({key:'strategy1'},{runId:'s1'},{code:'9999'},date),ticker:'9999',record_date:date});assert(!verify(p).symbols.includes('9999'));assert.equal(verify(p).status,'READY');});
test('producer preserves missing run as data gap',()=>assert.equal(bind({key:'strategy3'},{},{code:'2330'},date).source_binding_status,'DATA_GAP'));
test('producer rejects conflicting row run',()=>assert.equal(bind({key:'strategy3'},{runId:'one'},{code:'2330',run_id:'two'},date).source_binding_status,'DATA_GAP'));
console.log(JSON.stringify({checks,scope:'isolated_scorecard_source_binding',production_complete:false}));
module.exports={fixture};
