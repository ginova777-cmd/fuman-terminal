const fs = require("fs");
const path = require("path");
const { readSnapshot } = require("../lib/supabase-snapshots");

const SNAPSHOT_KEY = process.env.FUMAN_SCORECARD_SNAPSHOT_KEY || "scorecard_latest";
const SNAPSHOT_FILE = path.join(process.cwd(), "data", "scorecard-latest.json");

function readStaticSnapshot(reason = "scorecard_static_snapshot") {
  const raw = fs.readFileSync(SNAPSHOT_FILE, "utf8");
  const payload = JSON.parse(raw);
  return {
    ok: payload.ok !== false,
    ...payload,
    cacheSource: payload.cacheSource || "json-snapshot",
    fallbackReason: reason,
  };
}

async function buildPayload() {
  const snapshot = await readSnapshot(SNAPSHOT_KEY, { allowLatestFallback: true, timeoutMs: 30000 }).catch(() => null);
  if (snapshot?.payload && typeof snapshot.payload === "object") {
    return {
      ok: snapshot.payload.ok !== false,
      ...snapshot.payload,
      source: snapshot.payload.source || "supabase:scorecard_snapshot",
      cacheSource: "supabase-snapshot",
      snapshot: {
        key: snapshot.key || SNAPSHOT_KEY,
        tradeDate: snapshot.tradeDate || "",
        updatedAt: snapshot.updatedAt || "",
        source: snapshot.source || "",
      },
    };
  }
  return readStaticSnapshot("supabase_scorecard_snapshot_missing");
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
  try {
    const payload = await buildPayload();
    if (request.method === "HEAD") response.status(200).end("");
    else response.status(200).json(payload);
  } catch (error) {
    response.status(503).json({ ok: false, error: "scorecard_unavailable", reason: error?.message || String(error), updatedAt: new Date().toISOString() });
  }
};
