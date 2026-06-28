const fs = require("fs");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");

const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const SNAPSHOT_FILE = path.join(process.cwd(), "data", "scorecard-latest.json");

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function isoDate(value) {
  const text = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function historyDates(records) {
  return [...new Set((Array.isArray(records) ? records : [])
    .map((row) => cleanText(row.record_date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))]
    .sort()
    .reverse();
}

function summarize(records, dailyRows, latestDate) {
  const rows = Array.isArray(records) ? records : [];
  const wins = rows.filter((row) => cleanNumber(row.pnl) > 0).length;
  const losses = rows.filter((row) => cleanNumber(row.pnl) < 0).length;
  const flats = rows.length - wins - losses;
  const totalPnl = rows.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
  const grouped = new Map();
  rows.forEach((row) => {
    const strategy = cleanText(row.strategy || "未分類") || "未分類";
    grouped.set(strategy, [...(grouped.get(strategy) || []), row]);
  });
  const byStrategy = [...grouped.entries()].map(([strategy, items]) => {
    const strategyWins = items.filter((row) => cleanNumber(row.pnl) > 0).length;
    const strategyLosses = items.filter((row) => cleanNumber(row.pnl) < 0).length;
    const strategyPnl = items.reduce((sum, row) => sum + cleanNumber(row.pnl), 0);
    return {
      strategy,
      rows: items.length,
      wins: strategyWins,
      losses: strategyLosses,
      flats: items.length - strategyWins - strategyLosses,
      winRate: items.length ? (strategyWins / items.length) * 100 : 0,
      pnl: strategyPnl,
    };
  }).sort((a, b) => b.pnl - a.pnl || b.rows - a.rows);
  return {
    latestDate,
    rows: rows.length,
    wins,
    losses,
    flats,
    winRate: rows.length ? (wins / rows.length) * 100 : 0,
    totalPnl,
    byStrategy,
    daily: Array.isArray(dailyRows) ? dailyRows : [],
  };
}

function selectPayloadDate(payload, requestedDate = "") {
  const allRecords = Array.isArray(payload?.records) ? payload.records : [];
  const dates = historyDates(allRecords);
  const selectedDate = dates.includes(requestedDate) ? requestedDate : (isoDate(payload?.latestDate) || dates[0] || "");
  const records = selectedDate ? allRecords.filter((row) => cleanText(row.record_date) === selectedDate) : allRecords;
  const allDaily = Array.isArray(payload?.summary?.daily) ? payload.summary.daily : [];
  const daily = selectedDate ? allDaily.filter((row) => cleanText(row.summary_date) === selectedDate) : allDaily;
  return {
    ...payload,
    latestDate: selectedDate || payload.latestDate || "",
    selectedDate: selectedDate || payload.latestDate || "",
    historyLatestDate: dates[0] || payload.latestDate || "",
    historyDates: dates,
    records,
    summary: summarize(records, daily, selectedDate || payload.latestDate || ""),
  };
}

function readStaticSnapshot(reason = "scorecard_static_snapshot") {
  const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
  const payload = JSON.parse(raw);
  return {
    ok: payload.ok !== false,
    ...payload,
    cacheSource: payload.cacheSource || "json-snapshot",
    fallbackReason: reason,
  };
}

async function buildPayload(requestedDate = "") {
  const snapshot = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 30000 }).catch(() => null);
  if (snapshot?.payload && typeof snapshot.payload === "object") {
    return selectPayloadDate({
      ok: snapshot.payload.ok !== false,
      ...snapshot.payload,
      source: snapshot.payload.source || "supabase:scorecard_snapshot",
      cacheSource: "supabase-snapshot",
      snapshot: {
        key: snapshot.key || SNAPSHOT_KEY,
        tradeDate: snapshot.tradeDate || "",
        updatedAt: snapshot.updatedAt || "",
        source: snapshot.source || "",
      },
    }, requestedDate);
  }
  return selectPayloadDate(readStaticSnapshot("supabase_scorecard_snapshot_missing"), requestedDate);
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  try {
    const requestedDate = isoDate(request.query?.date || request.query?.record_date || "");
    const payload = await buildPayload(requestedDate);
    if (request.method === "HEAD") response.status(200).end("");
    else response.status(200).json(payload);
  } catch (error) {
    response.status(503).json({ ok: false, error: "scorecard_unavailable", reason: error?.message || String(error), updatedAt: new Date().toISOString() });
  }
};
