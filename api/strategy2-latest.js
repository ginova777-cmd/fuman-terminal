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

function runtimeStrategy2HistoryCandidates(marketSession = null) {
  const keys = [
    marketSession?.today,
    marketSession?.marketDataDate,
    taipeiClock().ymd,
  ].map(isoDate).filter(Boolean);
  return [...new Set(keys)].map((date) => path.join(RUNTIME_DIR, "data", "strategy2-intraday-history", `${date}.json`));
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
      historyContract: "strategy2-session-history-0845-1200-v1",
      historyWindow: {
        start: "08:45",
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
  return compactStrategy2Payload({
    ...payload,
    ok: payload.ok !== false,
    cacheSource: "runtime-session-history",
    gate: "strategy2-session-history-0845-1200",
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
  const fallbackLimit = compact ? 60 : 200;
  const wantsAllToday = /^(1|true|yes)$/i.test(params.get("today") || params.get("allToday") || "");
  const maxLimit = compact ? (wantsAllToday ? 240 : 120) : 500;
  const rawLimit = hasTopLimit ? requestedTop : Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : fallbackLimit;
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
  const snapshotFields = snapshotAudit.ok
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
    });
  const evidencedPayload = {
    ...payload,
    ...snapshotFields,
  };
  return {
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
}
function compactStrategy2Payload(payload, options) {
  if (!options?.compact) return attachStrategy2SelfCheck(payload);
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
  const compactPayload = {
    ok: payload?.ok !== false,
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
    qualityStatus: payload?.qualityStatus || "complete",
    sourceCoverage: payload?.sourceCoverage || null,
    fallbackUsed: payload?.fallbackUsed === true,
    fallbackAllowed: payload?.fallbackAllowed !== false,
    fallbackScope: Array.isArray(payload?.fallbackScope) ? payload.fallbackScope : [],
    fallbackDetails: Array.isArray(payload?.fallbackDetails) ? payload.fallbackDetails : [],
    sourceGate: payload?.sourceGate || null,
    resourceReadiness: payload?.resourceReadiness || null,
    writeBudget: payload?.writeBudget || null,
    retentionOk: payload?.retentionOk ?? true,
    publishAllowed: payload?.publishAllowed !== false,
    publishBlocked: payload?.publishBlocked === true,
    publishBlockedReason: payload?.publishBlockedReason || "",
    ...runTimeSourceSnapshotResponseFields(payload),
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
  return attachStrategy2SelfCheck(compactPayload);
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
  const sourceReady = sourceGate?.ok === true && readinessCoverage?.ready === true;
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
  const publishAllowed = Boolean(
    (sourceGate?.publishAllowed === true || afterhoursHold)
    && (payload.publishBlocked !== true || afterhoursHold)
    && readinessCoverage.ready === true
  );
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
  const sourceGateCoverage = normalizeStrategy2SourceGateCoverage(sourceGate, readinessCoverage);
  const today = payload?.marketSession?.today || taipeiClock().ymd;
  const payloadTradeDate = compactDate(payload?.tradeDate || payload?.usedDate || payload?.sourceDate || payload?.date || payload?.marketSession?.marketDataDate || "");
  const runCompleteReady = Boolean(
    payload?.complete === true
    && payload?.runId
    && payloadTradeDate === today
    && String(payload?.qualityStatus || "").toLowerCase() === "complete"
    && payload?.cacheSource === "supabase-api"
    && payload?.fallbackUsed !== true
  );
  const topLevelSourceCoverage = runCompleteReady
    ? {
      ...sourceGateCoverage,
      ok: true,
      ready: true,
      status: "ready",
      reason: publishAllowed && sourceGateCoverage.ready === true
        ? sourceGateCoverage.reason || "strategy2_source_publish_gate_ready"
        : "strategy2_complete_run_source_snapshot_ready_current_gate_disclosed",
      currentGateStatus: sourceGateCoverage.status,
      currentGateReady: sourceGateCoverage.ready === true,
      currentGateReason: sourceGateCoverage.reason || "",
    }
    : sourceGateCoverage;
  const nextPayload = {
    ...payload,
    status: publishAllowed ? "ready" : "degraded",
    qualityStatus: publishAllowed ? payload.qualityStatus || "complete" : "degraded",
    sourceCoverage: topLevelSourceCoverage,
    currentSourceGateCoverage: sourceGateCoverage,
    sourceGate: {
      ok: sourceGate?.ok === true,
      publishAllowed: sourceGate?.publishAllowed === true,
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
    issues: [...priorIssues, ...gateIssues],
    warnings: [...priorWarnings, ...gateWarnings],
    reason: publishBlocked ? `${payload.reason || AUTHORITATIVE_GATE}; ${publishBlockedReason}` : payload.reason,
    transport: {
      ...(payload.transport || {}),
      sourcePublishGate: "strategy2-source-publish-gate",
      publishAllowed,
      publishBlocked,
      publishBlockedReason,
      afterhoursHoldUntilMidnight: afterhoursHold,
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

async function readStrategy2SnapshotPayload(options = {}) {
  const snapshot = await readSnapshot(STRATEGY2_SNAPSHOT_KEY, {
    allowLatestFallback: true,
    timeoutMs: Number(process.env.STRATEGY2_SNAPSHOT_READ_TIMEOUT_MS || 5000),
  }).catch(() => null);
  const payload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  if (!payload || !hasStrategy2PayloadRows(payload)) return null;
  return compactStrategy2Payload({
    ...payload,
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
  const readinessRunId = String(readiness?.latestRunId || "").trim();
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

module.exports = async function handler(request, response) {
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
      const snapshotPayload = await readStrategy2SnapshotPayload(options);
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
    const readinessPromise = fetchStrategy2Readiness(base);
    const [completeRun, readiness, tradingDay, sourceGate] = await Promise.all([
      readinessPromise.then((ready) => fetchCompleteRunPayload(base, marketSession, options, ready)),
      readinessPromise,
      strategy2TradingDayState(),
      fetchStrategy2SourceGate(),
    ]);
    if (completeRun) {
      setStrategy2LiveShellCache(response, options);
      response.status(200).json(attachStrategy2PublishGate(
        attachStrategy2Readiness(completeRun, readiness, tradingDay),
        sourceGate
      ));
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
    response.status(503).json(apiOnlyError("strategy2_api_only_failed", error?.message || String(error)));
  }
};



