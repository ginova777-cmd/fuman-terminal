"use strict";

const zlib = require("zlib");

const { withEntitlementRequired } = require("../lib/server-entitlement-guard");
const { readSnapshot } = require("../lib/supabase-snapshots");
const { attachMainForceCostsToPayload } = require("../lib/terminal-main-force-costs");
const { attachThreeGatePricesToPayload } = require("../lib/terminal-three-gate-prices");

const SNAPSHOT_KEY = "strategy2_live_v3";
const REPLAY_SNAPSHOT_KEY = "strategy2_live_v3_diagnostic_replay";
const CONTRACT = "strategy2-live-v3-fugle-deep-scan-1m";

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function cacheHeaders(response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
}

function expandTerminalSnapshotRow(row = {}) {
  if (row?.code || !row?.c) return row;
  const pct = String(row.x || "");
  const changePercent = Number(pct.replace(/[% ,]/g, ""));
  const replay = row.sm === "strategy2_v3_diagnostic_replay";
  return {
    code: row.c, symbol: row.c, name: row.n || row.c, entryAt: row.t || "", timestamp: row.t || "",
    entryCandleTime: row.t || "", entryPrice: row.p, price: row.p, pct,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0, score: row.s,
    strategy: "V3量價突破", signalId: "s2_v3_1m_trend_volume_breakout", signalLine: row.l || "",
    reason: row.r || "", state: row.f ? "LIVE候選" : replay ? "回測資料完整，未達正式訊號" : "資料完整，未達訊號",
    stateId: row.f ? "candidate" : "watch", stateLabel: row.f ? "正式候選" : replay ? "回測觀察" : "觀察",
    formalCandidate: row.f === true, supportPrice: row.u, stopLoss: row.k, targetPrice: row.o,
    entryTradeDate: row.a || "", entryPriceSource: "fugle_daytrade_source_formal_1m",
    candleCount: row.m, volumeRatio1m: row.v, scanMode: row.sm || "",
    eventOrigin: row.sm || "", observationKind: row.sm || "",
  };
}

function decodeTerminalSnapshotRows(payload = {}, field) {
  const raw = payload?.[field];
  if (Array.isArray(raw)) return raw.map(expandTerminalSnapshotRow);
  if (payload?.recordsEncoding !== "gzip-base64-json-v1") return [];
  const compressed = String(payload?.[field + "Gzip"] || "");
  if (!compressed) return [];
  try {
    const decoded = JSON.parse(zlib.gunzipSync(Buffer.from(compressed, "base64")).toString("utf8"));
    return Array.isArray(decoded) ? decoded.map(expandTerminalSnapshotRow) : [];
  } catch {
    return [];
  }
}

function cleanRows(value, limit) {
  return (Array.isArray(value) ? value : [])
    .map(expandTerminalSnapshotRow)
    .filter((row) => row && /^\d{4}$/.test(String(row.code || row.symbol || "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 240, 1000)));
}
function emptyPayload(today, reason) {
  return {
    ok: true,
    strategy: "strategy2",
    version: "v3",
    strategyContract: CONTRACT,
    status: "waiting_for_v3_live_scan",
    dataDate: today,
    date: today,
    tradeDate: today,
    runId: "",
    updatedAt: "",
    complete: false,
    formalDisplayAllowed: false,
    publishAllowed: false,
    latestOverwriteAllowed: false,
    qualityStatus: "waiting",
    unattendedStatus: "NO",
    fallbackUsed: false,
    preservePreviousGood: false,
    expectedCount: 0,
    scannedCount: 0,
    resultCount: 0,
    count: 0,
    readbackCount: 0,
    dataGapCount: 0,
    currentCandidates: [],
    observations: [],
    events: [],
    records: [],
    rows: [],
    matches: [],
    sourceCoverage: {
      noLegacyReadbackViews: true,
      noTop40Gate: true,
      noPreviousGoodFallback: true,
    },
    reason,
    transport: { source: "supabase:market_snapshots", snapshotKey: SNAPSHOT_KEY, via: "api/strategy2-latest" },
  };
}

function isFormalPayload(payload, today) {
  return payload?.status === "complete"
    && payload?.complete === true
    && payload?.formalDisplayAllowed === true
    && payload?.publishAllowed === true
    && String(payload?.dataDate || payload?.date || "") === today;
}

function isVisibleDiagnosticReplay(payload, today) {
  return payload?.status === "diagnostic_replay"
    && payload?.diagnosticReplay === true
    && payload?.replayDisplayAllowed === true
    && payload?.formalDisplayAllowed === false
    && payload?.publishAllowed === false
    && payload?.preservePreviousGood === false
    && String(payload?.dataDate || payload?.date || "") === today;
}

async function readV3SnapshotWithRetry(snapshotKey, options = {}) {
  const attempts = Math.max(1, Math.min(Number(process.env.STRATEGY2_V3_SNAPSHOT_READ_ATTEMPTS || 3), 3));
  const totalTimeoutMs = Math.max(3000, Math.min(Number(options.timeoutMs || 12000), 15000));
  const deadline = Date.now() + totalTimeoutMs;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 700) break;
    const attemptTimeoutMs = Math.max(700, Math.min(4500, Math.floor(remainingMs / (attempts - attempt + 1))));
    const snapshot = await readSnapshot(snapshotKey, { ...options, timeoutMs: attemptTimeoutMs });
    if (snapshot) return snapshot;
  }
  return null;
}
async function strategy2Latest(request, response) {
  cacheHeaders(response);
  const today = taipeiDate();
  const query = request.query || {};
  const snapshotTimeoutMs = Math.max(3000, Math.min(Number(process.env.STRATEGY2_V3_SNAPSHOT_READ_TIMEOUT_MS || 12000), 15000));
  const snapshotOptions = { tradeDate: today.replace(/\D/g, ""), allowLatestFallback: false, timeoutMs: snapshotTimeoutMs };
  const [snapshot, replaySnapshot] = await Promise.all([
    readV3SnapshotWithRetry(SNAPSHOT_KEY, snapshotOptions),
    readV3SnapshotWithRetry(REPLAY_SNAPSHOT_KEY, snapshotOptions),
  ]);
  const formalPayload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  const replayPayload = replaySnapshot?.payload && typeof replaySnapshot.payload === "object" ? replaySnapshot.payload : null;
  let payload = formalPayload;
  let replay = false;
  if (!isFormalPayload(formalPayload, today) && isVisibleDiagnosticReplay(replayPayload, today)) {
    payload = replayPayload;
    replay = true;
  }
  if (!payload) return response.status(200).json(emptyPayload(today, "strategy2_v3_snapshot_read_unavailable_or_missing"));
  if (payload.strategyContract !== CONTRACT || payload.version !== "v3") return response.status(200).json(emptyPayload(today, "strategy2_v3_contract_mismatch"));
  if (String(payload.dataDate || payload.date || "") !== today) return response.status(200).json(emptyPayload(today, "strategy2_v3_snapshot_not_today"));
  if (!String(payload.runId || "").startsWith("strategy2-v3-live-")) return response.status(200).json(emptyPayload(today, "strategy2_v3_runid_invalid"));
  if (!isFormalPayload(payload, today) && !isVisibleDiagnosticReplay(payload, today)) {
    return response.status(200).json(emptyPayload(today, "strategy2_v3_snapshot_not_formal_complete"));
  }
  const limit = Number(query.limit || 240);
  const records = cleanRows(decodeTerminalSnapshotRows(payload, "records"), limit);
  const currentCandidates = cleanRows(decodeTerminalSnapshotRows(payload, "currentCandidates"), limit);
  const responsePayload = {
    ...payload,
    ok: true,
    date: today,
    dataDate: today,
    tradeDate: today,
    records,
    events: records,
    rows: records,
    matches: records,
    formalEvents: records,
    currentCandidates,
    count: replay ? records.length : Number(payload.resultCount ?? currentCandidates.length),
    resultCount: Number(payload.resultCount ?? currentCandidates.length),
    returnedCount: records.length,
    fallbackUsed: false,
    preservePreviousGood: false,
    cacheSource: replay ? "supabase:market_snapshots:strategy2_live_v3_diagnostic_replay" : "supabase:market_snapshots:strategy2_live_v3",
    transport: { ...(payload.transport || {}), source: replay ? "strategy2-live-v3-diagnostic-replay" : "strategy2-live-v3", snapshotKey: replay ? REPLAY_SNAPSHOT_KEY : SNAPSHOT_KEY, via: "api/strategy2-latest", fetchedAt: new Date().toISOString() },
  };
  if (!replay) {
    await attachMainForceCostsToPayload(responsePayload);
    await attachThreeGatePricesToPayload(responsePayload);
  } else {
    responsePayload.mainForceCostContract = { contract: "terminal-main-force-costs-v1", skipped: "diagnostic_replay" };
    responsePayload.threeGatePriceContract = { contract: "terminal-three-gate-prices-v1", skipped: "diagnostic_replay" };
  }
  return response.status(200).json(responsePayload);
}

module.exports = withEntitlementRequired(strategy2Latest, "strategy2");
