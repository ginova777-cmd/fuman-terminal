const fs = require("fs");
const path = require("path");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));

const LATEST_RUN_VIEW = process.env.SUPABASE_OPEN_BUY_LATEST_RUN_VIEW || "v_strategy1_open_buy_latest_complete_run";
const TABLE = process.env.SUPABASE_OPEN_BUY_RESULTS_TABLE || "strategy1_open_buy_results";

function taipeiDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value).reduce((out, part) => {
    if (part.type !== "literal") out[part.type] = part.value;
    return out;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function fetchRowsFrom(table, query) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${table} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeRow(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const signals = Array.isArray(payload.signals || row.signals) ? (payload.signals || row.signals) : [];
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || row.code || "").trim(),
    close: cleanNumber(payload.close || payload.price || row.close || row.price),
    price: cleanNumber(payload.price || payload.close || row.price || row.close),
    percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
    tradeVolume: cleanNumber(payload.tradeVolume || payload.volume || row.trade_volume || row.volume),
    volume: cleanNumber(payload.volume || payload.tradeVolume || row.volume || row.trade_volume),
    value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
    score: cleanNumber(payload.score || row.score),
    reason: String(payload.reason || row.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
    signals,
  };
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.strategy1",
      "status=eq.complete",
      "complete=eq.true",
      "order=finished_at.desc",
      "limit=1",
    ].join("&")
  );
  return rows[0]?.run_id ? rows[0] : null;
}

async function fetchLatestCompleteRows() {
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: null };
  const rows = await fetchRowsFrom(
    TABLE,
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,generated_at,updated_at",
      "strategy=eq.strategy1",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      "limit=2000",
    ].join("&")
  );
  return { rows, run };
}

function buildPayload(rows, run) {
  const matches = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizeRow);
  return {
    ok: true,
    source: "supabase:strategy1_open_buy_results",
    cacheSource: "supabase-api",
    runId: String(run?.run_id || rows[0]?.run_id || ""),
    updatedAt: String(run?.finished_at || run?.updated_at || rows[0]?.updated_at || new Date().toISOString()),
    usedDate: String(run?.scan_date || rows[0]?.scan_date || "").replace(/-/g, ""),
    complete: true,
    qualityStatus: String(run?.quality_status || rows[0]?.quality_status || "complete"),
    count: matches.length,
    total: Math.max(matches.length, cleanNumber(run?.expected_total)),
    scannedCount: cleanNumber(run?.scanned_count),
    matches,
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      table: TABLE,
      gate: "run_id",
      runId: String(run?.run_id || rows[0]?.run_id || ""),
      via: "api/open-buy-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function missingPayload(error, detail = "") {
  return {
    ok: false,
    error,
    detail,
    date: taipeiDateKey(),
    cacheSource: "none",
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      table: TABLE,
      gate: "run_id",
      via: "api/open-buy-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      response.status(503).json(missingPayload("strategy1_supabase_not_configured"));
      return;
    }
    const latest = await fetchLatestCompleteRows();
    if (!latest.run?.run_id) {
      response.status(404).json(missingPayload("strategy1_complete_run_missing"));
      return;
    }
    response.status(200).json(buildPayload(latest.rows, latest.run));
  } catch (error) {
    response.status(503).json(missingPayload("strategy1_complete_run_fetch_failed", error?.message || String(error)));
  }
};
