const fs = require("fs");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const STATIC_CANDIDATES = [
  path.join(RUNTIME_DIR, "data", "strategy-match-index.json"),
  path.join(ROOT, "data", "strategy-match-index.json"),
];

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
  return {
    ...payload,
    ok: payload?.ok !== false,
    source: payload?.source || "strategy-match-index",
    cacheSource,
    count: Number(payload?.count || Object.keys(byCode).length) || 0,
    byCode,
    strategies: payload?.strategies && typeof payload.strategies === "object" ? payload.strategies : {},
    watchlistDetectWindow: {
      timezone: "Asia/Taipei",
      reason: transport.reason || (hasSnapshot ? "supabase-snapshot" : "static-fallback"),
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

function readStaticPayload() {
  for (const file of STATIC_CANDIDATES) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!hasIndex(payload)) continue;
      return normalizePayload(payload, "data/strategy-match-index.json", {
        file,
        reason: "static-fallback",
        gate: "static-fallback",
      });
    } catch {
      // Try the next local cache candidate.
    }
  }
  return null;
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
    // Fall through to local JSON.
  }

  const fallback = readStaticPayload();
  if (fallback) {
    response.status(200).json(fallback);
    return;
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
