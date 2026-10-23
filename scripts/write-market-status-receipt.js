"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isTwseTradingDay, taipeiDateParts, dateKey } = require("./twse-trading-day");
function arg(name, fallback = "") { const hit = process.argv.find((v) => v === `--${name}` || v.startsWith(`--${name}=`)); return hit ? (hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true") : fallback; }
function compactDate(value) { const s = String(value || "").replace(/\D/g, ""); return s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : ""; }
function sha256(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function classify(day) {
  if (!day || typeof day.isTradingDay !== "boolean" || day.error || ["stale_cache", "weekend_fallback"].includes(day.source)) return { status: "BLOCKED", reason: "MARKET_STATUS_UNVERIFIED", exitCode: 2 };
  if (day.isTradingDay) return { status: "OPEN", reason: "TRADING_DAY", exitCode: 0 };
  const text = `${day.reason || ""} ${day.row?.Name || ""} ${day.row?.Description || ""}`;
  const typhoon = /typhoon|颱風|停班|停課/i.test(text);
  if (typhoon && (!day.source || !(day.row?.sourceUrl || day.row?.source_url) || !(day.row?.announcementDate || day.row?.Date) || !(day.row?.effectiveAt || day.row?.effective_at) || !(day.row?.sourceSha256 || day.row?.evidenceSha256))) return { status: "BLOCKED", reason: "MARKET_STATUS_UNVERIFIED", exitCode: 2 };
  return { status: "SKIPPED", reason: typhoon ? "MARKET_CLOSED_TY" : "MARKET_CLOSED", exitCode: 10 };
}
async function main() {
  const now = new Date(); const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime"; const stateDir = process.env.FUMAN_STATE_DIR || path.join(runtime, "state");
  const requested = compactDate(arg("trade-date")) || dateKey(taipeiDateParts(now));
  let day = await isTwseTradingDay(new Date(`${requested}T04:00:00+00:00`), { stateDir, includeEvidence: true });
  if (day.isTradingDay === true && !day.error) {
    try {
      const emergency = await require('./market-emergency-status.cjs').check(requested);
      day = emergency.isTradingDay ? { ...day, emergencyEvidence: emergency } : emergency;
    } catch (error) { day = { ...day, error: error.message }; }
  }
  const verdict = classify(day); const stage = arg("stage", "unknown"); const executionMode = arg("execution-mode", "natural"); const runId = arg("run-id", `market-status-${requested.replace(/-/g, "")}-${crypto.randomUUID()}`);
  const evidence = { date: requested, day, source: day?.source || "", sourceUrl: day?.calendar_evidence?.source_url || day?.row?.sourceUrl || day?.row?.source_url || "", announcementDate: day?.row?.announcementDate || day?.row?.Date || "", row: day?.row || null };
  const receipt = { contract: "market-status-receipt-v1", receiptType: "market_status", tradeDate: requested, runId, stage, executionMode, checkedAt: new Date().toISOString(), status: verdict.status, skipReason: verdict.reason, complete: verdict.status !== "BLOCKED", exitCode: verdict.exitCode, marketOpen: day?.isTradingDay === true, source: day?.source || "", sourceVerified: verdict.status !== "BLOCKED" && day?.source !== "weekend_fallback", evidenceSha256: sha256(evidence), evidence, override: day?.override === true, overrideFile: day?.overrideFile || "" };
  receipt.runId = `market-decision-${requested}-${receipt.evidenceSha256}`;
  receipt.stage = 'market'; receipt.executionMode = 'decision';
  const outDir = path.join(runtime, "data", "market-status"); fs.mkdirSync(outDir, { recursive: true }); const out = path.join(outDir, `market-status-${requested.replace(/-/g, "")}-${receipt.evidenceSha256}.json`);
  if (fs.existsSync(out)) {
    const existing = JSON.parse(fs.readFileSync(out, "utf8"));
    if (existing.tradeDate !== requested || existing.contract !== "market-status-receipt-v1" || existing.evidenceSha256 !== sha256(existing.evidence) || existing.evidenceSha256 !== receipt.evidenceSha256 || existing.status !== verdict.status || existing.exitCode !== verdict.exitCode || existing.marketOpen !== receipt.marketOpen || existing.sourceVerified !== receipt.sourceVerified) throw Error("MARKET_STATUS_RECEIPT_CONFLICT");
    receipt.checkedAt = existing.checkedAt; receipt.runId = existing.runId; receipt.status = existing.status; receipt.skipReason = existing.skipReason; receipt.complete = existing.complete; receipt.exitCode = existing.exitCode; receipt.marketOpen = existing.marketOpen; receipt.source = existing.source; receipt.sourceVerified = existing.sourceVerified; receipt.evidenceSha256 = existing.evidenceSha256; receipt.evidence = existing.evidence; receipt.override = existing.override; receipt.overrideFile = existing.overrideFile;
  } else fs.writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  if (verdict.status === "SKIPPED") {
    const scanDir = path.join(runtime, "data", "scan-receipts"); fs.mkdirSync(scanDir, { recursive: true });
    const scanReceipt = { contract: "market-status-wrapper-skip-v1", strategy: stage, tradeDate: requested, runId, stage, executionMode, marketReceipt: out, skipReason: verdict.reason, status: "SKIPPED", complete: false, evaluationComplete: true, scanExecuted: false, exitCode: 0, decisionExitCode: verdict.exitCode, checkedAt: receipt.checkedAt };
    const skipPath = path.join(scanDir, `${stage}-market-closed-${requested.replace(/-/g, "")}-${receipt.evidenceSha256}-${sha256({runId, executionMode})}.json`);
    try { fs.writeFileSync(skipPath, `${JSON.stringify(scanReceipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const prior = JSON.parse(fs.readFileSync(skipPath, "utf8"));
      if (prior.marketReceipt !== out || prior.status !== scanReceipt.status || prior.exitCode !== scanReceipt.exitCode) throw Error("WRAPPER_RECEIPT_CONFLICT");
    }
  }
  console.log(JSON.stringify({ ok: verdict.status === "OPEN", receiptPath: out, ...receipt, wrapperRunId: runId, wrapperStage: stage, wrapperExecutionMode: executionMode })); process.exitCode = verdict.exitCode;
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, status: "BLOCKED", skipReason: "MARKET_STATUS_UNVERIFIED", error: error.message })); process.exitCode = 2; });
