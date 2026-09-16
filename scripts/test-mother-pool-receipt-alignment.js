"use strict";
const assert = require("assert/strict");
const fs = require("fs"), path = require("path");
const { isPublishedMotherMember } = require("../lib/daytrade-published-membership");
const { verifyMorningStage } = require("../lib/mother-pool-morning-ack");
const date = "2026-09-16", now = Date.parse(`${date}T05:10:00Z`);
const common = { trade_date:date, report_run_id:"fixture-only", complete:true,ok:true,status:"complete",exitCode:0,
  first_blocker:null,db_readback_ok:true,missing_fields:[],formal_candidate_allowed:false,forbidden_publish_guard:true,
  formal_candidate_count:0,received_symbols:1,db_readback_symbols:["2330"] };
const h={...common,contract:"opening-report-0830-mother-pool-handoff-ack-v2",checked_at:`${date}T05:00:00Z`};
const p={...common,contract:"opening-report-0830-mother-pool-persistence-ack-v1",checked_at:`${date}T05:09:00Z`,
  writer_refreshes_observed:2,writer_refresh_timestamps:[`${date}T05:03:00Z`,`${date}T05:08:00Z`]};
assert.equal(verifyMorningStage(h,p,date,now).complete,true);
for(const changed of [{trade_date:"2026-09-15"},{report_run_id:"other"},{complete:false},{formal_candidate_allowed:true},
 {db_readback_symbols:["2330","2330"]},{writer_refresh_timestamps:[`${date}T04:59:00Z`,`${date}T05:08:00Z`]},
 {writer_refresh_timestamps:[`${date}T05:03:00Z`,`${date}T05:03:00Z`]}, {missing_fields:["source"]}]) {
  assert.equal(verifyMorningStage(h,{...p,...changed},date,now).complete,false);
}
assert.equal(verifyMorningStage({...h,contract:"opening-report-0830-mother-pool-field-ack-v1"},p,date,now).complete,false);
assert.equal(verifyMorningStage({...h,received_symbols:0,db_readback_symbols:[]},{...p,received_symbols:0,db_readback_symbols:[]},date,now).complete,true);
assert.equal(isPublishedMotherMember({payload:{pool_layer:"morning_watch_only",formal_pool_eligible:false}}),false);
assert.equal(isPublishedMotherMember({basePool:{eligible:true},metrics:{price:100}}),true);
assert.equal(isPublishedMotherMember({basePool:{eligible:true},metrics:{price:0}}),false);
assert.equal(isPublishedMotherMember({terminalForcedAdmission:true}),true);
const root=path.resolve(__dirname,"..");
const writer=fs.readFileSync(path.join(root,"scripts/run-daytrade-source-writer.js"),"utf8");
assert.equal(writer.split(".filter(isPublishedMotherMember)").length-1,2);
const verifier=fs.readFileSync(path.join(root,"scripts/verify-daytrade-mother-pool-closed-loop.js"),"utf8");
assert(!verifier.includes("mother-pool-field-ack"));
assert(verifier.includes('scope: "mother_pool_core_water"'));
assert(verifier.includes("all_modules_complete: failures.length === 0 && morningHandoffComplete"));
console.log("PASS membership identity, watch-only exclusion, two-stage ACK positive/negative/zero cases, independent scope");
