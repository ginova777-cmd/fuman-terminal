const strategy2Latest = require("./strategy2-latest");
const { readDesktopRouteSnapshot } = require("../lib/desktop-route-snapshot-cache");
const { buildDesktopRouteSnapshot } = require("../lib/desktop-route-snapshot-builder");
const { upsertSnapshot } = require("../lib/supabase-snapshots");

const SNAPSHOT_MAX_AGE_MS = Number(
  process.env.FUMAN_PRODUCTION_HEALTH_SNAPSHOT_MAX_AGE_MS
  || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_MAX_AGE_MS
  || process.env.DESKTOP_ROUTE_SNAPSHOT_MAX_AGE_MS
  || 6 * 60 * 60 * 1000
);
const SNAPSHOT_READ_TIMEOUT_MS = Number(
  process.env.FUMAN_PRODUCTION_HEALTH_SNAPSHOT_READ_TIMEOUT_MS
  || process.env.FUMAN_DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS
  || process.env.DESKTOP_ROUTE_SNAPSHOT_READ_TIMEOUT_MS
  || 30000
);

function createCaptureResponse(resolve, label) {
  let settled = false;
  const done = (statusCode, payload, headers = {}) => {
    if (settled) return;
    settled = true;
    resolve({ statusCode, payload, headers, label });
  };
  return {
    statusCode: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    send(payload) {
      done(this.statusCode || 200, payload, this.headers);
      return this;
    },
    end(payload = "") {
      done(this.statusCode || 204, payload, this.headers);
      return this;
    },
  };
}

function callJson(label, handler, query = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      resolve({
        statusCode: 504,
        payload: { ok: false, error: "health_timeout", label, timeoutMs },
        elapsedMs: Date.now() - startedAt,
      });
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      resolve({ ...result, elapsedMs: Date.now() - startedAt });
    };
    const capture = createCaptureResponse(finish, label);
    const search = new URLSearchParams(query);
    const req = {
      method: "GET",
      url: `${label}?${search.toString()}`,
      headers: { host: "localhost", "x-production-health": "1" },
      fumanInternalVerify: true,
      query,
    };
    Promise.resolve(handler(req, capture)).catch((error) => {
      finish({
        statusCode: 500,
        payload: { ok: false, error: "health_handler_failed", message: error?.message || String(error) },
      });
    });
  });
}

function endpointHasStrategy2(endpoints = {}) {
  return Object.keys(endpoints || {}).some((endpoint) => /strategy2-latest/i.test(endpoint));
}

function buildIssue(condition, message, issues) {
  if (!condition) issues.push(message);
}

async function writeHealthSnapshot(result) {
  try {
    await upsertSnapshot("production_health_latest", result, {
      source: "production-health",
      reason: result.ok ? "production-health-ok" : "production-health-issues",
      timeoutMs: 4000,
    });
  } catch {}
}

async function readSnapshotForHealth(request) {
  const snapshot = await readDesktopRouteSnapshot({
    timeoutMs: SNAPSHOT_READ_TIMEOUT_MS,
    maxAgeMs: SNAPSHOT_MAX_AGE_MS,
  });
  if (snapshot?.payload) return { snapshot, fallback: false, error: "" };
  if (process.env.FUMAN_PRODUCTION_HEALTH_DISABLE_LIVE_SNAPSHOT_FALLBACK === "1") {
    return { snapshot: null, fallback: false, error: "desktop_route_snapshot_read_miss" };
  }
  try {
    const payload = await buildDesktopRouteSnapshot({
      ...request,
      method: "GET",
      url: "/api/production-health?snapshotBuild=1",
      query: {
        ...(request.query || {}),
        snapshotBuild: "1",
        healthFallback: "1",
      },
    });
    return {
      snapshot: {
        updatedAt: payload.updatedAt || "",
        payload: {
          ...payload,
          cacheSource: "production-health-live-readonly",
          snapshotHit: false,
          snapshotFresh: true,
          snapshotStale: false,
          snapshotReadFallback: true,
          snapshotAgeMs: 0,
          snapshotMaxAgeMs: SNAPSHOT_MAX_AGE_MS,
        },
      },
      fallback: true,
      error: "",
    };
  } catch (error) {
    return {
      snapshot: null,
      fallback: false,
      error: error?.message || String(error),
    };
  }
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const issues = [];
  const snapshotRead = await readSnapshotForHealth(request);
  const snapshot = snapshotRead.snapshot;
  const payload = snapshot?.payload || {};
  const endpoints = payload.endpoints || {};
  const endpointCount = Object.keys(endpoints).length;
  const hasStrategy2Snapshot = endpointHasStrategy2(endpoints);
  const strategy2 = await callJson("/api/strategy2-latest", strategy2Latest, {
    canvas: "1",
    compact: "1",
    shell: "1",
    limit: "20",
    live: "1",
  }, 9000);
  const strategy2Payload = strategy2.payload || {};
  const strategy2CacheSource = String(strategy2Payload.cacheSource || strategy2Payload.source || strategy2Payload.transport?.source || "");

  buildIssue(Boolean(snapshot?.payload), "desktop route snapshot missing", issues);
  buildIssue(payload.snapshotFresh === true, "desktop route snapshot stale", issues);
  buildIssue(payload.partial === false, "desktop route snapshot partial", issues);
  buildIssue(endpointCount >= 10, `desktop route snapshot endpoint count too low: ${endpointCount}`, issues);
  buildIssue(!hasStrategy2Snapshot, "strategy2 must not be stored in cold desktop snapshot", issues);
  buildIssue(strategy2.statusCode >= 200 && strategy2.statusCode < 300 && strategy2Payload.ok !== false, "strategy2 live endpoint unhealthy", issues);
  buildIssue(!/desktop_route_snapshot/i.test(strategy2CacheSource), "strategy2 live endpoint is reading desktop snapshot", issues);

  const result = {
    ok: issues.length === 0,
    source: "production-health",
    updatedAt: new Date().toISOString(),
    issues,
    snapshot: {
      hit: Boolean(payload.snapshotHit),
      fresh: Boolean(payload.snapshotFresh),
      partial: Boolean(payload.partial),
      readFallback: Boolean(snapshotRead.fallback || payload.snapshotReadFallback),
      readFallbackError: snapshotRead.error || "",
      ageMs: payload.snapshotAgeMs ?? null,
      maxAgeMs: payload.snapshotMaxAgeMs ?? SNAPSHOT_MAX_AGE_MS,
      endpointCount,
      cacheSource: payload.cacheSource || "",
      updatedAt: payload.updatedAt || snapshot?.updatedAt || "",
      hasStrategy2Snapshot,
    },
    strategy2: {
      ok: strategy2.statusCode >= 200 && strategy2.statusCode < 300 && strategy2Payload.ok !== false,
      statusCode: strategy2.statusCode,
      elapsedMs: strategy2.elapsedMs,
      source: strategy2CacheSource,
      count: Number(strategy2Payload.count ?? strategy2Payload.total ?? strategy2Payload.records?.length ?? strategy2Payload.events?.length ?? 0) || 0,
      updatedAt: strategy2Payload.updatedAt || strategy2Payload.transport?.fetchedAt || "",
    },
  };

  if (request.method === "HEAD") {
    response.status(result.ok ? 200 : 503).end("");
    return;
  }
  await writeHealthSnapshot(result);
  response.status(result.ok ? 200 : 503).json(result);
};
