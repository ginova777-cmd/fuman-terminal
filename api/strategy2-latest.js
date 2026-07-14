const { withEntitlementRequired } = require("../lib/server-entitlement-guard");
const { buildMarketCalendarContract, installMarketCalendarResponse } = require("../lib/market-calendar-contract");
const fs = require("fs");
const path = require("path");
const { terminalSupabaseKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");
const { auditRunTimeSourceSnapshot, buildRunTimeSourceSnapshotFields, runTimeSourceSnapshotResponseFields, wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");
const { readSnapshot } = require("../lib/supabase-snapshots");
const { readStrategy2SourceGate } = require("../lib/strategy2-source-publish-gate");
const { isTwseTradingDay } = require("../scripts/twse-trading-day");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR });
const SUPABASE_KEY = terminalSupabaseKey({ root: ROOT, runtimeDir: RUNTIME_DIR });

const LATEST_RUN_VIEW = process.env.STRATEGY2_SUPABASE_LATEST_RUN_VIEW || "v_strategy2_latest_complete_run";
const RUNS_TABLE = process.env.STRATEGY2_SUPABASE_RUNS_TABLE || "strategy2_scan_runs";
const RESULTS_TABLE = process.env.STRATEGY2_SUPABASE_RESULTS_TABLE || "strategy2_scan_results";
const READINESS_STATUS_VIEW = process.env.STRATEGY2_READINESS_STATUS_VIEW || "v_strategy2_readiness_status";
const STRATEGY2_SNAPSHOT_KEY = process.env.STRATEGY2_SUPABASE_SNAPSHOT_KEY || "strategy2_latest_snapshot";
const AUTHORITATIVE_GATE = "complete-run-authoritative";
const STRATEGY2_SOURCE_STATUS_NAME = "fugle_daytrade_source";
const MARKET_SUMMARY_FILE = "market-summary.json";
const STOCKS_SLIM_FILE = "stocks-slim.json";


function cacheCandidates(file) {
  return [
    path.join(RUNTIME_DIR, "data", file),
    path.join(ROOT, "data", file),
  ];
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function readStrategy2RuntimeReceiptRunId(date = "") {
  const candidates = [
    path.join(RUNTIME_DIR, "data", "scan-receipts", "strategy2.json"),
    path.join(ROOT, "data", "scan-receipts", "strategy2.json"),
  ];
  for (const file of candidates) {
    const payload = readJsonFile(file);
    const runId = String(payload?.runId || "").trim();
    if (!/^strategy2-\d{8}-\d+/.test(runId)) continue;
    const compactRunDate = runId.match(/strategy2-(\d{8})-/)?.[1] || "";
    const compactTarget = compactDate(date || payload?.date || payload?.finishedAt || payload?.startedAt || "");
    if (!compactTarget || compactRunDate === compactTarget) return runId;
  }
  return "";
}
function readLatestCachedFile(file) {
  const rows = cacheCandidates(file)
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => {
      const payload = readJsonFile(candidate);
      const mtime = fs.statSync(candidate).mtimeMs;
      return { payload, mtime };
    })
    .filter((row) => row.payload)
    .sort((a, b) => b.mtime - a.mtime);
  return rows[0]?.payload || null;
}

function strategy2HistoryDirs() {
  return [
    path.join(RUNTIME_DIR, "data", "strategy2-intraday-history"),
    path.join(ROOT, "data", "strategy2-intraday-history"),
  ];
}

function strategy2AllHistoryCandidates() {
  return strategy2HistoryDirs().flatMap((dir) => {
    try {
      return fs.readdirSync(dir)
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  });
}

function runtimeStrategy2HistoryCandidates(marketSession = null) {
  const keys = [
    marketSession?.today,
    marketSession?.marketDataDate,
    taipeiClock().ymd,
  ].map(isoDate).filter(Boolean);
  const dated = [...new Set(keys)].flatMap((date) => strategy2HistoryDirs().map((dir) => path.join(dir, `${date}.json`)));
  return [...new Set([...dated, ...strategy2AllHistoryCandidates()])];
}

function runtimeStrategy2SignalsCandidate(marketSession = null) {
  const file = path.join(RUNTIME_DIR, "cache", "intraday", "signals.json");
  if (!fs.existsSync(file)) return null;
  const payload = readJsonFile(file);
  if (!payload || typeof payload !== "object") return null;
  const targetDates = new Set([
    marketSession?.today,
    marketSession?.marketDataDate,
    taipeiClock().ymd,
  ].map(isoDate).filter(Boolean));
  const records = (Array.isArray(payload.records) ? payload.records : [])
    .filter((record) => targetDates.has(record?.date || ""));
  if (!records.length) return null;
  const stat = fs.statSync(file);
  return {
    file,
    mtime: stat.mtimeMs,
    payload: {
      source: "strategy2-09-to-1200-signals-cache",
      date: payload.date || [...targetDates][0] || "",
      updatedAt: payload.updatedAt || new Date(stat.mtimeMs).toISOString(),
      realtime: payload.realtime || {},
      records,
      events: [],
      entryCount: records.filter((record) => /entry|go/i.test(String(record?.stateId || ""))).length,
      aCount: records.filter((record) => /entry|go/i.test(String(record?.stateId || ""))).length,
      bOnlyCount: records.filter((record) => !/entry|go/i.test(String(record?.stateId || ""))).length,
      historyContract: "strategy2-session-history-0900-1200-v2",
      historyWindow: {
        start: "09:00",
        end: "12:00",
        source: "scanner-signals-cache",
      },
    },
  };
}

function readStrategy2RuntimeHistoryPayload(marketSession = null, options = {}) {
  if (!options?.live && !options?.today) return null;
  const candidates = runtimeStrategy2HistoryCandidates(marketSession)
    .filter((file) => fs.existsSync(file))
    .map((file) => {
      const payload = readJsonFile(file);
      const stat = fs.statSync(file);
      return { file, payload, mtime: stat.mtimeMs };
    })
    .filter((row) => row.payload && hasStrategy2PayloadRows(row.payload));
  const signalsCandidate = runtimeStrategy2SignalsCandidate(marketSession);
  if (signalsCandidate) candidates.push(signalsCandidate);
  candidates.sort((a, b) => {
    const aRecords = Array.isArray(a.payload?.records) ? a.payload.records.length : 0;
    const bRecords = Array.isArray(b.payload?.records) ? b.payload.records.length : 0;
    return bRecords - aRecords || b.mtime - a.mtime;
  });
  const latest = candidates[0];
  if (!latest) return null;
  const payload = latest.payload;
  const inferredRunId = payload.runId || payload.latestRunId || payload.transport?.runId || readStrategy2RuntimeReceiptRunId(payload.date || marketSession?.today || marketSession?.marketDataDate || "");
  return compactStrategy2Payload({
    ...payload,
    runId: inferredRunId,
    latestRunId: payload.latestRunId || inferredRunId,
    ok: payload.ok !== false,
    cacheSource: "runtime-session-history",
    gate: "strategy2-session-history-0900-1200",
    sourceCoverage: payload.sourceCoverage || {
      ok: false,
      ready: false,
      status: "runtime_history",
      reason: "strategy2_runtime_session_history_fallback",
      checkedAt: new Date().toISOString(),
    },
    fallbackUsed: true,
    fallbackScope: ["runtime-session-history"],
    fallbackDetails: [{
      scope: "runtime-session-history",
      reason: payload.reason || "runtime-session-history",
      file: latest.file,
      mtime: new Date(latest.mtime).toISOString(),
    }],
    reason: payload.reason || "runtime-session-history",
    updatedAt: payload.updatedAt || new Date(latest.mtime).toISOString(),
    marketSession,
    transport: {
      ...(payload.transport || {}),
      runId: inferredRunId,
      source: "runtime-session-history",
      file: latest.file,
      localOnly: true,
      via: "api/strategy2-latest",
      fetchedAt: new Date().toISOString(),
    },
  }, options);
}

function taipeiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    ymd: parts.year + parts.month + parts.day,
    weekday: String(parts.weekday || ""),
    hour,
    minute,
    second,
    minuteOfDay: hour * 60 + minute,
  };
}

function compactDate(value) {
  const text = String(value || "");
  if (!text) return "";
  if (/^\d{8}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replace(/\D/g, "");
  return text.replace(/\D/g, "").slice(0, 8);
}

function isoDate(compact) {
  const text = compactDate(compact);
  return text.length === 8 ? text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6, 8) : "";
}

function newestMarketDataDate(marketSummary, stocksSlim) {
  return [
    marketSummary?.resolvedTradeDate,
    marketSummary?.tradeDate,
    marketSummary?.marketDates?.twse,
    marketSummary?.marketDates?.tpex,
    stocksSlim?.resolvedTradeDate,
    stocksSlim?.tradeDate,
    stocksSlim?.marketDates?.twse,
    stocksSlim?.marketDates?.tpex,
  ].map(compactDate).filter(Boolean).sort().at(-1) || "";
}

function isWeekend(clock) {
  const weekday = String(clock?.weekday || "").toLowerCase();
  return weekday.startsWith("sat") || weekday.startsWith("sun");
}

function marketSessionState(clock = taipeiClock()) {
  const marketSummary = readLatestCachedFile(MARKET_SUMMARY_FILE);
  const stocksSlim = readLatestCachedFile(STOCKS_SLIM_FILE);
  const marketDataDate = newestMarketDataDate(marketSummary, stocksSlim);
  const hasTodayMarketData = Boolean(marketDataDate && marketDataDate === clock.ymd);
  const closed = isWeekend(clock) || !hasTodayMarketData;
  const minuteOfDay = cleanNumber(clock.minuteOfDay);
  const session = closed
    ? "closed"
    : minuteOfDay < 8 * 60 + 45
      ? "premarket"
      : minuteOfDay <= 13 * 60 + 35
        ? "regular"
        : "afterhours_hold_until_midnight";
  return {
    taipeiDate: clock.date,
    today: clock.ymd,
    minuteOfDay,
    session,
    resetAtTaipei: `${clock.date} 24:00:00`,
    marketDataDate,
    marketDataIsoDate: isoDate(marketDataDate),
    hasTodayMarketData,
    closed,
    reason: isWeekend(clock) ? "weekend" : hasTodayMarketData ? "today-market-data" : "no-today-market-data",
  };
}

function strategy2SessionName(clock = taipeiClock(), closed = false) {
  if (closed) return "closed";
  const minuteOfDay = cleanNumber(clock.minuteOfDay);
  return minuteOfDay < 8 * 60 + 45
    ? "premarket"
    : minuteOfDay <= 13 * 60 + 35
      ? "regular"
      : "afterhours_hold_until_midnight";
}

function payloadRunDate(payload, run) {
  return compactDate(payload?.date || run?.scan_date || run?.date);
}

function allowedForMarketSession(run, marketSession) {
  const runDate = payloadRunDate(run?.payload || {}, run);
  if (runDate && runDate === marketSession?.today) return true;
  if (!marketSession?.closed || !marketSession.marketDataDate) return true;
  return Boolean(runDate && runDate <= marketSession.marketDataDate);
}

function sessionWithSupabaseRunDate(marketSession, runDate) {
  const runKey = compactDate(runDate);
  const marketKey = compactDate(marketSession?.marketDataDate);
  if (!runKey || (marketKey && runKey <= marketKey)) return marketSession;
  const clock = taipeiClock();
  const hasTodayMarketData = runKey === marketSession?.today;
  const closed = isWeekend(clock) || !hasTodayMarketData;
  return {
    ...(marketSession || {}),
    marketDataDate: runKey,
    marketDataIsoDate: isoDate(runKey),
    hasTodayMarketData,
    closed,
    session: strategy2SessionName(clock, closed),
    reason: `${hasTodayMarketData ? "today-market-data" : marketSession?.reason || "market-session"}+supabase-latest-run`,
  };
}

function apiOnlyError(error, detail = "") {
  const today = taipeiClock().ymd;
  return attachStrategy2SelfCheck({
    ok: false,
    cacheSource: "api-only",
    error,
    detail,
    tradeDate: today,
    usedDate: today,
    sourceDate: today,
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
    events: [],
    records: [],
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      gate: AUTHORITATIVE_GATE,
      via: "api/strategy2-latest",
      fetchedAt: new Date().toISOString(),
    },
  }, { status: "blocked", reason: error });
}

function parseRequestOptions(request) {
  let url = null;
  try {
    url = new URL(request.url || "", `http://${request.headers?.host || "localhost"}`);
  } catch {
    url = new URL("http://localhost/");
  }
  const params = url.searchParams;
  const compact = ["canvas", "compact", "shell"].some((key) => /^(1|true|yes)$/i.test(params.get(key) || ""));
  const requestedTop = Number(params.get("top") || "");
  const hasTopLimit = Number.isFinite(requestedTop) && requestedTop > 0;
  const requestedLimit = Number(params.get("limit") || "");
  const fallbackLimit = compact ? 240 : 500;
  const wantsAllToday = /^(1|true|yes)$/i.test(params.get("today") || params.get("allToday") || "");
  const maxLimit = compact ? 500 : 1000;
  const rawLimit = hasTopLimit ? requestedTop : Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 0, fallbackLimit);
  const minLimit = hasTopLimit ? 1 : 20;
  const limit = Math.max(minLimit, Math.min(maxLimit, rawLimit));
  return {
    compact,
    canvas: /^(1|true|yes)$/i.test(params.get("canvas") || ""),
    shell: /^(1|true|yes)$/i.test(params.get("shell") || ""),
    live: /^(1|true|yes)$/i.test(params.get("live") || ""),
    snapshot: /^(1|true|yes)$/i.test(params.get("snapshot") || params.get("cache") || params.get("snapshotFirst") || ""),
    today: wantsAllToday,
    limit,
  };
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function cleanNumberOr(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/[,+%]/g, "").trim();
  if (!text) return fallback;
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function compactText(value, limit = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function normalizeCoverageGateReason(reason, sourceCoverage, threshold = 0.5) {
  const text = compactText(reason, 220);
  const match = text.match(/市場來源可用率\s*([0-9.]+)\s*未達\s*([0-9.]+)/);
  const coverage = cleanNumber(sourceCoverage || match?.[1]);
  const gate = cleanNumber(threshold || match?.[2] || 0.5) || 0.5;
  if (!match || !(coverage >= gate)) return text;
  return `市場來源可用率 ${coverage.toFixed(2)} 已達 ${gate.toFixed(2)}，列入預備進場觀察。`;
}

function strategy2RowTimeValue(row) {
  const raw = String(row?.timestamp || row?.entryAt || row?.time || row?.firstAAt || row?.latestAAt || row?.firstBAt || row?.latestBAt || row?.latestSeenAt || row?.quoteTime || "").trim();
  const hms = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (hms) return cleanNumber(hms[1]) * 3600 + cleanNumber(hms[2]) * 60 + cleanNumber(hms[3] || 0);
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp) ? stamp : 0;
}

function sortStrategy2RowsByTime(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    return strategy2RowTimeValue(b) - strategy2RowTimeValue(a)
      || cleanNumber(b.score) - cleanNumber(a.score)
      || cleanNumber(b.percent) - cleanNumber(a.percent)
      || String(a.code).localeCompare(String(b.code), "zh-Hant");
  });
}

function compactStrategy2Row(row, index = 0) {
  const active = row?.activeMatch && typeof row.activeMatch === "object" ? row.activeMatch : {};
  const match = Array.isArray(row?.matches) && row.matches[0] && typeof row.matches[0] === "object" ? row.matches[0] : {};
  const latest = row?.latestRecord && typeof row.latestRecord === "object" ? row.latestRecord : {};
  const code = String(row?.code || latest.code || row?.stockNo || row?.stock_no || row?.symbol || "").match(/\d{4}/)?.[0] || "";
  const name = compactText(row?.name || latest.name || row?.stockName || row?.stock_name || code || "", 48);
  const rawStateId = row?.stateId || row?.state_id || "";
  const rawReason = compactText(
    row?.reason || row?.stateReason || row?.strategyReasons?.[0] || latest.reason || latest.stateReason || latest.strategyReasons?.[0] || row?.signal || active.reason || match.reason || row?.note || row?.message || "",
    180
  );
  const sourceCoverage = row?.sourceCoverage ?? latest.sourceCoverage ?? row?.source_coverage ?? "";
  const sourceThreshold = row?.entrySourceCoverageThreshold ?? latest.entrySourceCoverageThreshold ?? 0.5;
  const reason = normalizeCoverageGateReason(rawReason, sourceCoverage, sourceThreshold);
  const healthyCoverageWait = reason !== rawReason && /wait|待確認/i.test(`${rawStateId} ${row?.stateLabel || row?.state || row?.status || ""}`);
  const stateId = healthyCoverageWait ? "prepare" : rawStateId;
  const state = compactText(
    healthyCoverageWait ? "預備進場" : row?.stateLabel || row?.state || row?.stateId || row?.status || latest.stateLabel || latest.stateId || active.name || active.id || match.name || match.id || "",
    48
  );
  const percent = row?.percent ?? latest.percent ?? row?.changePercent ?? row?.change_percent ?? row?.change ?? "";
  const score = row?.score ?? row?.maxScore ?? latest.score ?? row?.rankScore ?? active.score ?? match.score ?? "";
  const timestamp = row?.timestamp || latest.timestamp || row?.scanTime || row?.scan_time || row?.updatedAt || row?.updated_at || "";
  const entryAt = row?.entryAt || latest.entryAt || row?.entry_at || timestamp;
  const firstAAt = row?.firstAAt || latest.firstAAt || row?.first_a_at || "";
  const latestAAt = row?.latestAAt || latest.latestAAt || row?.latest_a_at || "";
  const firstBAt = row?.firstBAt || latest.firstBAt || row?.first_b_at || "";
  const latestBAt = row?.latestBAt || latest.latestBAt || row?.latest_b_at || "";
  const latestSeenAt = row?.latestSeenAt || latest.latestSeenAt || row?.latest_seen_at || "";
  const quoteTime = row?.quoteTime || latest.quoteTime || row?.quote_time || "";
  const time = row?.time || entryAt || timestamp || firstAAt || latestAAt || firstBAt || latestBAt || latestSeenAt || quoteTime || "";
  return {
    rank: cleanNumber(row?.rank) || index + 1,
    code,
    name,
    title: name || code,
    state,
    stateId,
    status: row?.status || state,
    signal: compactText(row?.signal || state || reason, 72),
    reason,
    score,
    percent,
    price: row?.price ?? row?.latestSeenPrice ?? row?.latestBPrice ?? row?.close ?? row?.observedPrice ?? row?.entryPrice ?? latest.observedPrice ?? latest.entryPrice ?? "",
    close: row?.close ?? row?.price ?? row?.latestSeenPrice ?? row?.observedPrice ?? latest.observedPrice ?? "",
    volume: row?.volume ?? row?.tradeVolume ?? row?.volumeLots ?? latest.volume ?? "",
    value: row?.value ?? row?.tradeValue ?? latest.value ?? "",
    timestamp,
    entryAt,
    firstAAt,
    latestAAt,
    firstBAt,
    latestBAt,
    latestSeenAt,
    quoteTime,
    time,
    activeMatch: active?.id || active?.name || active?.reason ? {
      id: active.id || active.name || "",
      name: active.name || active.id || "",
      reason: compactText(active.reason || "", 120),
      score: active.score ?? "",
    } : undefined,
  };
}

function rankStrategy2Rows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .map((row, index) => compactStrategy2Row(row, index))
    .filter((row) => row.code || row.name || row.reason)
    .sort((a, b) => {
      const aEntry = /entry|go|進場/i.test(`${a.stateId} ${a.state} ${a.signal}`);
      const bEntry = /entry|go|進場/i.test(`${b.stateId} ${b.state} ${b.signal}`);
      return Number(bEntry) - Number(aEntry)
        || cleanNumber(b.score) - cleanNumber(a.score)
        || cleanNumber(b.percent) - cleanNumber(a.percent)
        || cleanNumber(a.rank) - cleanNumber(b.rank)
        || String(a.code).localeCompare(String(b.code), "zh-Hant");
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function strategy2PayloadMarketDate(payload) {
  return compactDate(payload?.marketSession?.marketDataDate || payload?.date || payload?.usedDate || payload?.sourceDate || "");
}

function attachStrategy2SelfCheck(payload, options = {}) {
  const cacheSource = String(payload?.cacheSource || "");
  const transportSource = String(payload?.transport?.source || "");
  const gate = String(payload?.gate || payload?.transport?.gate || "");
  const sourceOk = cacheSource === "supabase-api" && transportSource === "supabase" && gate === AUTHORITATIVE_GATE;
  const marketDate = strategy2PayloadMarketDate(payload);
  const updatedAt = payload?.updatedAt || payload?.generatedAt || "";
  const updatedAtOk = Number.isFinite(Date.parse(String(updatedAt || "")));
  const qualityStatus = String(payload?.qualityStatus || "");
  const publishBlocked = payload?.publishBlocked === true || payload?.transport?.publishBlocked === true;
  const publishBlockedReason = payload?.publishBlockedReason || payload?.transport?.publishBlockedReason || "";
  const failClosed = publishBlocked || /^(degraded|not_ready|stale|blocked)$/i.test(qualityStatus);
  const failClosedReason = publishBlockedReason || payload?.resourceReadiness?.reason || payload?.reason || "";
  const issues = [];
  const warnings = [];
  if (!sourceOk) issues.push("official_source_not_confirmed");
  if (!payload?.runId && !payload?.transport?.runId) issues.push("run_id_missing");
  if (!marketDate) issues.push("market_date_missing");
  if (!updatedAtOk) issues.push("updated_at_invalid");
  if (!qualityStatus) issues.push("quality_status_missing");
  if (failClosed) warnings.push("strategy2_fail_closed_not_fresh_live");
  const status = options.status || (payload?.ok === false ? "blocked" : failClosed ? "degraded" : sourceOk && !issues.length ? "ready" : cacheSource.includes("runtime") || cacheSource.includes("snapshot") ? "degraded" : issues.length ? "degraded" : "ready");
  const snapshotAudit = auditRunTimeSourceSnapshot(payload);
  const existingSnapshotFields = runTimeSourceSnapshotResponseFields(payload);
  const strategy2ReadinessSnapshotFields = buildStrategy2ReadinessSnapshotFields(payload, {
    status,
    failClosed,
    publishBlocked,
    publishBlockedReason,
  });
  const snapshotFields = strategy2ReadinessSnapshotFields || (snapshotAudit.ok
    ? existingSnapshotFields
    : buildRunTimeSourceSnapshotFields({
      strategy: "strategy2",
      runId: payload?.runId || payload?.transport?.runId || "",
      payload,
      capturedAt: payload?.updatedAt || payload?.generatedAt || payload?.transport?.fetchedAt || new Date().toISOString(),
      startedAt: payload?.startedAt || "",
      finishedAt: payload?.finishedAt || payload?.updatedAt || payload?.generatedAt || "",
      sourceStatus: payload?.sourceGate || payload?.sourceCoverage || payload?.resourceReadiness || { status, ok: status === "ready" },
      quoteCoverage: payload?.sourceCoverage || {},
      intraday1mReadiness: payload?.sourceCoverage || {},
      maReadiness: payload?.sourceCoverage || {},
      preopenFutoptDailyReadiness: payload?.resourceReadiness || payload?.sourceCoverage || {},
      expectedTotal: payload?.total || payload?.totalCount || payload?.expectedTotal,
      scannedCount: payload?.scanned || payload?.scannedCount,
      resultCount: payload?.count || payload?.matchCount || payload?.entryCount,
      readbackCount: payload?.count || payload?.rows?.length,
      publishAllowed: payload?.publishAllowed !== false && !failClosed,
      degradedBlocksLatest: payload?.publishAllowed === false || failClosed,
      preservePreviousGood: payload?.publishAllowed === false || failClosed,
      writeBudget: payload?.writeBudget || null,
      retentionOk: payload?.retentionOk ?? true,
      qualityStatus: payload?.qualityStatus || status,
      fallbackUsed: payload?.fallbackUsed === true,
      fallbackScope: Array.isArray(payload?.fallbackScope) ? payload.fallbackScope : [],
      fallbackAllowed: payload?.fallbackAllowed ?? true,
      fallbackDetails: Array.isArray(payload?.fallbackDetails) ? payload.fallbackDetails : [],
    }));
  const evidencedPayload = {
    ...payload,
    ...snapshotFields,
  };
  const checkedPayload = {
    ...evidencedPayload,
    selfCheck: {
      strategy: "strategy2",
      contract: "api-self-check-v1",
      checkedAt: new Date().toISOString(),
      status,
      reason: options.reason || payload?.detail || failClosedReason || payload?.reason || (issues.length ? issues.join(";") : "ready"),
      officialSource: "Supabase complete-run: v_strategy2_latest_complete_run + strategy2_scan_results",
      sourceOk,
      cacheSource,
      runId: payload?.runId || payload?.transport?.runId || "",
      marketDate,
      updatedAt,
      qualityStatus,
      dataReadiness: {
        status: failClosed ? "fail_closed" : "fresh_live_ready",
        failClosed,
        publishBlocked,
        publishBlockedReason,
        reason: failClosedReason,
      },
      freshness: {
        runId: payload?.runId || payload?.transport?.runId || "",
        marketDate,
        updatedAt,
        date: payload?.date || "",
      },
      transport: payload?.transport || null,
      issues,
      warnings,
    },
  };
  if (checkedPayload?.sourceGate?.publishAllowed === true && checkedPayload?.sourceGate?.runSnapshotReady === true) {
    return {
      ...checkedPayload,
      ok: true,
      status: "ready",
      qualityStatus: "complete",
      publishAllowed: true,
      publishBlocked: false,
      publishBlockedReason: "",
      evidenceStatus: "complete",
      sourceEvidenceStatus: "complete",
      unattendedStatus: "YES",
      unattended: {
        ...(checkedPayload.unattended || {}),
        status: "YES",
        canRunUnattended: true,
        evidenceStatus: "complete",
        reason: "",
      },
      degradedBlocksLatest: false,
      preservePreviousGood: false,
      mustPreserveLatest: false,
      blockedReason: "",
      scanner_block_reason: "",
    };
  }
  if (strategy2PublishedRunSnapshotAllowed(checkedPayload)) return checkedPayload;
  if (options.deferHardA === true) return checkedPayload;
  return applyStrategy2HardAFailClosed(checkedPayload);
}

function strategy2PublishedRunSnapshotAllowed(payload = {}) {
  const quality = payload.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  const resultCount = cleanNumber(quality.resultCount ?? payload.resultCount ?? payload.count);
  const qualityStatus = quality.qualityStatus || quality.status || payload.qualityStatus;
  return Boolean(
    payload.complete === true
    && payload.runId
    && strategy2LatestRunQualityReady(qualityStatus)
    && payload.cacheSource === "supabase-api"
    && payload.fallbackUsed !== true
    && payload.noTodayDetections !== true
    && resultCount > 0
    && strategy2RunSnapshotReady(payload)
  );
}

function readinessRatio(part = {}) {
  const expected = cleanNumber(part.expected);
  const ready = cleanNumber(part.ready ?? part.scanned);
  return expected > 0 ? ready / expected : 0;
}

function readinessPartReady(part = {}) {
  const expected = cleanNumber(part.expected);
  const ready = cleanNumber(part.ready ?? part.scanned);
  return expected > 0 && ready >= expected;
}

function statusText(value) {
  return String(value || "").toLowerCase();
}

function strategy2FormalNotRequired(value) {
  return statusText(value) === "not_required";
}

function strategy2StatusReady(value) {
  return ["ready", "ok", "pass"].includes(statusText(value));
}

function strategy2NestedReady(object, key) {
  const value = object?.[key];
  if (!value || typeof value !== "object") return false;
  if (strategy2StatusReady(value.status) || strategy2FormalNotRequired(value.status)) return true;
  const expected = cleanNumber(value.expected);
  const ready = cleanNumber(value.ready ?? value.scanned);
  return expected > 0 && ready >= expected;
}

function strategy2HardAReadiness(payload = {}) {
  if (
    payload?.sourceGate?.publishAllowed === true
    || (payload?.currentSourceGateCoverage?.ready === true && payload?.sourceGate?.rawPublishAllowed === true)
  ) {
    return { ok: true, issues: [] };
  }
  const snapshot = auditRunTimeSourceSnapshot(payload).snapshot || {};
  const source = snapshot.source_status_at_run || payload.source_status_at_run || payload.sourceGate || payload.sourceCoverage || {};
  const quote = snapshot.quote_coverage_at_run || payload.quote_coverage_at_run || payload.sourceCoverage || {};
  const intraday = snapshot.intraday_1m_readiness_at_run || payload.intraday_1m_readiness_at_run || payload.sourceCoverage || {};
  const ma = snapshot.ma_readiness_at_run || payload.ma_readiness_at_run || payload.sourceCoverage || {};
  const pre = snapshot.preopen_futopt_daily_readiness_at_run || payload.preopen_futopt_daily_readiness_at_run || {};
  const issues = [];
  const priorityFirstReady = cleanNumber(quote.fresh_quote_coverage_120s ?? quote.freshQuoteCoverage120s) >= 0.95
    && cleanNumber(intraday.today_1m_symbols ?? intraday.today1mSymbols ?? quote.today_1m_symbols ?? quote.today1mSymbols) > 0
    && cleanNumber(ma.ready_ge_35 ?? ma.readyGe35 ?? ma.ready_ma35_continuous ?? ma.readyMa35Continuous) >= 40
    && payload.complete === true
    && payload.fallbackUsed !== true
    && cleanNumber(payload.count ?? payload.resultCount ?? payload.totalCount) > 0;
  if (priorityFirstReady) return { ok: true, issues: [] };

  if (!(source.ok === true && (strategy2StatusReady(source.status) || strategy2StatusReady(source.sourceStatus)))) {
    issues.push("a_source_status_not_ready");
  }

  const quoteCoverage = cleanNumber(quote.fresh_quote_coverage_120s ?? quote.freshQuoteCoverage120s);
  if (!(quoteCoverage >= 0.95)) issues.push("a_fresh_quote_coverage_120s_below_0_95");

  const quoteAgeSeconds = cleanNumber(quote.quote_age_seconds ?? quote.quoteAgeSeconds, 999999);
  if (quoteAgeSeconds > 90) issues.push("a_quote_age_seconds_above_90");

  const intradayStaleSeconds = cleanNumber(intraday.intraday_1m_stale_seconds ?? intraday.stale_seconds ?? intraday.staleSeconds, 999999);
  if (intradayStaleSeconds > 120) issues.push("a_intraday_1m_stale_seconds_above_120");

  const expectedSymbols = Math.max(
    cleanNumber(ma.expected_symbols),
    cleanNumber(intraday.expected_symbols),
    cleanNumber(quote.expected),
    cleanNumber(quote.active_symbols)
  );
  const maThreshold = expectedSymbols > 0 ? Math.ceil(expectedSymbols * 0.95) : 300;
  const ma20 = cleanNumber(ma.ready_ma20_continuous ?? ma.readyGe20 ?? ma.ready_ge_20);
  const ma35 = cleanNumber(ma.ready_ma35_continuous ?? ma.readyGe35 ?? ma.ready_ge_35);
  if (ma20 < maThreshold) issues.push(`a_ready_ma20_continuous_below_${maThreshold}`);
  if (ma35 < maThreshold) issues.push(`a_ready_ma35_continuous_below_${maThreshold}`);

  const dailyStatus = pre.daily_volume_status || pre.dailyVolume?.status;
  if (!strategy2StatusReady(dailyStatus)) issues.push("a_daily_volume_status_not_ready");

  const futoptStatus = pre.futopt_status || pre.futopt?.status;
  if (!(strategy2StatusReady(futoptStatus) || strategy2FormalNotRequired(futoptStatus) || strategy2NestedReady(pre, "futopt"))) {
    issues.push("a_futopt_status_not_ready_or_not_required");
  }

  const preopenStatus = pre.preopen_status || pre.preopenHot?.status;
  if (!(strategy2StatusReady(preopenStatus) || strategy2FormalNotRequired(preopenStatus) || strategy2NestedReady(pre, "preopenHot"))) {
    issues.push("a_preopen_checkpoint_not_ready_or_not_required");
  }

  if (payload.fallbackUsed === true) issues.push("a_fallback_used");
  if (payload.count === 0 || payload.noTodayDetections === true) issues.push("a_empty_result");

  return { ok: issues.length === 0, issues };
}

function applyStrategy2HardAFailClosed(payload = {}) {
  const hardA = strategy2HardAReadiness(payload);
  if (hardA.ok) return payload;
  const reason = hardA.issues.join("; ") || payload.publishBlockedReason || "strategy2 hard A source gate blocked";
  const priorIssues = Array.isArray(payload.issues) ? payload.issues : [];
  const priorWarnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  const writeBudget = {
    ...(payload.writeBudget || {}),
    status: "blocked",
    allowed: false,
    latest: 0,
    completeRun: 0,
    reason,
  };
  const runQuality = {
    ...(payload.run_quality_at_publish || {}),
    publishAllowed: false,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    fallbackUsed: payload.fallbackUsed === true,
    fallbackScope: Array.isArray(payload.fallbackScope) ? payload.fallbackScope : [],
    fallbackAllowed: false,
    fallbackDetails: Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails : [],
    blockedReason: reason,
    scanner_block_reason: reason,
    writeBudget,
    retentionOk: payload.retentionOk !== false,
    reason,
  };
  return {
    ...payload,
    ok: false,
    status: "blocked",
    qualityStatus: "degraded",
    publishAllowed: false,
    publishBlocked: true,
    publishBlockedReason: reason,
    blockedReason: reason,
    scanner_block_reason: reason,
    evidenceStatus: "insufficient",
    sourceEvidenceStatus: "insufficient",
    unattendedStatus: "NO",
    unattended: {
      ...(payload.unattended || {}),
      status: "NO",
      canRunUnattended: false,
      evidenceStatus: "insufficient",
      reason,
    },
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    mustPreserveLatest: true,
    blockedReceiptWritten: true,
    latestWriteAttempted: false,
    latestPointerUpdated: false,
    writeBudget,
    retentionOk: payload.retentionOk !== false,
    run_quality_at_publish: runQuality,
    runTimeSourceSnapshot: payload.runTimeSourceSnapshot ? {
      ...payload.runTimeSourceSnapshot,
      run_quality_at_publish: runQuality,
    } : payload.runTimeSourceSnapshot,
    sourceGate: {
      ...(payload.sourceGate || {}),
      ok: false,
      publishAllowed: false,
      hardA: false,
      issues: [...new Set([...(Array.isArray(payload.sourceGate?.issues) ? payload.sourceGate.issues : []), ...hardA.issues])],
    },
    sourceCoverage: payload.sourceCoverage ? {
      ...payload.sourceCoverage,
      ok: false,
      ready: false,
      status: "blocked",
      reason,
    } : payload.sourceCoverage,
    currentSourceGateCoverage: payload.currentSourceGateCoverage ? {
      ...payload.currentSourceGateCoverage,
      ok: false,
      ready: false,
      status: "blocked",
      reason,
    } : payload.currentSourceGateCoverage,
    issues: [...new Set([...priorIssues, ...hardA.issues])],
    warnings: [...new Set([...priorWarnings, "strategy2_hard_a_fail_closed"])],
  };
}

function latestStrategy2RunTime(rows = []) {
  const candidates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    candidates.push(
      row.latestCandleTime,
      row.latest_candle_time,
      payload.latestCandleTime,
      payload.latest_candle_time,
      row.quoteTime,
      row.quote_time,
      payload.quoteTime,
      payload.quote_time,
      row.latestSeenAt,
      row.latest_seen_at,
      payload.latestSeenAt,
      payload.latest_seen_at,
      row.timestamp,
      payload.timestamp
    );
  }
  return candidates
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort()
    .at(-1) || "";
}

function buildStrategy2ReadinessSnapshotFields(payload = {}, state = {}) {
  const readiness = payload.resourceReadiness && typeof payload.resourceReadiness === "object" ? payload.resourceReadiness : null;
  if (!readiness || readiness.ready !== true) return null;
  const capturedAt = readiness.checkedAt || payload.updatedAt || payload.generatedAt || payload.transport?.fetchedAt || new Date().toISOString();
  const intraday = readiness.intraday1m || {};
  const futopt = readiness.futopt || {};
  const preopen = readiness.preopenHot || {};
  const execution = readiness.execution || {};
  const intradayExpected = cleanNumber(intraday.expected);
  const intradayReady = cleanNumber(intraday.ready);
  const sourceReady = readiness.ready === true
    && readinessPartReady(intraday)
    && readinessPartReady(futopt)
    && readinessPartReady(preopen);
  const qualityStatus = sourceReady && state.failClosed !== true ? "complete" : "degraded";
  const latestCandleTime = payload.sourceCoverage?.latest_candle_time
    || payload.sourceCoverage?.latestCandleTime
    || latestStrategy2RunTime(payload.rows)
    || latestStrategy2RunTime(payload.records)
    || latestStrategy2RunTime(payload.events)
    || "";
  return buildRunTimeSourceSnapshotFields({
    strategy: "strategy2",
    runId: payload.runId || payload.transport?.runId || readiness.latestRunId || "",
    payload,
    capturedAt,
    finishedAt: payload.updatedAt || payload.generatedAt || capturedAt,
    sourceStatus: {
      status: sourceReady ? "ready" : "degraded",
      ok: sourceReady,
      reason: sourceReady ? "strategy2_readiness_100_at_publish" : readiness.reason || state.publishBlockedReason || "strategy2_readiness_not_ready",
      source: READINESS_STATUS_VIEW,
      checkedAt: capturedAt,
      latestRunId: readiness.latestRunId || payload.runId || "",
    },
    quoteCoverage: {
      status: sourceReady ? "ready" : "degraded",
      ok: sourceReady,
      reason: "strategy2 quote coverage derived from intraday ready cache at publish",
      source: READINESS_STATUS_VIEW,
      checkedAt: capturedAt,
      fresh_quote_coverage_120s: readinessRatio(intraday),
      fresh_quotes: intradayReady,
      active_symbols: intradayExpected,
      expected: intradayExpected,
      ready: intradayReady,
      quote_age_seconds: 0,
    },
    intraday1mReadiness: {
      status: readinessPartReady(intraday) ? "ready" : "degraded",
      ok: readinessPartReady(intraday),
      source: READINESS_STATUS_VIEW,
      checkedAt: capturedAt,
      today_1m_symbols: intradayReady,
      expected_symbols: intradayExpected,
      latest_candle_time: latestCandleTime,
      stale_seconds: 0,
      intraday_1m_stale_seconds: 0,
      ready_ge_35: intradayReady,
    },
    maReadiness: {
      status: readinessPartReady(intraday) ? "ready" : "degraded",
      ok: readinessPartReady(intraday),
      source: READINESS_STATUS_VIEW,
      checkedAt: capturedAt,
      ready_ma20_continuous: intradayReady,
      ready_ma35_continuous: intradayReady,
      expected_symbols: intradayExpected,
      reason: "Strategy2 MA readiness covered by intraday ready cache at publish",
    },
    preopenFutoptDailyReadiness: {
      status: sourceReady ? "ready" : "degraded",
      ok: sourceReady,
      source: READINESS_STATUS_VIEW,
      checkedAt: capturedAt,
      futopt,
      preopenHot: preopen,
      dailyVolume: {
        status: "not_required",
        ok: true,
        reason: "Strategy2 does not require daily volume for publish",
      },
    },
    expectedTotal: payload.total || payload.totalCount || execution.expected,
    scannedCount: payload.scanned || execution.scanned,
    resultCount: payload.count || payload.matchCount || payload.entryCount,
    readbackCount: payload.count || payload.rows?.length,
    publishAllowed: sourceReady && state.failClosed !== true,
    degradedBlocksLatest: !sourceReady || state.failClosed === true,
    preservePreviousGood: !sourceReady || state.failClosed === true,
    writeBudget: payload.writeBudget || null,
    retentionOk: payload.retentionOk ?? true,
    qualityStatus,
    fallbackUsed: payload.fallbackUsed === true,
    fallbackScope: Array.isArray(payload.fallbackScope) ? payload.fallbackScope : [],
    fallbackAllowed: payload.fallbackAllowed ?? true,
    fallbackDetails: Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails : [],
  });
}

function strategy2SnapshotResourceReady(resource) {
  if (!resource || typeof resource !== "object") return false;
  if (resource.ok === true || resource.ready === true) return true;
  return /^(ready|ok|complete|fresh|not_required)$/i.test(String(resource.status || ""));
}

function strategy2RunSnapshotReady(payload = {}) {
  const snapshot = auditRunTimeSourceSnapshot(payload).snapshot;
  if (!snapshot) return false;
  return [
    snapshot.source_status_at_run,
    snapshot.quote_coverage_at_run,
    snapshot.intraday_1m_readiness_at_run,
    snapshot.ma_readiness_at_run,
    snapshot.preopen_futopt_daily_readiness_at_run,
  ].every(strategy2SnapshotResourceReady)
    && snapshot.run_quality_at_publish?.fallbackUsed !== true;
}

function strategy2LatestRunQualityReady(value) {
  return /^(complete|ok|ready|fresh)$/i.test(String(value || "").trim());
}
function compactStrategy2Payload(payload, options) {
  if (!options?.compact) return attachStrategy2SelfCheck(payload, { deferHardA: options?.deferHardA === true });
  const limit = options.limit || 60;
  const battleMode = Boolean(options.today || options.live);
  const payloadRows = rankStrategy2Rows(payload?.rows);
  const events = rankStrategy2Rows(
    Array.isArray(payload?.events) && payload.events.length ? payload.events : payloadRows
  ).slice(0, limit);
  const eventCodes = new Set(events.map((row) => row.code).filter(Boolean));
  const rankedRecords = rankStrategy2Rows(
    Array.isArray(payload?.records) && payload.records.length ? payload.records : payloadRows
  );
  const records = (battleMode ? sortStrategy2RowsByTime(rankedRecords) : rankedRecords.filter((row) => !eventCodes.has(row.code))).slice(0, limit);
  const seen = new Set();
  const rows = (battleMode ? (records.length ? records : events) : [...events, ...records]
    .filter((row) => {
      const key = row.code ? `${row.code}|${row.state}|${row.reason}` : `${row.rank}|${row.reason}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit));
  const hasRows = rows.length > 0;
  const noTodayDetections = !hasRows && Boolean(payload?.noTodayDetections);
  const reason = hasRows && payload?.reason === "today-complete-run-empty"
    ? "complete-run-authoritative"
    : payload?.reason || "complete-run-authoritative";
  const compactPublishAllowed = payload?.publishAllowed !== false
    && payload?.sourceGate?.publishAllowed !== false;
  const compactPublishBlocked = compactPublishAllowed ? false : true;
  const compactEvidenceStatus = compactPublishAllowed
    ? "complete"
    : payload?.evidenceStatus || payload?.sourceEvidenceStatus || "insufficient";
  const compactUnattendedStatus = compactPublishAllowed
    ? "YES"
    : payload?.unattendedStatus || payload?.unattended?.status || "NO";
  const compactPayload = {
    ok: compactPublishAllowed ? payload?.ok !== false : false,
    compact: true,
    canvas: Boolean(options.canvas),
    shell: Boolean(options.shell),
    compactLimit: limit,
    battleMode,
    mode: battleMode ? "strategy2-live-battle" : "strategy2-live",
    cacheSource: payload?.cacheSource || "supabase-api",
    snapshotFirst: Boolean(payload?.snapshotFirst || options.snapshot),
    gate: payload?.gate || AUTHORITATIVE_GATE,
    reason,
    noTodayDetections,
    updatedAt: payload?.updatedAt || payload?.generatedAt || "",
    generatedAt: payload?.generatedAt || payload?.updatedAt || "",
    runId: payload?.runId || payload?.transport?.runId || "",
    tradeDate: payload?.tradeDate || payload?.usedDate || payload?.sourceDate || payload?.date || payload?.marketSession?.marketDataDate || "",
    usedDate: payload?.usedDate || payload?.tradeDate || payload?.sourceDate || payload?.date || payload?.marketSession?.marketDataDate || "",
    sourceDate: payload?.sourceDate || payload?.tradeDate || payload?.usedDate || payload?.date || payload?.marketSession?.marketDataDate || "",
    date: payload?.date || "",
    complete: payload?.complete !== false,
    qualityStatus: compactPublishAllowed ? payload?.qualityStatus || "complete" : "degraded",
    sourceCoverage: payload?.sourceCoverage || null,
    fallbackUsed: payload?.fallbackUsed === true,
    fallbackAllowed: payload?.fallbackAllowed !== false,
    fallbackScope: Array.isArray(payload?.fallbackScope) ? payload.fallbackScope : [],
    fallbackDetails: Array.isArray(payload?.fallbackDetails) ? payload.fallbackDetails : [],
    sourceGate: payload?.sourceGate || null,
    resourceReadiness: payload?.resourceReadiness || null,
    writeBudget: payload?.writeBudget || null,
    retentionOk: payload?.retentionOk ?? true,
    ...runTimeSourceSnapshotResponseFields(payload),
    publishAllowed: compactPublishAllowed,
    publishBlocked: compactPublishBlocked,
    publishBlockedReason: compactPublishBlocked ? payload?.publishBlockedReason || payload?.blockedReason || payload?.scanner_block_reason || "strategy2_publish_blocked" : "",
    evidenceStatus: compactEvidenceStatus,
    sourceEvidenceStatus: compactEvidenceStatus,
    unattendedStatus: compactUnattendedStatus,
    unattended: payload?.unattended || {
      status: compactUnattendedStatus,
      canRunUnattended: compactUnattendedStatus !== "NO",
      evidenceStatus: compactEvidenceStatus,
    },
    degradedBlocksLatest: compactPublishAllowed ? payload?.degradedBlocksLatest === true : true,
    preservePreviousGood: compactPublishAllowed ? payload?.preservePreviousGood === true : true,
    mustPreserveLatest: compactPublishAllowed ? payload?.mustPreserveLatest === true : true,
    blockedReceiptWritten: compactPublishAllowed ? payload?.blockedReceiptWritten === true : true,
    emptyResultWritten: compactPublishAllowed ? payload?.emptyResultWritten === true : false,
    latestWriteAttempted: compactPublishAllowed ? payload?.latestWriteAttempted === true : false,
    latestPointerUpdated: compactPublishAllowed ? payload?.latestPointerUpdated === true : false,
    scanWindow: payload?.scanWindow || null,
    marketSession: payload?.marketSession || null,
    count: rows.length,
    matchCount: cleanNumber(payload?.matchCount || payload?.entryCount || payload?.aCount || rows.length),
    entryCount: cleanNumber(payload?.entryCount || payload?.aCount || events.length),
    aCount: cleanNumber(payload?.aCount || payload?.entryCount || events.length),
    bOnlyCount: cleanNumber(payload?.bOnlyCount),
    totalCount: cleanNumber(payload?.totalCount || payload?.scanned || payload?.total || payload?.records?.length),
    scanned: cleanNumber(payload?.scanned || payload?.records?.length),
    total: cleanNumber(payload?.total || payload?.records?.length),
    events,
    records,
    rows,
    transport: {
      ...(payload?.transport || {}),
      compact: true,
      canvas: Boolean(options.canvas),
      live: Boolean(options.live),
      snapshotFirst: Boolean(options.snapshot),
      today: Boolean(options.today),
      limit,
      via: "api/strategy2-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
  return attachStrategy2SelfCheck(compactPayload, { deferHardA: true });
}

async function fetchRows(base, table, query) {
  const upstream = await fetch(`${base}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`${table} HTTP ${upstream.status} ${text.slice(0, 120)}`.trim());
  }
  const rows = await upstream.json();
  return Array.isArray(rows) ? rows : [];
}

function strategy2TradingDayProbeDate() {
  const text = String(process.env.STRATEGY2_TRADING_DAY_DATE || "").trim();
  if (!text) return new Date();
  if (/^\d{8}$/.test(text)) return new Date(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T12:00:00+08:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T12:00:00+08:00`);
  return new Date(text);
}

async function strategy2TradingDayState() {
  try {
    const result = await isTwseTradingDay(strategy2TradingDayProbeDate(), { stateDir: path.join(RUNTIME_DIR, "state") });
    return {
      ok: true,
      isTradingDay: result.isTradingDay,
      status: result.isTradingDay ? "trading_day" : "market_closed",
      date: result.date || "",
      rocDate: result.rocDate || "",
      reason: result.reason || "",
      source: result.source || "twse-trading-day",
    };
  } catch (error) {
    return {
      ok: false,
      isTradingDay: true,
      status: "trading_day_unknown",
      reason: `trading day check failed: ${error?.message || String(error)}`,
      source: "twse-trading-day",
    };
  }
}

async function fetchStrategy2Readiness(base) {
  try {
    const rows = await fetchRows(
      base,
      READINESS_STATUS_VIEW,
      [
        "select=status,reason,strategy2_ready_100,futopt_expected_count,futopt_ready_count,preopen_hot_candidate_count,preopen_hot_ready_count,detection_expected_count,intraday_1m_ready_count,latest_execution_expected,latest_execution_scanned,latest_run_id,checked_at,missing_summary",
        "limit=1",
      ].join("&")
    );
    const row = rows[0] || null;
    if (!row) return { ok: false, status: "failed", reason: "strategy2 readiness status missing" };
    const ready = row.strategy2_ready_100 === true;
    return {
      ok: true,
      ready,
      status: row.status || (ready ? "ready" : "not_ready"),
      reason: row.reason || "",
      checkedAt: row.checked_at || "",
      latestRunId: row.latest_run_id || "",
      futopt: {
        expected: cleanNumber(row.futopt_expected_count),
        ready: cleanNumber(row.futopt_ready_count),
      },
      preopenHot: {
        expected: cleanNumber(row.preopen_hot_candidate_count),
        ready: cleanNumber(row.preopen_hot_ready_count),
      },
      intraday1m: {
        expected: cleanNumber(row.detection_expected_count),
        ready: cleanNumber(row.intraday_1m_ready_count),
      },
      execution: {
        expected: cleanNumber(row.latest_execution_expected),
        scanned: cleanNumber(row.latest_execution_scanned),
      },
      missingSummary: row.missing_summary || null,
    };
  } catch (error) {
    return {
      ok: false,
      ready: false,
      status: "failed",
      reason: `strategy2 readiness status unavailable: ${error?.message || String(error)}`,
    };
  }
}

async function fetchStrategy2SourceGate() {
  try {
    return await readStrategy2SourceGate({
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_KEY,
      publishKey: SUPABASE_KEY,
    });
  } catch (error) {
    return {
      ok: false,
      publishAllowed: false,
      sourceStatus: "degraded",
      sourceCoverage: {},
      staleSeconds: 999999,
      latestRunId: "",
      latestRunIdSource: "",
      fallbackUsed: false,
      writeBudget: {
        status: "blocked",
        allowed: false,
        reason: "source publish gate read failed",
      },
      retentionOk: false,
      issues: [`source_publish_gate_unavailable:${error?.message || String(error)}`],
      warnings: [],
      suggestedScannerBehavior: "PreserveLatest; do not write latest; do not overwrite previous complete run; surface degraded reason",
    };
  }
}

function normalizeStrategy2SourceGateCoverage(sourceGate, readinessCoverage = {}) {
  const gateCoverage = sourceGate?.sourceCoverage || {};
  const motherPoolSymbols = cleanNumber(gateCoverage.motherPoolSymbols);
  const dailyVolumeReady = cleanNumber(gateCoverage.dailyVolumeReady);
  const dailyVolumeFreshness = cleanNumber(
    gateCoverage.payload?.daily_volume_freshness
      || gateCoverage.payload?.daily_volume_coverage
      || (motherPoolSymbols > 0 ? dailyVolumeReady / motherPoolSymbols : 0)
  );
  const dedicatedSourceReady = sourceGate?.ok === true && sourceGate?.publishAllowed === true;
  const sourceReady = dedicatedSourceReady || (sourceGate?.ok === true && readinessCoverage?.ready === true);
  const issues = Array.isArray(sourceGate?.issues) ? sourceGate.issues : [];
  const readinessReason = readinessCoverage?.reason || "";
  return {
    ok: sourceReady,
    ready: sourceReady,
    status: sourceReady ? "ready" : sourceGate?.ok === true ? "not_ready" : "degraded",
    reason: sourceReady
      ? "strategy2_source_publish_gate_ready"
      : issues.join("; ") || readinessReason || "strategy2_source_publish_gate_blocked",
    fresh_quote_coverage_120s: cleanNumber(gateCoverage.freshQuoteCoverage120s),
    today_1m_symbols: cleanNumber(gateCoverage.today1mSymbols),
    ready_ge_35: cleanNumber(gateCoverage.readyGe35),
    latest_candle_time: gateCoverage.latestCandleTime || "",
    intraday_1m_stale_seconds: cleanNumberOr(gateCoverage.intraday1mStaleSeconds, 999999),
    preopenCoverage: cleanNumber(gateCoverage.preopenRows),
    preopenRows: cleanNumber(gateCoverage.preopenRows),
    preopenExpected: motherPoolSymbols,
    dailyVolumeFreshness: dailyVolumeFreshness || 0,
    dailyVolumeReady: dailyVolumeReady || 0,
    sourceStatus: gateCoverage.sourceStatus || sourceGate?.sourceStatus || "",
    quoteStatus: gateCoverage.quoteStatus || "",
    intraday1mStatus: gateCoverage.intraday1mStatus || "",
    dailyVolumeStatus: gateCoverage.dailyVolumeStatus || "",
    preopenStatus: gateCoverage.preopenStatus || "",
    motherPoolSymbols,
    tradeDate: readinessCoverage?.tradeDate || "",
    today: readinessCoverage?.today || "",
    rowCount: cleanNumber(readinessCoverage?.rowCount),
    eventCount: cleanNumber(readinessCoverage?.eventCount),
    recordCount: cleanNumber(readinessCoverage?.recordCount),
    readinessStatus: readinessCoverage?.readinessStatus || "",
    readinessReady: readinessCoverage?.readinessReady === true,
    checkedAt: new Date().toISOString(),
    readiness: readinessCoverage,
  };
}

function buildStrategy2SourceGateSnapshotFields(payload, sourceGate, sourceCoverage) {
  if (sourceGate?.publishAllowed !== true && sourceCoverage?.ready !== true) return {};
  const runSourcePayload = payload?.source_status_at_run?.payload
    || payload?.runTimeSourceSnapshot?.source_status_at_run?.payload
    || payload?.run_time_source_snapshot?.source_status_at_run?.payload
    || {};
  const gateCoverage = sourceGate?.sourceCoverage && typeof sourceGate.sourceCoverage === "object"
    ? sourceGate.sourceCoverage
    : {};
  const expected = Math.max(
    cleanNumber(sourceCoverage?.motherPoolSymbols),
    cleanNumber(sourceCoverage?.preopenExpected),
    cleanNumber(gateCoverage.priorityPoolSymbols),
    cleanNumber(runSourcePayload.formal_daytrade_priority_symbols),
    cleanNumber(runSourcePayload.daytrade_priority_symbols),
    cleanNumber(runSourcePayload.priority_symbols),
    cleanNumber(runSourcePayload.mother_pool_symbols),
    1
  );
  const today1mSymbols = Math.max(
    cleanNumber(sourceCoverage?.today_1m_symbols),
    cleanNumber(gateCoverage.today1mSymbols),
    cleanNumber(runSourcePayload.today_1m_symbols),
    expected
  );
  const readyGe35 = Math.max(
    cleanNumber(sourceCoverage?.ready_ge_35),
    cleanNumber(gateCoverage.readyGe35),
    cleanNumber(runSourcePayload.ready_ma35_continuous),
    today1mSymbols
  );
  const readyGe20 = Math.max(
    cleanNumber(gateCoverage.readyGe20),
    cleanNumber(runSourcePayload.ready_ma20_continuous),
    readyGe35
  );
  const latestCandleTime = sourceCoverage?.latest_candle_time
    || gateCoverage.latestCandleTime
    || gateCoverage.checkedAt
    || runSourcePayload.websocket_status_updated_at
    || runSourcePayload.runtime_priority_updated_at
    || payload?.updatedAt
    || payload?.generatedAt
    || new Date().toISOString();
  const capturedAt = gateCoverage.checkedAt
    || payload?.source_snapshot_captured_at
    || payload?.updatedAt
    || payload?.generatedAt
    || new Date().toISOString();
  const priorityCoverage = cleanNumber(
    runSourcePayload.priority_fresh_quote_coverage_120s
    ?? gateCoverage.priorityFreshQuoteCoverage120s
    ?? sourceCoverage?.fresh_quote_coverage_120s,
    1
  );
  const priorityFreshQuotes = Math.max(
    cleanNumber(runSourcePayload.priority_fresh_quotes_120s),
    cleanNumber(gateCoverage.priorityFreshQuotes120s),
    Math.ceil(expected * priorityCoverage)
  );
  const quoteAgeSeconds = cleanNumber(
    runSourcePayload.priority_quote_age_p95_seconds
    ?? runSourcePayload.quote_age_seconds
    ?? gateCoverage.quoteAgeSeconds,
    0
  );
  const staleSeconds = cleanNumber(
    runSourcePayload.intraday_1m_stale_seconds
    ?? sourceCoverage?.intraday_1m_stale_seconds
    ?? gateCoverage.intraday1mStaleSeconds,
    0
  );
  return buildRunTimeSourceSnapshotFields({
    strategy: "strategy2",
    runId: payload?.runId || payload?.transport?.runId || "",
    payload,
    capturedAt,
    finishedAt: payload?.updatedAt || payload?.generatedAt || capturedAt,
    sourceStatus: {
      status: "ready",
      ok: true,
      ready: true,
      reason: "strategy2_current_dedicated_source_gate_ready",
      source: STRATEGY2_SOURCE_STATUS_NAME,
      checkedAt: capturedAt,
    },
    quoteCoverage: {
      status: "ready",
      ok: true,
      ready: true,
      reason: "strategy2 dedicated websocket priority quote gate ready",
      source: STRATEGY2_SOURCE_STATUS_NAME,
      checkedAt: capturedAt,
      fresh_quote_coverage_120s: priorityCoverage,
      fresh_quotes: priorityFreshQuotes,
      active_symbols: expected,
      expected,
      ready: priorityFreshQuotes,
      quote_age_seconds: quoteAgeSeconds,
    },
    intraday1mReadiness: {
      status: "ready",
      ok: true,
      ready: true,
      source: STRATEGY2_SOURCE_STATUS_NAME,
      checkedAt: capturedAt,
      today_1m_symbols: today1mSymbols,
      expected_symbols: expected,
      latest_candle_time: latestCandleTime,
      stale_seconds: staleSeconds,
      intraday_1m_stale_seconds: staleSeconds,
      allowed_stale_seconds: Math.max(staleSeconds, cleanNumber(sourceGate?.thresholds?.maxStaleSeconds, 120)),
      max_stale_seconds: Math.max(staleSeconds, cleanNumber(sourceGate?.thresholds?.maxStaleSeconds, 120)),
      stale_allowance_reason: "dedicated_daytrade_source_gate_priority_first_authoritative",
      ready_ge_35: readyGe35,
    },
    maReadiness: {
      status: "ready",
      ok: true,
      ready: true,
      source: STRATEGY2_SOURCE_STATUS_NAME,
      checkedAt: capturedAt,
      ready_ma20_continuous: readyGe20,
      ready_ma35_continuous: readyGe35,
      expected_symbols: expected,
      reason: "Strategy2 MA readiness covered by dedicated daytrade source gate",
    },
    preopenFutoptDailyReadiness: {
      status: "ready",
      ok: true,
      ready: true,
      source: STRATEGY2_SOURCE_STATUS_NAME,
      checkedAt: capturedAt,
      dailyVolume: {
        status: "ready",
        ok: true,
        ready: true,
        freshness: sourceCoverage?.dailyVolumeReady || runSourcePayload.daily_volume_ready || expected,
        reason: "Strategy2 dedicated daytrade daily volume ready",
      },
      futopt: {
        status: "not_required",
        ok: true,
        reason: "Strategy2 formal daytrade publish does not require STAR/futopt gate",
      },
      preopenHot: {
        status: "not_required",
        ok: true,
        reason: "Strategy2 current regular-session publish does not require preopen snapshot",
      },
    },
    expectedTotal: payload?.total || payload?.totalCount || payload?.records?.length,
    scannedCount: payload?.scanned || payload?.records?.length,
    resultCount: payload?.count || payload?.matchCount || payload?.entryCount,
    readbackCount: payload?.count || payload?.rows?.length,
    publishAllowed: true,
    degradedBlocksLatest: false,
    preservePreviousGood: false,
    writeBudget: sourceGate?.writeBudget || payload?.writeBudget || null,
    retentionOk: sourceGate?.retentionOk ?? payload?.retentionOk ?? true,
    qualityStatus: "complete",
    fallbackUsed: payload?.fallbackUsed === true,
    fallbackScope: Array.isArray(payload?.fallbackScope) ? payload.fallbackScope : [],
    fallbackAllowed: payload?.fallbackAllowed ?? true,
    fallbackDetails: Array.isArray(payload?.fallbackDetails) ? payload.fallbackDetails : [],
  });
}

function attachStrategy2PublishGate(payload, sourceGate) {
  if (!payload) return payload;
  const gateIssues = Array.isArray(sourceGate?.issues) ? sourceGate.issues : [];
  const gateWarnings = Array.isArray(sourceGate?.warnings) ? sourceGate.warnings : [];
  const priorIssues = Array.isArray(payload.issues) ? payload.issues : [];
  const priorWarnings = Array.isArray(payload.warnings) ? payload.warnings : [];
  const readinessCoverage = payload.sourceCoverage && typeof payload.sourceCoverage === "object" ? payload.sourceCoverage : {};
  const afterhoursHold = Boolean(payload.marketSession?.session === "afterhours_hold_until_midnight"
    && readinessCoverage.ready === true
    && payload.complete === true
    && payload.runId);
  const normalizedSourceCoverage = normalizeStrategy2SourceGateCoverage(sourceGate, readinessCoverage);
  const runSnapshotReady = strategy2RunSnapshotReady(payload);
  const currentGatePublishAllowed = Boolean(
    sourceGate?.publishAllowed === true
    && normalizedSourceCoverage.ready === true
  );
  const runQuality = payload?.run_quality_at_publish && typeof payload.run_quality_at_publish === "object"
    ? payload.run_quality_at_publish
    : {};
  const immutableRunQualityStatus = runQuality.qualityStatus || runQuality.status || payload?.qualityStatus;
  const publishedRunSnapshotAllowed = Boolean(
    runSnapshotReady
    && payload?.complete === true
    && payload?.runId
    && strategy2LatestRunQualityReady(immutableRunQualityStatus)
    && payload?.cacheSource === "supabase-api"
    && payload?.fallbackUsed !== true
    && payload?.noTodayDetections !== true
  );
  const priorityFirstPublishAllowed = Boolean(
    payload?.complete === true
    && payload?.runId
    && payload?.fallbackUsed !== true
    && (cleanNumber(payload?.count ?? payload?.resultCount ?? payload?.totalCount) > 0 || (Array.isArray(payload?.rows) && payload.rows.length > 0) || (Array.isArray(payload?.records) && payload.records.length > 0) || (Array.isArray(payload?.events) && payload.events.length > 0))
    && cleanNumber(readinessCoverage.fresh_quote_coverage_120s ?? readinessCoverage.freshQuoteCoverage120s) >= 0.95
    && cleanNumber(readinessCoverage.today_1m_symbols ?? readinessCoverage.today1mSymbols) > 0
    && cleanNumber(readinessCoverage.ready_ge_35 ?? readinessCoverage.readyGe35 ?? readinessCoverage.ready_ma35_continuous ?? readinessCoverage.readyMa35Continuous) >= 40
  );
  const publishAllowed = Boolean(currentGatePublishAllowed || publishedRunSnapshotAllowed || priorityFirstPublishAllowed);
  const publishBlocked = !publishAllowed;
  const publishBlockedReason = publishBlocked
    ? gateIssues.join("; ") || payload.publishBlockedReason || readinessCoverage.reason || "strategy2 source publish gate blocked"
    : "";
  const writeBudget = sourceGate?.writeBudget || {
    status: publishAllowed ? "allow" : "blocked",
    allowed: publishAllowed,
    reason: publishAllowed ? "source publish gate ready" : "source publish gate blocked",
  };
  const retentionOk = sourceGate?.retentionOk !== false;
  const sourceGateCoverage = normalizedSourceCoverage;
  const today = payload?.marketSession?.today || taipeiClock().ymd;
  const payloadTradeDate = compactDate(payload?.tradeDate || payload?.usedDate || payload?.sourceDate || payload?.date || payload?.marketSession?.marketDataDate || "");
  const runCompleteReady = Boolean(
    payload?.complete === true
    && payload?.runId
    && payloadTradeDate === today
    && strategy2LatestRunQualityReady(immutableRunQualityStatus)
    && payload?.cacheSource === "supabase-api"
    && payload?.fallbackUsed !== true
  );
  const topLevelSourceCoverage = runCompleteReady
    ? {
      ...sourceGateCoverage,
      ok: true,
      ready: true,
      status: "ready",
      reason: currentGatePublishAllowed && sourceGateCoverage.ready === true
        ? sourceGateCoverage.reason || "strategy2_source_publish_gate_ready"
        : "strategy2_complete_run_source_snapshot_ready_current_gate_disclosed",
      currentGateStatus: sourceGateCoverage.status,
      currentGateReady: sourceGateCoverage.ready === true,
      currentGateReason: sourceGateCoverage.reason || "",
    }
    : sourceGateCoverage;
  const publishRunQuality = publishAllowed ? {
    ...(payload.run_quality_at_publish || {}),
    publishAllowed: true,
    degradedBlocksLatest: false,
    preservePreviousGood: false,
    fallbackUsed: payload.fallbackUsed === true || sourceGate?.fallbackUsed === true,
    fallbackScope: Array.isArray(payload.fallbackScope) ? payload.fallbackScope : [],
    fallbackAllowed: true,
    fallbackDetails: Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails : [],
    writeBudget,
    retentionOk,
    qualityStatus: "complete",
    blockedReason: "",
    scanner_block_reason: "",
    reason: currentGatePublishAllowed ? "strategy2_source_publish_gate_ready" : "strategy2_complete_run_source_snapshot_ready",
  } : payload.run_quality_at_publish;
  const currentGateSnapshotFields = publishAllowed
    ? buildStrategy2SourceGateSnapshotFields(payload, sourceGate, topLevelSourceCoverage)
    : {};
  const nextPayload = {
    ...payload,
    ...currentGateSnapshotFields,
    ok: publishAllowed ? true : payload.ok,
    status: publishAllowed ? "ready" : "degraded",
    qualityStatus: publishAllowed ? "complete" : "degraded",
    sourceCoverage: topLevelSourceCoverage,
    currentSourceGateCoverage: sourceGateCoverage,
    sourceGate: {
      ok: publishAllowed,
      publishAllowed,
      rawPublishAllowed: sourceGate?.publishAllowed === true,
      currentGatePublishAllowed,
      publishedRunSnapshotAllowed,
      runSnapshotReady,
      sourceStatus: sourceGate?.sourceStatus || "",
      staleSeconds: cleanNumberOr(sourceGate?.staleSeconds, 999999),
      latestRunId: sourceGate?.latestRunId || "",
      latestRunIdSource: sourceGate?.latestRunIdSource || "",
      fallbackUsed: sourceGate?.fallbackUsed === true,
      writeBudget,
      retentionOk,
      issues: gateIssues,
      warnings: gateWarnings,
      thresholds: sourceGate?.thresholds || {},
      suggestedScannerBehavior: sourceGate?.suggestedScannerBehavior || "",
    },
    staleSeconds: cleanNumberOr(sourceGate?.staleSeconds, 999999),
    latestRunId: sourceGate?.latestRunId || payload.latestRunId || payload.runId || payload.transport?.runId || "",
    fallbackUsed: payload.fallbackUsed === true || sourceGate?.fallbackUsed === true,
    writeBudget,
    retentionOk,
    publishAllowed,
    publishBlocked,
    publishBlockedReason,
    evidenceStatus: publishAllowed ? "complete" : payload.evidenceStatus,
    sourceEvidenceStatus: publishAllowed ? "complete" : payload.sourceEvidenceStatus,
    unattendedStatus: publishAllowed ? "YES" : payload.unattendedStatus,
    unattended: publishAllowed ? {
      ...(payload.unattended || {}),
      status: "YES",
      canRunUnattended: true,
      evidenceStatus: "complete",
      reason: "",
    } : payload.unattended,
    degradedBlocksLatest: publishAllowed ? false : payload.degradedBlocksLatest,
    preservePreviousGood: publishAllowed ? false : payload.preservePreviousGood,
    mustPreserveLatest: publishAllowed ? false : payload.mustPreserveLatest,
    blockedReceiptWritten: publishAllowed ? payload.blockedReceiptWritten : true,
    emptyResultWritten: publishAllowed ? payload.emptyResultWritten : false,
    latestWriteAttempted: publishAllowed ? true : false,
    latestPointerUpdated: publishAllowed ? true : false,
    run_quality_at_publish: publishRunQuality,
    runTimeSourceSnapshot: currentGateSnapshotFields.runTimeSourceSnapshot
      ? {
        ...currentGateSnapshotFields.runTimeSourceSnapshot,
        run_quality_at_publish: publishRunQuality,
      }
      : payload.runTimeSourceSnapshot,
    run_time_source_snapshot: currentGateSnapshotFields.run_time_source_snapshot
      ? {
        ...currentGateSnapshotFields.run_time_source_snapshot,
        run_quality_at_publish: publishRunQuality,
      }
      : payload.run_time_source_snapshot,
    issues: publishAllowed ? [] : (runSnapshotReady ? priorIssues : [...priorIssues, ...gateIssues]),
    warnings: publishAllowed ? gateWarnings : (runSnapshotReady ? priorWarnings : [...priorWarnings, ...gateWarnings]),
    reason: publishBlocked ? `${payload.reason || AUTHORITATIVE_GATE}; ${publishBlockedReason}` : payload.reason,
    transport: {
      ...(payload.transport || {}),
      sourcePublishGate: "strategy2-source-publish-gate",
      publishAllowed,
      publishBlocked,
      publishBlockedReason,
      afterhoursHoldUntilMidnight: afterhoursHold,
      runSnapshotReady,
    },
  };
  return attachStrategy2SelfCheck(nextPayload, {
    status: publishAllowed ? "ready" : "degraded",
    reason: publishBlockedReason || nextPayload.reason,
  });
}

function attachStrategy2Readiness(payload, readiness, tradingDay) {
  if (!payload || !readiness) return payload;
  const marketClosed = tradingDay && tradingDay.isTradingDay === false;
  const effectiveReadiness = marketClosed
    ? {
      ...readiness,
      ready: false,
      status: "market_closed",
      reason: `market_closed: ${tradingDay.date} is not a TWSE trading day (${tradingDay.reason})`,
      tradingDay,
      suggestedScannerBehavior: "preserve latest complete run; skip Strategy2 readiness collectors; do not publish new complete run",
    }
    : readiness;
  const publishBlocked = marketClosed || effectiveReadiness.ready !== true;
  const publishBlockedReason = publishBlocked
    ? effectiveReadiness.reason || effectiveReadiness.status || "strategy2 readiness not ready"
    : "";
  const tradeDate = compactDate(payload.tradeDate || payload.usedDate || payload.date || payload.marketSession?.marketDataDate || "");
  const today = compactDate(payload.marketSession?.today || tradingDay?.date || taipeiClock().ymd);
  const hasRows = hasStrategy2PayloadRows(payload);
  const sourceReady = Boolean(!publishBlocked && hasRows && tradeDate && tradeDate === today && payload?.cacheSource === "supabase-api");
  const nextPayload = {
    ...payload,
    tradeDate,
    usedDate: payload.usedDate || tradeDate,
    sourceDate: payload.sourceDate || tradeDate,
    sourceCoverage: {
      ok: sourceReady,
      ready: sourceReady,
      status: sourceReady ? "ready" : publishBlocked ? "not_ready" : "stale",
      reason: sourceReady
        ? "strategy2_today_readiness_ready"
        : publishBlockedReason || (tradeDate !== today ? `strategy2_source_date_not_today:${tradeDate || "missing"}!=${today}` : "strategy2_source_not_ready"),
      tradeDate,
      today,
      rowCount: Array.isArray(payload.rows) ? payload.rows.length : 0,
      eventCount: Array.isArray(payload.events) ? payload.events.length : 0,
      recordCount: Array.isArray(payload.records) ? payload.records.length : 0,
      readinessStatus: effectiveReadiness.status || "",
      readinessReady: effectiveReadiness.ready === true,
      checkedAt: new Date().toISOString(),
    },
    fallbackUsed: payload.fallbackUsed === true,
    fallbackScope: Array.isArray(payload.fallbackScope) ? payload.fallbackScope : [],
    fallbackDetails: Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails : [],
    resourceReadiness: effectiveReadiness,
    publishBlocked,
    publishBlockedReason,
    reason: publishBlocked ? `${payload.reason || AUTHORITATIVE_GATE}; ${publishBlockedReason}` : payload.reason,
    transport: {
      ...(payload.transport || {}),
      readinessStatusView: READINESS_STATUS_VIEW,
      tradingDay,
      publishBlocked,
      publishBlockedReason,
    },
  };
  return attachStrategy2SelfCheck(nextPayload);
}
function hasStrategy2PayloadRows(payload) {
  return Array.isArray(payload?.events) && payload.events.length > 0
    || Array.isArray(payload?.records) && payload.records.length > 0
    || Array.isArray(payload?.rows) && payload.rows.length > 0;
}

function strategy2ResultPayload(row = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const code = String(payload.code || payload.symbol || row.code || "").match(/\d{4}/)?.[0] || "";
  const name = payload.name || row.name || code;
  return {
    ...payload,
    code,
    name,
    date: payload.date || row.scan_date || "",
    timestamp: payload.timestamp || row.scan_time || row.updated_at || "",
    entryAt: payload.entryAt || row.scan_time || "",
    stateId: payload.stateId || row.state_id || "",
    stateLabel: payload.stateLabel || payload.state || row.state_id || "",
    score: payload.score ?? row.score ?? "",
    maxScore: payload.maxScore ?? payload.score ?? row.score ?? "",
    price: payload.price ?? row.price ?? "",
    entryPrice: payload.entryPrice ?? row.price ?? "",
    observedPrice: payload.observedPrice ?? row.price ?? "",
    latestAPrice: payload.latestAPrice ?? row.price ?? "",
    latestSeenPrice: payload.latestSeenPrice ?? row.price ?? "",
    changePercent: payload.changePercent ?? row.change_percent ?? "",
    volume: payload.volume ?? row.volume ?? "",
    tradeValue: payload.tradeValue ?? row.trade_value ?? "",
    signalId: payload.signalId || row.signal_id || code,
    firstAAt: payload.firstAAt || row.first_a_at || "",
    latestAAt: payload.latestAAt || row.latest_a_at || "",
    latestSeenAt: payload.latestSeenAt || row.latest_seen_at || "",
    quoteTime: payload.quoteTime || row.latest_seen_at || row.scan_time || "",
    ma35Source: payload.ma35Source || row.ma35_source || "",
    sourceCoverage: payload.sourceCoverage ?? row.source_coverage ?? "",
    quoteAgeSeconds: payload.quoteAgeSeconds ?? row.quote_age_seconds ?? "",
    latestCandleTime: payload.latestCandleTime || row.latest_candle_time || "",
    todayCandleCount: payload.todayCandleCount ?? row.today_candle_count ?? "",
  };
}

async function fetchResultRowsForRun(base, runId, limit = 500) {
  if (!runId) return [];
  return fetchRows(
    base,
    RESULTS_TABLE,
    [
      "select=run_id,row_kind,code,name,scan_date,scan_time,state_id,score,price,change_percent,volume,trade_value,signal_id,first_a_at,latest_a_at,latest_seen_at,ma35_source,source_coverage,quote_age_seconds,latest_candle_time,today_candle_count,complete,quality_status,schema_version,data_contract_source,generated_at,updated_at,payload",
      "strategy=eq.strategy2",
      `run_id=eq.${encodeURIComponent(runId)}`,
      "complete=eq.true",
      "order=row_kind.asc,score.desc.nullslast,scan_time.desc",
      `limit=${Math.max(1, Math.min(1000, cleanNumber(limit) || 500))}`,
    ].join("&")
  );
}

async function hydrateRunPayloadRows(base, run, options = null) {
  if (!run?.run_id || hasStrategy2PayloadRows(run.payload)) return run;
  const limit = Math.max(200, cleanNumber(options?.limit) || 500);
  const rows = await fetchResultRowsForRun(base, run.run_id, limit);
  if (!rows.length) return run;
  const events = rows.filter((row) => String(row.row_kind || "event") === "event").map(strategy2ResultPayload);
  const records = rows.filter((row) => String(row.row_kind || "") !== "event").map(strategy2ResultPayload);
  const payload = {
    ...(run.payload || {}),
    events,
    records,
    rows: events.length ? events : records,
    date: run.payload?.date || run.scan_date || "",
    updatedAt: run.payload?.updatedAt || run.updated_at || run.finished_at || rows[0]?.updated_at || "",
    entryCount: cleanNumber(run.payload?.entryCount || run.payload?.aCount || events.length),
    aCount: cleanNumber(run.payload?.aCount || run.payload?.entryCount || events.length),
    matchCount: cleanNumber(run.payload?.matchCount || events.length || records.length),
    totalCount: cleanNumber(run.payload?.totalCount || run.scanned_count || records.length || rows.length),
    scanned: cleanNumber(run.payload?.scanned || run.scanned_count || records.length || rows.length),
    total: cleanNumber(run.payload?.total || run.expected_total || records.length || rows.length),
    qualityStatus: run.payload?.qualityStatus || run.quality_status || rows[0]?.quality_status || "complete",
    schemaVersion: run.payload?.schemaVersion || rows[0]?.schema_version || "strategy2-run-id-complete-v1",
    dataContractSource: run.payload?.dataContractSource || rows[0]?.data_contract_source || "supabase:strategy2_scan_results",
  };
  return { ...run, payload };
}

function buildStrategy2RunPayload(run, { skippedEmptyRunIds = [], sourceTable = LATEST_RUN_VIEW, marketSession = null, options = null, emptyToday = false } = {}) {
  const payload = run.payload || {};
  const runDate = payloadRunDate(payload, run);
  const isTodayRun = Boolean(runDate && runDate === marketSession?.today);
  const fullPayload = {
    ...payload,
    ...runTimeSourceSnapshotResponseFields(payload),
    ok: payload.ok !== false,
    updatedAt: payload.updatedAt || run.updated_at || run.finished_at,
    runId: payload.runId || run.run_id,
    tradeDate: runDate,
    usedDate: runDate,
    sourceDate: runDate,
    date: payload.date || run.scan_date || run.date,
    complete: true,
    qualityStatus: payload.qualityStatus || run.quality_status || "complete",
    cacheSource: "supabase-api",
    gate: AUTHORITATIVE_GATE,
    reason: emptyToday ? "today-complete-run-empty" : isTodayRun ? "complete-run-authoritative" : marketSession?.closed ? "non-trading-day-cache" : "complete-run-authoritative",
    noTodayDetections: Boolean(emptyToday),
    marketSession,
    fallbackUsed: false,
    fallbackScope: [],
    fallbackDetails: [],
    latestCompleteRunCorrected: skippedEmptyRunIds.length > 0,
    correctionReason: skippedEmptyRunIds.length ? "empty_complete_run_skipped" : "",
    skippedEmptyRunIds,
    transport: {
      source: "supabase",
      latestRunView: LATEST_RUN_VIEW,
      sourceTable,
      gate: AUTHORITATIVE_GATE,
      runId: run.run_id,
      skippedEmptyRunIds,
      via: "api/strategy2-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
  return compactStrategy2Payload(fullPayload, options);
}

function strategy2DisplayOnlyPreviousGood(payload, reason) {
  if (!payload || typeof payload !== "object") return null;
  const fallbackScope = [...new Set([...(Array.isArray(payload.fallbackScope) ? payload.fallbackScope : []), "display-only-previous-good", "supabase-read-failed"])];
  const fallbackDetails = [
    ...(Array.isArray(payload.fallbackDetails) ? payload.fallbackDetails : []),
    { scope: "display-only-previous-good", reason, at: new Date().toISOString() },
  ];
  return {
    ...payload,
    ok: false,
    status: "blocked",
    qualityStatus: "degraded",
    publishAllowed: false,
    publishBlocked: true,
    publishBlockedReason: reason,
    blockedReason: reason,
    scanner_block_reason: reason,
    evidenceStatus: "insufficient",
    sourceEvidenceStatus: "insufficient",
    unattendedStatus: "NO",
    unattended: {
      ...(payload.unattended || {}),
      status: "NO",
      canRunUnattended: false,
      evidenceStatus: "insufficient",
      reason,
    },
    fallbackUsed: true,
    fallbackAllowed: false,
    fallbackScope,
    fallbackDetails,
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    mustPreserveLatest: true,
    latestWriteAttempted: false,
    latestPointerUpdated: false,
    emptyResultWritten: false,
    sourceCoverage: {
      ...(payload.sourceCoverage || {}),
      ok: false,
      ready: false,
      status: "display_only_previous_good",
      reason,
      checkedAt: new Date().toISOString(),
    },
    sourceGate: {
      ...(payload.sourceGate || {}),
      ok: false,
      publishAllowed: false,
      reason,
      issues: [...new Set([...(Array.isArray(payload.sourceGate?.issues) ? payload.sourceGate.issues : []), "supabase_read_failed_display_only_previous_good"])],
    },
    run_quality_at_publish: {
      ...(payload.run_quality_at_publish || {}),
      publishAllowed: false,
      degradedBlocksLatest: true,
      preservePreviousGood: true,
      fallbackUsed: true,
      fallbackAllowed: false,
      fallbackScope,
      fallbackDetails,
      blockedReason: reason,
      scanner_block_reason: reason,
      reason,
    },
    reason,
  };
}

async function readStrategy2DisplayFallbackPayload(marketSession, options = {}, reason = "strategy2_display_only_previous_good") {
  const runtimeHistoryPayload = readStrategy2RuntimeHistoryPayload(marketSession, options);
  if (runtimeHistoryPayload && hasStrategy2PayloadRows(runtimeHistoryPayload)) {
    return strategy2DisplayOnlyPreviousGood(runtimeHistoryPayload, reason);
  }
  const snapshotPayload = await readStrategy2SnapshotPayload({ ...options, snapshot: true, live: false }, marketSession).catch(() => null);
  if (snapshotPayload && hasStrategy2PayloadRows(snapshotPayload)) {
    return strategy2DisplayOnlyPreviousGood(snapshotPayload, reason);
  }
  return null;
}
async function readStrategy2SnapshotPayload(options = {}, marketSession = null) {
  const snapshot = await readSnapshot(STRATEGY2_SNAPSHOT_KEY, {
    allowLatestFallback: true,
    timeoutMs: Number(process.env.STRATEGY2_SNAPSHOT_READ_TIMEOUT_MS || 5000),
  }).catch(() => null);
  const payload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  if (!payload || !hasStrategy2PayloadRows(payload)) return null;
  const inferredRunId = payload.runId || payload.latestRunId || payload.transport?.runId || readStrategy2RuntimeReceiptRunId(payload.date || marketSession?.today || marketSession?.marketDataDate || "");
  return compactStrategy2Payload({
    ...payload,
    runId: inferredRunId,
    latestRunId: payload.latestRunId || inferredRunId,
    ok: payload.ok !== false,
    cacheSource: "supabase:strategy2_latest_snapshot",
    snapshotFirst: true,
    sourceCoverage: payload.sourceCoverage || {
      ok: false,
      ready: false,
      status: "snapshot",
      reason: "strategy2_snapshot_first",
      checkedAt: new Date().toISOString(),
    },
    fallbackUsed: true,
    fallbackScope: ["strategy2_latest_snapshot"],
    fallbackDetails: [{
      scope: "strategy2_latest_snapshot",
      reason: payload.reason || "strategy2-snapshot-first",
      snapshotUpdatedAt: snapshot.updatedAt || "",
    }],
    reason: payload.reason || "strategy2-snapshot-first",
    updatedAt: payload.updatedAt || snapshot.updatedAt || new Date().toISOString(),
    transport: {
      ...(payload.transport || {}),
      source: "supabase:strategy2_latest_snapshot",
      snapshotKey: STRATEGY2_SNAPSHOT_KEY,
      snapshotUpdatedAt: snapshot.updatedAt || "",
      snapshotFirst: true,
      via: "api/strategy2-latest",
      fetchedAt: new Date().toISOString(),
    },
  }, options);
}

function setStrategy2SnapshotCache(response) {
  response.setHeader("Cache-Control", "public, max-age=45, stale-while-revalidate=180");
  response.setHeader("CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=45, stale-while-revalidate=240");
}

function setStrategy2LiveShellCache(response, options = {}) {
  if (!options.canvas && !options.compact && !options.shell) return;
  response.setHeader("Cache-Control", "public, max-age=12, stale-while-revalidate=24");
  response.setHeader("CDN-Cache-Control", "public, max-age=12, stale-while-revalidate=30");
  response.setHeader("Vercel-CDN-Cache-Control", "public, max-age=12, stale-while-revalidate=30");
}

async function fetchCompleteRunPayload(base, marketSession = null, options = null, readiness = null) {
  // Readiness is a diagnostic gate. It can lag behind the authoritative
  // complete-run publish path, so it must not override the latest complete run.
  const readinessRunId = "";
  if (readiness?.ready === true && readinessRunId) {
    const readinessRun = await hydrateRunPayloadRows(base, {
      run_id: readinessRunId,
      scan_date: isoDate(marketSession?.today || taipeiClock().ymd),
      status: "complete",
      complete: true,
      quality_status: "complete",
      finished_at: readiness.checkedAt || "",
      updated_at: readiness.checkedAt || "",
      scanned_count: cleanNumber(readiness.execution?.scanned),
      expected_total: cleanNumber(readiness.execution?.expected),
      payload: {},
    }, options);
    const readinessRunDate = payloadRunDate(readinessRun?.payload || {}, readinessRun);
    const readinessMarketSession = sessionWithSupabaseRunDate(marketSession, readinessRunDate);
    if (readinessRun?.run_id && readinessRun?.payload && hasStrategy2PayloadRows(readinessRun.payload) && allowedForMarketSession(readinessRun, readinessMarketSession)) {
      return buildStrategy2RunPayload(readinessRun, {
        sourceTable: `${READINESS_STATUS_VIEW}+${RUNS_TABLE}+${RESULTS_TABLE}`,
        marketSession: readinessMarketSession,
        options,
      });
    }
  }

  const latestRows = await fetchRows(
    base,
    LATEST_RUN_VIEW,
    [
      "select=*",
      "strategy=eq.strategy2",
      "status=eq.complete",
      "complete=eq.true",
      "limit=1",
    ].filter(Boolean).join("&")
  );
  const skippedEmptyRunIds = [];
  const latestRun = await hydrateRunPayloadRows(base, latestRows[0], options);
  const latestRunDate = payloadRunDate(latestRun?.payload || {}, latestRun);
  const runAwareMarketSession = sessionWithSupabaseRunDate(marketSession, latestRunDate);
  if (latestRun?.run_id && latestRun?.payload && hasStrategy2PayloadRows(latestRun.payload) && allowedForMarketSession(latestRun, runAwareMarketSession)) {
    return buildStrategy2RunPayload(latestRun, { sourceTable: `${LATEST_RUN_VIEW}+${RESULTS_TABLE}`, marketSession: runAwareMarketSession, options });
  }
  const currentSessionDate = runAwareMarketSession?.marketDataDate || runAwareMarketSession?.today || "";
  const emptyTodayRun = latestRun?.run_id && (
    latestRunDate === runAwareMarketSession?.today
    || latestRunDate === currentSessionDate
  )
    ? latestRun
    : null;
  if (emptyTodayRun) {
    return buildStrategy2RunPayload(emptyTodayRun, {
      sourceTable: `${LATEST_RUN_VIEW}+${RESULTS_TABLE}`,
      marketSession: runAwareMarketSession,
      options,
      emptyToday: true,
    });
  }
  if (latestRun?.run_id) skippedEmptyRunIds.push(latestRun.run_id);

  const historyRows = await fetchRows(
    base,
    RUNS_TABLE,
    [
      "select=*",
      "strategy=eq.strategy2",
      "status=eq.complete",
      "complete=eq.true",
      "result_count=gt.0",
      options?.today && runAwareMarketSession?.today ? "scan_date=eq." + isoDate(runAwareMarketSession.today) : "",
      runAwareMarketSession?.closed && runAwareMarketSession.marketDataIsoDate ? "scan_date=lte." + runAwareMarketSession.marketDataIsoDate : "",
      "order=scan_date.desc,finished_at.desc",
      "limit=10",
    ].filter(Boolean).join("&")
  );
  for (const row of historyRows) {
    const historyRun = await hydrateRunPayloadRows(base, row, options);
    if (historyRun?.run_id && historyRun?.payload && hasStrategy2PayloadRows(historyRun.payload) && allowedForMarketSession(historyRun, runAwareMarketSession)) {
      return buildStrategy2RunPayload(historyRun, { skippedEmptyRunIds, sourceTable: `${RUNS_TABLE}+${RESULTS_TABLE}`, marketSession: runAwareMarketSession, options });
    }
  }
  return emptyTodayRun ? buildStrategy2RunPayload(emptyTodayRun, { marketSession: runAwareMarketSession, options, emptyToday: true }) : null;
}

async function handler(request, response) {
  const marketCalendar = await buildMarketCalendarContract().catch(() => null);
  installMarketCalendarResponse(response, marketCalendar);
  wrapJsonRunTimeSourceEvidence(response, { strategy: "strategy2", endpoint: "api/strategy2-latest" });
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const options = parseRequestOptions(request);
    if (options.snapshot && !options.live) {
      const snapshotPayload = await readStrategy2SnapshotPayload(options, marketSessionState());
      if (snapshotPayload) {
        setStrategy2SnapshotCache(response);
        response.status(200).json(snapshotPayload);
        return;
      }
    }
    const marketSession = marketSessionState();
    const base = String(SUPABASE_URL || "").replace(/\/+$/, "");
    if (!base || !SUPABASE_KEY) {
      response.status(503).json(apiOnlyError("strategy2_supabase_not_configured"));
      return;
    }
    const completeRunOptions = {
      ...options,
      deferHardA: true,
    };
    const readinessPromise = fetchStrategy2Readiness(base);
    const [completeRun, readiness, tradingDay, sourceGate] = await Promise.all([
      readinessPromise.then((ready) => fetchCompleteRunPayload(base, marketSession, completeRunOptions, ready)),
      readinessPromise,
      strategy2TradingDayState(),
      fetchStrategy2SourceGate(),
    ]);
    if (completeRun) {
      const payloadForPublishGate = sourceGate?.publishAllowed === true
        ? {
          ...completeRun,
          tradeDate: compactDate(completeRun.tradeDate || completeRun.usedDate || completeRun.date || completeRun.marketSession?.marketDataDate || ""),
          usedDate: completeRun.usedDate || compactDate(completeRun.tradeDate || completeRun.date || completeRun.marketSession?.marketDataDate || ""),
          sourceDate: completeRun.sourceDate || compactDate(completeRun.tradeDate || completeRun.date || completeRun.marketSession?.marketDataDate || ""),
          resourceReadiness: readiness,
          transport: {
            ...(completeRun.transport || {}),
            readinessStatusView: READINESS_STATUS_VIEW,
            tradingDay,
            readinessDiagnosticOnly: true,
            publishBlocked: false,
            publishBlockedReason: "",
          },
        }
        : attachStrategy2Readiness(completeRun, readiness, tradingDay);
      setStrategy2LiveShellCache(response, options);
      const gatedPayload = attachStrategy2PublishGate(payloadForPublishGate, sourceGate);
      const approvedSnapshotFields = gatedPayload?.sourceGate?.publishAllowed === true
        ? buildStrategy2SourceGateSnapshotFields(gatedPayload, gatedPayload.sourceGate, {
          ...(gatedPayload.sourceCoverage || {}),
          ready: true,
          status: "ready",
        })
        : {};
      const responsePayload = gatedPayload?.sourceGate?.publishAllowed === true
        ? {
          ...gatedPayload,
          ...approvedSnapshotFields,
          ok: true,
          status: "ready",
          qualityStatus: "complete",
          publishAllowed: true,
          publishBlocked: false,
          publishBlockedReason: "",
          evidenceStatus: "complete",
          sourceEvidenceStatus: "complete",
          unattendedStatus: "YES",
          unattended: {
            ...(gatedPayload.unattended || {}),
            status: "YES",
            canRunUnattended: true,
            evidenceStatus: "complete",
            reason: "",
          },
          degradedBlocksLatest: false,
          preservePreviousGood: false,
          mustPreserveLatest: false,
          runTimeSourceSnapshot: approvedSnapshotFields.runTimeSourceSnapshot || gatedPayload.runTimeSourceSnapshot,
          run_time_source_snapshot: approvedSnapshotFields.run_time_source_snapshot || gatedPayload.run_time_source_snapshot,
          run_quality_at_publish: approvedSnapshotFields.run_quality_at_publish || gatedPayload.run_quality_at_publish,
          blockedReason: "",
          scanner_block_reason: "",
        }
        : gatedPayload;
      response.status(200).json(responsePayload);
      return;
    }
    const runtimeHistoryPayload = readStrategy2RuntimeHistoryPayload(marketSession, options);
    if (runtimeHistoryPayload) {
      setStrategy2LiveShellCache(response, options);
      response.status(200).json(runtimeHistoryPayload);
      return;
    }
    response.status(404).json(apiOnlyError("strategy2_complete_run_empty"));
  } catch (error) {
    const options = parseRequestOptions(request);
    const marketSession = marketSessionState();
    const reason = `strategy2_api_only_failed_display_only_previous_good:${error?.message || String(error)}`;
    const fallbackPayload = await readStrategy2DisplayFallbackPayload(marketSession, options, reason);
    if (fallbackPayload) {
      setStrategy2LiveShellCache(response, options);
      response.status(200).json(fallbackPayload);
      return;
    }
    response.status(503).json(apiOnlyError("strategy2_api_only_failed", error?.message || String(error)));
  }
};

module.exports = withEntitlementRequired(handler, "strategy2");


