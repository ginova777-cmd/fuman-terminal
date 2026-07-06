"use strict";

const fs = require("fs");
const path = require("path");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const { hydrateScorecardRuleMetadataFromReason } = require("../lib/scorecard-rule-locks");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "scorecard-latest.json");
const DAYS = Math.max(1, Number(process.env.FUMAN_SCORECARD_DAYS || "30"));
const RECORD_LIMIT = Math.max(1000, Number(process.env.FUMAN_SCORECARD_RECORD_LIMIT || String(DAYS * 800)));
const SCORECARD_CONTRACT = "scorecard-resource-chain-v1";
const TERMINAL_SCORECARD_SOURCE = "terminal-complete-run-scorecard";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_PAGE_SIZE = Math.max(100, Number(process.env.FUMAN_SCORECARD_SUPABASE_PAGE_SIZE || "1000")) || 1000;
const EXPECTED_SCORECARD_STRATEGIES = [
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

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(0, days - 1));
  return date.toISOString().slice(0, 10);
}

function compactDate(value) {
  return cleanText(value).replace(/\D/g, "").slice(0, 8);
}

function dateOnly(value) {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return text.slice(0, 10);
}

function scorecardRunId(latestDate) {
  return `scorecard-${compactDate(latestDate) || "unknown"}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
}

function readSourceReports() {
  const files = [
    process.env.FUMAN_SCORECARD_SOURCE_REPORTS_FILE,
    path.join(RUNTIME_DIR, "data", "scorecard-terminal-current.json"),
  ].filter(Boolean);
  for (const file of files) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      if (Array.isArray(payload.sourceReports) && payload.sourceReports.length) {
        return payload.sourceReports.map((row) => ({ ...row }));
      }
    } catch {}
  }
  return [];
}

async function supabaseGet(table, query, options = {}) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) throw new Error("missing Supabase URL/key for scorecard source export");
  const endpoint = `${url}/rest/v1/${table}?${query}`;
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: "application/json",
  };
  if (options.range) headers.Range = options.range;
  const response = await fetch(endpoint, {
    headers,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : [];
  } catch {
    json = null;
  }
  if (!response.ok) {
    const reason = json?.message || text.slice(0, 300) || `HTTP ${response.status}`;
    throw new Error(`Supabase ${table} source unavailable: ${response.status} ${reason}`);
  }
  if (!Array.isArray(json)) throw new Error(`Supabase ${table} returned non-array payload`);
  return json;
}

async function supabaseGetPaged(table, query, limit) {
  const rows = [];
  while (rows.length < limit) {
    const from = rows.length;
    const to = Math.min(from + SUPABASE_PAGE_SIZE, limit) - 1;
    const page = await supabaseGet(table, query, { range: `${from}-${to}` });
    rows.push(...page);
    if (page.length < (to - from + 1)) break;
  }
  return rows.slice(0, limit);
}

function recordId(row) {
  return cleanText(row.record_id || `${row.record_date}-${row.strategy}-${row.ticker}-${row.entry_time}`);
}

function normalizeRecord(row) {
  const entryPrice = cleanNumber(row.entry_price);
  const highPrice = cleanNumber(row.high_price);
  return hydrateScorecardRuleMetadataFromReason({
    record_id: recordId(row),
    record_date: cleanText(row.record_date).slice(0, 10),
    strategy: cleanText(row.strategy || "未分類"),
    ticker: cleanText(row.ticker),
    name: cleanText(row.name),
    entry_time: cleanText(row.entry_time),
    entry_price: entryPrice,
    high_price: highPrice,
    pnl: entryPrice && highPrice ? Math.round((highPrice - entryPrice) * 10000) / 10000 : cleanNumber(row.pnl),
    source_sheet: cleanText(row.source || row.source_sheet || "supabase:trade_records"),
    source: cleanText(row.source || row.source_sheet || "supabase:trade_records"),
    reason: cleanText(row.reason),
  });
}

function normalizeDaily(row) {
  return {
    summary_date: cleanText(row.summary_date).slice(0, 10),
    strategy: cleanText(row.strategy || "未分類"),
    signals: cleanNumber(row.signals),
    backtestable: cleanNumber(row.backtestable),
    wins: cleanNumber(row.wins),
    losses: cleanNumber(row.losses),
    flats: cleanNumber(row.flats),
    win_rate_pct: cleanNumber(row.win_rate_pct),
    total_pnl: cleanNumber(row.total_pnl),
    avg_pnl: cleanNumber(row.avg_pnl),
    max_profit: cleanNumber(row.max_profit),
    max_loss: cleanNumber(row.max_loss),
    status: cleanText(row.status),
    note: cleanText(row.note),
    source_sheet: cleanText(row.source || row.source_sheet || "supabase:strategy_daily_summary"),
    source: cleanText(row.source || row.source_sheet || "supabase:strategy_daily_summary"),
  };
}

function summarize(records, dailyRows, latestDate) {
  const wins = records.filter((row) => cleanNumber(row.pnl) > 0).length;
  const losses = records.filter((row) => cleanNumber(row.pnl) < 0).length;
  const flats = records.filter((row) => cleanNumber(row.pnl) === 0).length;
  const totalPnl = records.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
  const grouped = new Map();
  records.forEach((row) => {
    const strategy = cleanText(row.strategy || "未分類");
    grouped.set(strategy, [...(grouped.get(strategy) || []), row]);
  });
  const byStrategy = [...grouped.entries()].map(([strategy, rows]) => {
    const strategyWins = rows.filter((row) => cleanNumber(row.pnl) > 0).length;
    const strategyLosses = rows.filter((row) => cleanNumber(row.pnl) < 0).length;
    const strategyPnl = rows.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
    return {
      strategy,
      rows: rows.length,
      wins: strategyWins,
      losses: strategyLosses,
      flats: rows.filter((row) => cleanNumber(row.pnl) === 0).length,
      winRate: rows.length ? (strategyWins / rows.length) * 100 : 0,
      pnl: strategyPnl,
    };
  }).sort((a, b) => b.pnl - a.pnl || b.rows - a.rows);
  return {
    latestDate,
    rows: records.length,
    wins,
    losses,
    flats,
    winRate: records.length ? (wins / records.length) * 100 : 0,
    totalPnl,
    byStrategy,
    daily: dailyRows,
  };
}

function completeDateInfo(records) {
  const byDate = new Map();
  for (const row of records) {
    const date = cleanText(row.record_date);
    const strategy = cleanText(row.strategy || "未分類");
    if (!date || !strategy) continue;
    if (!byDate.has(date)) byDate.set(date, { date, rows: 0, byStrategy: new Map() });
    const info = byDate.get(date);
    info.rows += 1;
    info.byStrategy.set(strategy, (info.byStrategy.get(strategy) || 0) + 1);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).map((info) => {
    const byStrategy = Object.fromEntries([...info.byStrategy.entries()]);
    const missingStrategies = EXPECTED_SCORECARD_STRATEGIES.filter((strategy) => !byStrategy[strategy]);
    return {
      date: info.date,
      rows: info.rows,
      strategies: Object.keys(byStrategy).length,
      byStrategy,
      missingStrategies,
      complete: missingStrategies.length === 0,
    };
  });
}

async function main() {
  const outFile = argValue("out", OUT_FILE);
  const exportSource = cleanText(argValue("source", process.env.FUMAN_SCORECARD_EXPORT_SOURCE || TERMINAL_SCORECARD_SOURCE));
  const expectedDate = dateOnly(argValue("expected-date", process.env.FUMAN_SCORECARD_EXPECTED_DATE || ""));
  const since = dateDaysAgo(DAYS);
  const selectRecords = [
    "record_id",
    "record_date",
    "strategy",
    "ticker",
    "name",
    "entry_time",
    "entry_price",
    "high_price",
    "pnl",
    "source",
    "reason",
  ].join(",");
  const selectDaily = [
    "summary_date",
    "strategy",
    "signals",
    "backtestable",
    "wins",
    "losses",
    "flats",
    "win_rate_pct",
    "total_pnl",
    "avg_pnl",
    "max_profit",
    "max_loss",
    "status",
    "note",
    "source",
  ].join(",");
  const records = (await supabaseGetPaged(
    "trade_records",
    [
      `select=${selectRecords}`,
      exportSource ? `source=eq.${encodeURIComponent(exportSource)}` : "",
      `record_date=gte.${since}`,
      "order=record_date.desc,strategy.asc,ticker.asc",
    ].filter(Boolean).join("&"),
    RECORD_LIMIT,
  )).map(normalizeRecord).filter((row) => row.record_date && row.ticker);
  const dailyRows = (await supabaseGetPaged(
    "strategy_daily_summary",
    [
      `select=${selectDaily}`,
      exportSource ? `source=eq.${encodeURIComponent(exportSource)}` : "",
      `summary_date=gte.${since}`,
      "order=summary_date.desc,strategy.asc",
    ].filter(Boolean).join("&"),
    5000,
  )).map(normalizeDaily).filter((row) => row.strategy);
  const dateInfo = completeDateInfo(records);
  const latestDate = (dateInfo.find((item) => item.complete)?.date || records.map((row) => row.record_date).sort().at(-1) || "");
  const sourceReports = readSourceReports();
  if (!latestDate) throw new Error("scorecard Supabase source has no trade_records latestDate");
  if (!records.length) throw new Error("scorecard Supabase source returned 0 trade_records");
  if (expectedDate && latestDate !== expectedDate) {
    throw new Error(`scorecard export latestDate=${latestDate} does not match expectedDate=${expectedDate}`);
  }

  const payload = {
    ok: true,
    contract: SCORECARD_CONTRACT,
    qualityStatus: "complete",
    marketDate: latestDate,
    runId: scorecardRunId(latestDate),
    source: "supabase-scorecard-source",
    cacheSource: "supabase-snapshot",
    exportSource,
    sourceQuery: {
      source: exportSource,
      since,
      expectedDate,
      selectedLatestDateReason: dateInfo.find((item) => item.date === latestDate)?.complete
        ? "latest complete date with all expected strategies"
        : "fallback newest date; verifier must block if incomplete",
      latestDateCandidates: dateInfo.slice(0, 10),
    },
    updatedAt: new Date().toISOString(),
    latestDate,
    days: DAYS,
    records,
    sourceReports,
    summary: summarize(records, dailyRows, latestDate),
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    out: outFile,
    latestDate,
    rows: records.length,
    dailyRows: dailyRows.length,
    sourceReports: sourceReports.length,
    recordLimit: RECORD_LIMIT,
    fetchedRows: records.length,
    cacheSource: payload.cacheSource,
    exportSource: payload.exportSource,
    expectedDate,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[export-scorecard-supabase-source] failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
