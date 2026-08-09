const https = require("https");

const BASE_URL = String(process.env.FUMAN_SCORECARD_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const REQUIRE_ROWS = process.argv.includes("--require-rows") || process.env.FUMAN_DAYTRADE_ENTRY_REQUIRE_ROWS === "1";
const ENDPOINT = "/api/daytrade-entry-history";

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const digits = raw.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return "";
}

function expectedTradeDate() {
  return normalizeDate(argValue("--date") || argValue("--trade-date") || process.env.FUMAN_SCORECARD_EXPECTED_DATE || "") || todayTaipeiDate();
}

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

function hasReplayObservation(row) {
  return [row.source, row.strategy_label, row.signal_type].some((value) => String(value || "").toLowerCase().includes("replay")
    || String(value || "").toLowerCase().includes("observation"));
}

async function main() {
  const expectedDate = expectedTradeDate();
  const response = await fetchJson(`${ENDPOINT}?date=${encodeURIComponent(expectedDate)}`, 60000);
  const payload = response.json || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const issues = [];
  if (response.status < 200 || response.status >= 300) issues.push(`http_status_${response.status}`);
  if (payload.ok !== true) issues.push(`payload_ok_${payload.ok}`);
  if (payload.table !== "public.fugle_daytrade_entry_history") issues.push(`table_${payload.table || "missing"}`);
  if (payload.tradeDate !== expectedDate) issues.push(`trade_date_${payload.tradeDate || "missing"}_expected_${expectedDate}`);
  if (!payload.source || !String(payload.source).includes("supabase:public.fugle_daytrade_entry_history")) issues.push("source_not_supabase_entry_history");
  if (REQUIRE_ROWS && rows.length < 1) issues.push("empty_rows");
  for (const [index, row] of rows.entries()) {
    if (row.trade_date !== expectedDate) issues.push(`row_${index}_old_trade_date_${row.trade_date || "missing"}`);
    const key = secondsFromTime(row.entry_time);
    if (key < secondsFromTime("09:00:00") || key > secondsFromTime("13:30:00")) issues.push(`row_${index}_outside_window_${row.entry_time || "missing"}`);
    if (!String(row.symbol || "").trim()) issues.push(`row_${index}_blank_symbol`);
    if (hasReplayObservation(row)) issues.push(`row_${index}_replay_observation`);
    if (String(row.signal_type || "formal").toLowerCase() !== "formal") issues.push(`row_${index}_signal_type_not_formal`);
    if (index > 0) {
      const previous = rows[index - 1];
      const previousKey = secondsFromTime(previous.entry_time);
      if (previousKey < key) issues.push(`row_${index}_order_not_latest_first`);
    }
  }
  if (issues.length) {
    console.error(`[scorecard-daytrade-entry-live] rawOk=false base=${BASE_URL} endpoint=${ENDPOINT} issues=${issues.join(",")} rows=${rows.length}`);
    process.exit(1);
  }
  console.log(`[scorecard-daytrade-entry-live] rawOk=true base=${BASE_URL} endpoint=${ENDPOINT} table=${payload.table} tradeDate=${payload.tradeDate} rows=${rows.length} requireRows=${REQUIRE_ROWS} filteredOld=${payload.filtered?.nonToday ?? "missing"} filteredWindow=${payload.filtered?.outsideWindow ?? "missing"} filteredReplayObservation=${payload.filtered?.replayObservation ?? "missing"} source=${payload.source}`);
}

main().catch((error) => {
  console.error(`[scorecard-daytrade-entry-live] rawOk=false error=${error.stack || error.message || error}`);
  process.exit(1);
});
