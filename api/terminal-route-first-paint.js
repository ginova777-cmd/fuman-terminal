"use strict";

const { withEntitlementRequired } = require("../lib/server-entitlement-guard");
const { readDesktopRouteSnapshotForRoute } = require("../lib/desktop-route-snapshot-cache");

const ALLOWED = new Set(["strategy3", "strategy4", "strategy5", "institution"]);
const PATHS = { strategy3: "/api/strategy3-latest", strategy4: "/api/strategy4-latest", strategy5: "/api/strategy5-latest", institution: "/api/institution-latest" };

async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "method_not_allowed" });
  const route = String(request.query?.route || "").trim().toLowerCase();
  if (!ALLOWED.has(route)) return response.status(400).json({ ok: false, error: "unsupported_first_paint_route" });
  const snapshot = await readDesktopRouteSnapshotForRoute(route, { timeoutMs: 900, allowStale: true }).catch(() => null);
  const envelope = snapshot?.payload;
  const endpointEntry = Object.entries(envelope?.endpoints || {}).find(([endpoint]) => String(endpoint).startsWith(PATHS[route]));
  const payload = endpointEntry?.[1];
  if (!payload || typeof payload !== "object") return response.status(404).json({ ok: false, error: "route_snapshot_payload_missing", route });
  return response.status(200).json({ ...payload, firstPaint: true, firstPaintRoute: route, cacheSource: "supabase:desktop_route_snapshot:route" });
}

module.exports = withEntitlementRequired(handler, "strategy");
