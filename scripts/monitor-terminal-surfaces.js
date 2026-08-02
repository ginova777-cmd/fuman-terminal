"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-surface-monitor");
const OUT_FILE = path.join(OUT_DIR, "terminal-surface-monitor-latest.json");
const ACTIVE = ["strategy2", "strategy3", "strategy4", "strategy5", "institution", "cb", "warrant"];
const URL = String(process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/$/, "");
const argv = new Set(process.argv.slice(2));
const argDate = process.argv.find((arg) => arg.startsWith("--expected-date="));
function dateOnly(value) { const d = String(value || "").replace(/\D/g, ""); return d.length >= 8 ? d.slice(0, 8) : ""; }
function todayTaipei() { const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const g = (n) => p.find((x) => x.type === n)?.value || "00"; return g("year") + g("month") + g("day"); }
const expectedDate = dateOnly(argDate && argDate.slice(16) || process.env.FUMAN_EXPECTED_DATE) || todayTaipei();
const DAILY_FILE = path.join(OUT_DIR, "daily-" + expectedDate + ".json");
const ALERT_STATE_FILE = path.join(OUT_DIR, "terminal-surface-monitor-alert-state.json");
const verifyOnly = argv.has("--verify");
const live = argv.has("--production") || argv.has("--live");
const scheduled = argv.has("--scheduled");
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function text(v) { return String(v == null ? "" : v); }
function lower(v) { return text(v).toLowerCase(); }
function yes(v) { return v === true || v === "true" || v === 1; }
function uniq(a) { return Array.from(new Set(a.filter(Boolean))); }
function artifact(name, rel) { const file = path.join(ROOT, rel); const payload = readJson(file); return { name, file, exists: payload !== null, payload: payload || {} }; }
function marketClosed(manifest, canary) { const s = lower([manifest.marketStatus, manifest.market && manifest.market.status, manifest.blocker, manifest.waterRoot && manifest.waterRoot.reason, canary.status, canary.reason].join(" ")); return yes(manifest.marketClosedPreviousGood) || ["market_closed", "weekend", "holiday", "typhoon"].some((x) => s.includes(x)); }
function previousGood(row) { const s = lower(JSON.stringify(row)); return yes(row.previousGood) || yes(row.preservePreviousGood) || yes(row.fallback) || yes(row.rawFallback) || yes(row.fallbackUsed) || s.includes("previous_good") || s.includes("blocked_preserved") || s.includes("market_closed"); }
function moduleState(row, expected) {
  const issues = Array.isArray(row.issues) ? row.issues.map(text) : [];
  const tradeDate = dateOnly(row.tradeDate || row.trade_date);
  const sourceDate = dateOnly(row.sourceDate || row.source_date || row.sourceTradeDate);
  const runId = text(row.runId || row.run_id);
  const complete = yes(row.complete) || lower(row.qualityStatus || row.quality_status) === "complete";
  const fallback = yes(row.fallback) || yes(row.rawFallback) || yes(row.fallbackUsed);
  const current = complete && !fallback && tradeDate === expected && (!sourceDate || sourceDate === expected);
  const details = [];
  if (!tradeDate || tradeDate !== expected) details.push("MODULE_STALE_DATE");
  if (!sourceDate || sourceDate !== expected) details.push("MODULE_SOURCE_DATE_NOT_CURRENT");
  if (!runId) details.push("MODULE_RUNID_MISSING");
  if (!complete) details.push("MODULE_NOT_COMPLETE");
  if (fallback) details.push("MODULE_FALLBACK_OR_PREVIOUS_GOOD");
  const state = current ? (Number(row.resultCount) === 0 || yes(row.zeroResult) ? "zero-result-complete" : "current-complete") : previousGood(row) ? "previous-good-degraded" : "blocked";
  return { key: text(row.key), state, tradeDate, sourceDate, runId, complete, fallback, resultCount: Number.isFinite(Number(row.resultCount)) ? Number(row.resultCount) : null, issueCodes: uniq(details.concat(issues)), source: text(row.source || row.sourceName || "manifest") };
}
function localCheck() {
  const manifest = artifact("dailyManifest", "outputs/daily-terminal-run/daily-terminal-run-latest.json");
  const display = artifact("displayCorrectness", "outputs/terminal-display-correctness/terminal-display-correctness.json");
  const resource = artifact("resourceChain", "outputs/terminal-resource-chain-audit/terminal-resource-chain-audit.json");
  const canary = artifact("canary", "outputs/terminal-canary-publish/terminal-canary-publish.json");
  const closure = artifact("runIdClosure", "outputs/terminal-runid-closure/terminal-runid-closure.json");
  const ops = artifact("opsStatus", "data/terminal-ops-status-latest.json");
  const rows = Array.isArray(manifest.payload.modules) ? manifest.payload.modules : [];
  const closed = marketClosed(manifest.payload, canary.payload);
  const displayExpectedDate = closed
    ? dateOnly(manifest.payload.displayTradeDate || manifest.payload.display_trade_date || canary.payload.displayTradeDate || canary.payload.latestDate || manifest.payload.tradeDate || expectedDate)
    : expectedDate;
  const modules = ACTIVE.map((key) => moduleState(rows.find((row) => text(row.key) === key) || { key, issues: ["MODULE_ROW_MISSING"] }, displayExpectedDate));
  const issues = [];
  [manifest, display, resource, canary, closure].forEach((a) => { if (!a.exists) issues.push({ code: "SURFACE_ARTIFACT_MISSING", target: a.name, file: a.file }); });
  const manifestDate = dateOnly(manifest.payload.tradeDate || manifest.payload.requestedDate);
  if (manifest.exists && ((!closed && manifestDate !== expectedDate) || (closed && !displayExpectedDate))) issues.push({ code: "MANIFEST_DATE_MISMATCH", expectedDate: closed ? displayExpectedDate : expectedDate, actualDate: manifest.payload.tradeDate || manifest.payload.requestedDate || "" });
  if (display.exists && display.payload.ok !== true) issues.push({ code: "DISPLAY_CORRECTNESS_GATE_BLOCKED", issueCount: display.payload.issueCount == null ? null : display.payload.issueCount });
  if (resource.exists && resource.payload.ok !== true) issues.push({ code: "RESOURCE_CHAIN_BLOCKED" });
  if (closure.exists && closure.payload.ok !== true) issues.push({ code: "RUNID_CLOSURE_BLOCKED" });
  modules.forEach((row) => { if (row.state === "blocked" || (row.state === "previous-good-degraded" && !closed)) issues.push({ code: row.state === "blocked" ? "MODULE_NOT_CURRENT_COMPLETE" : "MODULE_PREVIOUS_GOOD_ON_TRADING_DAY", key: row.key, state: row.state, issueCodes: row.issueCodes }); });
  return { expectedDate, displayExpectedDate, marketClosed: closed, status: issues.length ? (closed ? "MARKET_CLOSED_PREVIOUS_GOOD" : "BLOCKED") : "PASS", artifactChecks: [manifest, display, resource, canary, closure, ops].map(({ payload, ...a }) => Object.assign({}, a, { contract: payload && payload.contract || "" })), modules, issues };
}
async function fetchOne(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { accept: "application/json,text/html", "cache-control": "no-cache" } });
    const body = await r.text();
    return { url, status: r.status, ok: r.ok, protected: r.status === 401 || r.status === 403, bytes: body.length, runIds: uniq(body.match(/(?:strategy[2345]|institution|cb-detect|warrant-flow|scorecard)-\d{8}-[\w-]+/gi) || []) };
  } catch (e) { return { url, status: 0, ok: false, protected: false, error: e.name === "AbortError" ? "timeout" : text(e.message), runIds: [] }; }
  finally { clearTimeout(timer); }
}
async function productionCheck(displayTradeDate, marketClosedMode) {
  const routes = [["releaseManifest", "/api/release-manifest"], ["scorecard", "/api/scorecard?live=1&limit=1"], ["desktop", "/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=1"], ["mobile", "/api/mobile-boot"], ["88", "/88.html?date=" + (marketClosedMode && displayTradeDate ? displayTradeDate : expectedDate)]];
  const surfaces = [];
  const observations = [];
  for (const pair of routes) { const row = Object.assign({ name: pair[0] }, await fetchOne(URL + pair[1])); surfaces.push(row); if (row.protected) observations.push({ code: "PROTECTED_SURFACE_NOT_AUTHENTICATED", name: row.name, status: row.status, interpretation: "membership protection, not scanner failure" }); }
  return { productionUrl: URL, surfaces, observations };
}
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const local = localCheck();
  const production = live ? await productionCheck(local.displayExpectedDate, local.marketClosed) : { skipped: true, reason: "production probe not requested" };
  const issues = local.issues.slice();
  (production.surfaces || []).forEach((row) => { if (!row.ok && !row.protected) issues.push({ code: row.status === 0 ? "PRODUCTION_SURFACE_UNREACHABLE" : "PRODUCTION_SURFACE_HTTP_ERROR", name: row.name, status: row.status, error: row.error || "" }); });
  const status = local.marketClosed && local.status === "MARKET_CLOSED_PREVIOUS_GOOD" ? "MARKET_CLOSED_PREVIOUS_GOOD" : issues.length === 0 ? local.status : "BLOCKED";
  const report = { contract: "terminal-surface-monitor-v1", checkedAt: new Date().toISOString(), expectedDate, displayExpectedDate: local.displayExpectedDate, mode: verifyOnly ? "verify" : scheduled ? "scheduled" : "manual", status, rule: "Official surfaces accept current complete, current zero-result complete, or explicit previous-good degraded only; protected 401/403 is reported separately from computation.", local, production, issues, nextAction: issues.length ? "classify_reason_then_enqueue_targeted_rollforward; never publish stale or empty as current" : "continue_scheduled_monitoring" };
  report.reportFiles = { latest: OUT_FILE, daily: DAILY_FILE, alertState: ALERT_STATE_FILE };
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(DAILY_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");
  const signature = JSON.stringify(report.issues.map((item) => item.code + ":" + (item.key || item.name || item.target || "")).sort());
  const previousAlert = readJson(ALERT_STATE_FILE) || {};
  const alertState = { contract: "terminal-surface-monitor-alert-state-v1", updatedAt: new Date().toISOString(), expectedDate, status, issueCount: issues.length, signature, changed: previousAlert.signature !== signature, action: issues.length ? "review_daily_report_and_targeted_rollforward" : "continue_monitoring" };
  fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify(alertState, null, 2) + "\n", "utf8");
  if (scheduled) { fs.appendFileSync(path.join(OUT_DIR, "terminal-surface-monitor.jsonl"), JSON.stringify({ checkedAt: report.checkedAt, expectedDate, status, issueCount: issues.length, signature }) + "\n", "utf8"); }
  console.log(JSON.stringify({ ok: issues.length === 0, status, expectedDate, issueCount: issues.length, report: OUT_FILE, dailyReport: DAILY_FILE, alertChanged: alertState.changed }, null, 2));
  if (verifyOnly && issues.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e.stack || e.message || e); process.exitCode = 1; });