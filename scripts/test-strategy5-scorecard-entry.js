'use strict';
const assert=require('assert'),{normalizeRecord}=require('./generate-terminal-scorecard-source');
const task={key:'strategy5',strategy:'策略5成績單'},payload={runId:'strategy5-20260911-20260911040538',sourceDate:'2026-09-11',usedDate:'2026-09-11'};
const row=normalizeRecord(task,payload,{code:'2330',name:'test',close:20,high:99,reason:'test',date:'2026-09-11'},0);
assert.equal(row.entry_price,20);assert.equal(row.high_price,20);assert.equal(row.runId,payload.runId);assert.equal(row.forward_observation_status,'not_started');
assert.throws(()=>normalizeRecord(task,payload,{code:'2330',close:20,runId:'different-run'},0),/source run mismatch/);
console.log('PASS Strategy5 after-close entry excludes pre-entry high and rejects mixed run');
