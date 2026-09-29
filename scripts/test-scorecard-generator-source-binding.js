'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const text=fs.readFileSync(require.resolve('./generate-terminal-scorecard-source'),'utf8');
const start=text.indexOf('function normalizeRecord(task, payload, row, index) {'),end=text.indexOf('\nasync function fetchStrategy4LatestCompletePayload(',start);assert(start>0&&end>start);
const context={require,scorecardRecordDate:()=> '2026-09-18',codeOf:r=>r.code,priceOf:()=>20,highOf:()=>21,normalizeDate:v=>v,
 reasonOf:()=> 'test',nameOf:()=> 'test',entryTimeOf:()=> '16:00',cleanText:v=>String(v||''),pnlOf:()=>1,
 applyScorecardRuleMetadata:require('../lib/scorecard-rule-locks').applyScorecardRuleMetadata};
vm.createContext(context);vm.runInContext(text.slice(start,end),context);
const record=context.normalizeRecord({key:'strategy4',strategy:'策略4波段成績單'},{runId:'s4-run',sourceDate:'2026-09-18'},{code:'2330',run_id:'s4-run'},0);
assert.equal(record.source_binding_status,'BOUND');assert.equal(record.source_run_id,'s4-run');assert.equal(record.source_binding_evidence.symbol,'2330');
const conflict=context.normalizeRecord({key:'strategy4',strategy:'策略4波段成績單'},{runId:'s4-run',sourceDate:'2026-09-18'},{code:'2330',run_id:'other'},0);
assert.equal(conflict.source_binding_status,'DATA_GAP');
console.log(JSON.stringify({checks:4,scope:'isolated_actual_scorecard_normalizer_with_real_metadata',production_complete:false}));
