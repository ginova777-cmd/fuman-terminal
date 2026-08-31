"use strict";

// This verifier deliberately treats stale Japanese/Korean leader rows as source gaps.
// The 08:30 runner re-applies freshness before scoring, so a stale row must never
// promote an industry, but it must not suppress the rest of the morning report.
const fs = require("fs");
const path = require("path");
const { assessLeaderFreshness } = require("../lib/opening-report-asia-freshness");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const REPORT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");

function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function source(relative) {
  try { return fs.readFileSync(path.join(ROOT, relative), "utf8"); } catch { return ""; }
}
function stage(name, ok, details = {}) {
  return { name, ok: ok === true, status: ok === true ? "PASS" : "FAIL", ...details };
}

function frozenEvidence(tradeDate) {
  const compact = compactDate(tradeDate);
  const preflight = readJson(path.join(REPORT_DIR, `opening-report-0820-preflight-receipt-${compact}.json`));
  const leaders = readJson(path.join(REPORT_DIR, `opening-report-0820-overseas-leaders-${compact}.json`));
  const snapshot = readJson(path.join(REPORT_DIR, `opening-report-0820-market-snapshot-${compact}.json`));
  const rows = (Array.isArray(leaders?.industries) ? leaders.industries : []).flatMap((industry) => industry?.leaders || []);
  const cutoff = Date.parse(`${tradeDate}T08:20:00+08:00`);
  const futureRows = rows.filter((leader) => {
    const at = Date.parse(leader?.selected_time || leader?.source_time || "");
    return Number.isFinite(at) && at > cutoff;
  });
  const sourceGaps = rows.filter((leader) => {
    const freshness = assessLeaderFreshness(leader, tradeDate);
    return freshness.required && !freshness.fresh;
  }).map((leader) => ({
    name: leader?.name || "",
    yahoo_symbol: leader?.yahoo_symbol || "",
    source_time: leader?.selected_time || leader?.source_time || "",
    reason_code: assessLeaderFreshness(leader, tradeDate).reason_code,
  }));
  const futureSnapshots = (Array.isArray(snapshot?.items) ? snapshot.items : []).filter((item) => {
    const at = Date.parse(item?.source_time || "");
    return Number.isFinite(at) && at > cutoff;
  });
  return {
    preflight,
    leaders,
    snapshot,
    sourceGaps,
    futureRows,
    futureSnapshots,
    preflightOk: preflight?.ok === true
      && compactDate(preflight?.date) === compact
      && String(preflight?.evidence_cutoff || "").includes("08:20:00 Asia/Taipei"),
    leadersOk: Array.isArray(leaders?.industries)
      && leaders.industries.length === 19
      && String(leaders?.cutoff || "").includes("08:20:00 Asia/Taipei")
      && futureRows.length === 0,
    snapshotOk: Array.isArray(snapshot?.items)
      && snapshot.items.length >= 4
      && String(snapshot?.cutoff || "").includes("08:20:00 Asia/Taipei")
      && futureSnapshots.length === 0,
  };
}

function currentDelivery(tradeDate) {
  const compact = compactDate(tradeDate);
  const final = readJson(path.join(REPORT_DIR, `opening-report-0830-final-receipt-${compact}.json`));
  const stateFiles = fs.existsSync(STATE_DIR)
    ? fs.readdirSync(STATE_DIR).filter((name) => new RegExp(`^opening_report_0830\\.industry_bias\\..*${compact}.*\\.json$`, "i").test(name))
    : [];
  const states = stateFiles.map((name) => readJson(path.join(STATE_DIR, name))).filter(Boolean);
  const finalOk = ["REPORT_OK", "REPORT_DEGRADED"].includes(final?.report_status)
    && compactDate(final?.date || final?.trade_date) === compact
    && typeof final?.run_id === "string" && final.run_id.includes(compact)
    && typeof final?.delivery_content_hash === "string" && /^[a-f0-9]{64}$/i.test(final.delivery_content_hash)
    && final?.formal_candidates === 0 && final?.watchlist_only === true;
  const stateOk = states.length === 19 && states.every((item) => {
    const date = compactDate(item?.date || item?.trade_date);
    return date === compact
      && item?.report_time === "08:30"
      && item?.source === "opening_report_0830"
      && item?.mode === "priority_bias_only";
  });
  const terminalOk = final?.terminal_briefing_snapshot?.ok === true
    && final?.terminal_briefing_snapshot?.report_run_id === final?.run_id
    && final?.terminal_briefing_snapshot?.delivery_content_hash === final?.delivery_content_hash;
  return { final, stateFiles, finalOk, stateOk, terminalOk };
}

function main() {
  const tradeDate = process.env.FUMAN_TRADE_DATE || taipeiDate();
  const preDelivery = process.argv.includes("--pre-delivery");
  const requireCurrent = process.argv.includes("--require-current");
  const frozen = frozenEvidence(tradeDate);
  const checks = [
    stage("static_stale_asia_isolation", source("scripts/run-opening-report-0830-production.js").includes("applyLeaderFreshness")
      && source("scripts/run-opening-report-0820-preflight.js").includes("overseas_stale_promoted_count")),
    stage("static_wrapper_pre_delivery", source("run-opening-report-0830-production-wrapper.ps1").includes("--pre-delivery")),
    stage("preflight_freeze_only", source("scripts/run-opening-report-0820-preflight.js").includes("preflight_only_no_terminal_no_line_no_bridge")),
    stage("bridge_after_delivery_required", source("scripts/run-opening-report-0830-production.js").includes("const applyBridge = true")
      && source("run-opening-report-0830-production-wrapper.ps1").includes("bridge_handoff_required = $true")
      && source("run-opening-report-0830-production-wrapper.ps1").includes("bridge_deferred_outside_delivery_chain = $false")),
  ];

  if (preDelivery || requireCurrent) {
    checks.push(stage("current_preflight", frozen.preflightOk));
    checks.push(stage("current_frozen_leaders", frozen.leadersOk, {
      source_gap_count: frozen.sourceGaps.length,
      source_gaps: frozen.sourceGaps,
      future_leader_count: frozen.futureRows.length,
      reason_code: frozen.sourceGaps.length
        ? "opening_report_0830_pre_delivery_ok_with_source_gaps"
        : "opening_report_0830_pre_delivery_ok",
    }));
    checks.push(stage("current_frozen_market_snapshot", frozen.snapshotOk, {
      future_snapshot_count: frozen.futureSnapshots.length,
    }));
  }

  if (requireCurrent) {
    const delivery = currentDelivery(tradeDate);
    checks.push(stage("current_report_scope", delivery.finalOk));
    checks.push(stage("industry_bias_19_of_19", delivery.stateOk, { found: delivery.stateFiles.length, expected: 19 }));
    checks.push(stage("terminal_snapshot_same_run_hash", delivery.terminalOk));
  }

  const failed = checks.filter((item) => !item.ok);
  const output = {
    ok: failed.length === 0,
    contract: "opening_report_0830_complete_contract_verifier_v2",
    date: tradeDate,
    mode: preDelivery ? "pre_delivery" : requireCurrent ? "current_closure" : "static",
    checks,
    failed_checks: failed.map((item) => item.name),
    first_blocker: failed[0]?.name || null,
    read_only: true,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}

main();
