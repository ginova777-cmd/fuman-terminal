"use strict";

const {
  STRATEGY,
  CONTRACT_VERSION,
  RESULTS_TABLE,
  RUNS_TABLE,
  taipeiDate,
  readJson,
  scanReceiptPath,
} = require("../scripts/strategy3-v2-contract");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

function cleanNumber(value) {
  const n = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function compactReason(row) {
  const entry = row.entry_price ?? row.entryPrice ?? "--";
  const close = row.close_price ?? row.close ?? "--";
  const candles = row.candle_count ?? row.candleCount ?? "--";
  const entryTime = String(row.entry_candle_time || row.entryCandleTime || "").slice(11, 16) || "13:00";
  return `Strategy3 V2 隔日沖參考；${entryTime} 進場價=${entry}；收盤=${close}；當日 1m=${candles} 根；同日 Fugle candles/quotes 完整掃。`;
}

function pctText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value == null ? "" : String(value);
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function normalizeRow(source = {}, index = 0) {
  const payload = source.payload && typeof source.payload === "object" ? source.payload : source;
  const row = { ...payload, ...source };
  const reason = compactReason(row);
  const code = String(row.code || row.symbol || "").trim();
  const close = row.close_price ?? row.closePrice ?? row.close ?? row.price ?? "";
  const entry = row.entry_price ?? row.entryPrice ?? "";
  const pct = pctText(row.change_percent ?? row.changePercent ?? row.pct ?? row.percent);
  const tags = [
    "隔日沖參考",
    "13:00進場",
    "V2完整掃",
    ...(Array.isArray(row.reason_codes) ? row.reason_codes.slice(0, 2) : []),
  ];
  return {
    ...row,
    rank: Number(row.rank || index + 1),
    code,
    symbol: code,
    stock_id: code,
    name: row.name || row.title || "",
    title: row.title || row.name || "",
    strategy: STRATEGY,
    strategyLabel: "Strategy3 V2",
    signalLabel: "隔日沖參考",
    subStrategy: "strategy3_v2_overnight_reference",
    price: close,
    close,
    closePrice: close,
    lastPrice: close,
    entryPrice: entry,
    entry_price: entry,
    pct,
    change: pct,
    percent: pct,
    changePercent: row.change_percent ?? row.changePercent,
    stopPrice: row.stop_price ?? row.stopPrice,
    targetPrice: row.conservative_target_price ?? row.targetPrice,
    conservativeTargetPrice: row.conservative_target_price ?? row.conservativeTargetPrice,
    aggressiveTargetPrice: row.aggressive_target_price ?? row.aggressiveTargetPrice,
    score: cleanNumber(row.score),
    volumeRatio: row.volume_ratio || row.volumeRatio || "",
    tags,
    signalTags: tags,
    signals: tags.map((label) => ({ id: label, label })),
    reason,
    summary: reason,
    line: reason,
    triggerReason: reason,
    tradeDate: row.trade_date || row.tradeDate || "",
    scanDate: row.trade_date || row.tradeDate || "",
  };
}

async function fetchSupabaseJson(table, query) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, status: 0, rows: [], error: "supabase_credentials_missing" };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const text = await response.text().catch(() => "");
  let rows = [];
  try { rows = JSON.parse(text); } catch {}
  return { ok: response.ok, status: response.status, rows: Array.isArray(rows) ? rows : [], error: response.ok ? "" : text.slice(0, 240) };
}

async function readSupabasePayload(dateDash, options = {}) {
  const runQuery = new URLSearchParams({
    select: "*",
    trade_date: options.latestReadOnly ? `lte.${dateDash}` : `eq.${dateDash}`,
    strategy: `eq.${STRATEGY}`,
    contract: `eq.${CONTRACT_VERSION}`,
    complete: "eq.true",
    status: "eq.complete",
    order: "finished_at.desc,created_at.desc",
    limit: "1",
  }).toString();
  const runResult = await fetchSupabaseJson(RUNS_TABLE, runQuery);
  if (!runResult.ok || !runResult.rows.length) return { ok: false, source: "supabase", reason: runResult.error || "strategy3_v2_no_supabase_complete_run", status: runResult.status };
  const run = runResult.rows[0];
  const resultQuery = new URLSearchParams({
    select: "*",
    run_id: `eq.${run.run_id}`,
    order: "rank.asc",
    limit: "2000",
  }).toString();
  const rowsResult = await fetchSupabaseJson(RESULTS_TABLE, resultQuery);
  if (!rowsResult.ok) return { ok: false, source: "supabase", reason: rowsResult.error || "strategy3_v2_supabase_results_read_failed", status: rowsResult.status };
  return {
    ok: true,
    source: "supabase",
    run,
    rows: rowsResult.rows.map((row, index) => normalizeRow(row, index)),
    latestReadOnly: options.latestReadOnly === true,
  };
}

function payloadFromComplete({ source, runId, tradeDate, status, count, rows, scannerSummary, latestReadOnly = false }) {
  const readonlyHistory = latestReadOnly === true;
  const displayMode = readonlyHistory ? "latest_readonly_history" : "strategy3_v2_complete_run";
  const formalDisplayAllowed = !readonlyHistory;
  const publishAllowed = !readonlyHistory;
  const unattendedStatus = readonlyHistory ? "HISTORY_ONLY" : "YES";
  const evidenceStatus = readonlyHistory ? "historical_readonly" : "complete";
  return {
    ok: true,
    complete: true,
    strategy: STRATEGY,
    contract: CONTRACT_VERSION,
    source,
    cacheSource: source,
    runId,
    run_id: runId,
    tradeDate,
    trade_date: tradeDate,
    scanDate: tradeDate,
    usedDate: tradeDate,
    dataDate: tradeDate,
    expectedTradeDate: tradeDate,
    status: readonlyHistory ? "READONLY_HISTORY" : "complete",
    rawStatus: readonlyHistory ? "READONLY_HISTORY" : (status || "COMPLETE"),
    qualityStatus: readonlyHistory ? "historical_readonly" : "complete",
    evidenceStatus,
    unattendedStatus,
    publishAllowed,
    latestOverwriteAllowed: !latestReadOnly,
    formalDisplayAllowed,
    todayAuthoritative: !latestReadOnly,
    preservePreviousGood: latestReadOnly,
    previousGoodReadback: latestReadOnly,
    resultCount: count || rows.length,
    count: count || rows.length,
    matches: rows,
    rows,
    scannerSummary: scannerSummary || {},
    run_quality_at_publish: {
      status: readonlyHistory ? "READONLY_HISTORY" : "complete",
      evidenceStatus,
      unattendedStatus,
      publishAllowed,
      latestOverwriteAllowed: !latestReadOnly,
      preservePreviousGood: latestReadOnly,
      previousGoodReadback: latestReadOnly,
    },
    terminalAuthority: {
      key: "strategy3",
      runId,
      tradeDate,
      sourceDate: tradeDate,
      moduleStatus: readonlyHistory ? "historical_readonly" : "complete",
      todayAuthoritative: !latestReadOnly,
      formalDisplayAllowed,
      displayMode,
      displayBlockReason: readonlyHistory ? "today_no_new_complete_run" : "",
      pendingNotDue: false,
      evidenceStatus,
      publishAllowed,
      fallback: latestReadOnly,
      resultCount: count || rows.length,
      readbackCount: rows.length,
    },
  };
}

module.exports = async function strategy3V2Latest(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  const date = String(request.query?.date || taipeiDate()).replace(/\D/g, "").slice(0, 8);
  const dateDash = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

  const supabase = await readSupabasePayload(dateDash).catch((error) => ({ ok: false, source: "supabase", reason: String(error?.message || error).slice(0, 240) }));
  if (supabase.ok) {
    return response.status(200).json(payloadFromComplete({
      source: "supabase:strategy3_v2",
      runId: supabase.run.run_id,
      tradeDate: supabase.run.trade_date || dateDash,
      status: supabase.run.status,
      count: Number(supabase.run.result_count || supabase.rows.length) || supabase.rows.length,
      rows: supabase.rows,
      scannerSummary: supabase.run.coverage || {},
      latestReadOnly: supabase.latestReadOnly === true,
    }));
  }

  const latestSupabase = await readSupabasePayload(dateDash, { latestReadOnly: true }).catch(() => null);
  if (latestSupabase?.ok) {
    return response.status(200).json(payloadFromComplete({
      source: "supabase:strategy3_v2:latest_readonly_history",
      runId: latestSupabase.run.run_id,
      tradeDate: latestSupabase.run.trade_date || dateDash,
      status: latestSupabase.run.status,
      count: Number(latestSupabase.run.result_count || latestSupabase.rows.length) || latestSupabase.rows.length,
      rows: latestSupabase.rows,
      scannerSummary: latestSupabase.run.coverage || {},
      latestReadOnly: true,
    }));
  }

  const receipt = readJson(scanReceiptPath(date), null);
  const rawRows = Array.isArray(receipt?.results) ? receipt.results : [];
  const rows = rawRows.map((row, index) => normalizeRow({ ...row, trade_date: receipt?.trade_date || row.trade_date || "" }, index));
  const complete = receipt?.ok === true && String(receipt?.status || "").toUpperCase() === "COMPLETE";
  const payload = complete
    ? payloadFromComplete({
        source: "strategy3_v2_scan_receipt",
        runId: receipt.run_id,
        tradeDate: receipt.trade_date || "",
        status: receipt.status || "",
        count: receipt.result_count || rows.length,
        rows,
        scannerSummary: receipt.scanner_summary || {},
      })
    : {
        ok: false,
        complete: false,
        strategy: STRATEGY,
        contract: CONTRACT_VERSION,
        source: "strategy3_v2",
        status: "FAIL_CLOSED",
        evidenceStatus: "insufficient",
        unattendedStatus: "NO",
        publishAllowed: false,
        formalDisplayAllowed: false,
        reason_code: receipt?.reason_code || supabase.reason || "strategy3_v2_no_complete_scan",
        matches: [],
        rows: [],
      };
  return response.status(200).json(payload);
};
