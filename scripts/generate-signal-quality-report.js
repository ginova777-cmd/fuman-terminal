const fs = require("fs");
const path = require("path");
const { ROOT, dataPath } = require("./runtime-paths");

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function firstJson(files, fallback = null) {
  for (const file of files) {
    const value = readJson(file, null);
    if (value) return value;
  }
  return fallback;
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function summarizeRows(rows = [], valueKeys = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { count: 0, avg: 0, winRate: 0, best: 0, worst: 0 };
  const values = list.map((row) => {
    for (const key of valueKeys) {
      const n = cleanNumber(row?.[key]);
      if (Number.isFinite(n) && n !== 0) return n;
    }
    return 0;
  });
  const wins = values.filter((value) => value > 0).length;
  return {
    count: list.length,
    avg: values.reduce((sum, value) => sum + value, 0) / list.length,
    winRate: (wins / list.length) * 100,
    best: Math.max(...values),
    worst: Math.min(...values),
  };
}

function strategy2Quality() {
  const latest = firstJson([
    dataPath("strategy2-intraday-latest.json"),
    path.join(ROOT, "data", "strategy2-intraday-latest.json"),
  ], {});
  const events = Array.isArray(latest.events) ? latest.events : Array.isArray(latest.matches) ? latest.matches : [];
  const reportDir = path.join(process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime", "reports");
  const reports = fs.existsSync(reportDir)
    ? fs.readdirSync(reportDir).filter((name) => /^backtest-strategy2-manager-radar-\d{8}\.json$/.test(name)).sort().slice(-5)
    : [];
  const backtests = reports.map((name) => readJson(path.join(reportDir, name), {}));
  const managerRows = backtests.flatMap((item) => Array.isArray(item?.manager?.trades) ? item.manager.trades : []);
  return {
    latestSignals: events.length,
    latestGo: events.filter((item) => /go|進場/i.test(String(item.state || item.status || item.zone || ""))).length,
    backtest: summarizeRows(managerRows, ["returnPct", "pnlPct", "profitPct"]),
    reports,
  };
}

function realtimeRadarQuality() {
  const latest = firstJson([
    dataPath("realtime-radar-latest.json"),
    path.join(ROOT, "data", "realtime-radar-latest.json"),
  ], {});
  const rows = Array.isArray(latest.rows) ? latest.rows : [];
  const scorecard = firstJson([
    dataPath("realtime-radar-scorecard-latest.json"),
    path.join(ROOT, "data", "realtime-radar-scorecard-latest.json"),
  ], {});
  const scoreRows = Array.isArray(scorecard.rows) ? scorecard.rows : [];
  return {
    latestSignals: rows.length,
    longSignals: rows.filter((item) => item.side === "long").length,
    shortSignals: rows.filter((item) => item.side === "short").length,
    scorecard: summarizeRows(scoreRows, ["returnPct", "pnlPct", "profitPct", "profit"]),
    updatedAt: latest.updatedAt || "",
  };
}

function strategy4Quality() {
  const payload = firstJson([
    dataPath("strategy4-latest.json"),
    path.join(ROOT, "data", "strategy4-latest.json"),
  ], {});
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const zoneCounts = { A: 0, B: 0, C: 0 };
  for (const item of matches) zoneCounts[item.swingZone || "A"] = (zoneCounts[item.swingZone || "A"] || 0) + 1;
  return {
    total: cleanNumber(payload.total),
    count: cleanNumber(payload.count || matches.length),
    complete: Boolean(payload.complete),
    zoneCounts,
    avgScore: matches.length ? matches.reduce((sum, item) => sum + cleanNumber(item.swingScore || item.score), 0) / matches.length : 0,
    updatedAt: payload.updatedAt || "",
  };
}

function main() {
  const report = {
    ok: true,
    updatedAt: new Date().toISOString(),
    strategy2: strategy2Quality(),
    realtimeRadar: realtimeRadarQuality(),
    strategy4: strategy4Quality(),
  };
  for (const root of [ROOT, process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime"]) {
    const out = path.join(root, "data", "signal-quality-report.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(`signal quality report wrote strategy2=${report.strategy2.latestSignals} radar=${report.realtimeRadar.latestSignals} strategy4=${report.strategy4.count}`);
}

main();
