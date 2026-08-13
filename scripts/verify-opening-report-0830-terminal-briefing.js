"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const marketAiLive = require("../api/market-ai-live");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const compactDate = (value) => String(value || "").replace(/\D/g, "").slice(0, 8);
const today = process.env.FUMAN_TRADE_DATE || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const compact = compactDate(today);

const apiSource = read("api/market-ai-live.js");
const appSource = read("terminal-app.js");
const runnerSource = read("scripts/run-opening-report-0830-production.js");
const desktopFastShellSource = read("terminal-desktop-fast-shell.js");
const indexSource = read("index.html");
const pkg = readJson(path.join(ROOT, "package.json"));

assert(apiSource.includes("function readOpeningMorningReport"), "market-ai-live missing readOpeningMorningReport");
assert(apiSource.includes("openingMorningReport: session?.openingMorningReport || readOpeningMorningReport(clock)"), "market-ai-live response missing openingMorningReport snapshot/local fallback");
assert(apiSource.includes("opening-report-0830-terminal-briefing-v1"), "opening report terminal contract missing");
assert(apiSource.includes("opening_report_0830_final_receipt_missing"), "missing final receipt fail-closed reason missing");
assert(apiSource.includes("readOpeningShortwave") && apiSource.includes("strategy5"), "shortwave sources must include Strategy5 previous closed run");
assert(apiSource.includes("readOpeningMorningReportSnapshot") && apiSource.includes("opening_report_0830_terminal_briefing"), "market-ai-live must read opening report terminal briefing snapshot");
assert(runnerSource.includes("upsertSnapshot") && runnerSource.includes("syncTerminalBriefingSnapshot") && runnerSource.includes("opening_report_0830_terminal_briefing"), "08:30 runner must upsert terminal briefing snapshot");
assert(appSource.includes("installOpeningReport0830TerminalBriefing"), "terminal app missing 08:30 briefing installer");
assert(appSource.includes("opening-report-0830-sunlight-polish-20260813") && appSource.includes("body.fuman-light-theme .opening-report-0830-briefing"), "terminal app sunlight briefing polish missing");
assert(appSource.includes("window.__fumanRenderOpeningReport0830=renderBriefing") && appSource.includes("__fumanRenderOpeningReport0830?.(payload?.openingMorningReport"), "opening report render hook missing from live renderer");
assert(desktopFastShellSource.includes("renderOpeningReport0830DesktopBriefing") && desktopFastShellSource.includes("aiPayload?.openingMorningReport") && desktopFastShellSource.includes("data-opening-report-0830-briefing"), "desktop fast shell must render opening report briefing");
assert(desktopFastShellSource.includes("fuman-sunlight-mode-polish-20260813") && desktopFastShellSource.includes("body.fuman-light-theme #market-view .opening-report-0830-briefing") && desktopFastShellSource.includes("body.fuman-light-theme #market-view .opening-report-0830-card"), "desktop sunlight mode briefing polish missing");
assert(!desktopFastShellSource.includes("<h4>熱門觀察股</h4>") && !desktopFastShellSource.includes("market-ai-block market-ai-hot-section"), "desktop fast shell must not render hot stock block inside 0830 briefing layout");
assert(appSource.includes("今日推薦"), "terminal display must use 今日推薦 instead of Mother Pool Bridge");
assert(appSource.includes("08:30-08:59"), "terminal briefing display window missing");
assert(appSource.includes("priority_scan_only"), "terminal briefing must expose priority_scan_only action");
assert(!/Mother Pool Bridge/.test(appSource), "terminal user-facing app must not display Mother Pool Bridge");
assert(runnerSource.includes("collectLineTargets") && runnerSource.includes("FUMAN_LINE_TO_GROUP") && runnerSource.includes("has_group_target"), "08:30 runner must support personal and group LINE targets");
assert(runnerSource.includes("upsertSnapshot") && runnerSource.includes("syncTerminalBriefingSnapshot") && runnerSource.includes("opening_report_0830_terminal_briefing"), "08:30 runner must upsert terminal briefing snapshot");
assert(pkg.scripts["verify:opening-report-0830-terminal-briefing"] === "node scripts/verify-opening-report-0830-terminal-briefing.js", "package script missing");
assert(indexSource.includes("sunlight-polish=20260813-01"), "index cache bust missing sunlight polish version");
assert(marketAiLive.__test?.readOpeningMorningReport, "market-ai-live __test missing readOpeningMorningReport");
assert(marketAiLive.__test?.readOpeningMorningReportSnapshot, "market-ai-live __test missing readOpeningMorningReportSnapshot");

const briefing = marketAiLive.__test.readOpeningMorningReport({
  date: compact.slice(0,4) + "-" + compact.slice(4,6) + "-" + compact.slice(6,8),
  ymd: compact,
  seconds: 8 * 60 * 60 + 30 * 60,
  time: "08:30:00",
});
assert(briefing.contract === "opening-report-0830-terminal-briefing-v1", "runtime briefing contract invalid");
assert(briefing.display_label === "今日推薦", "runtime display label must be 今日推薦");
assert(briefing.allowed_action === "priority_scan_only" || briefing.ok === false, "runtime allowed action invalid");
assert(briefing.visible_window?.active === true, "08:30 verifier clock must activate display window");
if (briefing.ok) {
  assert(briefing.run_id && briefing.run_id.includes(compact), "briefing runId must match date");
  assert(briefing.industry_bias?.count >= 19, "briefing must read at least 19 industry bias files");
  assert(Array.isArray(briefing.priority_industries) && briefing.priority_industries.length === 4, "briefing must expose top 4 priority industries");
  assert(Array.isArray(briefing.market_snapshot?.items) && briefing.market_snapshot.items.length >= 4, "briefing must expose global market snapshot rows");
  assert(briefing.formal_candidates === 0, "08:30 briefing must not create formal candidates");
} else {
  assert(briefing.reason_code === "opening_report_0830_final_receipt_missing" || Array.isArray(briefing.issues), "unexpected fail reason: " + briefing.reason_code);
}

const receiptPath = path.join(RUNTIME_ROOT, "data", "opening-report-0830", "opening-report-0830-terminal-briefing-verifier-" + compact + ".json");
fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
fs.writeFileSync(receiptPath, JSON.stringify({ ok: true, contract: "opening-report-0830-terminal-briefing-verifier-v1", checked_at: new Date().toISOString(), date: compact, briefing_status: briefing.ok ? "PASS" : "FAIL_CLOSED", reason_code: briefing.reason_code, run_id: briefing.run_id || "", display_label: briefing.display_label, industry_bias_count: briefing.industry_bias?.count || 0 }, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: true, receipt: receiptPath, briefing_status: briefing.ok ? "PASS" : "FAIL_CLOSED", reason_code: briefing.reason_code, run_id: briefing.run_id || "" }, null, 2));


