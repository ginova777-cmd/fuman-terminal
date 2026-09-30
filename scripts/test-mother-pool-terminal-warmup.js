'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const source=fs.readFileSync(path.join(__dirname,'run-daytrade-source-writer.js'),'utf8');
const expression=source.match(/warmingPending: (row\.basePool\.pending[^\n]+),/)[1];
const classify=new Function('row','return '+expression);
const cases=[
 {symbol:'2330',basePool:{eligible:true,pending:false},terminalForcedAdmission:true,expected:false},
 {symbol:'2317',basePool:{eligible:false,pending:true},terminalForcedAdmission:true,expected:true},
 {symbol:'2454',basePool:{eligible:false,pending:false},terminalForcedAdmission:true,expected:true},
 {symbol:'2308',basePool:{eligible:true,pending:false},terminalForcedAdmission:false,expected:false},
];
for(const row of cases)assert.equal(classify(row),row.expected);
const rows=cases.map(r=>({symbol:r.symbol,payload:{formal_pool_eligible:r.basePool.eligible,warming_pending:classify(r)}}));
const {allocate}=require('../lib/mother-pool-scan-allocation');
const result=allocate(rows,{identity:{trade_date:'2026-09-30',canonical_run_id:'fugle_daytrade_source:20260930:canonical',writer_run_id:'isolated-test',generation_id:'isolated-test'},asOf:'2026-09-30T03:00:00Z'});
assert.deepEqual([...result.selected_symbols].sort(),['2308','2330']);
console.log('PASS: qualified terminal seeds reach deep scan; pending and failed seeds remain blocked.');
