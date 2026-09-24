"use strict"; const assert=require("node:assert/strict"); const d=require("../lib/preopen-a15-a19");
assert.equal(d.a15({prev_high:110,prev_low:100,prev_close:105}).prev_range,10);
assert.throws(()=>d.a16([{values:Array.from({length:10},()=>1)}]),/A16_LEGACY_VALUES_VERIFIER_RETIRED/);
assert.equal(d.a17([{symbol:"2330",trade_date:"2026-09-17",capture_slot:"08:45",is_trial:true,trial_price:100}]).data_gap,true);
assert.equal(d.a15({prev_high:null,prev_low:null,prev_close:null}).data_gap,true);
assert.equal(d.a19({}).complete,false);
assert.deepEqual(d.a18([{status:"READY"}]).failed_checks,['A16_NO_ROWS','A17_TRIAL_DATA_GAP']);
const completeParts={a15:[{status:'READY'}],a16:[{status:'READY',contract:'mother_pool_a16_writer_reference_v1',db_readback_ok:true,source_ready:true}],a17:{complete:true,data_gap:false}};
assert.equal(d.a18(completeParts).failed_checks.length,0);
for(const key of ['a15','a16','a17']){const missing={...completeParts};delete missing[key];assert(d.a18(missing).failed_checks.length>0);}
assert.equal(d.a19({a15:{data_gap:false},a16:[{status:"READY"}],a17:{data_gap:false},a18:{failed_checks:[]}}).complete,false);
console.log("PASS A15-A19 isolated checks, including mandatory A15/A16/A17 closure evidence");
