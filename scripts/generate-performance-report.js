const fs = require("fs");
const path = require("path");
const { ROOT, dataPath } = require("./runtime-paths");

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stat(file) {
  const candidates = [dataPath(file), path.join(ROOT, "data", file)];
  const target = candidates.find((item) => fs.existsSync(item));
  if (!target) return { file, ok: false, bytes: 0, updatedAt: "" };
  const payload = readJson(target) || {};
  return {
    file,
    ok: true,
    bytes: fs.statSync(target).size,
    count: Number(payload.count || payload.matches?.length || payload.rows?.length || 0),
    updatedAt: payload.updatedAt || payload.scanStamp || "",
  };
}

function main() {
  const files = [
    "market-summary.json",
    "health-summary.json",
    "strategy4-summary.json",
    "strategy4-slim.json",
    "strategy4-zone-a.json",
    "institution-slim.json",
    "institution-joint-top.json",
    "warrant-flow-slim.json",
    "warrant-priority-top.json",
    "realtime-radar-latest.json",
    "signal-quality-report.json",
    "data-quality-report.json",
    "data-consistency-report.json",
    "strategy-weight-report.json",
  ];
  const payload = {
    ok: true,
    updatedAt: new Date().toISOString(),
    generatedBy: "generate-performance-report",
    assets: files.map(stat),
  };
  payload.totalBytes = payload.assets.reduce((sum, item) => sum + (item.bytes || 0), 0);
  payload.missing = payload.assets.filter((item) => !item.ok).map((item) => item.file);
  payload.ok = payload.missing.length === 0;
  for (const root of [ROOT, process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime"]) {
    const out = path.join(root, "data", "performance-report.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  console.log(`performance report wrote ok=${payload.ok} totalBytes=${payload.totalBytes}`);
}

main();
