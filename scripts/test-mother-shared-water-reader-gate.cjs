'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const file=path.resolve(__dirname,'../lib/strategy3-canonical-water-reader.js');
const context={require:require('node:module').createRequire(file),module:{exports:{}},__dirname:path.dirname(file),process,console,URL,URLSearchParams,AbortSignal,setTimeout,fetch};
vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports.testValidateGate=validateGate;',context);
const gate=context.module.exports.testValidateGate;
const good={grade:'A',status:'ready',formal_entry_allowed:true,formal_entry_speed_verdict:'YES',scanner_can_run_opening:true,formal_source_alignment_ok:true,priority_fresh_quote_coverage_120s:0.86,quote_age_seconds:10,websocket_formal_ready:true,websocket_connected:true,websocket_authenticated:true,websocket_rest_disabled:true,websocket_streaming_channels:['trades','aggregates','candles'],failed_checks:[]};
function check(row,proof){const failures=[];gate(row,'source',failures,proof);return failures;}
assert.deepEqual(check(good,null),['source_priority_quote_coverage_below_095']);
assert.deepEqual(check(good,{water_gate_pass:true,membership_verified:true}),[]);
for(const proof of [{},{water_gate_pass:true},{water_gate_pass:false,membership_verified:true}])assert.deepEqual(check({...good,priority_fresh_quote_coverage_120s:1},proof),['source_shared_water_unverified']);
const verified={water_gate_pass:true,membership_verified:true};
assert.deepEqual(check({...good,quote_age_seconds:121},verified),['source_quote_age_above_90']);
assert.deepEqual(check({...good,formal_source_alignment_ok:false},verified),['source_source_alignment_failed']);
assert.deepEqual(check({...good,failed_checks:['other']},verified),['source_failed_checks_not_empty']);
console.log(JSON.stringify({ok:true,cases:8,mode:'real_reader_gate_isolation',deployed:false,other_gates_preserved:true}));
