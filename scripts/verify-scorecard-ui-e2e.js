"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const OUT_DIR = path.join(ROOT, "outputs", "scorecard-ui-e2e");
const CHECK_LIVE = !process.argv.includes("--no-live");
const EXPECTED_STRATEGIES = [
  "策略1開盤入成績單",
  "策略2成績單",
  "策略3隔日沖成績單",
  "策略4成績單",
  "策略5成績單",
  "買賣超成績單",
  "權證成績單",
  "CB成績單",
  "即時雷達成績單",
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function timeMinutes(value) {
  const match = cleanText(value).match(/(?:^|T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function fetchText(pathname, timeoutMs = 30000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}t=${Date.now()}`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode || 0, headers: response.headers, body }));
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", reject);
  });
}

async function fetchJson(pathname, timeoutMs = 30000) {
  const response = await fetchText(pathname, timeoutMs);
  let json = null;
  try {
    json = JSON.parse(response.body || "null");
  } catch (error) {
    throw new Error(`${pathname} invalid JSON HTTP ${response.status}: ${error.message}`);
  }
  return { ...response, json };
}

function addCheck(checks, ok, id, message, detail = {}) {
  checks.push({ id, ok: Boolean(ok), message, detail });
}

function summarizeRecords(records) {
  const byStrategy = {};
  const dates = {};
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let totalPnl = 0;
  for (const row of records) {
    const strategy = cleanText(row.strategy || "未分類");
    const bucket = byStrategy[strategy] ||= {
      rows: 0,
      entry0: 0,
      high0: 0,
      pnl0: 0,
      wins: 0,
      losses: 0,
      flats: 0,
      totalPnl: 0,
    };
    const date = cleanText(row.record_date);
    const entry = cleanNumber(row.entry_price);
    const high = cleanNumber(row.high_price);
    const pnl = cleanNumber(row.pnl);
    dates[date] = (dates[date] || 0) + 1;
    bucket.rows += 1;
    if (!entry) bucket.entry0 += 1;
    if (!high) bucket.high0 += 1;
    if (!pnl) bucket.pnl0 += 1;
    if (pnl > 0) {
      wins += 1;
      bucket.wins += 1;
    } else if (pnl < 0) {
      losses += 1;
      bucket.losses += 1;
    } else {
      flats += 1;
      bucket.flats += 1;
    }
    totalPnl += pnl;
    bucket.totalPnl += pnl;
  }
  return { dates, byStrategy, wins, losses, flats, totalPnl };
}

function verifyPayload(checks, payload, source = "payload") {
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const summary = payload?.summary || {};
  const latestDate = cleanText(payload?.latestDate || summary.latestDate);
  const stats = summarizeRecords(records);
  const latestRows = records.filter((row) => cleanText(row.record_date) === latestDate);
  const latestStats = summarizeRecords(latestRows);
  const strategies = Object.keys(latestStats.byStrategy).sort();
  const missingStrategies = EXPECTED_STRATEGIES.filter((strategy) => !latestStats.byStrategy[strategy]);
  const dateKeys = Object.keys(stats.dates).filter(Boolean);
  const nonCbRows = records.filter((row) => cleanText(row.strategy) !== "CB成績單");
  const nonCbEntryMissing = nonCbRows.filter((row) => !cleanNumber(row.entry_price)).length;
  const nonCbHighMissing = nonCbRows.filter((row) => !cleanNumber(row.high_price)).length;
  const cbRows = records.filter((row) => cleanText(row.strategy) === "CB成績單");
  const cbEntryMissing = cbRows.filter((row) => !cleanNumber(row.entry_price)).length;
  const cbCalculated = cbRows.filter((row) => cleanNumber(row.entry_price) > 0 && cleanNumber(row.high_price) > 0).length;
  const requiredFieldMissing = records
    .map((row, index) => ({
      index,
      strategy: cleanText(row.strategy),
      ticker: cleanText(row.ticker),
      missing: [
        ["record_date", cleanText(row.record_date)],
        ["strategy", cleanText(row.strategy)],
        ["ticker", cleanText(row.ticker)],
        ["name", cleanText(row.name)],
        ["entry_time", cleanText(row.entry_time)],
        ["entry_price", cleanNumber(row.entry_price) > 0],
        ["high_price", cleanNumber(row.high_price) > 0],
        ["pnl", row.pnl !== undefined && row.pnl !== null && cleanText(row.pnl) !== ""],
        ["reason", cleanText(row.reason)],
      ].filter(([, ok]) => !ok).map(([field]) => field),
    }))
    .filter((row) => row.missing.length);
  const strategy2Rows = records.filter((row) => cleanText(row.strategy) === "策略2成績單");
  const strategy2OutOfWindow = strategy2Rows.filter((row) => {
    const minutes = timeMinutes(row.entry_time);
    return minutes === null || minutes < 9 * 60 || minutes > 13 * 60 + 30;
  }).map((row) => ({
    ticker: cleanText(row.ticker),
    name: cleanText(row.name),
    entry_time: cleanText(row.entry_time),
  }));
  const strategy3Rows = records.filter((row) => cleanText(row.strategy) === "策略3隔日沖成績單");
  const strategy3WrongEntryTime = strategy3Rows.filter((row) => timeMinutes(row.entry_time) !== 13 * 60).map((row) => ({
    ticker: cleanText(row.ticker),
    name: cleanText(row.name),
    entry_time: cleanText(row.entry_time),
  }));
  const strategy3ReportDates = new Set((Array.isArray(payload?.sourceReports) ? payload.sourceReports : [])
    .filter((report) => cleanText(report?.key) === "strategy3" || cleanText(report?.strategy) === "策略3隔日沖成績單")
    .map((report) => cleanText(report?.date))
    .filter(Boolean)
    .map((date) => {
      const digits = date.replace(/\D/g, "");
      return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : date.slice(0, 10);
    }));
  const strategy3BadSourceDate = strategy3Rows.filter((row) => {
    const sourceDate = cleanText(row.source_date) || cleanText(row.reason).match(/策略3來源日=(\d{4}-\d{2}-\d{2})/)?.[1] || "";
    if (!sourceDate) return true;
    if (strategy3ReportDates.size > 0 && !strategy3ReportDates.has(sourceDate)) return true;
    return false;
  }).map((row) => ({
    ticker: cleanText(row.ticker),
    name: cleanText(row.name),
    record_date: cleanText(row.record_date),
    source_date: cleanText(row.source_date) || cleanText(row.reason).match(/策略3來源日=(\d{4}-\d{2}-\d{2})/)?.[1] || "",
  }));
  const nonCbNoCalculatedPnlStrategies = EXPECTED_STRATEGIES
    .filter((strategy) => strategy !== "CB成績單")
    .filter((strategy) => {
      const bucket = stats.byStrategy[strategy];
      return !bucket || bucket.wins + bucket.losses <= 0;
    });

  addCheck(checks, payload?.ok !== false, `${source}-ok`, `${source} ok=true`, { ok: payload?.ok });
  addCheck(checks, records.length > 0, `${source}-rows`, `${source} has rows`, { rows: records.length });
  addCheck(checks, Boolean(latestDate), `${source}-latest-date`, `${source} has latestDate`, { latestDate });
  addCheck(checks, dateKeys.includes(latestDate), `${source}-latest-record-date`, `${source} includes latestDate records`, { latestDate, dates: stats.dates });
  addCheck(checks, latestRows.length > 0, `${source}-latest-rows`, `${source} has rows for latestDate`, { latestDate, latestRows: latestRows.length });
  addCheck(checks, missingStrategies.length === 0, `${source}-expected-strategies`, `${source} latestDate includes all scorecard strategy groups`, { strategies, missingStrategies });
  addCheck(checks, cleanNumber(latestStats.byStrategy["策略2成績單"]?.rows) > 0, `${source}-strategy2`, `${source} includes 策略2成績單 rows`, latestStats.byStrategy["策略2成績單"] || {});
  addCheck(checks, strategy2OutOfWindow.length === 0, `${source}-strategy2-display-window`, `${source} 策略2 scorecard rows are limited to 09:00-13:30`, { strategy2Rows: strategy2Rows.length, strategy2OutOfWindow });
  addCheck(checks, cleanNumber(latestStats.byStrategy["策略3隔日沖成績單"]?.rows) > 0, `${source}-strategy3`, `${source} includes 策略3隔日沖成績單 rows`, latestStats.byStrategy["策略3隔日沖成績單"] || {});
  addCheck(checks, strategy3WrongEntryTime.length === 0, `${source}-strategy3-entry-time`, `${source} 策略3 full-scan entry_time is 13:00`, { strategy3Rows: strategy3Rows.length, strategy3WrongEntryTime });
  addCheck(checks, strategy3BadSourceDate.length === 0, `${source}-strategy3-source-date`, `${source} 策略3 scorecard source_date is present and matches the Strategy3 source report date`, { latestDate, strategy3Rows: strategy3Rows.length, strategy3ReportDates: [...strategy3ReportDates], strategy3BadSourceDate });
  addCheck(checks, cleanNumber(latestStats.byStrategy["權證成績單"]?.rows) > 0, `${source}-warrant`, `${source} includes 權證成績單 rows`, latestStats.byStrategy["權證成績單"] || {});
  addCheck(checks, nonCbEntryMissing === 0, `${source}-entry-filled`, `${source} non-CB rows have entry_price`, { nonCbEntryMissing });
  addCheck(checks, nonCbHighMissing === 0, `${source}-high-filled`, `${source} non-CB rows have high_price`, { nonCbHighMissing });
  addCheck(checks, cbRows.length === 0 || cbEntryMissing === 0, `${source}-cb-entry-filled`, `${source} CB rows use detected stockPrice as entry_price`, { cbRows: cbRows.length, cbEntryMissing });
  addCheck(checks, cbRows.length === 0 || cbCalculated === cbRows.length, `${source}-cb-calculable`, `${source} CB rows have entry/high prices for pnl calculation`, { cbRows: cbRows.length, cbCalculated });
  addCheck(checks, requiredFieldMissing.length === 0, `${source}-required-fields`, `${source} every scorecard row has required display/calculation fields`, { missingCount: requiredFieldMissing.length, samples: requiredFieldMissing.slice(0, 20) });
  addCheck(checks, nonCbNoCalculatedPnlStrategies.length === 0, `${source}-pnl-calculated`, `${source} non-CB strategy groups have calculated wins/losses`, { nonCbNoCalculatedPnlStrategies, byStrategy: stats.byStrategy });
  addCheck(checks, cleanNumber(summary.rows) === records.length, `${source}-summary-row-match`, `${source} summary.rows matches records.length`, { summaryRows: summary.rows, records: records.length });
  addCheck(checks, cleanNumber(summary.wins) === stats.wins, `${source}-summary-wins-match`, `${source} summary.wins matches row pnl`, { summaryWins: summary.wins, wins: stats.wins });
  addCheck(checks, cleanNumber(summary.losses) === stats.losses, `${source}-summary-losses-match`, `${source} summary.losses matches row pnl`, { summaryLosses: summary.losses, losses: stats.losses });
  addCheck(checks, cleanNumber(summary.flats) === stats.flats, `${source}-summary-flats-match`, `${source} summary.flats matches row pnl`, { summaryFlats: summary.flats, flats: stats.flats });
  addCheck(checks, Math.abs(cleanNumber(summary.totalPnl) - stats.totalPnl) < 0.001, `${source}-summary-pnl-match`, `${source} summary.totalPnl matches row pnl sum`, { summaryTotalPnl: summary.totalPnl, totalPnl: stats.totalPnl });

  return { latestDate, rows: records.length, strategies, stats };
}

function verifyHtmlContract(checks, html, source = "88.html") {
  const requiredTestIds = [
    "scorecard-hero",
    "scorecard-metrics",
    "scorecard-strategy-summary",
    "scorecard-strategy-tabs",
    "scorecard-result-pills",
    "scorecard-history-date",
    "scorecard-theme-toggle",
    "scorecard-rows",
    "scorecard-metric-rows",
    "scorecard-metric-winrate",
    "scorecard-metric-wl",
    "scorecard-metric-pnl",
    "scorecard-rule-group",
    "scorecard-rule-tags",
    "scorecard-followup",
  ];
  const missingTestIds = requiredTestIds.filter((id) => !html.includes(`data-testid="${id}"`) && !html.includes(id));
  const resultPills = ["all", "win", "loss", "flat"].filter((value) =>
    html.includes(`data-result="${value}"`) || html.includes(`["${value}",`)
  );
  const hasStrategyButtons = html.includes("data-strategy=");
  const usesAllStrategySummary = !/summary\.byStrategy\|\|\[\]\)\.slice\(/.test(html);
  const hasMobileCss = /@media\s*\(max-width:\s*760px\)/.test(html) && /grid-template-columns:\s*repeat\(2/.test(html);
  const hidesBasisPanel = !/scorecard-basis/.test(html)
    && !/資料來源/.test(html)
    && !/日期規則/.test(html)
    && !/最高價來源/.test(html)
    && !/損益公式/.test(html);
  const hasHistorySelect = /id="historyDate"/.test(html)
    && /availableDates/.test(html)
    && /summarizeRows/.test(html)
    && /payload\.days/.test(html);
  const hasThemeToggle = /id="themeToggle"/.test(html)
    && /data-theme="sun"/.test(html)
    && /fuman-scorecard-theme/.test(html)
    && /prefers-color-scheme:\s*light/.test(html)
    && /applyTheme/.test(html);
  const displaysLotPnl = /PNL_MULTIPLIER\s*=\s*1000/.test(html)
    && /pnlText\s*=\s*\(value\)\s*=>\s*pnlFmt\.format\(\(Number\(value\)\s*\|\|\s*0\)\s*\*\s*PNL_MULTIPLIER\)/.test(html)
    && /損益\(元\)/.test(html)
    && /PNL_MULTIPLIER/.test(html);
  const preservesDecimalPnl = /const\s+pnlText\s*=/.test(html)
    && /maximumFractionDigits:\s*2/.test(html)
    && /pnlText\(row\.pnl\)/.test(html)
    && !/(money|count)\(row\.pnl\)/.test(html);
  const hasRuleColumns = /策略項目/.test(html)
    && /策略細項/.test(html)
    && /7日追蹤/.test(html)
    && /rowRuleGroup/.test(html)
    && /rowRuleTags/.test(html)
    && /rowFollowup/.test(html);
  const cleansMachineMarkers = /cleanReason/.test(html)
    && /規則版本=/.test(html)
    && /策略項目=/.test(html)
    && /追蹤狀態=/.test(html);

  addCheck(checks, missingTestIds.length === 0, `${source}-testids`, `${source} exposes scorecard UI E2E hooks`, { missingTestIds });
  addCheck(checks, resultPills.length === 4, `${source}-result-pills`, `${source} has result capsule filters all/win/loss/flat`, { resultPills });
  addCheck(checks, hasStrategyButtons, `${source}-strategy-pills`, `${source} has strategy capsule buttons`, { hasStrategyButtons });
  addCheck(checks, usesAllStrategySummary, `${source}-no-strategy-truncation`, `${source} does not truncate strategy summary cards`, { usesAllStrategySummary });
  addCheck(checks, hasMobileCss, `${source}-mobile-css`, `${source} has mobile responsive scorecard CSS`, { hasMobileCss });
  addCheck(checks, hidesBasisPanel, `${source}-basis-hidden`, `${source} hides the scorecard basis/source explanation panel`, { hidesBasisPanel });
  addCheck(checks, hasHistorySelect, `${source}-history-select`, `${source} has historical date selector and per-date summaries`, { hasHistorySelect });
  addCheck(checks, hasThemeToggle, `${source}-theme-toggle`, `${source} has night/sun theme toggle`, { hasThemeToggle });
  addCheck(checks, preservesDecimalPnl, `${source}-decimal-pnl`, `${source} preserves decimal pnl instead of rounding table values to integers`, { preservesDecimalPnl });
  addCheck(checks, displaysLotPnl, `${source}-lot-pnl`, `${source} displays pnl as price spread multiplied by 1000 shares`, { displaysLotPnl });
  addCheck(checks, hasRuleColumns, `${source}-rule-columns`, `${source} displays strategy item, strategy details, and 7-day followup as dedicated columns`, { hasRuleColumns });
  addCheck(checks, cleansMachineMarkers, `${source}-clean-rule-markers`, `${source} removes rule machine markers from the reason column`, { cleansMachineMarkers });
}

async function main() {
  const checks = [];
  const details = {};
  const localHtml = readText("88.html");
  verifyHtmlContract(checks, localHtml, "local-88-html");

  if (CHECK_LIVE) {
    const liveApi = await fetchJson("/api/scorecard", 35000);
    details.liveApi = {
      status: liveApi.status,
      cacheControl: liveApi.headers["cache-control"] || "",
      cacheSource: liveApi.json?.cacheSource || liveApi.json?.source || "",
      ...verifyPayload(checks, liveApi.json, "live-api"),
    };
    addCheck(checks, liveApi.status >= 200 && liveApi.status < 300, "live-api-http", "live /api/scorecard returns 2xx", { status: liveApi.status });
    addCheck(checks, /no-store/i.test(liveApi.headers["cache-control"] || ""), "live-api-no-store", "live /api/scorecard has no-store header", { cacheControl: liveApi.headers["cache-control"] || "" });

    const livePage = await fetchText("/88", 35000);
    details.livePage = {
      status: livePage.status,
      cacheControl: livePage.headers["cache-control"] || "",
    };
    addCheck(checks, livePage.status >= 200 && livePage.status < 300, "live-page-http", "live /88 returns 2xx", details.livePage);
    verifyHtmlContract(checks, livePage.body, "live-88-html");
  }

  const ok = checks.every((check) => check.ok);
  const report = {
    ok,
    checkedAt: new Date().toISOString(),
    contract: "scorecard-ui-e2e-v1",
    checks,
    details,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "scorecard-ui-e2e.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "scorecard-ui-e2e.md"), [
    "# Scorecard UI E2E",
    "",
    `ok: ${ok}`,
    `checkedAt: ${report.checkedAt}`,
    "",
    ...checks.map((check) => `- ${check.ok ? "OK" : "FAIL"} ${check.id}: ${check.message}`),
    "",
  ].join("\n"), "utf8");
  console.log(`[scorecard-ui-e2e] wrote ${path.join(OUT_DIR, "scorecard-ui-e2e.md")}`);
  if (!ok) {
    checks.filter((check) => !check.ok).forEach((check) => console.error(`- ${check.id}: ${check.message}`));
    process.exit(1);
  }
  console.log("[scorecard-ui-e2e] ok");
}

main().catch((error) => {
  console.error(`[scorecard-ui-e2e] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
