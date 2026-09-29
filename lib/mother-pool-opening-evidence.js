"use strict";
const fs = require("fs");
const path = require("path");
const { STAGES, CONTRACT, directory } = require("./opening-report-stage-contract");
function read(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function inspectStage({ final, bridge, ack }, date, stage) {
  const sameRun = Boolean(final?.run_id) && bridge?.run_id === final.run_id && ack?.report_run_id === final.run_id;
  const identity = final?.stage === stage && final?.stage_contract === CONTRACT
    && final?.date === date && bridge?.trade_date === date && ack?.trade_date === date && sameRun;
  const count = final?.priority_observation_count;
  const bridgeOk = identity && final?.complete === true && final?.status === "complete" && final?.exitCode === 0
    && final?.expected_industry_count === 15 && final?.scanned_industry_count === 15
    && final?.priority_observation_contract_ok === true
    && Number.isInteger(count) && count >= 0 && count <= 3
    && bridge?.status === "BRIDGE_OK" && bridge?.observation_count === count
    && bridge?.industry_count === bridge?.successful_industry_count
    && bridge?.forbidden_publish_guard === true && bridge?.formal_candidate_count === 0 && bridge?.formal_candidate_allowed === false;
  const symbols = Array.isArray(ack?.accepted_symbols) ? [...new Set(ack.accepted_symbols.map(String))] : [];
  const readback = new Set(ack?.accepted_readback_symbols || []);
  const ackOk = identity && ack?.contract === "opening-report-0830-mother-pool-handoff-ack-v2"
    && ack?.complete === true && ack?.db_readback_ok === true && ack?.first_blocker == null
    && ack?.disposition_contract === "opening-report-handoff-dispositions-v1"
    && Array.isArray(ack?.business_excluded_symbols) && Array.isArray(ack?.accepted_symbols)
    && ack?.accepted_count === symbols.length && ack?.accepted_readback_count === symbols.length
    && readback.size === symbols.length && symbols.every(symbol => /^\d{4}$/.test(symbol) && readback.has(symbol))
    && ack?.formal_candidate_count === 0 && ack?.formal_candidate_allowed === false && ack?.forbidden_publish_guard === true;
  return { stage, bridgeOk, ackOk, symbols, runId: final?.run_id || null };
}
function readOpeningEvidence(runtime, date, minute) {
  const compact = date.replace(/-/g, "");
  const stages = Object.values(STAGES).filter(stage => {
    const [hour, min] = stage.time.split(":").map(Number);
    return minute >= hour * 60 + min + 6;
  }).map(stage => {
    const base = directory(runtime, stage.id);
    const finalPath = path.join(base, `opening-report-0830-final-receipt-${compact}.json`);
    const bridgePath = path.join(base, `opening-report-0830-bridge-aggregate-${compact}.json`);
    const final = read(finalPath);
    const ackPath = final?.mother_pool_handoff_ack_receipt || "";
    const evidence = inspectStage({ final, bridge: read(bridgePath), ack: read(ackPath) }, date, stage.id);
    return { ...evidence, finalPath, bridgePath, ackPath };
  });
  return { required: stages.length > 0, stages, bridgeOk: stages.every(s => s.bridgeOk), ackOk: stages.every(s => s.ackOk), symbols: [...new Set(stages.flatMap(s => s.symbols))] };
}
module.exports = { inspectStage, readOpeningEvidence };
