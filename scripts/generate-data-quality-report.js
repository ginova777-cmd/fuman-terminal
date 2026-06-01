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
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (payload.data && typeof payload.data === "object") return Object.values(payload.data);
  return [];
}

function strategy2Issues(rows) {
  const issues = [];
  const highPctLowVolume = rows.filter((row) =>
    /^\d{4}$/.test(String(row.code || ""))
    && cleanNumber(row.percent ?? row.pct) >= 8
    && cleanNumber(row.volume ?? row.tradeVolume) > 0
    && cleanNumber(row.volume ?? row.tradeVolume) < 1000
  );
  if (highPctLowVolume.length) {
    issues.push({
      level: "high",
      message: `strategy2 suspicious high-pct low-volume rows ${highPctLowVolume.length}`,
      samples: highPctLowVolume.slice(0, 8).map((row) => ({
        code: String(row.code || ""),
        name: row.name || "",
        timestamp: row.timestamp || row.entryAt || "",
        percent: cleanNumber(row.percent ?? row.pct),
        volume: cleanNumber(row.volume ?? row.tradeVolume),
      })),
    });
  }

  const byCode = new Map();
  for (const row of rows) {
    const code = String(row.code || "");
    const volume = cleanNumber(row.volume ?? row.tradeVolume);
    if (!/^\d{4}$/.test(code) || volume <= 0) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push({ row, volume });
  }
  const suddenShrinks = [];
  for (const [code, items] of byCode) {
    const sorted = items.sort((a, b) => String(a.row.timestamp || a.row.entryAt || "").localeCompare(String(b.row.timestamp || b.row.entryAt || "")));
    let maxSeen = 0;
    for (const item of sorted) {
      if (maxSeen >= 10000 && item.volume > 0 && item.volume <= maxSeen / 100) {
        suddenShrinks.push({
          code,
          name: item.row.name || "",
          timestamp: item.row.timestamp || item.row.entryAt || "",
          previousMaxVolume: Math.round(maxSeen),
          volume: Math.round(item.volume),
        });
        break;
      }
      maxSeen = Math.max(maxSeen, item.volume);
    }
  }
  if (suddenShrinks.length) {
    issues.push({
      level: "high",
      message: `strategy2 suspicious volume unit shrink rows ${suddenShrinks.length}`,
      samples: suddenShrinks.slice(0, 8),
    });
  }
  return issues;
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
  if (file === "strategy2-intraday-latest.json") issues.push(...strategy2Issues(rows));
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
