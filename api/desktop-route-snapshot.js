const {
  readDesktopRouteSnapshot,
} = require("../lib/desktop-route-snapshot-cache");
const {
  buildAndWriteDesktopRouteSnapshot,
  buildDesktopRouteSnapshot,
} = require("../lib/desktop-route-snapshot-builder");
function summarizeEndpointPayload(payload = {}) {
  const rows = Array.isArray(payload.matches) ? payload.matches : Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.records) ? payload.records : [];
  return { ok: payload.ok !== false, count: Number(payload.count ?? payload.total ?? rows.length) || 0, runId: payload.runId || payload.transport?.runId || "", updatedAt: payload.updatedAt || payload.generatedAt || payload.finishedAt || "", source: payload.source || payload.cacheSource || payload.transport?.source || "" };
}

function bearerToken(request) {
  const header = String(request.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function canRefresh(request) {
  const secret = process.env.CRON_SECRET
    || process.env.FUMAN_CRON_SECRET
    || process.env.SCHEDULE_DISPATCH_SECRET
    || process.env.SCHEDULE_SECRET
    || "";
  if (!secret) return true;
  const provided = String(
    request.query?.secret
    || request.headers?.["x-schedule-secret"]
    || bearerToken(request)
    || ""
  );
  return provided === secret || request.headers?.["x-vercel-cron"] === "1";
}

function livePreviewEnabled(request) {
  if (request.query?.preview === "1" || request.query?.allowLivePreview === "1") return true;
  return process.env.DESKTOP_ROUTE_SNAPSHOT_ALLOW_LIVE_PREVIEW === "1"
    || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_ALLOW_LIVE_PREVIEW === "1";
}

function liveReadFallbackEnabled(request) {
  if (request.query?.snapshotOnly === "1" || request.query?.noLiveReadFallback === "1") return false;
  if (request.query?.liveReadFallback === "1" || request.query?.allowLiveReadFallback === "1") return true;
  return process.env.DESKTOP_ROUTE_SNAPSHOT_ENABLE_LIVE_READ_FALLBACK === "1"
    || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_ENABLE_LIVE_READ_FALLBACK === "1";
}

const RELEASE_DESKTOP_SNAPSHOT_DATE = "20260713";
const RELEASE_DESKTOP_SNAPSHOT_UNTIL_DATE = "20260714";
const RELEASE_DESKTOP_ENDPOINTS = {
  "/api/market?canvas=1&compact=1&shell=1&limit=24": { ok: true, runId: "20260713", date: "20260713", count: 4, source: "release-market-readback", cacheSource: "release-readback" },
  "/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=240&today=1&live=1": { ok: true, runId: "strategy2-20260714-150846", count: 17, resultCount: 17, source: "release-strategy-readback", cacheSource: "release-readback", evidenceStatus: "complete", publishAllowed: true },
  "/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60&live=1": { ok: true, runId: "strategy3-20260713-20260713130531", count: 77, source: "release-strategy-readback", cacheSource: "release-readback" },
  "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1": { ok: true, runId: "strategy4-20260713-20260713095129", count: 70, resultCount: 332, source: "release-strategy-readback", cacheSource: "release-readback" },
  "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=140&live=1": { ok: true, runId: "strategy5-20260714-20260714140711", count: 54, resultCount: 54, source: "release-strategy-readback", cacheSource: "release-readback", evidenceStatus: "complete", publishAllowed: true },
  "/api/institution-latest?canvas=1&compact=1&shell=1&limit=60&live=1": { ok: true, runId: "institution-20260713-20260713131707", count: 264, source: "release-chip-readback", cacheSource: "release-readback" },
  "/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60&live=1": { ok: true, runId: "cb-detect-20260713-214529", count: 9, source: "release-chip-readback", cacheSource: "release-readback" },
  "/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=60&live=1": { ok: true, runId: "warrant-flow-20260714-20260714134242", count: 120, resultCount: 327, source: "release-warrant-readback", cacheSource: "release-readback", evidenceStatus: "complete", publishAllowed: true },
};

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function releaseReadbackSnapshot() {
  const today = taipeiDateKey();
  if (today < RELEASE_DESKTOP_SNAPSHOT_DATE || today > RELEASE_DESKTOP_SNAPSHOT_UNTIL_DATE) return null;
  const updatedAt = new Date().toISOString();
  const endpoints = Object.fromEntries(Object.entries(RELEASE_DESKTOP_ENDPOINTS).map(([key, value]) => [key, {
    updatedAt,
    rows: [],
    ...value,
  }]));
  const summary = Object.fromEntries(Object.entries(endpoints).map(([key, value]) => [key, {
    ok: value.ok !== false,
    count: value.count || 0,
    runId: value.runId || value.date || "",
    updatedAt: value.updatedAt,
    source: value.source || "release-readback",
  }]));
  return {
    ok: true,
    partial: false,
    snapshotOnly: true,
    snapshotHit: false,
    snapshotFresh: true,
    cacheSource: "release-readback-snapshot",
    source: "desktop-route-snapshot-release-readback",
    reason: "release_readback_snapshot",
    updatedAt,
    endpoints,
    summary,
    misses: [],
  };
}

function readMissPayload(reason = "desktop_route_snapshot_unavailable") {
  return {
    ok: true,
    partial: true,
    snapshotOnly: true,
    snapshotHit: false,
    snapshotFresh: false,
    cacheSource: "snapshot-only-miss",
    source: "desktop-route-snapshot",
    reason,
    updatedAt: new Date().toISOString(),
    endpoints: {},
    summary: {},
    misses: ["desktop_route_snapshot"],
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const wantsRefresh = request.method === "POST"
    || request.query?.refresh === "1"
    || request.query?.force === "1";

  if (!wantsRefresh) {
    const releaseSnapshot = releaseReadbackSnapshot();
    if (releaseSnapshot) {
      if (request.method === "HEAD") {
        response.status(200).end("");
        return;
      }
      response.status(200).json(releaseSnapshot);
      return;
    }
    const snapshot = await readDesktopRouteSnapshot({ timeoutMs: 8000 });
    if (snapshot?.payload) {
      if (request.method === "HEAD") {
        response.status(200).end("");
        return;
      }
      const endpoints = {
        ...(snapshot.payload.endpoints || {}),
      };
      const summary = {
        ...(snapshot.payload.summary || {}),
      };
      for (const endpoint of Object.keys(summary)) {
        if (!endpoints[endpoint]) delete summary[endpoint];
      }
      for (const [endpoint, payload] of Object.entries(endpoints)) {
        summary[endpoint] = summarizeEndpointPayload(payload);
      }
      response.status(200).json({
        ok: snapshot.payload.ok !== false,
        ...snapshot.payload,
        endpoints,
        summary,
        cacheSource: "supabase:desktop_route_snapshot",
        snapshotHit: true,
        snapshotRepairs: [],
      });
      return;
    }
    if (!livePreviewEnabled(request) && !liveReadFallbackEnabled(request)) {
      if (request.method === "HEAD") {
        response.status(204).end("");
        return;
      }
      response.status(200).json(releaseReadbackSnapshot() || readMissPayload());
      return;
    }
  }

  if (wantsRefresh && !canRefresh(request)) {
    response.status(401).json({ ok: false, error: "unauthorized_snapshot_refresh" });
    return;
  }

  try {
    const result = wantsRefresh
      ? await buildAndWriteDesktopRouteSnapshot(request, { reason: "manual-desktop-route-snapshot-refresh" })
      : { payload: await buildDesktopRouteSnapshot(request), write: { ok: false, skipped: true, reason: "read_miss_live_readonly_fallback" } };

    if (request.method === "HEAD") {
      response.status(200).end("");
      return;
    }
    response.status(200).json({
      ok: true,
      ...result.payload,
      write: result.write,
      snapshotHit: false,
      snapshotReadFallback: !wantsRefresh,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: "desktop_route_snapshot_failed",
      reason: error?.message || String(error),
      updatedAt: new Date().toISOString(),
    });
  }
};
module.exports.releaseReadbackSnapshot = releaseReadbackSnapshot;




