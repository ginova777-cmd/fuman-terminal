const fs = require("fs");
const path = require("path");
const { upsertSnapshot } = require("../lib/supabase-snapshots");

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRow(row) {
  return {
    at: new Date(cleanNumber(row.at, Date.now())).toISOString(),
    url: String(row.url || row.view || row.key || "unknown").slice(0, 140),
    route: String(row.key || row.route || "").slice(0, 80),
    source: String(row.source || "").slice(0, 80),
    stage: String(row.stage || "").slice(0, 24),
    ms: Math.max(0, Math.round(cleanNumber(row.ms, Math.max(cleanNumber(row.nav), cleanNumber(row.shell), cleanNumber(row.api))))),
    nav: Math.max(0, Math.round(cleanNumber(row.nav))),
    shell: Math.max(0, Math.round(cleanNumber(row.shell))),
    api: Math.max(0, Math.round(cleanNumber(row.api))),
    ok: row.ok !== false,
    viewport: String(row.viewport || "").slice(0, 32),
    mobilePerf: Boolean(row.mobilePerf),
    error: String(row.error || "").slice(0, 100),
  };
}

function normalizeRouteMetric(metric) {
  return {
    avg: Math.max(0, Math.round(cleanNumber(metric?.avg))),
    p95: Math.max(0, Math.round(cleanNumber(metric?.p95))),
    max: Math.max(0, Math.round(cleanNumber(metric?.max))),
  };
}

function normalizeSummary(summary) {
  const routes = Array.isArray(summary?.routes) ? summary.routes.slice(0, 20).map((route) => ({
    key: String(route?.key || "").slice(0, 80),
    count: Math.max(0, Math.round(cleanNumber(route?.count))),
    focus: String(route?.focus || "").slice(0, 12),
    nav: normalizeRouteMetric(route?.nav),
    shell: normalizeRouteMetric(route?.shell),
    api: normalizeRouteMetric(route?.api),
    worst: Math.max(0, Math.round(cleanNumber(route?.worst))),
    lastAt: cleanNumber(route?.lastAt),
  })) : [];
  return {
    count: Math.max(0, Math.round(cleanNumber(summary?.count))),
    focus: String(summary?.focus || "").slice(0, 12),
    maxNav: Math.max(0, Math.round(cleanNumber(summary?.maxNav))),
    maxShell: Math.max(0, Math.round(cleanNumber(summary?.maxShell))),
    maxApi: Math.max(0, Math.round(cleanNumber(summary?.maxApi))),
    firstFix: String(summary?.firstFix || "").slice(0, 160),
    routes,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const rows = Array.isArray(body.rows) ? body.rows : [body];
    const items = rows.slice(-40).map(normalizeRow);
    const payload = {
      receivedAt: new Date().toISOString(),
      source: String(body.source || "").slice(0, 80),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 180),
      summary: normalizeSummary(body.summary || {}),
      rows: items,
    };
    const dir = process.env.FUMAN_PERFORMANCE_REPORT_DIR || path.join(process.cwd(), ".performance-reports");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "performance-reports.jsonl"), `${JSON.stringify(payload)}\n`, "utf8");
    if (payload.source === "desktop-route-latency") {
      await upsertSnapshot("desktop_route_latency_latest", payload, {
        source: "performance-report",
        reason: "desktop-route-latency",
        timeoutMs: 4000,
      }).catch(() => undefined);
    }
    res.status(200).json({ ok: true, count: items.length });
  } catch (error) {
    res.status(200).json({ ok: false });
  }
};
