const { readSnapshot, upsertSnapshot } = require("./supabase-snapshots");

const DESKTOP_ROUTE_SNAPSHOT_KEY = "desktop_route_snapshot";
const VOLATILE_PARAMS = new Set(["t", "ts", "fresh", "_", "cacheBust", "verify", "v", "fastBundle", "snapshotBuild", "postScanSnapshotContract"]);
const DEFAULT_MAX_AGE_MS = Number(process.env.DESKTOP_ROUTE_SNAPSHOT_MAX_AGE_MS || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_MAX_AGE_MS || 6 * 60 * 60 * 1000);
const DEFAULT_READ_TIMEOUT_MS = Number(process.env.DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS || 30000);
const DEFAULT_ENDPOINT_TIMEOUT_MS = Number(process.env.DESKTOP_ROUTE_SNAPSHOT_ENDPOINT_TIMEOUT_MS || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_ENDPOINT_TIMEOUT_MS || 12000);
const DEFAULT_WRITE_TIMEOUT_MS = Number(process.env.DESKTOP_ROUTE_SNAPSHOT_WRITE_TIMEOUT_MS || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_WRITE_TIMEOUT_MS || 180000);

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
    timeoutMs: Number(options.timeoutMs || DEFAULT_READ_TIMEOUT_MS),
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
    timeoutMs: options.timeoutMs || DEFAULT_WRITE_TIMEOUT_MS,
  });
}

function endpointPayloadUpdatedAtMs(payload) {
  const candidates = [
    payload?.updatedAt,
    payload?.generatedAt,
    payload?.finishedAt,
    payload?.transport?.fetchedAt,
  ];
  for (const value of candidates) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function endpointPayloadFromSnapshot(snapshotPayload, endpoint) {
  const endpoints = snapshotPayload?.endpoints && typeof snapshotPayload.endpoints === "object"
    ? snapshotPayload.endpoints
    : {};
  const clean = cleanEndpoint(endpoint);
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
  const preferredCandidates = samePath.filter(([key]) => {
    const url = new URL(key, "https://fuman.local");
    return (!wantsCanvas || url.searchParams.get("canvas") === "1")
      && (!wantsCompact || url.searchParams.get("compact") === "1" || url.searchParams.get("shell") === "1");
  });
  const candidates = (preferredCandidates.length ? preferredCandidates : samePath).slice();
  candidates.sort(([aKey, aPayload], [bKey, bPayload]) => {
    const aUpdatedAt = endpointPayloadUpdatedAtMs(aPayload);
    const bUpdatedAt = endpointPayloadUpdatedAtMs(bPayload);
    if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt;
    const aLive = new URL(aKey, "https://fuman.local").searchParams.get("live") === "1" ? 1 : 0;
    const bLive = new URL(bKey, "https://fuman.local").searchParams.get("live") === "1" ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    return aKey === clean ? -1 : bKey === clean ? 1 : 0;
  });
  return candidates[0]?.[1] || null;
}

async function readEndpointFromDesktopSnapshot(request, options = {}) {
  if (shouldBypassDesktopSnapshot(request)) return null;
  const url = requestUrl(request);
  const compactIntent = url.searchParams.get("canvas") === "1"
    || url.searchParams.get("compact") === "1"
    || url.searchParams.get("shell") === "1"
    || url.searchParams.get("fastBundle") === "1";
  if (!compactIntent && !options.allowFullEndpoint) return null;
  const timeoutMs = Number(options.timeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS);
  const snapshot = await readDesktopRouteSnapshot({
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_ENDPOINT_TIMEOUT_MS,
  });
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
  endpointPayloadFromSnapshot,
  snapshotFreshness,
  readDesktopRouteSnapshot,
  writeDesktopRouteSnapshot,
  readEndpointFromDesktopSnapshot,
};
