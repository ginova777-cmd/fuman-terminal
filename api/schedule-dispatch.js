module.exports = async function handler(req, res) {
  res.statusCode = 410;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({
    ok: false,
    retired: true,
    error: "schedule_dispatch_retired",
    message: "GitHub workflow dispatch is retired. Use desktop route snapshots and local scanners instead.",
    updatedAt: new Date().toISOString(),
  }));
};
