const { readSnapshot } = require("../lib/supabase-snapshots");

function hasIndex(payload) {
  return Boolean(payload && payload.byCode && typeof payload.byCode === "object");
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
  return {
    ...payload,
    ok: payload?.ok !== false,
    source: payload?.source || "strategy-match-index",
    cacheSource,
    runId,
    count: Number(payload?.count || Object.keys(byCode).length) || 0,
    byCode,
    strategies: payload?.strategies && typeof payload.strategies === "object" ? payload.strategies : {},
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
    transport: {
      source: "none",
      via: "api/watchlist-match-index",
      fetchedAt: new Date().toISOString(),
    },
  });
};
