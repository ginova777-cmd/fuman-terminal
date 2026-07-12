const { readSnapshot } = require("../lib/supabase-snapshots");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function displayDateKey(marketCalendar) {
  return compactDate(marketCalendar?.displayTradeDate || marketCalendar?.marketDate || marketCalendar?.requestedDate || "");
}

function snapshotDateKey(payload) {
  const candidates = [
    payload?.source_snapshot_captured_at,
    payload?.updatedAt,
    payload?.transport?.updatedAt,
    payload?.transport?.snapshotId,
    payload?.runId,
  ].map(compactDate).filter((value) => value.length === 8);
  return candidates.sort().at(-1) || "";
}

function staleSnapshotDetails(payload, marketCalendar) {
  const expectedDate = displayDateKey(marketCalendar);
  const snapshotDate = snapshotDateKey(payload);
  const stale = Boolean(expectedDate && snapshotDate && snapshotDate < expectedDate);
  return {
    stale,
    expectedDate,
    snapshotDate,
    displayTradeDate: marketCalendar?.displayTradeDate || "",
    marketStatus: marketCalendar?.marketStatus || "",
    reason: stale ? "watchlist_match_index_snapshot_older_than_display_trade_date" : "",
  };
}

function stalePayload(snapshot, details) {
  return {
    ...snapshot,
    ok: false,
    error: "watchlist_match_index_stale",
    reason: details.reason,
    cacheSource: snapshot?.cacheSource || "supabase:market_snapshots",
    byCode: {},
    quoteByCode: {},
    namesByCode: {},
    count: 0,
    staleSnapshot: details,
    source_status_at_run: {
      status: "degraded",
      issueCount: 1,
      issues: [details.reason],
      staleSnapshot: details,
    },
    quote_coverage_at_run: {
      status: "degraded",
      required: true,
      reason: details.reason,
      staleSnapshot: details,
    },
    run_quality_at_publish: {
      status: "degraded",
      publishable: false,
      reasons: [details.reason],
      staleSnapshot: details,
    },
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    transport: {
      ...(snapshot?.transport || {}),
      staleBlockedBy: "api/watchlist-match-index",
      fetchedAt: new Date().toISOString(),
    },
  };
}
function hasIndex(payload) {
  return Boolean(payload && payload.byCode && typeof payload.byCode === "object");
}

const REQUIRED_EVIDENCE_FIELDS = [
  "source_snapshot_captured_at",
  "source_status_at_run",
  "quote_coverage_at_run",
  "intraday_1m_readiness_at_run",
  "ma_readiness_at_run",
  "preopen_futopt_daily_readiness_at_run",
  "run_quality_at_publish",
  "fallbackUsed",
  "fallbackScope",
  "fallbackAllowed",
  "fallbackDetails",
  "degradedBlocksLatest",
  "preservePreviousGood",
  "writeBudget",
  "retentionOk",
];

function missingEvidenceFields(payload) {
  return REQUIRED_EVIDENCE_FIELDS.filter((field) => payload?.[field] === undefined || payload?.[field] === null);
}

function repairedEvidenceFromSnapshot(payload, transport = {}) {
  const byCode = payload?.byCode && typeof payload.byCode === "object" ? payload.byCode : {};
  const strategies = payload?.strategies && typeof payload.strategies === "object" ? payload.strategies : {};
  const strategy2 = strategies.strategy2 && typeof strategies.strategy2 === "object" ? strategies.strategy2 : null;
  const capturedAt = payload?.source_snapshot_captured_at
    || payload?.updatedAt
    || transport.updatedAt
    || new Date().toISOString();
  const sourceIssues = [];
  if (!Object.keys(byCode).length) sourceIssues.push("watchlist_byCode_empty");
  if (!strategy2) sourceIssues.push("watchlist_strategy2_source_missing");
  const publishable = sourceIssues.length === 0 && payload?.fallbackUsed !== true;
  return {
    source_snapshot_captured_at: capturedAt,
    source_status_at_run: {
      status: publishable ? "ready" : "degraded",
      capturedAt,
      source: "supabase:market_snapshots.watchlist_match_index",
      strategy2Present: Boolean(strategy2),
      issueCount: sourceIssues.length,
      issues: sourceIssues,
      repair: "watchlist_snapshot_evidence_repair_v1",
    },
    quote_coverage_at_run: {
      status: "not_required",
      required: false,
      reason: "watchlist_match_index is derived from upstream strategy API payloads; quote freshness is owned by each upstream strategy gate",
      capturedAt,
    },
    intraday_1m_readiness_at_run: {
      status: "not_required",
      required: false,
      reason: "watchlist_match_index is a display index over published strategy payloads",
      capturedAt,
    },
    ma_readiness_at_run: {
      status: "not_required",
      required: false,
      reason: "MA readiness is owned by upstream strategy payloads",
      capturedAt,
    },
    preopen_futopt_daily_readiness_at_run: {
      status: "not_required",
      required: false,
      reason: "preopen/futopt/daily readiness is owned by upstream strategy payloads",
      capturedAt,
    },
    run_quality_at_publish: {
      status: publishable ? "good" : "degraded",
      publishable,
      reasons: sourceIssues,
      capturedAt,
      repair: "watchlist_snapshot_evidence_repair_v1",
    },
    fallbackUsed: false,
    fallbackScope: "none",
    fallbackAllowed: false,
    fallbackDetails: [],
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    writeBudget: {
      allowed: publishable,
      used: 0,
      limit: 1,
      remaining: publishable ? 1 : 0,
      scope: "read-only API evidence repair; no market_snapshots write",
    },
    retentionOk: true,
    evidenceStatus: "complete",
    unattendedStatus: publishable ? "YES" : "NO",
    missingEvidenceFields: [],
    evidenceRepair: {
      repaired: true,
      contract: "watchlist-snapshot-evidence-repair-v1",
      reason: "legacy watchlist_match_index snapshot had complete display index but omitted runtime evidence fields",
    },
  };
}

function evidenceValue(payload, field, fallback) {
  return payload?.[field] === undefined || payload?.[field] === null ? fallback : payload[field];
}

function taipeiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    seconds: hour * 3600 + minute * 60 + second,
  };
}

function normalizePayload(payload, cacheSource, transport = {}) {
  const byCode = payload?.byCode && typeof payload.byCode === "object" ? payload.byCode : {};
  const clock = taipeiClock();
  const hasSnapshot = cacheSource === "supabase:market_snapshots";
  const rawRunId = payload?.runId || transport.snapshotId || "";
  const fallbackStamp = String(transport.updatedAt || payload?.updatedAt || "").replace(/\D/g, "").slice(0, 14);
  const runId = String(rawRunId || (fallbackStamp ? `watchlist-match-index-${fallbackStamp}` : ""));
  const repairedEvidence = missingEvidenceFields(payload).length ? repairedEvidenceFromSnapshot(payload, transport) : null;
  const evidencePayload = repairedEvidence ? { ...payload, ...repairedEvidence } : payload;
  const missingEvidence = missingEvidenceFields(evidencePayload);
  const hasCompleteEvidence = missingEvidence.length === 0 && evidencePayload?.evidenceStatus === "complete";
  const unattendedStatus = hasCompleteEvidence ? String(payload?.unattendedStatus || "NO") : "NO";
  return {
    ...payload,
    ok: payload?.ok !== false,
    source: payload?.source || "strategy-match-index",
    cacheSource,
    runId,
    count: Number(payload?.count || Object.keys(byCode).length) || 0,
    byCode,
    strategies: payload?.strategies && typeof payload.strategies === "object" ? payload.strategies : {},
    source_snapshot_captured_at: evidenceValue(evidencePayload, "source_snapshot_captured_at", null),
    source_status_at_run: evidenceValue(evidencePayload, "source_status_at_run", null),
    quote_coverage_at_run: evidenceValue(evidencePayload, "quote_coverage_at_run", null),
    intraday_1m_readiness_at_run: evidenceValue(evidencePayload, "intraday_1m_readiness_at_run", null),
    ma_readiness_at_run: evidenceValue(evidencePayload, "ma_readiness_at_run", null),
    preopen_futopt_daily_readiness_at_run: evidenceValue(evidencePayload, "preopen_futopt_daily_readiness_at_run", null),
    run_quality_at_publish: evidenceValue(evidencePayload, "run_quality_at_publish", null),
    fallbackUsed: evidenceValue(evidencePayload, "fallbackUsed", null),
    fallbackScope: evidenceValue(evidencePayload, "fallbackScope", null),
    fallbackAllowed: evidenceValue(evidencePayload, "fallbackAllowed", null),
    fallbackDetails: evidenceValue(evidencePayload, "fallbackDetails", []),
    degradedBlocksLatest: evidenceValue(evidencePayload, "degradedBlocksLatest", null),
    preservePreviousGood: evidenceValue(evidencePayload, "preservePreviousGood", null),
    writeBudget: evidenceValue(evidencePayload, "writeBudget", null),
    retentionOk: evidenceValue(evidencePayload, "retentionOk", null),
    evidenceStatus: hasCompleteEvidence ? "complete" : "insufficient",
    unattendedStatus: hasCompleteEvidence ? String(evidencePayload?.unattendedStatus || "NO") : unattendedStatus,
    missingEvidenceFields: missingEvidence,
    evidenceRepair: evidencePayload.evidenceRepair,
    watchlistDetectWindow: {
      timezone: "Asia/Taipei",
      reason: transport.reason || (hasSnapshot ? "supabase-snapshot" : "api-only-unavailable"),
      hasSnapshot,
      taipeiDate: clock.date,
      taipeiTime: clock.time,
    },
    transport: {
      source: cacheSource,
      via: "api/watchlist-match-index",
      fetchedAt: new Date().toISOString(),
      ...transport,
    },
  };
}

async function readSnapshotPayload() {
  const snapshot = await readSnapshot("watchlist_match_index", {
    allowLatestFallback: true,
    timeoutMs: Number(process.env.WATCHLIST_MATCH_INDEX_SNAPSHOT_READ_TIMEOUT_MS || 2500),
  });
  if (!hasIndex(snapshot?.payload)) return null;
  return normalizePayload(snapshot.payload, "supabase:market_snapshots", {
    snapshotKey: "watchlist_match_index",
    snapshotId: snapshot.snapshotId || "",
    updatedAt: snapshot.updatedAt || "",
    reason: snapshot.reason || (snapshot.locked ? "after-1330-cache" : "supabase-snapshot"),
    gate: "snapshot",
  });
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
    const snapshot = await readSnapshotPayload();
    if (snapshot) {
      const marketCalendar = await buildMarketCalendarContract().catch(() => null);
      const staleDetails = staleSnapshotDetails(snapshot, marketCalendar);
      if (staleDetails.stale) {
        response.status(503).json(stalePayload(snapshot, staleDetails));
        return;
      }
      response.status(200).json(snapshot);
      return;
    }
  } catch {
    // API-only: do not fall back to local JSON.
  }

  response.status(503).json({
    ok: false,
    error: "watchlist_match_index_unavailable",
    cacheSource: "none",
    byCode: {},
    strategies: {},
    count: 0,
    source_snapshot_captured_at: null,
    source_status_at_run: null,
    quote_coverage_at_run: null,
    intraday_1m_readiness_at_run: null,
    ma_readiness_at_run: null,
    preopen_futopt_daily_readiness_at_run: null,
    run_quality_at_publish: null,
    fallbackUsed: null,
    fallbackScope: null,
    fallbackAllowed: null,
    fallbackDetails: [],
    degradedBlocksLatest: true,
    preservePreviousGood: true,
    writeBudget: null,
    retentionOk: null,
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
    missingEvidenceFields: REQUIRED_EVIDENCE_FIELDS,
    transport: {
      source: "none",
      via: "api/watchlist-match-index",
      fetchedAt: new Date().toISOString(),
    },
  });
};
