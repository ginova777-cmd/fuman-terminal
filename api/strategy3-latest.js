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

const TABLE = process.env.STRATEGY3_SUPABASE_RESULTS_TABLE || "strategy3_scan_results";
const LATEST_RUN_VIEW = process.env.STRATEGY3_SUPABASE_LATEST_RUN_VIEW || "v_strategy3_latest_complete_run";

function staticFallback(reason = "") {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "strategy3-latest.json"), "utf8"));
    return {
      ...payload,
      cacheSource: "static-fallback",
      transport: {
        source: "static-json",
        via: "api/strategy3-latest",
        fallbackReason: reason,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { ok: false, error: "strategy3_static_fallback_failed", detail: error?.message || String(error) };
  }
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

function normalizeSignals(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePayload(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const signals = normalizeSignals(payload.matches || payload.signals || row.signals);
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
    tradeValue: cleanNumber(payload.tradeValue || payload.value || row.trade_value),
    score: cleanNumber(payload.score || payload.overnightScore || row.score),
    overnightScore: cleanNumber(payload.overnightScore || payload.score || row.score),
    matches: signals,
    reason: String(payload.tvOvernightEntry?.reason || payload.reason || row.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
  };
}

function buildPayload(rows, run) {
  const first = rows[0] || {};
  const matches = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizePayload);
  const scanDate = String(first.scan_date || run?.scan_date || "").replace(/-/g, "");
  return {
    ok: true,
    source: "supabase:strategy3_scan_results",
    cacheSource: "supabase-api",
    runId: String(first.run_id || run?.run_id || ""),
    generatedAt: String(first.generated_at || run?.generated_at || run?.finished_at || first.updated_at || new Date().toISOString()),
    updatedAt: String(run?.finished_at || first.updated_at || new Date().toISOString()),
    usedDate: scanDate,
    complete: true,
    qualityStatus: String(first.quality_status || run?.quality_status || ""),
    count: matches.length,
    total: Math.max(matches.length, cleanNumber(run?.expected_total || run?.scanned_count)),
    matches,
    transport: {
      source: "supabase",
      table: TABLE,
      latestRunView: LATEST_RUN_VIEW,
      gate: "run_id",
      runId: String(first.run_id || run?.run_id || ""),
      via: "api/strategy3-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.strategy3",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].join("&")
  );
  const row = rows[0];
  return row?.run_id ? row : null;
}

async function fetchLatestCompleteRows() {
  const run = await fetchLatestCompleteRun();
  if (!run?.run_id) return { rows: [], run: null };
  const rows = await fetchRowsFrom(
    TABLE,
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,complete,quality_status,generated_at,updated_at",
      "strategy=eq.strategy3",
      `run_id=eq.${encodeURIComponent(run.run_id)}`,
      "order=rank.asc",
      "limit=2000",
    ].join("&")
  );
  return { rows, run };
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
      response.status(200).json(staticFallback("supabase_not_configured"));
      return;
    }
    const latest = await fetchLatestCompleteRows();
    if (!latest.rows.length) {
      response.status(200).json(staticFallback("strategy3_scan_results_latest_empty"));
      return;
    }
    response.status(200).json(buildPayload(latest.rows, latest.run));
  } catch (error) {
    response.status(200).json(staticFallback(error?.message || String(error)));
  }
};
