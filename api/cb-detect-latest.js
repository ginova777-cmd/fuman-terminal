const { readSnapshot } = require("../lib/supabase-snapshots");

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

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const snapshot = await readSnapshot("cb_detect_latest", { allowLatestFallback: true, timeoutMs: 5000 });
    if (!snapshot?.payload) {
      response.status(404).json(apiOnlyError("cb_detect_snapshot_missing"));
      return;
    }
    response.status(200).json({
      ...snapshot.payload,
      ok: snapshot.payload.ok !== false,
      complete: snapshot.payload.complete !== false,
      qualityStatus: snapshot.payload.qualityStatus || "complete",
      count: Number(snapshot.payload.count || snapshot.payload.rows?.length || 0),
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
