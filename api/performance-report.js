const fs = require("fs");
const path = require("path");

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRow(row) {
  return {
    at: new Date(cleanNumber(row.at, Date.now())).toISOString(),
    url: String(row.url || row.view || "unknown").slice(0, 140),
    ms: Math.max(0, Math.round(cleanNumber(row.ms))),
    ok: row.ok !== false,
    viewport: String(row.viewport || "").slice(0, 32),
    mobilePerf: Boolean(row.mobilePerf),
    error: String(row.error || "").slice(0, 100),
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
      userAgent: String(req.headers["user-agent"] || "").slice(0, 180),
      rows: items,
    };
    const dir = process.env.FUMAN_PERFORMANCE_REPORT_DIR || path.join(process.cwd(), ".performance-reports");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "performance-reports.jsonl"), `${JSON.stringify(payload)}\n`, "utf8");
    res.status(200).json({ ok: true, count: items.length });
  } catch (error) {
    res.status(200).json({ ok: false });
  }
};
