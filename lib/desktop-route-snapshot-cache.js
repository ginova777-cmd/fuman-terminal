const crypto = require("crypto");
const { readSnapshot, upsertSnapshot } = require("./supabase-snapshots");

const DESKTOP_ROUTE_SNAPSHOT_KEY = "desktop_route_snapshot";
const VOLATILE_PARAMS = new Set(["t", "ts", "fresh", "_", "cacheBust", "fastBundle", "snapshotBuild"]);
const DEFAULT_MAX_AGE_MS = Number(process.env.DESKTOP_ROUTE_SNAPSHOT_MAX_AGE_MS || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_MAX_AGE_MS || 6 * 60 * 60 * 1000);

function requestUrl(request) {
  return new URL(request?.url || "/", `https://${request?.headers?.host || "localhost"}`);
}

function cleanEndpoint(endpoint) {
  const url = new URL(endpoint || "/", "https://fuman.local");
  VOLATILE_PARAMS.forEach((key) => url.searchParams.delete(key));
  return `${url.pathname}${url.search}`;
}

function endpointSnapshotKey(endpoint) {
  const clean = cleanEndpoint(endpoint);
  const hash = crypto.createHash("sha1").update(clean, "utf8").digest("hex").slice(0, 20);
  return `desktop_route_endpoint_${hash}`;
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
  const write = await upsertSnapshot(DESKTOP_ROUTE_SNAPSHOT_KEY, payload, {
    source: "desktop-route-snapshot",
    reason: options.reason || "desktop-route-precomputed-bundle",
    timeoutMs: options.timeoutMs || 20000,
  });
  if (write?.ok !== false) {
    const endpointSnapshots = await writeDesktopEndpointSnapshots(payload, {
      reason: options.reason || "desktop-route-precomputed-bundle",
      timeoutMs: options.endpointTimeoutMs || 12000,
    });
    write.endpointSnapshots = endpointSnapshots;
  }
  return write;
}

async function writeDesktopEndpointSnapshots(snapshotPayload, options = {}) {
  const endpoints = snapshotPayload?.endpoints && typeof snapshotPayload.endpoints === "object"
    ? snapshotPayload.endpoints
    : {};
  const entries = Object.entries(endpoints);
  if (!entries.length) return { ok: true, count: 0 };
  let okCount = 0;
  const errors = [];
  for (const [endpoint, endpointPayload] of entries) {
    const key = endpointSnapshotKey(endpoint);
    const payload = {
      ok: true,
      source: "desktop-route-endpoint-snapshot",
      cacheSource: "desktop-route-endpoint-snapshot-build",
      endpoint: cleanEndpoint(endpoint),
      updatedAt: snapshotPayload.updatedAt || new Date().toISOString(),
      parentUpdatedAt: snapshotPayload.updatedAt || "",
      parentSnapshotSource: snapshotPayload.snapshotSource || DESKTOP_ROUTE_SNAPSHOT_KEY,
      payload: endpointPayload,
    };
    const result = await upsertSnapshot(key, payload, {
      source: "desktop-route-endpoint-snapshot",
      reason: options.reason || "desktop-route-endpoint-cache",
      timeoutMs: options.timeoutMs || 12000,
    });
    if (result?.ok) okCount += 1;
    else errors.push({ endpoint, error: result?.error || result?.reason || "write_failed" });
  }
  return { ok: errors.length === 0, count: okCount, errors };
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
  const endpoint = `${url.pathname}${url.search}`;
  const snapshot = await readDesktopRouteSnapshot({ timeoutMs: options.timeoutMs || 900 });
  let payload = endpointPayloadFromSnapshot(snapshot?.payload, endpoint);
  let source = "supabase:desktop_route_snapshot";
  let snapshotKey = DESKTOP_ROUTE_SNAPSHOT_KEY;
  if (!payload) {
    const endpointSnapshot = await readEndpointSnapshot(endpoint, {
      timeoutMs: options.timeoutMs || 900,
      maxAgeMs: options.maxAgeMs,
    });
    payload = endpointSnapshot?.payload || null;
    source = endpointSnapshot?.source || "supabase:desktop_route_endpoint_snapshot";
    snapshotKey = endpointSnapshot?.key || endpointSnapshotKey(endpoint);
  }
  if (!payload || typeof payload !== "object") return null;
  return {
    ...payload,
    cacheSource: source,
    snapshotHit: true,
    transport: {
      ...(payload.transport || {}),
      source,
      snapshotKey,
      via: options.via || url.pathname,
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function readEndpointSnapshot(endpoint, options = {}) {
  const key = endpointSnapshotKey(endpoint);
  const snapshot = await readSnapshot(key, {
    allowLatestFallback: true,
    timeoutMs: options.timeoutMs || 900,
  });
  if (!snapshot?.payload || typeof snapshot.payload !== "object") return null;
  const freshness = snapshotFreshness(snapshot, options);
  if (freshness.stale && !options.allowStale) return null;
  const payload = snapshot.payload.payload && typeof snapshot.payload.payload === "object"
    ? snapshot.payload.payload
    : null;
  if (!payload) return null;
  return {
    key,
    source: "supabase:desktop_route_endpoint_snapshot",
    payload: {
      ...payload,
      snapshotEndpointHit: true,
      snapshotFresh: freshness.fresh,
      snapshotAgeMs: Number.isFinite(freshness.ageMs) ? freshness.ageMs : null,
      snapshotMaxAgeMs: freshness.maxAgeMs,
    },
  };
}

module.exports = {
  DESKTOP_ROUTE_SNAPSHOT_KEY,
  cleanEndpoint,
  endpointSnapshotKey,
  snapshotFreshness,
  readDesktopRouteSnapshot,
  writeDesktopRouteSnapshot,
  writeDesktopEndpointSnapshots,
  readEndpointFromDesktopSnapshot,
};
