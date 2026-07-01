const realtimeRadarLatest = require("../api/realtime-radar-latest");

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,％%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function rowsFromPayload(payload) {
  return Array.isArray(payload?.matches) ? payload.matches
    : Array.isArray(payload?.rows) ? payload.rows
      : Array.isArray(payload?.records) ? payload.records
        : Array.isArray(payload?.events) ? payload.events
          : [];
}

function summarizeEndpointPayload(payload) {
  const rows = rowsFromPayload(payload);
  return {
    ok: payload?.ok !== false,
    count: Number(payload?.count ?? payload?.totalCount ?? payload?.total ?? rows.length) || 0,
    runId: payload?.runId || payload?.transport?.runId || "",
    updatedAt: payload?.updatedAt || payload?.generatedAt || payload?.finishedAt || "",
    source: payload?.source || payload?.cacheSource || payload?.transport?.source || "",
  };
}

function isRealtimeRadarEndpoint(endpoint) {
  return String(endpoint || "").startsWith("/api/realtime-radar-latest");
}

function endpointMaxAgeMs(payload) {
  const freshnessMax = cleanNumber(payload?.freshness?.maxAgeSeconds) * 1000;
  const sourceMax = cleanNumber(payload?.sourceCoverage?.maxAgeSeconds) * 1000;
  return Math.max(DEFAULT_MAX_AGE_MS, freshnessMax || 0, sourceMax || 0);
}

function endpointUpdatedAtMs(payload) {
  const candidates = [
    payload?.updatedAt,
    payload?.generatedAt,
    payload?.finishedAt,
    payload?.freshness?.updatedAt,
    payload?.sourceCoverage?.updatedAt,
    payload?.transport?.fetchedAt,
  ];
  for (const value of candidates) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function isRealtimeRadarSnapshotStale(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== "object") return true;
  if (payload.ok === false) return true;
  const statusText = `${payload.status || ""} ${payload.reason || ""} ${payload.freshness?.decision || ""}`.toLowerCase();
  if (/stale|degraded|fallback|unavailable|error/.test(statusText)) return true;
  const updatedAtMs = endpointUpdatedAtMs(payload);
  if (!updatedAtMs) return true;
  return nowMs - updatedAtMs > endpointMaxAgeMs(payload);
}

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

function endpointQuery(endpoint) {
  const url = new URL(endpoint || "/api/realtime-radar-latest", "https://fuman.local");
  return Object.fromEntries(url.searchParams.entries());
}

function callRealtimeRadarEndpoint(request, endpoint, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        statusCode: 504,
        payload: {
          ok: false,
          error: "realtime_radar_snapshot_repair_timeout",
          endpoint,
          timeoutMs,
        },
      });
    }, timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    const capture = createCaptureResponse(finish, endpoint);
    const query = {
      ...(request?.query || {}),
      ...endpointQuery(endpoint),
      live: "1",
      snapshotRepair: "1",
    };
    Promise.resolve(realtimeRadarLatest({
      ...request,
      method: "GET",
      url: endpoint,
      query,
    }, capture)).catch((error) => {
      finish({
        statusCode: 500,
        payload: {
          ok: false,
          error: "realtime_radar_snapshot_repair_failed",
          endpoint,
          message: error?.message || String(error),
        },
      });
    });
  });
}

async function repairRealtimeRadarSnapshotEndpoints(request, endpoints, options = {}) {
  const repairs = [];
  if (!endpoints || typeof endpoints !== "object") return repairs;
  const nowMs = Date.now();
  const timeoutMs = Number(options.timeoutMs || 5000);
  const shapePayload = typeof options.shapePayload === "function" ? options.shapePayload : (payload) => payload;
  const removeStaleOnFailure = options.removeStaleOnFailure !== false;

  for (const [endpoint, payload] of Object.entries(endpoints)) {
    if (!isRealtimeRadarEndpoint(endpoint) || !isRealtimeRadarSnapshotStale(payload, nowMs)) continue;
    const previousRunId = payload?.runId || payload?.transport?.runId || "";
    const result = await callRealtimeRadarEndpoint(request, endpoint, timeoutMs);
    const replacement = result?.payload;
    const rows = rowsFromPayload(replacement);
    const usable = Number(result?.statusCode || 0) < 400
      && replacement?.ok !== false
      && rows.length > 0
      && !isRealtimeRadarSnapshotStale(replacement, Date.now());
    if (usable) {
      endpoints[endpoint] = shapePayload({
        ...replacement,
        transport: {
          ...(replacement.transport || {}),
          source: replacement.transport?.source || replacement.cacheSource || "api/realtime-radar-latest",
          snapshotRepair: "realtime-radar-live-repair",
          staleSnapshotRunId: previousRunId,
          via: options.via || "realtime-radar-snapshot-repair",
          fetchedAt: new Date().toISOString(),
        },
      });
      repairs.push({
        endpoint,
        status: "repaired",
        previousRunId,
        runId: endpoints[endpoint]?.runId || endpoints[endpoint]?.transport?.runId || "",
        count: rows.length,
      });
      continue;
    }
    if (removeStaleOnFailure) delete endpoints[endpoint];
    repairs.push({
      endpoint,
      status: removeStaleOnFailure ? "removed_stale" : "left_stale",
      previousRunId,
      reason: replacement?.reason || replacement?.error || `HTTP ${result?.statusCode || 0}`,
    });
  }
  return repairs;
}

module.exports = {
  isRealtimeRadarEndpoint,
  isRealtimeRadarSnapshotStale,
  repairRealtimeRadarSnapshotEndpoints,
  summarizeEndpointPayload,
};
