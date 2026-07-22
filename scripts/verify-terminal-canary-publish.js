const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(argValue("--out", "outputs/terminal-canary-publish"));
const MANIFEST_FILE = path.resolve(argValue("--manifest", path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json")));
const SCORECARD_FILE = path.resolve(argValue("--scorecard", path.join(ROOT, "data", "scorecard-latest.json")));

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function clean(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function marketClosedPreviousGood(manifest = {}) {
  const bits = [
    manifest.waterRoot?.status,
    manifest.waterRoot?.reason,
    manifest.blocker,
    manifest.status,
  ].map(lower).join(" ");
  const tradingDay = bits.includes("trading_day") || bits.includes("after_formal_source_window");
  if (tradingDay && !bits.includes("market_closed")) return false;
  return bits.includes("market_closed") || bits.includes("previous_good") || bits.includes("wait_source_window") || bits.includes("skip_formal_scan");
}

function sourceReportsByKey(scorecard = {}) {
  const map = new Map();
  for (const row of Array.isArray(scorecard.sourceReports) ? scorecard.sourceReports : []) {
    const key = lower(row.key || row.strategyKey || row.sourceKey);
    if (key) map.set(key, row);
  }
  return map;
}

function hasFallbackSignal(row = {}) {
  const text = lower([
    row.reason,
    row.error,
    row.fallbackReason,
    row.cacheSource,
    row.source,
    row.status,
    row.qualityStatus,
  ].join(" "));
  return row.fallback === true
    || row.fallbackUsed === true
    || row.publishAllowed === false
    || text.includes("fallback")
    || text.includes("stale")
    || text.includes("previous_good");
}

function isPendingNotDueModule(row = {}) {
  const issueText = [
    Array.isArray(row.issues) ? row.issues.join(" ") : "",
    row.issue || "",
    row.blocker || "",
    row.reason || "",
  ].join(" ");
  return row.pendingNotDue === true
    || lower(row.status) === "pending_not_due"
    || lower(issueText).includes("pending_not_due");
}

function runIdDate(row = {}) {
  const raw = clean(row.runId || row.run_id || row.latestRunId || "");
  const match = raw.match(/20\d{6}/);
  return match ? match[0] : "";
}

function manifestPendingNotDuePreviousGood(modules = []) {
  if (!modules.length) return false;
  return modules.every((row) => isPendingNotDueModule(row)
    && row.ok === true
    && row.fallback !== true
    && clean(row.runId));
}

function maxModuleRunDate(modules = []) {
  return modules.map(runIdDate).filter(Boolean).sort().pop() || "";
}

function manifestFullyClosed(manifest = {}, modules = []) {
  if (manifest.ok !== true) return false;
  if (!modules.length) return false;
  return modules.every((row) => isPendingNotDueModule(row)
    || (row.ok === true && row.complete === true && row.fallback !== true && clean(row.runId)));
}

function manifestPreviousGoodHoldClosure(manifest = {}, modules = []) {
  const status = lower(manifest.unattendedStatus || manifest.status || "");
  if (!status.includes("previous_good_hold")) return false;
  return manifestFullyClosed(manifest, modules);
}

function validateCanary(manifest, scorecard, options = {}) {
  const issues = [];
  const tradeDate = compactDate(manifest.tradeDate);
  const scorecardDate = compactDate(scorecard.latestDate || scorecard.marketDate || scorecard.summary?.latestDate);
  const reports = sourceReportsByKey(scorecard);
  const modules = (Array.isArray(manifest.modules) ? manifest.modules : []).filter((row) => row.key && row.key !== "market");
  const hardBlockedModules = modules.filter((row) => row.ok !== true && !isPendingNotDueModule(row));
  const pendingPreviousGood = manifestPendingNotDuePreviousGood(modules);
  const hasPendingNotDue = hardBlockedModules.length === 0 && (modules.some((row) => isPendingNotDueModule(row)) || lower(manifest.blocker).includes("pending_not_due"));
  const previousGoodDate = maxModuleRunDate(modules);
  const closed = marketClosedPreviousGood(manifest) || pendingPreviousGood;
  const previousGoodHoldClosure = manifestPreviousGoodHoldClosure(manifest, modules);
  const expectedReportDate = pendingPreviousGood ? previousGoodDate : tradeDate;

  if (manifest.contract !== "daily-terminal-run-manifest-v1") issues.push("manifest_contract_invalid");
  if (hasPendingNotDue && manifest.ok !== true) {
    const deferrals = [`manifest_pending_not_due:${manifest.blocker || "pending_not_due"}`];
    return {
      ok: true,
      contract: "terminal-canary-publish-v1",
      checkedAt: new Date().toISOString(),
      status: "PENDING_NOT_DUE",
      scorecardPublishAllowed: false,
      canaryDeferred: true,
      marketClosedPreviousGood: false,
      tradeDate,
      manifestTradeDate: tradeDate,
      manifest: {
        ok: manifest.ok === true,
        unattendedStatus: manifest.unattendedStatus || "",
        modules: modules.length,
        blocker: manifest.blocker || "",
      },
      scorecard: {
        ok: scorecard.ok === true,
        latestDate: scorecard.latestDate || scorecard.summary?.latestDate || "",
        records: Array.isArray(scorecard.records) ? scorecard.records.length : 0,
        sourceReports: Array.isArray(scorecard.sourceReports) ? scorecard.sourceReports.length : 0,
        cacheSource: scorecard.cacheSource || "",
      },
      issues,
      deferrals,
      mode: options.mode || "artifact",
    };
  }
  if (scorecard.contract !== "scorecard-resource-chain-v1") issues.push("scorecard_contract_invalid");
  if (!tradeDate) issues.push("manifest_tradeDate_missing");
  if (!pendingPreviousGood && scorecardDate !== tradeDate) issues.push(`scorecard_latestDate_mismatch:${scorecardDate || "missing"}!=${tradeDate || "missing"}`);
  if (pendingPreviousGood && scorecardDate !== previousGoodDate) issues.push(`scorecard_previousGoodDate_mismatch:${scorecardDate || "missing"}!=${previousGoodDate || "missing"}`);
  if (scorecard.ok !== true) issues.push("scorecard_ok_not_true");
  if (scorecard.qualityStatus && lower(scorecard.qualityStatus) !== "complete") issues.push(`scorecard_quality_not_complete:${scorecard.qualityStatus}`);
  if (!Array.isArray(scorecard.records) || scorecard.records.length <= 0) issues.push("scorecard_records_empty");
  if (!Array.isArray(scorecard.sourceReports) || scorecard.sourceReports.length <= 0) issues.push("scorecard_sourceReports_empty");
  const allowMarketClosedPublish = closed && (manifestFullyClosed(manifest, modules) || pendingPreviousGood);
  const allowPreviousGoodHoldClosurePublish = previousGoodHoldClosure && !pendingPreviousGood;
  const enforcePublishable = !closed || allowMarketClosedPublish;
  if (!closed && !allowPreviousGoodHoldClosurePublish && (manifest.ok !== true || manifest.unattendedStatus !== "YES")) {
    issues.push(`manifest_not_green:${manifest.unattendedStatus || "missing"}`);
  }
  if (closed && !allowMarketClosedPublish) {
    issues.push(`manifest_market_closed_not_publishable:${manifest.unattendedStatus || "missing"}`);
  }

  for (const row of modules) {
    const key = lower(row.key);
    if (isPendingNotDueModule(row) && !pendingPreviousGood) continue;
    const report = reports.get(key);
    if (!report) {
      issues.push(`sourceReport_missing:${row.key}`);
      continue;
    }
    const reportRunId = clean(report.runId || report.run_id);
    const expectedRunId = clean(row.runId);
    const reportDate = compactDate(report.date || report.tradeDate || report.marketDate || report.updatedAt || reportRunId);
    if (!expectedRunId) issues.push(`manifest_module_runId_missing:${row.key}`);
    if (reportRunId !== expectedRunId) issues.push(`sourceReport_runId_mismatch:${row.key}:${reportRunId || "missing"}!=${expectedRunId || "missing"}`);
    if (reportDate !== expectedReportDate) issues.push(`sourceReport_date_mismatch:${row.key}:${reportDate || "missing"}!=${expectedReportDate || "missing"}`);
    if (report.ok !== true) issues.push(`sourceReport_not_ok:${row.key}`);
    if (Number(report.statusCode || 200) >= 400) issues.push(`sourceReport_http_bad:${row.key}:${report.statusCode}`);
    if (enforcePublishable && hasFallbackSignal(report)) issues.push(`sourceReport_fallback_or_stale:${row.key}`);
    if (enforcePublishable && !isPendingNotDueModule(row) && (row.ok !== true || row.complete !== true || row.fallback === true)) {
      issues.push(`manifest_module_not_publishable:${row.key}`);
    }
  }

  const publishAllowed = issues.length === 0 && (!closed || allowMarketClosedPublish || allowPreviousGoodHoldClosurePublish);
  return {
    ok: issues.length === 0,
    contract: "terminal-canary-publish-v1",
    checkedAt: new Date().toISOString(),
    status: closed
      ? (publishAllowed ? "CANARY_READY_MARKET_CLOSED_CLOSURE" : "NOT_ARMED_MARKET_CLOSED_PREVIOUS_GOOD")
      : (publishAllowed && allowPreviousGoodHoldClosurePublish ? "CANARY_READY_PREVIOUS_GOOD_HOLD_CLOSURE" : (publishAllowed ? "CANARY_READY" : "BLOCKED")),
    scorecardPublishAllowed: publishAllowed,
    marketClosedPreviousGood: closed,
    tradeDate: expectedReportDate,
    manifestTradeDate: tradeDate,
    manifest: {
      ok: manifest.ok === true,
      unattendedStatus: manifest.unattendedStatus || "",
      modules: modules.length,
      blocker: manifest.blocker || "",
    },
    scorecard: {
      ok: scorecard.ok === true,
      latestDate: scorecard.latestDate || scorecard.summary?.latestDate || "",
      records: Array.isArray(scorecard.records) ? scorecard.records.length : 0,
      sourceReports: Array.isArray(scorecard.sourceReports) ? scorecard.sourceReports.length : 0,
      cacheSource: scorecard.cacheSource || "",
    },
    issues,
    mode: options.mode || "artifact",
  };
}

function markdown(payload) {
  const lines = [];
  lines.push("# Terminal Canary Publish");
  lines.push("");
  lines.push(`- checkedAt: ${payload.checkedAt}`);
  lines.push(`- tradeDate: ${payload.tradeDate}`);
  lines.push(`- status: ${payload.status}`);
  lines.push(`- scorecardPublishAllowed: ${payload.scorecardPublishAllowed}`);
  lines.push(`- marketClosedPreviousGood: ${payload.marketClosedPreviousGood}`);
  lines.push(`- issues: ${payload.issues.join("; ") || "none"}`);
  lines.push("");
  lines.push("## Evidence");
  lines.push(`- manifest: ok=${payload.manifest.ok} unattended=${payload.manifest.unattendedStatus} modules=${payload.manifest.modules}`);
  lines.push(`- scorecard: ok=${payload.scorecard.ok} latestDate=${payload.scorecard.latestDate} records=${payload.scorecard.records} sourceReports=${payload.scorecard.sourceReports}`);
  return `${lines.join("\n")}\n`;
}

function selfTests() {
  const manifest = {
    contract: "daily-terminal-run-manifest-v1",
    tradeDate: "20260717",
    ok: true,
    unattendedStatus: "YES",
    modules: [
      { key: "strategy2", runId: "strategy2-20260717-a", ok: true, complete: true, fallback: false },
      { key: "strategy3", runId: "strategy3-20260717-a", ok: true, complete: true, fallback: false },
    ],
  };
  const scorecard = {
    ok: true,
    contract: "scorecard-resource-chain-v1",
    qualityStatus: "complete",
    latestDate: "2026-07-17",
    records: [{ strategy: "x" }],
    sourceReports: [
      { key: "strategy2", ok: true, statusCode: 200, runId: "strategy2-20260717-a", date: "20260717" },
      { key: "strategy3", ok: true, statusCode: 200, runId: "strategy3-20260717-a", date: "20260717" },
    ],
  };
  const cases = [
    { name: "green", mutate: (m, s) => [m, s], expectOk: true },
    { name: "missing-report", mutate: (m, s) => [m, { ...s, sourceReports: s.sourceReports.slice(0, 1) }], expectOk: false, issue: "sourceReport_missing:strategy3" },
    { name: "runid-mismatch", mutate: (m, s) => [m, { ...s, sourceReports: [{ ...s.sourceReports[0], runId: "old" }, s.sourceReports[1]] }], expectOk: false, issue: "sourceReport_runId_mismatch:strategy2" },
    { name: "fallback-report", mutate: (m, s) => [m, { ...s, sourceReports: [{ ...s.sourceReports[0], fallbackUsed: true }, s.sourceReports[1]] }], expectOk: false, issue: "sourceReport_fallback_or_stale:strategy2" },
    { name: "trading-day-previous-good-is-blocked-not-market-closed", mutate: (m, s) => [{ ...m, ok: false, unattendedStatus: "NO", waterRoot: { status: "trading_day_wait_source_window_previous_good", reason: "trading_day_outside_formal_source_window_preserve_previous_good" }, blocker: "terminal_resource_chain_unattended_failed" }, { ...s, latestDate: "2026-07-16" }], expectOk: false, expectedStatus: "BLOCKED", issue: "scorecard_latestDate_mismatch" },
    { name: "manifest-pending-not-due-defers-scorecard-check", mutate: (m, s) => [{ ...m, ok: false, unattendedStatus: "NO", blocker: "pending_not_due:strategy4@16:00", modules: [...m.modules, { key: "strategy4", runId: "strategy4-20260716-a", ok: true, complete: false, pendingNotDue: true, issues: ["pending_not_due:16:00"] }] }, { ...s, latestDate: "2026-07-16", sourceReports: [] }], expectOk: true, expectedStatus: "PENDING_NOT_DUE" },
    { name: "manifest-hard-blocker-overrides-later-pending", mutate: (m, s) => [{ ...m, ok: false, unattendedStatus: "NO", blocker: "strategy4:manifest_tradeDate_mismatch:20260720!=20260721", modules: [...m.modules, { key: "strategy4", runId: "strategy4-20260720-a", ok: false, complete: false, pendingNotDue: false, issues: ["manifest_tradeDate_mismatch:20260720!=20260721"] }, { key: "strategy5", runId: "strategy5-20260720-a", ok: true, complete: false, pendingNotDue: true, issues: ["pending_not_due:21:00"] }] }, { ...s, latestDate: "2026-07-20", sourceReports: [] }], expectOk: false, expectedStatus: "BLOCKED", issue: "manifest_not_green" },
  ];
  const failures = [];
  for (const item of cases) {
    const [m, s] = item.mutate(JSON.parse(JSON.stringify(manifest)), JSON.parse(JSON.stringify(scorecard)));
    const result = validateCanary(m, s, { mode: `self-test:${item.name}` });
    const hasIssue = item.issue ? result.issues.some((issue) => issue.includes(item.issue)) : true;
    if (item.expectedStatus && result.status !== item.expectedStatus) failures.push({ name: item.name, result, expectedStatus: item.expectedStatus });
    if (result.ok !== item.expectOk || !hasIssue) failures.push({ name: item.name, result });
  }
  return failures;
}

async function main() {
  const manifest = readJson(MANIFEST_FILE);
  const scorecard = readJson(SCORECARD_FILE);
  const payload = validateCanary(manifest, scorecard);
  const selfTestFailures = selfTests();
  if (selfTestFailures.length) {
    payload.ok = false;
    payload.issues.push(`self_test_failed:${selfTestFailures.map((item) => item.name).join(",")}`);
    payload.selfTestFailures = selfTestFailures;
  }
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const jsonFile = path.join(OUT_DIR, "terminal-canary-publish.json");
  const mdFile = path.join(OUT_DIR, "terminal-canary-publish.md");
  await fs.promises.writeFile(jsonFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(mdFile, markdown(payload), "utf8");
  console.log(JSON.stringify({
    ok: payload.ok,
    status: payload.status,
    scorecardPublishAllowed: payload.scorecardPublishAllowed,
    tradeDate: payload.tradeDate,
    issues: payload.issues,
    output: jsonFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-canary-publish] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});

module.exports = { validateCanary, selfTests };
