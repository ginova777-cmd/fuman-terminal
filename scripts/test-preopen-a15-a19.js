"use strict"; const assert=require("node:assert/strict"); const d=require("../lib/preopen-a15-a19");
assert.equal(d.a15({prev_high:110,prev_low:100,prev_close:105}).prev_range,10);
assert.equal(d.a16([{values:Array.from({length:10},()=>1)}])[0].status,"READY");
assert.equal(d.a17([{capture_slot:"08:45",is_trial:true,trial_price:100}]).data_gap,false);
assert.equal(d.a18([{status:"READY"}]).failed_checks.length,0);
assert.equal(d.a19({a15:{data_gap:false},a16:[{status:"READY"}],a17:{data_gap:false},a18:{failed_checks:[]}}).complete,true);
console.log("5/5 A15-A19 isolated checks passed");
