"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const {validate}=require("../lib/opening-frozen-preflight-recovery");
function fixture(){
 const common={ok:true,date:"2026-09-24",run_id:"run-us_0820",stage:"us_0820",checked_at:"2026-09-24T08:20:30+08:00",cutoff:"2026-09-24T08:20:59.999+08:00"};
 return {attempt:{...common,ok:false,within_0830_preflight_window:false,overseas_detector_stderr_tail:"outside_0830_preflight_window"},
 frozen:{...common,items:[1,2,3,4]},leaders:{...common,detection_policy:"us_only_tx_night_0820_v1",industries:Array.from({length:15},()=>({leaders:[]}))},
 consumed:{...common,contract:"opening-report-0830-overseas-preflight-v1",source_receipt_run_id:common.run_id,source_cutoff:common.cutoff,industry_count:15}};
}
test("only independently verified frozen evidence can recover expired retry",()=>assert.deepEqual(validate(fixture(),"2026-09-24","us_0820",[]),[]));
test("changed identity, later data, failed original evidence and bad raw night evidence reject recovery",()=>{
 const edits=[e=>e.frozen.run_id="wrong",e=>e.leaders.checked_at="2026-09-24T10:00:00+08:00",e=>e.consumed.ok=false,e=>e.attempt.overseas_detector_stderr_tail="network_error",e=>e.leaders.detection_policy="wrong",e=>e.frozen.cutoff="changed"];
 for(const edit of edits){const e=fixture();edit(e);assert.ok(validate(e,"2026-09-24","us_0820",[]).length);}
 assert.ok(validate(fixture(),"2026-09-24","us_0820",["hash_mismatch"]).length);
});

test("resumed consumption may be later while frozen sources remain inside cutoff",()=>{const e=fixture();e.consumed.checked_at="2026-09-24T18:30:00+08:00";assert.deepEqual(validate(e,"2026-09-24","us_0820",[]),[]);e.frozen.checked_at="2026-09-24T18:00:00+08:00";assert.ok(validate(e,"2026-09-24","us_0820",[]).includes("frozen_capture_outside_window"));});
