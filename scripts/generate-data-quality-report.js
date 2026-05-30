const fs = require("fs");
const path = require("path");
const { ROOT, dataPath } = require("./runtime-paths");

const FILES = [
  "market-summary.json",
  "strategy2-intraday-latest.json",
  "realtime-radar-latest.json",
  "strategy4-latest.json",
  "strategy4-summary.json",
  "strategy4-slim.json",
  "institution-latest.json",
  "warrant-flow-latest.json",
];

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function rowsOf(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.stocks)) return payload.stocks;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (payload.data && typeof payload.data === "object") return Object.values(payload.data);
  return [];
}

function inspect(file) {
  const candidates = [dataPath(file), path.join(ROOT, "data", file)];
  const target = candidates.find((item) => fs.existsSync(item));
  if (!target) return { file, ok: false, issues: [{ level: "high", message: "missing" }] };
  let payload;
  try {
    payload = readJson(target);
  } catch (error) {
    return { file, ok: false, bytes: fs.statSync(target).size, issues: [{ level: "high", message: "invalid json" }] };
  }
  const rows = rowsOf(payload);
  const issues = [];
  const dated = payload.updatedAt || payload.scanStamp || payload.usedDate || "";
  const zeroClose = rows.filter((row) => "close" in row && cleanNumber(row.close) <= 0).length;
  const extremePct = rows.filter((row) => Math.abs(cleanNumber(row.percent ?? row.pct ?? row.stockPercent)) > 20).length;
  const requiresCode = !["market-summary.json"].includes(file);
  const missingCode = requiresCode ? rows.filter((row) => !String(row.code || row.underlyingCode || "").trim()).length : 0;
  if (!dated) issues.push({ level: "medium", message: "missing updatedAt/scan date" });
  if (rows.length && zeroClose / rows.length > 0.15) issues.push({ level: "medium", message: `zero close ratio high ${zeroClose}/${rows.length}` });
  if (extremePct) issues.push({ level: "medium", message: `extreme percent rows ${extremePct}` });
  if (missingCode) issues.push({ level: "high", message: `missing code rows ${missingCode}` });
  return {
    file,
    ok: !issues.some((item) => item.level === "high"),
    bytes: fs.statSync(target).size,
    count: Number(payload.count || rows.length || 0),
    updatedAt: dated,
    issues,
  };
}

function main() {
  const files = FILES.map(inspect);
  const report = {
    ok: files.every((item) => item.ok),
    updatedAt: new Date().toISOString(),
    files,
    highIssues: files.flatMap((item) => item.issues.filter((issue) => issue.level === "high").map((issue) => ({ file: item.file, ...issue }))),
    mediumIssues: files.flatMap((item) => item.issues.filter((issue) => issue.level === "medium").map((issue) => ({ file: item.file, ...issue }))),
  };
  for (const root of [ROOT, process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime"]) {
    const out = path.join(root, "data", "data-quality-report.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(`data quality report wrote ok=${report.ok} high=${report.highIssues.length} medium=${report.mediumIssues.length}`);
}

main();
