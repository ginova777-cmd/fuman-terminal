"use strict";
const assert = require("assert/strict");
const { verifyExistingSnapshot } = require("../lib/opening-report-resume-snapshot");
async function main() {
  const final = { run_id: "test-run", date: "2026-10-02", delivery_content_hash: "test-hash", display_top3: [{rank:1,symbol:"TEST"}], night_futures:{close:100}, night_futures_summary:"test-night" };
  const row = { snapshotId:final.run_id, tradeDate:"20261002", payload:{...structuredClone(final),ok:true,stage:"us_0820",stage_contract:"opening-report-two-stage-v1"} };
  let calls = 0;
  const options = {final,stage:"us_0820",stageContract:"opening-report-two-stage-v1",tradeDate:final.date,runId:final.run_id};
  const readSnapshot = async (key, opts) => { calls++; assert.equal(key,"opening_report_0830_terminal_briefing_us_0820"); assert.equal(opts.maxAttempts,1); assert.equal(opts.allowLatestFallback,false); assert.equal(opts.timeoutMs,10000); return structuredClone(row); };
  assert.equal((await verifyExistingSnapshot({...options,readSnapshot})).snapshot_written,false);
  assert.equal(calls,1);
  const mutations = [r=>r.snapshotId="other",r=>r.tradeDate="20261001",r=>r.payload.run_id="other",r=>r.payload.date="2026-10-01",r=>r.payload.stage="asia_0850",r=>r.payload.stage_contract="old",r=>r.payload.ok=false,r=>r.payload.delivery_content_hash="other",r=>r.payload.display_top3[0].symbol="CHANGED",r=>r.payload.night_futures.close=99,r=>r.payload.night_futures_summary="changed"];
  for(const mutate of mutations){const invalid=structuredClone(row);mutate(invalid);const result=await verifyExistingSnapshot({...options,readSnapshot:async()=>invalid});assert.equal(result.ok,false);assert.equal(result.preserve_previous_good,true);}
  for(const read of [async()=>null,async()=>{throw Error("connection failed")}]) assert.equal((await verifyExistingSnapshot({...options,readSnapshot:read})).ok,false);
  let unexpectedRead=false;
  assert.equal((await verifyExistingSnapshot({...options,final:{...final,delivery_content_hash:null},readSnapshot:async()=>{unexpectedRead=true}})).ok,false);
  assert.equal(unexpectedRead,false);
  console.log("PASS: verified same-stage readback; 11 identity mismatches, missing/error readback and incomplete expectation fail closed; no snapshot writer used.");
}
main().catch(e=>{console.error(e);process.exitCode=1});
