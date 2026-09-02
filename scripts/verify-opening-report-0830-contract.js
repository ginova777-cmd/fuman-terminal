"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  FORBIDDEN_OVERSEAS_LEADERS,
  OPENING_REPORT_0830_INDUSTRY_MAP,
  validateIndustryMapContract,
} = require("./opening-report-0830-industry-map-contract.js");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const REPORT_DIR = path.join(RUNTIME_DIR, "data", "opening-report-0830");
const compactDate = (value) => String(value || "").replace(/\D/g, "").slice(0, 8);
const taipeiDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const contains = (text, value) => String(text || "").includes(value);
const stage = (name, ok, details = {}) => ({ name, ok: ok === true, status: ok === true ? "PASS" : "FAIL", ...details });

function task(name) {
  const result = spawnSync("schtasks.exe", ["/Query", "/TN", name, "/V", "/FO", "LIST"], { encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, text: `${result.stdout || ""}\n${result.stderr || ""}` };
}
function taskXml(name) {
  const result = spawnSync("schtasks.exe", ["/Query", "/TN", name, "/XML"], { encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, text: `${result.stdout || ""}\n${result.stderr || ""}` };
}
function taskXml(name) {
  const result = spawnSync("schtasks.exe", ["/Query", "/TN", name, "/XML"], { encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, text: `${result.stdout || ""}\n${result.stderr || ""}` };
}
function taskXml(name) {
  const result = spawnSync("schtasks.exe", ["/Query", "/TN", name, "/XML"], { encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, text: `${result.stdout || ""}\n${result.stderr || ""}` };
}

function mapRow(industry) {
  return OPENING_REPORT_0830_INDUSTRY_MAP.find((row) => row.industry === industry) || null;
}
function hasStock(row, tier, symbol) {
  return (tier === "A" ? row?.a : row?.b || []).some((stock) => String(stock.symbol) === String(symbol));
}
function exactLeaders(row) {
  return (row?.overseas_leaders || []).map((leader) => `${leader.name}:${leader.yahoo_symbol}`);
}
function section(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = startAt >= 0 ? source.indexOf(end, startAt) : -1;
  return startAt >= 0 ? source.slice(startAt, endAt >= 0 ? endAt : undefined) : "";
}

function currentReceiptChecks(tradeDate) {
  const compact = compactDate(tradeDate);
  const preflight = readJson(path.join(REPORT_DIR, `opening-report-0820-preflight-receipt-${compact}.json`));
  const leaders = readJson(path.join(REPORT_DIR, `opening-report-0820-overseas-leaders-${compact}.json`));
  const snapshot = readJson(path.join(REPORT_DIR, `opening-report-0820-market-snapshot-${compact}.json`));
  const final = readJson(path.join(REPORT_DIR, `opening-report-0830-final-receipt-${compact}.json`));
  const line = readJson(path.join(REPORT_DIR, `line-push-receipt-${compact}.json`));
  const asiaWindowStart = Date.parse(`${tradeDate}T08:00:00+08:00`);
  const cutoff = Date.parse(`${tradeDate}T08:20:00+08:00`);
  const allLeaders = (leaders?.industries || []).flatMap((item) => item.leaders || []);
  const lateLeaders = allLeaders
    .filter((leader) => leader.ok === true && Number.isFinite(Date.parse(leader.selected_time || leader.source_time || "")) && Date.parse(leader.selected_time || leader.source_time) > cutoff);
  const staleAsiaLeaders = allLeaders.filter((leader) => {
    if (leader.ok !== true || !/\.(?:T|KS)$/i.test(String(leader.yahoo_symbol || ""))) return false;
    const sourceMs = Date.parse(leader.selected_time || leader.source_time || "");
    return !Number.isFinite(sourceMs) || sourceMs < asiaWindowStart || sourceMs > cutoff;
  });
  const lateSnapshot = (snapshot?.items || []).filter((item) => Number.isFinite(Number(item.percent)) && Number.isFinite(Date.parse(item.source_time || "")) && Date.parse(item.source_time) > cutoff);
  return {
    preflight: preflight?.ok === true && compactDate(preflight.date) === compact && String(preflight.evidence_cutoff || "").includes("08:20:00 Asia/Taipei"),
    leaders: Array.isArray(leaders?.industries) && leaders.industries.length === 19 && String(leaders.cutoff || "").includes("08:20:00 Asia/Taipei") && lateLeaders.length === 0 && staleAsiaLeaders.length === 0,
    snapshot: Array.isArray(snapshot?.items) && snapshot.items.length >= 4 && String(snapshot.cutoff || "").includes("08:20:00 Asia/Taipei") && lateSnapshot.length === 0,
    final: ["REPORT_OK", "REPORT_DEGRADED"].includes(final?.report_status) && final?.formal_candidates === 0 && final?.watchlist_only === true,
    delivery: final?.run_id && final?.delivery_content_hash
      && final?.terminal_briefing_snapshot?.ok === true
      && final?.terminal_briefing_snapshot?.report_run_id === final?.run_id
      && final?.terminal_briefing_snapshot?.delivery_content_hash === final?.delivery_content_hash
      && line?.ok === true
      && line?.run_id === final?.run_id
      && line?.delivery_content_hash === final?.delivery_content_hash
      && Number(line?.target_count || 0) >= 2
      && Number(line?.delivered_count || 0) >= Number(line?.target_count || 0)
      && line?.has_user_target === true
      && line?.has_group_target === true
      && line?.token_logged !== true
      && line?.target_logged !== true,
    late_leader_count: lateLeaders.length,
    stale_asia_leader_count: staleAsiaLeaders.length,
    stale_asia_leaders: staleAsiaLeaders.map((leader) => ({ name: leader.name, yahoo_symbol: leader.yahoo_symbol, source_time: leader.selected_time || leader.source_time || "" })),
    late_snapshot_count: lateSnapshot.length,
  };
}

function main() {
  const tradeDate = process.env.FUMAN_TRADE_DATE || taipeiDate();
  const requireCurrent = process.argv.includes("--require-current");
  const preDelivery = process.argv.includes("--pre-delivery");
  const preflight = read("scripts/run-opening-report-0820-preflight.js");
  const detector = read("scripts/run-opening-report-0830-overseas-leader-detector.js");
  const runner = read("scripts/run-opening-report-0830-production.js");
  const api = read("api/market-ai-live.js");
  const app = read("terminal-app.js");
  const shell = read("terminal-desktop-fast-shell.js");
  const wrapper = read("run-opening-report-0830-production-wrapper.ps1");
  const packageJson = JSON.parse(read("package.json"));
  const industry = validateIndustryMapContract(OPENING_REPORT_0830_INDUSTRY_MAP);
  const passive = mapRow("PASSIVE_COMPONENTS");
  const optical = mapRow("OPTICAL_COMM");
  const iiiV = mapRow("III_V_OPTICAL");
  const pcb = mapRow("PCB_CCL");
  const appBriefing = section(app, "function renderBriefing", "window.__fumanRenderOpeningReport0830");
  const shellBriefing = section(shell, "function renderOpeningReport0830DesktopBriefing", "function renderMarketApiAi");
  const lineText = section(runner, "function lineReportText", "function lineReportFlex");
  const lineFlex = section(runner, "function lineReportFlex", "async function pushLine");
  const task0820 = task("Fuman Opening Report 0820 Preflight");
  const task0830 = task("Fuman Opening Report 0830 Telegram");
  const task0820Xml = taskXml("Fuman Opening Report 0820 Preflight");
  const task0830Xml = taskXml("Fuman Opening Report 0830 Telegram");

  const checks = preDelivery ? [] : [
    stage("industry_contract_19", industry.ok === true && OPENING_REPORT_0830_INDUSTRY_MAP.length === 19, { issues: industry.issues }),
    stage("hard_mappings", hasStock(pcb, "A", "8358") && hasStock(pcb, "B", "8039") && hasStock(optical, "A", "4979") && hasStock(iiiV, "B", "4991")),
    stage("passive_murata_only", JSON.stringify(exactLeaders(passive)) === JSON.stringify(["Murata:6981.T"])),
    stage("optical_us_leader_contract", JSON.stringify(exactLeaders(optical)) === JSON.stringify(["COHR:COHR", "LITE:LITE", "CIEN:CIEN", "AAOI:AAOI", "GLW:GLW"])),
    stage("forbidden_overseas_excluded", FORBIDDEN_OVERSEAS_LEADERS.every((name) => !OPENING_REPORT_0830_INDUSTRY_MAP.some((row) => (row.overseas_leaders || []).some((leader) => leader.name === name)))),
    stage("schedule_0820_0830", task0820.ok && task0820Xml.ok && task0820Xml.text.includes("T08:20:00+08:00") && task0830.ok && task0830Xml.ok && task0830Xml.text.includes("T08:30:00+08:00")),
    stage("preflight_freeze_only", contains(preflight, "08:20:00 Asia/Taipei") && contains(preflight, "preflight_only_no_terminal_no_line_no_bridge") && contains(preflight, "opening-report-0820-overseas-leaders") && contains(preflight, "opening-report-0820-market-snapshot") && !contains(preflight, "pushLine(")),
    stage("japan_korea_time_window", contains(detector, "08:00-08:20 Asia/Taipei") && contains(detector, "T08:20:00+08:00") && contains(detector, "Later data must not be backfilled")),
    stage("delivery_reads_frozen_only", contains(runner, "frozenOverseasLeadersPath") && contains(runner, "frozenMarketSnapshotOrFallback") && contains(runner, "const marketSnapshot = frozenMarketSnapshotOrFallback(tradeDate, runId);") && contains(runner, "must not refetch")),
    stage("report_observation_scope", contains(runner, "formal_candidates: 0") && contains(runner, "watchlist_only: true") && contains(runner, "industry_observation_only") && !contains(lineText, "Formal Gate") && !contains(lineFlex, "Formal Gate")),
    stage("strategy5_previous_close_only", contains(api, 'const allowed = new Set(["strategy5"])') && contains(api, "/^strategy5-line-card-") && contains(api, "shortwave: readOpeningShortwave(clock)") && !contains(api, 'new Set(["strategy3", "strategy4", "strategy5"])')),
    stage("terminal_morning_observation_only", contains(appBriefing, "08:20") && contains(shellBriefing, "08:20") && contains(appBriefing, "Strategy5") && contains(shellBriefing, "Strategy5") && !contains(appBriefing, "Formal Gate") && !contains(shellBriefing, "Formal Gate") && !contains(appBriefing, "priority scan，不直接 publish") && !contains(shellBriefing, "priority scan，不直接 publish")),
    stage("line_personal_group_same_source", contains(runner, "collectLineTargets") && contains(runner, "FUMAN_LINE_TO_GROUP") && contains(runner, "delivery_content_hash") && contains(runner, "report_run_id: runId") && contains(runner, "delivery_content_hash: contentHash") && contains(runner, "retryableStatus") && contains(runner, "status === 429")),
    stage("bridge_after_delivery_optional", contains(runner, "const applyBridge = false") && contains(wrapper, "bridge_handoff_required = $false") && contains(wrapper, "bridge_deferred_outside_delivery_chain")),
    stage("nontrading_day_no_replay", contains(runner, "market_calendar_non_trading_day") && contains(runner, "no_terminal_no_line_no_industry_bias_no_bridge") && contains(wrapper, "market_calendar_skip")),
    stage("package_contract_script", packageJson.scripts?.["verify:opening-report-0830-contract"] === "node --use-system-ca scripts/verify-opening-report-0830-contract.js"),
  ];
  const current = currentReceiptChecks(tradeDate);
  if (requireCurrent || preDelivery) {
    checks.push(stage("current_preflight", current.preflight));
    checks.push(stage("current_frozen_leaders", current.leaders, { late_leader_count: current.late_leader_count, stale_asia_leader_count: current.stale_asia_leader_count, stale_asia_leaders: current.stale_asia_leaders }));
    checks.push(stage("current_frozen_market_snapshot", current.snapshot, { late_snapshot_count: current.late_snapshot_count }));
    if (requireCurrent) checks.push(stage("current_report_scope", current.final));
    if (requireCurrent) checks.push(stage("current_terminal_and_line_same_run_hash", current.delivery));
  }
  const failures = checks.filter((item) => !item.ok);
  const compact = compactDate(tradeDate);
  const receiptPath = path.join(REPORT_DIR, `opening-report-0830-contract-verifier-${compact}.json`);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const output = {
    ok: failures.length === 0,
    contract: "opening-report-0830-complete-contract-verifier-v1",
    checked_at: new Date().toISOString(),
    date: tradeDate,
    mode: preDelivery ? "pre_delivery_current_receipts" : requireCurrent ? "current_receipts" : "static_contract",
    first_blocker: failures[0]?.name || "",
    reason_code: failures.length ? `opening_report_0830_contract_${failures[0].name}` : "opening_report_0830_complete_contract_verified",
    checks,
    verifier_receipt: receiptPath,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exitCode = 1;
}
main();
