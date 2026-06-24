const { buildAndWriteDesktopRouteSnapshot } = require("../lib/desktop-route-snapshot-builder");

function bearerToken(request) {
  const header = String(request.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function authorized(request) {
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

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  if (!authorized(request)) {
    response.status(401).json({ ok: false, error: "unauthorized_snapshot_refresh" });
    return;
  }

  try {
    const writeEndpointSnapshots = request.query?.endpointSnapshots === "1"
      || request.query?.endpointSnapshots === "true";
    const { payload, write } = await buildAndWriteDesktopRouteSnapshot(request, {
      reason: request.headers?.["x-vercel-cron"] === "1"
        ? "vercel-cron-desktop-route-snapshot"
        : "manual-desktop-route-snapshot-refresh",
      writeEndpointSnapshots,
    });
    response.status(write?.ok === false ? 207 : 200).json({
      ok: write?.ok !== false,
      write,
      summary: payload.summary,
      misses: payload.misses,
      partial: payload.partial,
      elapsedMs: payload.elapsedMs,
      updatedAt: payload.updatedAt,
      endpointCount: Object.keys(payload.endpoints || {}).length,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: "desktop_route_snapshot_refresh_failed",
      reason: error?.message || String(error),
      updatedAt: new Date().toISOString(),
    });
  }
};
