const https = require("https");

const BASE_URL = String(process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const REQUIRE_ROWS = process.argv.includes("--require-rows") || process.env.FUMAN_SEVEN_STRATEGY_DAILY_HISTORY_REQUIRE_ROWS === "1";
const ENDPOINT = "/api/seven-strategy-daily-history";

function todayTaipeiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function fetchJson(pathname, timeoutMs = 45000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}verify=${Date.now()}`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode || 0, headers: response.headers, json: JSON.parse(body || "null"), body });
        } catch (error) {
          reject(new Error(`${pathname} invalid JSON HTTP ${response.statusCode}: ${error.message}; body=${body.slice(0, 240)}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", reject);
  });
}

function secondsFromTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return -1;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function hasReplay(row) {
  return [row.source, row.strategy, row.signalType].some((value) => String(value || "").toLowerCase().includes("replay"));
}

function blank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  return String(value).trim() === "";
}

async function main() {
  const expectedDate = todayTaipeiDate();
  const [historyResponse, reportsResponse] = await Promise.all([
    fetchJson(`${ENDPOINT}?limit=100`, 60000),
    fetchJson("/api/source-reports", 60000).catch((error) => ({ status: 0, json: { ok: false, error: error.message } })),
  ]);
  const payload = historyResponse.json || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const reports = Array.isArray(reportsResponse.json?.sourceReports) ? reportsResponse.json.sourceReports : [];
  const sourceReport = reports.find((report) => String(report.key || report.sourceName || "").toLowerCase() === "seven_strategy_daily_history");
  const issues = [];
  if (historyResponse.status < 200 || historyResponse.status >= 300) issues.push(`http_status_${historyResponse.status}`);
  if (payload.ok !== true) issues.push(`payload_ok_${payload.ok}`);
  if (payload.sourceName !== "seven_strategy_daily_history") issues.push(`source_name_${payload.sourceName || "missing"}`);
  if (payload.table !== "public.seven_strategy_daily_history") issues.push(`table_${payload.table || "missing"}`);
  if (payload.tradeDate !== expectedDate) issues.push(`trade_date_${payload.tradeDate || "missing"}_expected_${expectedDate}`);
  if (!payload.source || !String(payload.source).includes("supabase:public.seven_strategy_daily_history")) issues.push("source_not_supabase_seven_strategy_daily_history");
  if (REQUIRE_ROWS && rows.length < 1) issues.push("empty_rows");
  if (!sourceReport) issues.push("source_reports_missing_seven_strategy_daily_history");
  for (const [index, row] of rows.entries()) {
    if (row.tradeDate !== expectedDate) issues.push(`row_${index}_old_trade_date_${row.tradeDate || "missing"}`);
    const key = secondsFromTime(row.detectTime);
    if (key < secondsFromTime("09:00:00") || key > secondsFromTime("13:30:00")) issues.push(`row_${index}_outside_window_${row.detectTime || "missing"}`);
    if (blank(row.symbol)) issues.push(`row_${index}_blank_symbol`);
    if (blank(row.name)) issues.push(`row_${index}_blank_name`);
    if (blank(row.entryPrice)) issues.push(`row_${index}_blank_entryPrice`);
    if (blank(row.strategy)) issues.push(`row_${index}_blank_strategy`);
    if (row.signalType !== "formal" && row.signalType !== "detected") issues.push(`row_${index}_bad_signalType_${row.signalType || "missing"}`);
    if (hasReplay(row)) issues.push(`row_${index}_replay`);
    if (index > 0) {
      const previous = rows[index - 1];
      const previousKey = secondsFromTime(previous.detectTime);
      if (previousKey < key) issues.push(`row_${index}_order_not_latest_first`);
    }
  }
  if (issues.length) {
    console.error(`[scorecard-seven-strategy-daily-history-live] rawOk=false base=${BASE_URL} endpoint=${ENDPOINT} issues=${issues.join(",")} rows=${rows.length} sourceReports=${Boolean(sourceReport)}`);
    process.exit(1);
  }
  console.log(`[scorecard-seven-strategy-daily-history-live] rawOk=true base=${BASE_URL} endpoint=${ENDPOINT} sourceName=${payload.sourceName} table=${payload.table} tradeDate=${payload.tradeDate} rows=${rows.length} formal=${payload.formalCount} detected=${payload.detectedCount} requireRows=${REQUIRE_ROWS} sourceReports=${Boolean(sourceReport)} filteredOld=${payload.filtered?.nonToday ?? "missing"} filteredWindow=${payload.filtered?.outsideWindow ?? "missing"} filteredReplay=${payload.filtered?.replay ?? "missing"} filteredBlankRequired=${payload.filtered?.blankRequired ?? "missing"} source=${payload.source}`);
}

main().catch((error) => {
  console.error(`[scorecard-seven-strategy-daily-history-live] rawOk=false error=${error.stack || error.message || error}`);
  process.exit(1);
});
