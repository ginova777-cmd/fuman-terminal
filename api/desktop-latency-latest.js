const { readSnapshot } = require("../lib/supabase-snapshots");

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const snapshot = await readSnapshot("desktop_route_latency_latest", {
    allowLatestFallback: true,
    timeoutMs: 2500,
  });
  const payload = snapshot?.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  const result = {
    ok: Boolean(payload),
    source: "desktop-latency-latest",
    updatedAt: snapshot?.updatedAt || payload?.receivedAt || "",
    summary: payload?.summary || null,
    rows: Array.isArray(payload?.rows) ? payload.rows.slice(-50) : [],
  };

  if (request.method === "HEAD") {
    response.status(result.ok ? 200 : 404).end("");
    return;
  }
  response.status(result.ok ? 200 : 404).json(result);
};
