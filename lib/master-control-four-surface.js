"use strict";
const fs = require("fs");
const path = require("path");

const STRATEGIES = {
  strategy2: { endpoint: "/api/strategy2-latest?compact=1&limit=1200&live=1", mobile: "strategy2", receipts: ["strategy2-v3-live.json", "strategy2.json"] },
  strategy3: { endpoint: "/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=1200&live=1", mobile: "strategy3", receipts: ["strategy3-v2-complete-scan-{date}.json", "strategy3-v2.json", "strategy3.json"] },
  strategy4: { endpoint: "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=1200&live=1", mobile: "strategy4", receipts: ["strategy4.json"] },
  strategy5: { endpoint: "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=1200&live=1", mobile: "strategy5", receipts: ["strategy5.json"] },
  institution: { endpoint: "/api/institution-latest?canvas=1&compact=1&shell=1&limit=1200&live=1", mobile: "chip", receipts: ["institution.json"] },
};
const IDENTITY_FIELDS = ["tradeDate", "runId", "resultCount"];
const ROUTE88_FIELDS = ["strategy", "tradeDate", "sourceDate", "runId", "startedAt", "finishedAt", "universeCount", "scannedCount", "resultCount", "qualityStatus", "evidenceStatus", "fallbackUsed", "publishAllowed", "desktopStatus", "mobileStatus", "scorecardUpdatedAt", "firstBlocker", "reasonCode"];

function compactDate(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function normalizeKey(value) { return String(value || "").replace(/[_\-\s/]/g, "").toLowerCase(); }
function first(object, paths, fallback = "") {
  for (const pathText of paths) {
    const value = pathText.split(".").reduce((row, key) => row?.[key], object);
    if (value !== undefined && value !== null && String(value) !== "") return value;
  }
  return fallback;
}
function rowsOf(payload) {
  for (const key of ["rows", "results", "matches", "items", "data", "records", "signals"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}
function identity(payload) {
  const rows = rowsOf(payload);
  return {
    tradeDate: compactDate(first(payload, ["tradeDate", "trade_date", "scanDate", "scan_date", "sourceDate", "usedDate", "marketDate", "market_date", "payload.tradeDate"])),
    runId: String(first(payload, ["runId", "run_id", "canonicalRunId", "transport.runId", "payload.runId"])),
    resultCount: number(first(payload, ["resultCount", "result_count", "matches", "count", "readbackCount"], rows.length)),
  };
}
function mobileIdentity(html) {
  const attr = (names) => { for (const name of names) { const hit = String(html || "").match(new RegExp(`${name}=["']([^"']*)["']`, "i")); if (hit) return hit[1]; } return ""; };
  return { tradeDate: compactDate(attr(["data-trade-date", "data-source-date", "data-scan-date"])), runId: attr(["data-run-id"]), resultCount: number(attr(["data-result-count", "data-count", "data-row-count"])) };
}
function findRoute88(payload, strategy, seen = new Set()) {
  if (!payload || typeof payload !== "object" || seen.has(payload)) return null;
  seen.add(payload);
  const aliasesByStrategy = { strategy2: ["strategy2", "策略2", "策略2成績單"], strategy3: ["strategy3", "策略3", "策略3v2", "策略3隔日沖成績單"], strategy4: ["strategy4", "策略4", "策略4成績單"], strategy5: ["strategy5", "策略5", "策略5成績單", "綜合策略"], institution: ["institution", "buysell", "買賣超", "買賣超成績單", "法人"] };
  const aliases = new Set((aliasesByStrategy[strategy] || [strategy]).map(normalizeKey));
  if (!Array.isArray(payload) && Array.isArray(payload.sourceReports)) {
    const report = payload.sourceReports.find((row) => aliases.has(normalizeKey(row?.key || row?.strategy || row?.name)));
    if (report) return report;
  }
  if (!Array.isArray(payload)) {
    const key = normalizeKey(payload.strategy || payload.strategyKey || payload.key || payload.name);
    if (aliases.has(key)) return payload;
    if (payload.sourceReports?.[strategy]) return payload.sourceReports[strategy];
  }
  for (const child of Object.values(payload)) { const found = findRoute88(child, strategy, seen); if (found) return found; }
  return null;
}
function readReceipt(runtimeDir, strategy, tradeDate) {
  const dir = path.join(runtimeDir, "data", "scan-receipts");
  for (const pattern of STRATEGIES[strategy].receipts) {
    const file = path.join(dir, pattern.replace("{date}", tradeDate));
    try { const payload = JSON.parse(fs.readFileSync(file, "utf8")); return { file, payload, ...identity(payload), complete: String(payload.status || "").toLowerCase() === "complete" && (payload.complete === true || payload.ok === true) && payload.publish_allowed !== false && payload.publishAllowed !== false, fallbackUsed: payload.fallback === true || payload.fallbackUsed === true || payload.fallback_used === true }; } catch {}
  }
  return { file: path.join(dir, STRATEGIES[strategy].receipts[0].replace("{date}", tradeDate)), payload: null, tradeDate: "", runId: "", resultCount: null, complete: false, fallbackUsed: false };
}
async function request(baseUrl, endpoint, headers, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(endpoint, baseUrl), { cache: "no-store", headers: { Accept: "application/json, text/html", "Cache-Control": "no-cache", ...headers }, signal: controller.signal });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { ok: response.ok, status: response.status, text, json };
  } catch (error) { return { ok: false, status: 0, text: "", json: null, error: error?.message || String(error) }; }
  finally { clearTimeout(timer); }
}
function compare(strategy, receipt, surfaces, due, expectedTradeDate = "") {
  const issues = [];
  if (!due) return issues;
  const expectedDate = compactDate(expectedTradeDate);
  if (!receipt.complete) issues.push(`${strategy}:complete_scan_receipt_not_complete`);
  if (receipt.fallbackUsed) issues.push(`${strategy}:complete_scan_receipt_fallback_used`);
  // Stale receipt + stale surfaces can agree with each other but are not today's closure.
  if (expectedDate && receipt.tradeDate && receipt.tradeDate !== expectedDate) issues.push(`${strategy}:receipt_tradeDate_not_current:${receipt.tradeDate}!=${expectedDate}`);
  for (const field of IDENTITY_FIELDS) {
    const canonical = receipt[field];
    if (canonical === "" || canonical === null || canonical === undefined) issues.push(`${strategy}:receipt_${field}_missing`);
    for (const [surface, row] of Object.entries(surfaces)) {
      const value = row?.[field];
      if (value === "" || value === null || value === undefined) issues.push(`${strategy}:${surface}_${field}_missing`);
      else if (canonical !== "" && canonical !== null && canonical !== undefined && String(value) !== String(canonical)) issues.push(`${strategy}:${surface}_${field}_mismatch:${value}!=${canonical}`);
      if (field === "tradeDate" && expectedDate && value && compactDate(value) !== expectedDate) issues.push(`${strategy}:${surface}_tradeDate_not_current:${compactDate(value)}!=${expectedDate}`);
    }
  }
  return issues;
}

async function auditFourSurfaces({ baseUrl, runtimeDir, headers = {}, timeoutMs = 45000, dueByStrategy = {}, tradeDate }) {
  const date = compactDate(tradeDate);
  const scorecard = await request(baseUrl, "/api/scorecard?live=1&refreshSourceReports=1&strictLiveReports=1&noCache=1", headers, timeoutMs);
  const blockers = [];
  if (!scorecard.ok || !scorecard.json) blockers.push(`route88:http_or_json_failure:${scorecard.status}`);
  const strategies = [];
  for (const [strategy, config] of Object.entries(STRATEGIES)) {
    const due = dueByStrategy[strategy] === true;
    const [desktopRead, mobileRead] = await Promise.all([
      request(baseUrl, config.endpoint, headers, timeoutMs),
      request(baseUrl, `/api/mobile-fragment?tab=${encodeURIComponent(config.mobile)}&live=1&noSnapshot=1`, headers, timeoutMs),
    ]);
    const receipt = readReceipt(runtimeDir, strategy, date);
    const route88Row = findRoute88(scorecard.json, strategy);
    const surfaces = { desktop: identity(desktopRead.json), mobile: mobileIdentity(mobileRead.text), route88: identity(route88Row) };
    const issues = [];
    if (due && !desktopRead.ok) issues.push(`${strategy}:desktop_http_${desktopRead.status}`);
    if (due && !mobileRead.ok) issues.push(`${strategy}:mobile_http_${mobileRead.status}`);
    if (due && !route88Row) issues.push(`${strategy}:route88_row_missing`);
    if (due && route88Row) for (const field of ROUTE88_FIELDS) if (!(field in route88Row)) issues.push(`${strategy}:route88_field_missing:${field}`);
    issues.push(...compare(strategy, receipt, surfaces, due, date));
    strategies.push({ strategy, due, receipt, surfaces, route88RequiredFieldsPresent: route88Row ? ROUTE88_FIELDS.filter((field) => field in route88Row) : [], issues });
    blockers.push(...issues);
  }
  return { ok: blockers.length === 0, contract: "master-control-four-surface-v1", tradeDate: date, scorecardHttpStatus: scorecard.status, strategies, blockers };
}

module.exports = { auditFourSurfaces, compare, ROUTE88_FIELDS };
