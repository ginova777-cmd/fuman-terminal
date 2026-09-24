"use strict";
const path = require("path");
const CONTRACT = "opening-report-two-stage-v1";
const STAGES = Object.freeze({
  us_0820: Object.freeze({ id: "us_0820", time: "08:20", markets: ["us"], captureNight: true }),
  asia_0850: Object.freeze({ id: "asia_0850", time: "08:50", markets: ["japan", "korea"], captureNight: false }),
});
function stage(id = process.env.FUMAN_MORNING_STAGE || "us_0820") {
  if (!Object.hasOwn(STAGES, id)) throw Error("morning_stage_invalid:" + id);
  return STAGES[id];
}
function market(symbol) {
  if (/\.T$/i.test(symbol)) return "japan";
  if (/\.(KS|KQ)$/i.test(symbol)) return "korea";
  return /\./.test(symbol) ? "other" : "us";
}
function allowed(symbol, id) {
  return !["5803.T", "000725.SZ"].includes(String(symbol).toUpperCase()) && stage(id).markets.includes(market(symbol));
}
function cutoff(date, id) { return `${date}T${stage(id).time}:59.999+08:00`; }
function canStart(date, now, id) {
  const start = Date.parse(`${date}T${stage(id).time}:00+08:00`);
  const actual = Date.parse(now);
  return Number.isFinite(start) && Number.isFinite(actual) && actual >= start && actual <= Date.parse(cutoff(date, id));
}
function directory(runtime, id) { return path.join(runtime, "data", "opening-report-stages", stage(id).id); }
function settlementReminder(date, officialDates) {
  // Dates must come from the authoritative exchange calendar, including holiday adjustments.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(officialDates)) throw Error("settlement_calendar_required");
  const today = Date.parse(date + "T00:00:00Z");
  for (const settlement of [...officialDates].sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(settlement)) throw Error("settlement_date_invalid");
    const end = Date.parse(settlement + "T00:00:00Z");
    const weekDay = new Date(end).getUTCDay();
    const monday = end - ((weekDay + 6) % 7) * 86400000;
    if (today >= monday && today <= end) return `${Number(settlement.slice(5,7))}/${Number(settlement.slice(8,10))} 台指期結算`;
  }
  return "";
}
function verifyStageIdentity(receipt, date, id) {
  const expected = stage(id);
  const issues = [];
  if (receipt?.stage !== expected.id || receipt?.stage_contract !== CONTRACT) issues.push("stage_identity_mismatch");
  if (receipt?.trade_date !== date && receipt?.date !== date) issues.push("stage_date_mismatch");
  if (!receipt?.run_id || !String(receipt.run_id).includes(expected.id)) issues.push("stage_run_id_missing");
  const leaders = (receipt?.industries || []).flatMap(row => row.leaders || []);
  if (!leaders.length || !leaders.every(row => allowed(row.yahoo_symbol, id))) issues.push("stage_source_scope_mismatch");
  return issues;
}
function verifyNight(e,{date,runId,cutoff:currentCutoff,runtime}) {
  const night=require('./opening-report-night-futures');
  if(stage().captureNight) return night.verify(e,{date,runId,cutoff:currentCutoff});
  try {
    const fs=require('fs'),base=directory(runtime,'us_0820'),day=date.replace(/-/g,'');
    const frozen=JSON.parse(fs.readFileSync(path.join(base,'opening-report-0830-market-snapshot-'+day+'.json'),'utf8'));
    const preflight=require('./opening-frozen-preflight-recovery').resolvePreflight(base,date);
    if(frozen.ok!==true||frozen.date!==date||frozen.stage!=='us_0820'||!String(frozen.run_id).includes('us_0820')||preflight.ok!==true||preflight.date!==date||preflight.run_id!==frozen.run_id) return ['night_parent_preflight_invalid'];
    if(!require('util').isDeepStrictEqual(e,frozen.night_futures)) return ['night_parent_evidence_mismatch'];
    const recovery=frozen.recovery;
    const parentCutoff=recovery?recovery.cutoff_at:cutoff(date,'us_0820');
    if(recovery&&(recovery.contract!=='opening-morning-authorized-recovery-v1'||recovery.stage!=='us_0820'||recovery.trade_date!==date||recovery.run_id!==frozen.run_id||!['user-20260916-two-stage-replay'].includes(recovery.authorization)||!Number.isFinite(Date.parse(recovery.started_at))||!Number.isFinite(Date.parse(parentCutoff))||Date.parse(parentCutoff)<=Date.parse(recovery.started_at)||Date.parse(parentCutoff)-Date.parse(recovery.started_at)>600000)) return ['night_parent_recovery_invalid'];
    return night.verify(e,{date,runId:frozen.run_id,cutoff:parentCutoff});
  } catch(error) { return ['night_parent_readback_failed:'+error.message]; }
}
module.exports = { verifyNight, CONTRACT, STAGES, stage, market, allowed, cutoff, canStart, directory, settlementReminder, verifyStageIdentity };
