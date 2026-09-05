"use strict";
const fs = require("fs");
const path = require("path");
const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const root = path.resolve(__dirname, "..");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const key = today.replace(/\D/g, "");
const taipeiWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(new Date());
const marketClosedWeekend = taipeiWeekday === "Sat" || taipeiWeekday === "Sun";
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
const institutionFile = path.join(runtime, "data", "scan-receipts", "institution.json");
const e2eFile = path.join(root, "outputs", "institution-e2e-closure", "institution-e2e-closure.json");
const sourceFile = path.join(runtime, "data", "scan-receipts", "chip-source-sync.json");
const snapshotFile = path.join(runtime, "data", "scan-receipts", "desktop-route-snapshot.json");
const out = path.join(runtime, "data", "scan-receipts", "buy-sell-complete.json");
const institution = readJson(institutionFile);
const e2e = readJson(e2eFile);
const source = readJson(sourceFile);
const snapshot = readJson(snapshotFile);
const latestSummary = e2e?.computeLayer?.latestSummary || {};
const previousGoodRunId = String(latestSummary.runId || e2e?.expectedRunId || "");
const previousGoodCount = Number(latestSummary.count || latestSummary.resultCount || 0);
const effectiveRunId = marketClosedWeekend ? previousGoodRunId : String(institution?.runId || "");
const effectiveCount = marketClosedWeekend ? previousGoodCount : Number(institution?.matches || 0);
const effectiveDateKey = marketClosedWeekend ? String(e2e?.sourceDataDate || e2e?.runIdDate || "") : key;
const issues = [];
const indexHtml = readText(path.join(root, "index.html"));
const desktopShell = readText(path.join(root, "terminal-desktop-fast-shell.js"));
const requiredLoadingMarkers = [
  [indexHtml, 'data-initial-loading-skeleton="institution"', "institution_loading_skeleton_missing"],
  [indexHtml, 'data-retired-surface="institution-initial-legacy-controls"', "institution_legacy_controls_retirement_missing"],
  [desktopShell, "fetchCanvasRows(key, true)", "institution_formal_api_loader_missing"],
  [desktopShell, "if (!panel || panel.hidden) return false", "institution_visible_panel_render_gate_missing"],
];
for (const [body, marker, issue] of requiredLoadingMarkers) if (!body.includes(marker)) issues.push(issue);
if (desktopShell.includes("fetchFixedDomRouteRows(key)")) issues.push("institution_retired_undefined_loader_remains");
if (desktopShell.includes('if (!panel || panel.hidden || !panel.classList.contains("active")) return false')) issues.push("institution_retired_active_class_gate_remains");
const institutionApi = readText(path.join(root, "api", "institution-latest.js"));
const snapshotCache = readText(path.join(root, "lib", "desktop-route-snapshot-cache.js"));
const institutionFirstPaint = readText(path.join(root, "terminal-route-first-paint.js"));
if (!institutionApi.includes("allowStale: marketCalendar?.marketOpen === false")) issues.push("institution_weekend_previous_good_fast_path_missing");
if (!snapshotCache.includes("allowStale: options.allowStale === true")) issues.push("institution_snapshot_allow_stale_passthrough_missing");
if (!institutionApi.includes("await Promise.all([")) issues.push("institution_live_enrichment_not_parallel");
if (!indexHtml.includes('data-fuman-route-first-paint="1"')) issues.push("institution_first_paint_script_missing");
if (!institutionFirstPaint.includes("fuman:route-first-paint") || !institutionFirstPaint.includes("priority: \"high\"")) issues.push("institution_first_paint_contract_missing");
if (!institutionApi.includes('readDesktopRouteSnapshotForRoute("institution"') || !institutionApi.includes("options.firstPaint")) issues.push("institution_route_snapshot_first_paint_missing");
if (!desktopShell.includes('endpoint === "/api/institution-latest" && !withBust') || !desktopShell.includes('query.set("firstPaint", "1")')) issues.push("institution_click_snapshot_first_missing");
if (source?.complete !== true || source?.status !== "complete" || Number(source?.exitCode) !== 0) issues.push("chip_source_sync_not_complete");
if (marketClosedWeekend) {
  if (!previousGoodRunId || !previousGoodRunId.includes(effectiveDateKey)) issues.push("institution_previous_good_runid_invalid");
  if (previousGoodCount <= 0) issues.push("institution_previous_good_result_empty");
  if (latestSummary.publishAllowed !== true || latestSummary.evidenceStatus !== "complete" || latestSummary.unattendedStatus !== "YES" || latestSummary.qualityStatus !== "complete") issues.push("institution_previous_good_publish_contract_not_complete");
  if (latestSummary.fallbackUsed === true) issues.push("institution_previous_good_fallback_used");
} else {
  if (institution?.complete !== true || institution?.status !== "complete" || Number(institution?.exitCode) !== 0) issues.push("institution_receipt_not_complete");
  if (!String(institution?.runId || "").includes(key)) issues.push("institution_run_not_today");
  if (Number(institution?.matches || 0) <= 0) issues.push("institution_result_empty");
  if (institution?.publishAllowed !== true || institution?.evidenceStatus !== "complete" || institution?.unattendedStatus !== "YES") issues.push("institution_publish_contract_not_complete");
}
if (e2e?.ok !== true) issues.push("institution_e2e_not_complete");
if (String(e2e?.expectedRunId || e2e?.runId || "") !== effectiveRunId) issues.push("institution_e2e_runid_mismatch");
const snapshotEndpoint = "/api/institution-latest?canvas=1&compact=1&shell=1&limit=60&live=1";
const snapshotSummary = snapshot?.summary?.[snapshotEndpoint] || {};
if (snapshot?.ok !== true || snapshot?.partial === true) issues.push("institution_desktop_snapshot_not_complete");
if (String(snapshotSummary.runId || "") !== effectiveRunId) issues.push("institution_desktop_snapshot_runid_mismatch");
if (Number(snapshotSummary.count || 0) <= 0 || Number(snapshotSummary.count || 0) > effectiveCount) issues.push("institution_desktop_snapshot_count_invalid");
const payload = { contract: "strategy-runner-verifier-receipt-v1", strategy: "institution", label: "買賣超",
  checkedAt: new Date().toISOString(), tradeDate: effectiveDateKey ? `${effectiveDateKey.slice(0, 4)}-${effectiveDateKey.slice(4, 6)}-${effectiveDateKey.slice(6, 8)}` : today,
  marketMode: marketClosedWeekend ? "weekend_previous_good" : "trading_day_current_run", status: issues.length ? "failed" : "complete",
  complete: issues.length === 0, exitCode: issues.length ? 1 : 0, runId: effectiveRunId,
  count: effectiveCount, sourceReceipt: sourceFile, institutionReceipt: marketClosedWeekend ? null : institutionFile,
  e2eReceipt: e2eFile, snapshotReceipt: snapshotFile, snapshotRunId: String(snapshotSummary.runId || ""), snapshotCount: Number(snapshotSummary.count || 0),
  displayContract: "scheduled-complete-scan -> route-snapshot -> click-snapshot-first -> background-api-refresh",
  verifier: "scripts/verify-buy-sell-complete.js", issues };
if (process.argv.includes("--write-receipt")) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8"); }
console.log(JSON.stringify({ ...payload, receiptPath: out, readOnly: !process.argv.includes("--write-receipt") }, null, 2));
process.exitCode = payload.complete ? 0 : 1;
