const { buildAndWriteDesktopRouteSnapshot } = require("../lib/desktop-route-snapshot-builder");
const { verifyRequestEntitlement } = require("../lib/server-entitlement-guard");

const ADMIN_EMAILS = new Set(
  String(process.env.FUMAN_ADMIN_EMAILS || "ginova777@gmail.com")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

function bearerToken(request) {
  const header = String(request.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isAdminEntitlement(entitlement) {
  const email = String(entitlement?.user?.email || entitlement?.access?.email || "").trim().toLowerCase();
  return Boolean(entitlement?.ok && email && ADMIN_EMAILS.has(email));
}

async function authorized(request) {
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

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  if (!(await authorized(request))) {
    response.status(401).json({ ok: false, error: "unauthorized_snapshot_refresh" });
    return;
  }

  try {
    const { payload, write, watchlistWrite } = await buildAndWriteDesktopRouteSnapshot(request, {
      reason: request.headers?.["x-vercel-cron"] === "1"
        ? "vercel-cron-desktop-route-snapshot"
        : "manual-desktop-route-snapshot-refresh",
    });
    const ok = write?.ok !== false && watchlistWrite?.ok !== false;
    response.status(ok ? 200 : 207).json({
      ok,
      write,
      watchlistWrite,
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
