const {
  readDesktopRouteSnapshot,
} = require("../lib/desktop-route-snapshot-cache");
const {
  buildAndWriteDesktopRouteSnapshot,
  buildDesktopRouteSnapshot,
} = require("../lib/desktop-route-snapshot-builder");
const {
  repairRealtimeRadarSnapshotEndpoints,
  summarizeEndpointPayload,
} = require("../lib/realtime-radar-snapshot-repair");

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
    const snapshot = await readDesktopRouteSnapshot({ timeoutMs: 30000 });
    if (snapshot?.payload) {
      if (request.method === "HEAD") {
        response.status(200).end("");
        return;
      }
      const endpoints = {
        ...(snapshot.payload.endpoints || {}),
      };
      const realtimeRadarRepairs = await repairRealtimeRadarSnapshotEndpoints(request, endpoints, {
        timeoutMs: 6500,
        via: "api/desktop-route-snapshot",
      });
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
        snapshotRepairs: realtimeRadarRepairs,
      });
      return;
    }
    if (!livePreviewEnabled(request)) {
      if (request.method === "HEAD") {
        response.status(204).end("");
        return;
      }
      response.status(200).json(readMissPayload());
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
      : { payload: await buildDesktopRouteSnapshot(request), write: { ok: false, skipped: true, reason: "read_miss_live_preview" } };

    if (request.method === "HEAD") {
      response.status(200).end("");
      return;
    }
    response.status(200).json({
      ok: true,
      ...result.payload,
      write: result.write,
      snapshotHit: false,
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
