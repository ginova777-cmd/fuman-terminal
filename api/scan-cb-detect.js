const { main } = require("../scripts/generate-cb-detect");

function bearerToken(request) {
  const header = String(request.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function authorized(request) {
  const secret = process.env.CRON_SECRET
    || process.env.FUMAN_CRON_SECRET
    || process.env.SCHEDULE_DISPATCH_SECRET
    || process.env.SCHEDULE_SECRET
    || "";
  if (!secret) return true;
  const provided = String(
    request.query?.secret
    || request.headers?.["x-schedule-secret"]
    || bearerToken(request)
    || ""
  );
  return provided === secret || request.headers?.["x-vercel-cron"] === "1";
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  if (!authorized(request)) {
    response.status(401).json({ ok: false, error: "unauthorized_cb_detect_scan" });
    return;
  }

  try {
    const result = await main();
    response.status(200).json({
      ok: true,
      source: "cb-detect-scanner-api",
      ...result,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: "cb_detect_scan_failed",
      reason: error?.message || String(error),
      updatedAt: new Date().toISOString(),
    });
  }
};

