const fs = require("fs");
const path = require("path");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ runtimeDir: RUNTIME_DIR });

const RUNS_TABLE = process.env.SUPABASE_OPEN_BUY_RUNS_TABLE || "strategy1_open_buy_runs";
const RESULTS_TABLE = process.env.SUPABASE_OPEN_BUY_RESULTS_TABLE || "strategy1_open_buy_results";
const READY_STATUS_VIEW = process.env.SUPABASE_STRATEGY1_READY_STATUS_VIEW || "v_strategy1_ready_status";
const STRATEGY1_GATE = "complete-run-authoritative+decision-ready";

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

function compactDateKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return digits;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? taipeiDateKey(new Date(parsed)).replace(/\D/g, "") : "";
}

function isoDateKey(value) {
  const key = compactDateKey(value);
  return /^\d{8}$/.test(key) ? `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}` : "";
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function arrayLength(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value.length;
  }
  return 0;
}

function isEmptySnapshotRestore(payload = {}) {
  const sourceText = [
    payload.cacheSource,
    payload.source,
    payload.transport?.gate,
    payload.transport?.source,
  ].filter(Boolean).join(" ");
  const rows = arrayLength(payload, ["rows", "matches", "buyMatches"]);
  const runId = String(payload.runId || payload.transport?.runId || payload.meta?.run_id || "").trim();
  return /snapshot-friendly-empty|snapshot-soft-fallback/i.test(sourceText)
    || (!runId && cleanNumber(payload.count) === 0 && rows === 0);
}

function parseRequestOptions(request) {
  try {
    const url = new URL(request.url || "", "http://localhost");
    const canvas = url.searchParams.get("canvas") === "1" || url.searchParams.get("compact") === "1";
    const limit = Math.max(1, Math.min(canvas ? 120 : 2000, cleanNumber(url.searchParams.get("limit")) || (canvas ? 60 : 2000)));
    const snapshotFriendly = canvas
      || url.searchParams.get("snapshotBuild") === "1"
      || url.searchParams.get("fastBundle") === "1"
      || url.searchParams.get("shell") === "1";
    return { canvas, limit, snapshotFriendly };
  } catch {
    return { canvas: false, limit: 2000, snapshotFriendly: false };
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

function normalizeDecision(payload = {}, row = {}) {
  const direct = String(row.decision || payload.strategy1Decision?.decision || "").trim().toUpperCase();
  return ["BUY", "WATCH", "BLOCK"].includes(direct) ? direct : "WATCH";
}

function normalizeRow(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const signals = Array.isArray(payload.signals || row.signals) ? (payload.signals || row.signals) : [];
  const decision = normalizeDecision(payload, row);
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
    rank: cleanNumber(row.rank || payload.rank),
    reason: String(payload.reason || row.reason || signals.map((signal) => signal.reason).filter(Boolean).join("；")).trim(),
    signals,
    decision,
    blockReason: String(row.block_reason || payload.strategy1Decision?.blockReason || "").trim(),
    setupType: String(row.setup_type || payload.strategy1Decision?.setupType || payload.setup_type || payload.setupType || "").trim(),
  };
}

function runIsAuthoritative(run = {}) {
  const expectedTotal = cleanNumber(run.expected_total);
  const scannedCount = cleanNumber(run.scanned_count);
  return String(run.status || "").toLowerCase() === "complete"
    && run.complete === true
    && expectedTotal > 0
    && scannedCount > 0
    && expectedTotal === scannedCount;
}

function runTradeDateKey(run = {}) {
  return compactDateKey(run.run_trade_date || run.trade_date || run.scan_date || "");
}

function readinessText(readyStatus = {}) {
  return [
    readyStatus.last_error,
    readyStatus.lastError,
    readyStatus.message,
    readyStatus.reason,
    readyStatus.flame_reason,
    readyStatus.source_status,
    readyStatus.current_phase,
  ].filter(Boolean).join(" ");
}

function allowsPrevious2130Run(readyStatus = {}) {
  const text = readinessText(readyStatus);
  return readyStatus.is_trading_day === false
    || /not_trading_day|market_closed|holiday/i.test(text)
    || /preopen_not_ready|futopt_not_ready/i.test(text);
}

function carryForwardReason(readyStatus = {}, usedDate = "") {
  const sourceDate = isoDateKey(usedDate) || usedDate || "latest trading day";
  const prefix = readyStatus.is_trading_day === false ? "休假日沿用" : "盤前沿用";
  const detail = decisionReadyError(readyStatus);
  return `${prefix} ${sourceDate} 21:30 初篩名單；等待 08:45 個股期貨 / 08:55 搓合；${detail}`;
}

async function fetchReadyStatus() {
  try {
    const rows = await fetchRowsFrom(READY_STATUS_VIEW, "select=*&limit=1");
    return rows[0] || null;
  } catch (error) {
    return { decision_ready: false, last_error: error?.message || String(error) };
  }
}

async function fetchLatestCompleteRun(readyStatus, limit = 50, options = {}) {
  const latestTradingDay = compactDateKey(readyStatus?.latest_trading_day || readyStatus?.trade_date || "");
  const rows = await fetchRowsFrom(
    RUNS_TABLE,
    [
      "select=*",
      "strategy=eq.strategy1",
      "status=eq.complete",
      "complete=eq.true",
      "order=finished_at.desc",
      `limit=${Math.max(1, Math.min(50, cleanNumber(limit) || 50))}`,
    ].join("&")
  );
  let previousAuthoritativeRun = null;
  const currentTradingDayRun = rows.find((run) => {
    if (!run?.run_id || !runIsAuthoritative(run)) return false;
    if (!previousAuthoritativeRun) previousAuthoritativeRun = run;
    const runDate = runTradeDateKey(run);
    return !latestTradingDay || !runDate || runDate === latestTradingDay;
  });
  if (currentTradingDayRun) return currentTradingDayRun;
  if (options.allowPrevious2130Run && previousAuthoritativeRun && allowsPrevious2130Run(readyStatus)) {
    return { ...previousAuthoritativeRun, __previous2130CarryForward: true };
  }
  return null;
}

async function fetchRowsForRun(runId, limit = 2000) {
  return fetchRowsFrom(
    RESULTS_TABLE,
    [
      "select=run_id,scan_date,code,name,price,close,change_percent,volume,trade_volume,trade_value,score,rank,reason,signals,payload,decision,block_reason,setup_type,complete,quality_status,generated_at,updated_at",
      "strategy=eq.strategy1",
      `run_id=eq.${encodeURIComponent(runId)}`,
      "order=rank.asc",
      `limit=${Math.max(1, Math.min(2000, cleanNumber(limit) || 2000))}`,
    ].join("&")
  );
}

function selectPendingDisplayRows(rows) {
  const buy = rows.filter((row) => row.decision === "BUY");
  if (buy.length) return buy;
  const watch = rows.filter((row) => row.decision === "WATCH");
  if (watch.length) return watch;
  const nonBlocked = rows.filter((row) => row.decision !== "BLOCK");
  return nonBlocked.length ? nonBlocked : rows;
}

function strategy1StageCards(resultCount, buyCount, readyStatus = {}) {
  const futoptCount = cleanNumber(
    readyStatus.futopt_ready_count
    || readyStatus.futopt_count
    || readyStatus.individual_futures_count
    || readyStatus.futures_ready_count
  );
  const futoptReady = readyStatus.futopt_ready === true || futoptCount > 0;
  const decisionReady = readyStatus.decision_ready === true;
  return [
    {
      key: "candidate_2130_futopt_0845",
      time: "21:30 + 08:45",
      title: "初篩 + 個股期貨",
      label: "21:30 初篩符合 + 08:45 個股期貨確認",
      count: resultCount,
      secondaryCount: futoptCount,
      status: resultCount > 0 && futoptReady ? "ready" : resultCount > 0 ? "waiting_futopt" : "waiting",
    },
    {
      key: "auction_0855",
      time: "08:55",
      title: "搓合確認",
      label: "08:55 搓合完美符合",
      count: buyCount,
      status: decisionReady ? "ready" : "waiting",
    },
  ];
}

function strategy1SourceCoverage({ usedDate, readyStatus, expectedTotal, scannedCount, carryForward2130, displayMode }) {
  const today = compactDateKey(taipeiDateKey());
  const decisionReady = readyStatus?.decision_ready === true;
  const completeScan = expectedTotal > 0 && scannedCount > 0 && scannedCount >= expectedTotal;
  const ready = Boolean(!carryForward2130 && decisionReady && usedDate === today && completeScan);
  return {
    ok: ready,
    ready,
    status: ready ? "ready" : carryForward2130 ? "carry_forward" : decisionReady ? "stale" : "not_ready",
    reason: ready
      ? "strategy1_today_decision_ready"
      : carryForward2130
        ? "strategy1_previous_2130_carry_forward"
        : decisionReady
          ? `strategy1_source_date_not_today:${usedDate || "missing"}!=${today}`
          : decisionReadyError(readyStatus),
    tradeDate: usedDate,
    today,
    expectedTotal,
    scannedCount,
    decisionReady,
    displayMode,
    readyStatusView: READY_STATUS_VIEW,
    checkedAt: new Date().toISOString(),
  };
}

function buildPayload(rows, run, readyStatus, options = {}) {
  const carryForward2130 = Boolean(options.previous2130CarryForward || run.__previous2130CarryForward);
  const normalized = rows
    .slice()
    .sort((a, b) => cleanNumber(a.rank) - cleanNumber(b.rank) || String(a.code).localeCompare(String(b.code)))
    .map(normalizeRow);
  const matches = normalized.filter((row) => row.decision === "BUY");
  const decisionPending = readyStatus?.decision_ready !== true;
  const displayRows = decisionPending && options.pendingCandidateDisplay
    ? selectPendingDisplayRows(normalized)
    : matches;
  const expectedTotal = cleanNumber(run.expected_total);
  const scannedCount = cleanNumber(run.scanned_count);
  const resultCount = normalized.length;
  const buyCount = normalized.filter((row) => row.decision === "BUY").length;
  const watchCount = normalized.filter((row) => row.decision === "WATCH").length;
  const blockCount = normalized.filter((row) => row.decision === "BLOCK").length;
  const runId = String(run.run_id || "");
  const usedDate = compactDateKey(run.run_trade_date || run.scan_date || rows[0]?.scan_date || "");
  const displayMode = carryForward2130
    ? "previous_2130_candidates"
    : decisionPending && options.pendingCandidateDisplay ? "decision_pending_candidates" : "buy_matches";
  const qualityStatus = carryForward2130
    ? "previous_2130_carry_forward"
    : decisionPending && options.pendingCandidateDisplay ? "decision_pending" : String(run.quality_status || rows[0]?.quality_status || "complete");
  const reason = carryForward2130
    ? carryForwardReason(readyStatus, usedDate)
    : readyStatus?.decision_ready === true ? "decision-ready" : decisionReadyError(readyStatus);
  const fallbackUsed = Boolean(carryForward2130 || (decisionPending && options.pendingCandidateDisplay));
  const fallbackScope = carryForward2130 ? ["previous_2130_complete_run"] : fallbackUsed ? ["decision_pending_display"] : [];
  const fallbackDetails = fallbackUsed
    ? [{
      scope: fallbackScope.join("+"),
      reason,
      usedDate,
      today: compactDateKey(taipeiDateKey()),
    }]
    : [];

  return {
    ok: true,
    source: "supabase:strategy1_open_buy_results",
    cacheSource: "supabase-api",
    gate: STRATEGY1_GATE,
    runId,
    updatedAt: String(run.finished_at || run.updated_at || rows[0]?.updated_at || new Date().toISOString()),
    tradeDate: usedDate,
    usedDate,
    sourceDate: usedDate,
    marketSession: {
      today: compactDateKey(taipeiDateKey()),
      taipeiDate: taipeiDateKey(),
      marketDataDate: usedDate,
      marketDataIsoDate: isoDateKey(usedDate),
      hasTodayMarketData: usedDate === compactDateKey(taipeiDateKey()),
      closed: carryForward2130 || readyStatus?.is_trading_day === false,
      reason: carryForward2130 ? "strategy1-previous-2130-carry-forward" : "strategy1-run-date",
      source: carryForward2130 ? "strategy1-previous-2130-complete-run" : "strategy1-run-date",
    },
    complete: true,
    canvas: Boolean(options.canvas),
    qualityStatus,
    sourceCoverage: strategy1SourceCoverage({ usedDate, readyStatus, expectedTotal, scannedCount, carryForward2130, displayMode }),
    fallbackUsed,
    fallbackScope,
    fallbackDetails,
    decisionReady: readyStatus?.decision_ready === true,
    decisionPending,
    displayMode,
    reason,
    lastError: carryForward2130 ? decisionReadyError(readyStatus) : "",
    count: displayRows.length,
    displayCount: displayRows.length,
    total: expectedTotal || resultCount,
    expectedTotal,
    scannedCount,
    resultCount,
    buyCount,
    watchCount,
    blockCount,
    stageCards: strategy1StageCards(resultCount, buyCount, readyStatus),
    rows: displayRows,
    matches: displayRows,
    buyMatches: matches,
    meta: {
      gate: STRATEGY1_GATE,
      run_id: runId,
      expected_total: expectedTotal,
      scanned_count: scannedCount,
      result_count: resultCount,
      buy_count: buyCount,
      watch_count: watchCount,
      block_count: blockCount,
      display_count: displayRows.length,
      display_mode: displayMode,
      decision_ready: readyStatus?.decision_ready === true,
      decision_pending: decisionPending,
      previous_2130_carry_forward: carryForward2130,
      latest_run_source: RUNS_TABLE,
      ready_status_view: READY_STATUS_VIEW,
    },
    transport: {
      source: "supabase",
      latestRunSource: RUNS_TABLE,
      runsTable: RUNS_TABLE,
      table: RESULTS_TABLE,
      readyStatusView: READY_STATUS_VIEW,
      gate: STRATEGY1_GATE,
      decisionReady: readyStatus?.decision_ready === true,
      decisionPending,
      displayMode,
      previous2130CarryForward: carryForward2130,
      runId,
      via: "api/open-buy-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function missingPayload(error, detail = "") {
  const today = compactDateKey(taipeiDateKey());
  return {
    ok: false,
    error,
    detail,
    date: taipeiDateKey(),
    tradeDate: today,
    usedDate: today,
    sourceDate: today,
    cacheSource: "none",
    gate: STRATEGY1_GATE,
    sourceCoverage: {
      ok: false,
      ready: false,
      status: "blocked",
      reason: detail || error,
      tradeDate: today,
      today,
      checkedAt: new Date().toISOString(),
    },
    fallbackUsed: false,
    fallbackScope: [],
    fallbackDetails: [],
    decisionReady: false,
    lastError: detail || error,
    expectedTotal: 0,
    scannedCount: 0,
    resultCount: 0,
    buyCount: 0,
    watchCount: 0,
    blockCount: 0,
    rows: [],
    matches: [],
    meta: {
      gate: STRATEGY1_GATE,
      expected_total: 0,
      scanned_count: 0,
      result_count: 0,
      buy_count: 0,
      watch_count: 0,
      block_count: 0,
      decision_ready: false,
      latest_run_source: RUNS_TABLE,
      ready_status_view: READY_STATUS_VIEW,
      last_error: detail || error,
    },
    transport: {
      source: "supabase",
      latestRunSource: RUNS_TABLE,
      runsTable: RUNS_TABLE,
      table: RESULTS_TABLE,
      readyStatusView: READY_STATUS_VIEW,
      gate: STRATEGY1_GATE,
      via: "api/open-buy-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function emptySnapshotPayload(error, detail = "") {
  const payload = missingPayload(error, detail);
  return {
    ...payload,
    ok: true,
    cacheSource: "snapshot-friendly-empty",
    complete: false,
    qualityStatus: "waiting_snapshot",
    reason: detail || error,
    transport: {
      ...(payload.transport || {}),
      gate: "snapshot-friendly-empty",
    },
  };
}

function decisionReadyError(readyStatus) {
  return readyStatus?.last_error
    || readyStatus?.lastError
    || readyStatus?.message
    || "decision_ready=false";
}

async function snapshotFriendlyPendingPayload(readyStatus, options) {
  const detail = decisionReadyError(readyStatus);
  const run = await fetchLatestCompleteRun(readyStatus, 50, { allowPrevious2130Run: true });
  if (!run?.run_id) return emptySnapshotPayload("strategy1_decision_not_ready", detail);
  const rows = await fetchRowsForRun(run.run_id, options.limit);
  if (!rows.length) return emptySnapshotPayload("strategy1_complete_run_empty", run.run_id);
  const previous2130CarryForward = Boolean(run.__previous2130CarryForward);
  const payload = buildPayload(rows, run, readyStatus, { ...options, pendingCandidateDisplay: true, previous2130CarryForward });
  const gate = previous2130CarryForward
    ? `${STRATEGY1_GATE}+previous-2130-carry-forward`
    : `${STRATEGY1_GATE}+decision-pending-display`;
  return {
    ...payload,
    gate,
    qualityStatus: previous2130CarryForward ? "previous_2130_carry_forward" : "decision_pending",
    reason: previous2130CarryForward ? carryForwardReason(readyStatus, payload.usedDate) : detail,
    decisionPending: true,
    lastError: detail,
    meta: {
      ...(payload.meta || {}),
      gate,
      decision_pending_display: true,
      previous_2130_carry_forward: previous2130CarryForward,
    },
    transport: {
      ...(payload.transport || {}),
      gate,
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

  const cached = await readEndpointFromDesktopSnapshot(request, {
    timeoutMs: 2500,
    via: "api/open-buy-latest",
  });
  if (cached && !isEmptySnapshotRestore(cached)) {
    response.status(200).json(cached);
    return;
  }

  const options = parseRequestOptions(request);
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      if (options.snapshotFriendly) {
        response.status(200).json(emptySnapshotPayload("strategy1_supabase_not_configured"));
        return;
      }
      response.status(503).json(missingPayload("strategy1_supabase_not_configured"));
      return;
    }
    const readyStatus = await fetchReadyStatus();
    if (readyStatus?.decision_ready !== true) {
      const detail = decisionReadyError(readyStatus);
      if (options.snapshotFriendly) {
        response.status(200).json(await snapshotFriendlyPendingPayload(readyStatus, options));
        return;
      }
      response.status(503).json(missingPayload("strategy1_decision_not_ready", detail));
      return;
    }
    const run = await fetchLatestCompleteRun(readyStatus, options.snapshotFriendly ? 12 : 50);
    if (!run?.run_id) {
      if (options.snapshotFriendly) {
        response.status(200).json(emptySnapshotPayload("strategy1_complete_run_missing"));
        return;
      }
      response.status(404).json(missingPayload("strategy1_complete_run_missing"));
      return;
    }
    const rows = await fetchRowsForRun(run.run_id, options.limit);
    if (!rows.length) {
      if (options.snapshotFriendly) {
        response.status(200).json(emptySnapshotPayload("strategy1_complete_run_empty", run.run_id));
        return;
      }
      response.status(404).json(missingPayload("strategy1_complete_run_empty", run.run_id));
      return;
    }
    response.status(200).json(buildPayload(rows, run, readyStatus, options));
  } catch (error) {
    if (options.snapshotFriendly) {
      response.status(200).json(emptySnapshotPayload("strategy1_complete_run_fetch_failed", error?.message || String(error)));
      return;
    }
    response.status(503).json(missingPayload("strategy1_complete_run_fetch_failed", error?.message || String(error)));
  }
};
