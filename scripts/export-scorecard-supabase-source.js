"use strict";

const fs = require("fs");
const path = require("path");
const { serverSupabaseKey, serverSupabaseUrl } = require("../lib/server-supabase-key");
const { hydrateScorecardRuleMetadataFromReason } = require("../lib/scorecard-rule-locks");

const ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(ROOT, "data", "scorecard-latest.json");
const DAYS = Math.max(1, Number(process.env.FUMAN_SCORECARD_DAYS || "30"));
const RECORD_LIMIT = Math.max(1000, Number(process.env.FUMAN_SCORECARD_RECORD_LIMIT || String(DAYS * 800)));

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

async function supabaseGet(table, query) {
  const url = serverSupabaseUrl();
  const key = serverSupabaseKey();
  if (!url || !key) throw new Error("missing Supabase URL/key for scorecard source export");
  const endpoint = `${url}/rest/v1/${table}?${query}`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json",
    },
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

async function main() {
  const outFile = argValue("out", OUT_FILE);
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
  const records = (await supabaseGet(
    "trade_records",
    `select=${selectRecords}&record_date=gte.${since}&order=record_date.desc,strategy.asc,ticker.asc&limit=${RECORD_LIMIT}`,
  )).map(normalizeRecord).filter((row) => row.record_date && row.ticker);
  const dailyRows = (await supabaseGet(
    "strategy_daily_summary",
    `select=${selectDaily}&summary_date=gte.${since}&order=summary_date.desc,strategy.asc&limit=1000`,
  )).map(normalizeDaily).filter((row) => row.strategy);
  const latestDate = records.map((row) => row.record_date).sort().at(-1) || "";
  if (!latestDate) throw new Error("scorecard Supabase source has no trade_records latestDate");
  if (!records.length) throw new Error("scorecard Supabase source returned 0 trade_records");

  const payload = {
    ok: true,
    source: "supabase-scorecard-source",
    cacheSource: "supabase-snapshot",
    exportSource: "supabase:trade_records+strategy_daily_summary",
    updatedAt: new Date().toISOString(),
    latestDate,
    days: DAYS,
    records,
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
    recordLimit: RECORD_LIMIT,
    cacheSource: payload.cacheSource,
    exportSource: payload.exportSource,
  }, null, 2));
}

main().catch((error) => {
  console.error(`[export-scorecard-supabase-source] failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
