"use strict";

const { withEntitlementRequired } = require("../lib/server-entitlement-guard");
const { readSnapshot } = require("../lib/supabase-snapshots");
const { wrapJsonRunTimeSourceEvidence } = require("../lib/run-time-source-snapshot-contract");

const SNAPSHOT_KEY = "strategy2_live_v2";
const REALTIME_SNAPSHOT_KEY = "strategy2_v2_realtime_observation";
const CONTRACT = "strategy2-live-v2-fugle-mother-pool-1m";

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

function cleanRows(value, limit) {
  return (Array.isArray(value) ? value : [])
    .filter((row) => row && /^\d{4}$/.test(String(row.code || row.symbol || "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 240, 500)));
}

function hidePreviousGoodRows(rows, payload) {
  const previousGoodRowsHidden = payload?.preservePreviousGood === true
    || payload?.run_quality_at_publish?.preservePreviousGood === true
    || payload?.previousGood === true
    || payload?.fallbackUsed === true;
  // formal terminal hides previous-good rows; previous-good can be labeled, but not displayed as fresh Strategy2 candidates.
  return previousGoodRowsHidden ? [] : rows;
}
function emptyPayload(today, reason) {
  return {
    ok: true,
    strategy: "strategy2",
    version: "v2",
    strategyContract: CONTRACT,
    status: "waiting_for_v2_live_scan",
    dataDate: today,
    date: today,
    tradeDate: today,
    runId: "",
    updatedAt: "",
    complete: false,
    formalDisplayAllowed: false,
    publishAllowed: false,
    qualityStatus: "waiting",
    unattendedStatus: "NO",
    fallbackUsed: false,
    previousGoodRunId: "",
    expectedCount: 0,
    scannedCount: 0,
    resultCount: 0,
    count: 0,
    dataGapCount: 0,
    records: [],
    formalEvents: [],
    observations: [],
    preopenFutures: [],
    events: [],
    rows: [],
    matches: [],
    sourceCoverage: { noTop40Gate: true, noPreviousGoodFallback: true },
    reason,
    transport: { source: "supabase:market_snapshots", snapshotKey: SNAPSHOT_KEY, via: "api/strategy2-latest" },
  };
}

async function strategy2Latest(request, response) {
  cacheHeaders(response);
  wrapJsonRunTimeSourceEvidence(response, {
    strategy: "strategy2",
    endpoint: "api/strategy2-latest",
    evidenceStatusOnQualityFail: "insufficient",
  });
  const today = taipeiDate();
  const query = request.query || {};
  const [snapshot, realtimeSnapshot] = await Promise.all([
    readSnapshot(SNAPSHOT_KEY, { tradeDate: today.replace(/\D/g, ""), allowLatestFallback: false, timeoutMs: 7000 }),
    readSnapshot(REALTIME_SNAPSHOT_KEY, { tradeDate: today.replace(/\D/g, ""), allowLatestFallback: false, timeoutMs: 5000 }),
  ]);
  const payload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  const realtimePayload = realtimeSnapshot?.payload && realtimeSnapshot.payload?.dataDate === today ? realtimeSnapshot.payload : null;
  if (!payload) return response.status(200).json(emptyPayload(today, "strategy2_v2_today_snapshot_missing"));
  if (payload.strategyContract !== CONTRACT || payload.version !== "v2") return response.status(200).json(emptyPayload(today, "strategy2_v2_contract_mismatch"));
  if (String(payload.dataDate || payload.date || "") !== today) return response.status(200).json(emptyPayload(today, "strategy2_v2_snapshot_not_today"));
  if (!String(payload.runId || "").startsWith("strategy2-v2-")) return response.status(200).json(emptyPayload(today, "strategy2_v2_runid_invalid"));
  const limit = Number(query.limit || 240);
  const rawFormalEvents = cleanRows(payload.events || payload.rows || payload.matches, limit);
  const formalEvents = hidePreviousGoodRows(rawFormalEvents, payload);
  const previousGoodRowsHidden = rawFormalEvents.length > 0 && formalEvents.length === 0;
  const observations = cleanRows(realtimePayload?.observations, limit);
  const preopenFutures = cleanRows(realtimePayload?.preopenFutures, 20);
  const events = cleanRows([...observations, ...formalEvents]
    .sort((left, right) => String(right?.entryAt || right?.timestamp || "").localeCompare(String(left?.entryAt || left?.timestamp || ""))), limit);
  const records = events;
  return response.status(200).json({
    ...payload,
    ok: true,
    date: today,
    dataDate: today,
    tradeDate: today,
    formalEvents,
    observations,
    preopenFutures,
    realtimeObserver: realtimePayload ? {
      runId: realtimePayload.runId || "",
      updatedAt: realtimePayload.updatedAt || "",
      phase: realtimePayload.phase || "",
      status: realtimePayload.status || "",
      pollIntervalSeconds: Number(realtimePayload.pollIntervalSeconds || 0),
      sourceHealth: realtimePayload.sourceHealth || {},
      errors: Array.isArray(realtimePayload.errors) ? realtimePayload.errors : [],
    } : null,
    events,
    records,
    rows: events,
    matches: events,
    count: Number(payload.resultCount ?? events.length),
    resultCount: Number(payload.resultCount ?? events.length),
    returnedCount: events.length,
    observationCount: observations.length,
    formalReturnedCount: formalEvents.length,
    previousGoodRowsHidden,
    hiddenPreviousGoodCount: previousGoodRowsHidden ? rawFormalEvents.length : 0,
    fallbackUsed: false,
    previousGoodRunId: "",
    cacheSource: "supabase:market_snapshots:strategy2_live_v2+strategy2_v2_realtime_observation",
    transport: { ...(payload.transport || {}), source: "strategy2-live-v2", snapshotKey: SNAPSHOT_KEY, via: "api/strategy2-latest", fetchedAt: new Date().toISOString() },
  });
}

module.exports = withEntitlementRequired(strategy2Latest, "strategy2");


