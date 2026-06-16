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

const TABLE = process.env.STRATEGY4_SUPABASE_RESULTS_TABLE || "strategy4_scan_results";
const RUNS_TABLE = process.env.STRATEGY4_SUPABASE_RUNS_TABLE || "strategy4_scan_runs";
const EXPECTED_SCHEMA = "strategy4-cache-v3-unit-contract";
const EXPECTED_UNIT = "lots";
const EXPECTED_SOURCE = "supabase:strategy4_daily_ohlcv_view";

function staticFallback(reason = "") {
  try {
    const payload = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "strategy4-latest.json"), "utf8"));
    return {
      ...payload,
      cacheSource: "static-fallback",
      transport: {
        source: "static-json",
        via: "api/strategy4-latest",
        fallbackReason: reason,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { ok: false, error: "strategy4_static_fallback_failed", detail: error?.message || String(error) };
  }
}

async function fetchRowsFrom(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
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

async function fetchRows(query) {
  return fetchRowsFrom(TABLE, query);
}

async function fetchExactCount(table, query) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const response = await fetch(url, {
    method: "HEAD",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "count=exact",
    },
    cache: "no-store",
  });
  if (!response.ok) return 0;
  const range = response.headers.get("content-range") || "";
  const match = range.match(/\/(\d+)$/);
  return match ? Number(match[1]) || 0 : 0;
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeSignalList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePayload(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const signals = normalizeSignalList(payload.signals || row.signals);
  return {
    ...payload,
    code: String(payload.code || row.code || "").trim(),
    name: String(payload.name || row.name || row.code || "").trim(),
    close: cleanNumber(payload.close || payload.price || row.price),
    price: cleanNumber(payload.price || payload.close || row.price),
    percent: cleanNumber(payload.percent ?? payload.changePercent ?? row.change_percent),
    volume: cleanNumber(payload.volume || row.volume),
    value: cleanNumber(payload.value || payload.tradeValue || row.trade_value),
    swingScore: cleanNumber(payload.swingScore || payload.score || row.score),
    score: cleanNumber(payload.score || payload.swingScore || row.score),
    swingZone: String(payload.swingZone || payload.zone || row.zone || "").trim(),
    swingZoneLabel: String(payload.swingZoneLabel || payload.zoneLabel || row.zone_label || "").trim(),
    signals,
    reason: String(payload.reason || row.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
  };
}

function buildPayload(rows, total) {
  const first = rows[0] || {};
  const matches = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizePayload);
  const zones = matches.reduce((acc, item) => {
    const zone = String(item.swingZone || item.zone || "").toUpperCase();
    if (zone === "A" || zone === "B" || zone === "C") acc[zone] += 1;
    return acc;
  }, { A: 0, B: 0, C: 0 });
  const scanDate = String(first.scan_date || "").replace(/-/g, "");
  return {
    ok: true,
    source: "supabase:strategy4_scan_results",
    cacheSource: "supabase-api",
    schemaVersion: String(first.schema_version || EXPECTED_SCHEMA),
    volumeUnit: String(first.volume_unit || EXPECTED_UNIT),
    dataContractSource: String(first.data_contract_source || EXPECTED_SOURCE),
    runId: String(first.run_id || ""),
    generatedAt: String(first.generated_at || first.scan_time || first.updated_at || new Date().toISOString()),
    updatedAt: String(first.scan_time || first.updated_at || new Date().toISOString()),
    scanStamp: scanDate,
    complete: Boolean(first.complete),
    qualityStatus: String(first.quality_status || ""),
    count: matches.length,
    total: Math.max(matches.length, cleanNumber(total), 1500),
    zones,
    matches,
    transport: {
      source: "supabase",
      table: TABLE,
      runTable: RUNS_TABLE,
      runId: String(first.run_id || ""),
      via: "api/strategy4-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function fetchLatestCompleteRun() {
  const rows = await fetchRowsFrom(
    RUNS_TABLE,
    [
      "select=run_id,scan_date,finished_at,status,complete,result_count,schema_version,volume_unit,data_contract_source",
      "strategy=eq.strategy4",
      "status=eq.complete",
      "complete=eq.true",
      "order=finished_at.desc",
      "limit=1",
    ].join("&")
  );
  const row = rows[0];
  if (!row?.run_id) return null;
  if (row.schema_version && row.schema_version !== EXPECTED_SCHEMA) return null;
  if (row.volume_unit && row.volume_unit !== EXPECTED_UNIT) return null;
  if (row.data_contract_source && row.data_contract_source !== EXPECTED_SOURCE) return null;
  return row;
}

async function fetchLatestCompleteRows() {
  try {
    const run = await fetchLatestCompleteRun();
    if (run?.run_id) {
      const query = [
        "select=run_id,scan_date,scan_time,code,name,signals,price,change_percent,volume,trade_value,score,zone,zone_label,rank,reason,complete,quality_status,schema_version,volume_unit,data_contract_source,generated_at,payload,updated_at",
        "strategy=eq.strategy4",
        `run_id=eq.${encodeURIComponent(run.run_id)}`,
        "order=rank.asc",
        "limit=2000",
      ].join("&");
      const rows = await fetchRows(query);
      if (rows.length) return { rows, gate: "run_id", runId: run.run_id };
    }
  } catch (error) {
    // Backward compatibility until Strategy4RunIdCompleteGate.sql is applied and PostgREST schema cache refreshes.
  }

  const latest = await fetchRows("select=scan_date,scan_time&strategy=eq.strategy4&complete=eq.true&order=scan_time.desc&limit=1");
  const scanDate = latest[0]?.scan_date;
  const scanTime = latest[0]?.scan_time;
  if (!scanDate || !scanTime) return { rows: [], gate: "legacy-scan-time", runId: "" };
  const query = [
    "select=scan_date,scan_time,code,name,signals,price,change_percent,volume,trade_value,score,zone,zone_label,rank,reason,complete,quality_status,schema_version,volume_unit,data_contract_source,generated_at,payload,updated_at",
    "strategy=eq.strategy4",
    `scan_date=eq.${encodeURIComponent(scanDate)}`,
    `scan_time=eq.${encodeURIComponent(scanTime)}`,
    "order=rank.asc",
    "limit=2000",
  ].join("&");
  const rows = await fetchRows(query);
  return { rows, gate: "legacy-scan-time", runId: "" };
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
    const rows = latest.rows || [];
    if (!rows.length) {
      response.status(200).json(staticFallback("strategy4_scan_results_latest_empty"));
      return;
    }
    const total = await fetchExactCount("strategy4_stock_universe_view", "select=symbol&is_strategy4_eligible=eq.true&limit=1").catch(() => 0);
    const payload = buildPayload(rows, total);
    payload.transport.gate = latest.gate || "";
    payload.transport.runId = latest.runId || payload.transport.runId || "";
    payload.runId = latest.runId || payload.runId || "";
    if (payload.schemaVersion !== EXPECTED_SCHEMA || payload.volumeUnit !== EXPECTED_UNIT || payload.dataContractSource !== EXPECTED_SOURCE) {
      response.status(200).json(staticFallback("strategy4_supabase_contract_mismatch"));
      return;
    }
    response.status(200).json(payload);
  } catch (error) {
    response.status(200).json(staticFallback(error?.message || String(error)));
  }
};
