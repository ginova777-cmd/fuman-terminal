const { readSnapshot, upsertSnapshot } = require("./supabase-snapshots");

const DESKTOP_ROUTE_SNAPSHOT_KEY = "desktop_route_snapshot";
const VOLATILE_PARAMS = new Set(["t", "ts", "fresh", "_", "cacheBust", "fastBundle", "snapshotBuild"]);
const DEFAULT_MAX_AGE_MS = Number(process.env.DESKTOP_ROUTE_SNAPSHOT_MAX_AGE_MS || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_MAX_AGE_MS || 15 * 60 * 1000);

function requestUrl(request) {
  return new URL(request?.url || "/", `https://${request?.headers?.host || "localhost"}`);
}

function cleanEndpoint(endpoint) {
  const url = new URL(endpoint || "/", "https://fuman.local");
  VOLATILE_PARAMS.forEach((key) => url.searchParams.delete(key));
  return `${url.pathname}${url.search}`;
}

function shouldBypassDesktopSnapshot(request) {
  try {
    const url = requestUrl(request);
    const query = request?.query || {};
    return url.searchParams.get("snapshotBuild") === "1"
      || url.searchParams.get("refresh") === "1"
      || url.searchParams.get("force") === "1"
      || url.searchParams.get("live") === "1"
      || query.snapshotBuild === "1"
      || query.refresh === "1"
      || query.force === "1"
      || query.live === "1";
  } catch {
    return false;
  }
}

function snapshotUpdatedAtMs(snapshot) {
  const candidates = [
    snapshot?.updatedAt,
    snapshot?.payload?.updatedAt,
    snapshot?.payload?.generatedAt,
  ];
  for (const value of candidates) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function snapshotFreshness(snapshot, options = {}) {
  const maxAgeMs = Math.max(0, Number(options.maxAgeMs ?? DEFAULT_MAX_AGE_MS) || 0);
  const updatedAtMs = snapshotUpdatedAtMs(snapshot);
  const ageMs = updatedAtMs ? Date.now() - updatedAtMs : Infinity;
  return {
    updatedAtMs,
    ageMs,
    maxAgeMs,
    fresh: Boolean(updatedAtMs && (!maxAgeMs || ageMs <= maxAgeMs)),
    stale: Boolean(!updatedAtMs || (maxAgeMs && ageMs > maxAgeMs)),
  };
}

async function readDesktopRouteSnapshot(options = {}) {
  const snapshot = await readSnapshot(DESKTOP_ROUTE_SNAPSHOT_KEY, {
    allowLatestFallback: true,
    timeoutMs: options.timeoutMs || 1200,
  });
  if (!snapshot?.payload || typeof snapshot.payload !== "object") return null;
  const freshness = snapshotFreshness(snapshot, options);
  if (freshness.stale && !options.allowStale) return null;
  return {
    ...snapshot,
    payload: {
      ...snapshot.payload,
      source: "terminal-fast-bundle",
      cacheSource: "supabase:desktop_route_snapshot",
      snapshotHit: true,
      snapshotFresh: freshness.fresh,
      snapshotStale: freshness.stale,
      snapshotAgeMs: Number.isFinite(freshness.ageMs) ? freshness.ageMs : null,
      snapshotMaxAgeMs: freshness.maxAgeMs,
      snapshot: {
        key: snapshot.key || DESKTOP_ROUTE_SNAPSHOT_KEY,
        snapshotId: snapshot.snapshotId || "",
        updatedAt: snapshot.updatedAt || "",
        source: snapshot.source || "supabase:desktop_route_snapshot",
        fresh: freshness.fresh,
        stale: freshness.stale,
        ageMs: Number.isFinite(freshness.ageMs) ? freshness.ageMs : null,
        maxAgeMs: freshness.maxAgeMs,
      },
    },
  };
}

async function writeDesktopRouteSnapshot(payload, options = {}) {
  return upsertSnapshot(DESKTOP_ROUTE_SNAPSHOT_KEY, payload, {
    source: "desktop-route-snapshot",
    reason: options.reason || "desktop-route-precomputed-bundle",
    timeoutMs: options.timeoutMs || 20000,
  });
}

function endpointPayloadFromSnapshot(snapshotPayload, endpoint) {
  const endpoints = snapshotPayload?.endpoints && typeof snapshotPayload.endpoints === "object"
    ? snapshotPayload.endpoints
    : {};
  const clean = cleanEndpoint(endpoint);
  if (endpoints[clean]) return endpoints[clean];
  const target = new URL(clean, "https://fuman.local");
  const samePath = Object.entries(endpoints)
    .filter(([key]) => {
      try {
        return new URL(key, "https://fuman.local").pathname === target.pathname;
      } catch {
        return false;
      }
    });
  if (!samePath.length) return null;
  const wantsCanvas = target.searchParams.get("canvas") === "1";
  const wantsCompact = target.searchParams.get("compact") === "1" || target.searchParams.get("shell") === "1";
  const preferred = samePath.find(([key]) => {
    const url = new URL(key, "https://fuman.local");
    return (!wantsCanvas || url.searchParams.get("canvas") === "1")
      && (!wantsCompact || url.searchParams.get("compact") === "1" || url.searchParams.get("shell") === "1");
  });
  return (preferred || samePath[0])?.[1] || null;
}

async function readEndpointFromDesktopSnapshot(request, options = {}) {
  if (shouldBypassDesktopSnapshot(request)) return null;
  const url = requestUrl(request);
  const compactIntent = url.searchParams.get("canvas") === "1"
    || url.searchParams.get("compact") === "1"
    || url.searchParams.get("shell") === "1"
    || url.searchParams.get("fastBundle") === "1";
  if (!compactIntent && !options.allowFullEndpoint) return null;
  const snapshot = await readDesktopRouteSnapshot({ timeoutMs: options.timeoutMs || 900 });
  const payload = endpointPayloadFromSnapshot(snapshot?.payload, `${url.pathname}${url.search}`);
  if (!payload || typeof payload !== "object") return null;
  return {
    ...payload,
    cacheSource: "supabase:desktop_route_snapshot",
    snapshotHit: true,
    transport: {
      ...(payload.transport || {}),
      source: "supabase:desktop_route_snapshot",
      snapshotKey: DESKTOP_ROUTE_SNAPSHOT_KEY,
      via: options.via || url.pathname,
      fetchedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  DESKTOP_ROUTE_SNAPSHOT_KEY,
  cleanEndpoint,
  snapshotFreshness,
  readDesktopRouteSnapshot,
  writeDesktopRouteSnapshot,
  readEndpointFromDesktopSnapshot,
};
