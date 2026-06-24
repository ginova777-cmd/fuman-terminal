const { readSnapshot } = require("../lib/supabase-snapshots");
const { readEndpointFromDesktopSnapshot } = require("../lib/desktop-route-snapshot-cache");

function apiOnlyError(reason = "") {
  return {
    ok: false,
    error: "cb_detect_api_only_unavailable",
    detail: reason,
    cacheSource: "none",
    rows: [],
    transport: {
      source: "supabase-snapshot",
      snapshotKey: "cb_detect_latest",
      via: "api/cb-detect-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function emptyPayload(reason = "cb_detect_snapshot_missing", options = {}) {
  return {
    ok: true,
    complete: false,
    qualityStatus: "waiting_snapshot",
    cacheSource: "none",
    source: "cb-detect-empty-state",
    count: 0,
    returnedCount: 0,
    canvas: Boolean(options.canvas),
    compact: Boolean(options.compact),
    shell: Boolean(options.shell),
    rows: [],
    matches: [],
    updatedAt: new Date().toISOString(),
    reason,
    transport: {
      source: "none",
      snapshotKey: "cb_detect_latest",
      gate: "waiting_snapshot",
      via: "api/cb-detect-latest",
      fetchedAt: new Date().toISOString(),
    },
  };
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function readRequestOptions(request) {
  try {
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const query = request.query || {};
    const getParam = (key) => url.searchParams.get(key) ?? query[key];
    const canvas = getParam("canvas") === "1";
    const compact = getParam("compact") === "1";
    const shell = getParam("shell") === "1";
    const compactIntent = canvas || compact || shell || getParam("fastBundle") === "1" || getParam("snapshotBuild") === "1";
    const defaultLimit = compactIntent ? 60 : 3000;
    const maxLimit = compactIntent ? 70 : 3000;
    const limit = Math.max(1, Math.min(maxLimit, cleanNumber(getParam("limit")) || defaultLimit));
    return { canvas, compact, shell, compactIntent, limit };
  } catch {
    return { canvas: false, compact: false, shell: false, compactIntent: false, limit: 3000 };
  }
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const cached = await readEndpointFromDesktopSnapshot(request, {
    timeoutMs: 650,
    via: "api/cb-detect-latest",
  });
  if (cached) {
    response.status(200).json(cached);
    return;
  }

  try {
    const options = readRequestOptions(request);
    const snapshot = await readSnapshot("cb_detect_latest", { allowLatestFallback: true, timeoutMs: 5000 });
    if (!snapshot?.payload) {
      response.status(200).json(emptyPayload("cb_detect_snapshot_missing", options));
      return;
    }
    const rows = Array.isArray(snapshot.payload.rows)
      ? snapshot.payload.rows
      : Array.isArray(snapshot.payload.matches)
        ? snapshot.payload.matches
        : [];
    const outputRows = options.compactIntent ? rows.slice(0, options.limit || 60) : rows;
    response.status(200).json({
      ...snapshot.payload,
      ok: snapshot.payload.ok !== false,
      complete: snapshot.payload.complete !== false,
      qualityStatus: snapshot.payload.qualityStatus || "complete",
      count: Number(snapshot.payload.count || rows.length || 0),
      returnedCount: outputRows.length,
      canvas: Boolean(options.canvas),
      compact: Boolean(options.compact),
      shell: Boolean(options.shell),
      rows: outputRows,
      matches: outputRows,
      cacheSource: "supabase-snapshot",
      runId: snapshot.payload.runId || snapshot.snapshotId || "",
      updatedAt: snapshot.payload.updatedAt || snapshot.updatedAt || "",
      transport: {
        ...(snapshot.payload.transport || {}),
        source: "supabase-snapshot",
        snapshotKey: "cb_detect_latest",
        snapshotId: snapshot.snapshotId || "",
        gate: "latest-snapshot",
        via: "api/cb-detect-latest",
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    response.status(503).json(apiOnlyError(error?.message || String(error)));
  }
};
