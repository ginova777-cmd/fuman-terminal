const {
  readDesktopRouteSnapshot,
} = require("../lib/desktop-route-snapshot-cache");
const {
  buildAndWriteDesktopRouteSnapshot,
  buildDesktopRouteSnapshot,
} = require("../lib/desktop-route-snapshot-builder");
const { verifyRequestEntitlement } = require("../lib/server-entitlement-guard");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");

const ADMIN_EMAILS = new Set(
  String(process.env.FUMAN_ADMIN_EMAILS || "ginova777@gmail.com")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

function summarizeEndpointPayload(payload = {}) {
  const rows = Array.isArray(payload.matches) ? payload.matches : Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.records) ? payload.records : [];
  return { ok: payload.ok !== false, count: Number(payload.count ?? payload.total ?? rows.length) || 0, runId: payload.runId || payload.transport?.runId || "", updatedAt: payload.updatedAt || payload.generatedAt || payload.finishedAt || "", source: payload.source || payload.cacheSource || payload.transport?.source || "" };
}

function bearerToken(request) {
  const header = String(request.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isAdminEntitlement(entitlement) {
  const email = String(entitlement?.user?.email || entitlement?.access?.email || "").trim().toLowerCase();
  return Boolean(entitlement?.ok && email && ADMIN_EMAILS.has(email));
}

async function canRefresh(request) {
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
  if (provided === secret || request.headers?.["x-vercel-cron"] === "1") return true;
  const entitlement = await verifyRequestEntitlement(request, { scope: "desktop-route-snapshot-refresh" });
  return isAdminEntitlement(entitlement);
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

function releaseReadbackSnapshot() {
  return null;
}

async function shouldUseMarketClosedPreviousGood() {
  try {
    const calendar = await buildMarketCalendarContract();
    return Boolean(
      calendar?.marketOpen === false
      && (calendar?.displayMode === "market_closed_previous_good" || calendar?.formalScanSkipped === true || calendar?.preservePreviousGood === true)
    );
  } catch {
    return false;
  }
}

function snapshotResponsePayload(snapshot, extra = {}) {
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
  return {
    ok: snapshot.payload.ok !== false,
    ...snapshot.payload,
    ...extra,
    endpoints,
    summary,
    snapshotHit: true,
    snapshotRepairs: [],
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
      response.status(200).json(snapshotResponsePayload(snapshot, {
        cacheSource: "supabase:desktop_route_snapshot",
      }));
      return;
    }

    const staleSnapshot = await readDesktopRouteSnapshot({ timeoutMs: 8000, allowStale: true });
    if (staleSnapshot?.payload && await shouldUseMarketClosedPreviousGood()) {
      if (request.method === "HEAD") {
        response.status(200).end("");
        return;
      }
      response.status(200).json(snapshotResponsePayload(staleSnapshot, {
        cacheSource: "supabase:desktop_route_snapshot:market_closed_previous_good",
        marketClosedPreviousGood: true,
        reason: "market_closed_previous_good_stale_snapshot_allowed",
      }));
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

  if (wantsRefresh && !(await canRefresh(request))) {
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
