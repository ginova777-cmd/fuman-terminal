const fs = require("fs");
const path = require("path");
const { ROOT, dataPath, dataOutputPaths } = require("./runtime-paths");

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function qualityMultiplier(item, fallback = 1) {
  if (!item || Number(item.count || 0) < 5) return fallback;
  const winRate = Number(item.winRate || 0);
  if (!Number.isFinite(winRate) || winRate <= 0) return fallback;
  if (winRate >= 62) return 1.1;
  if (winRate >= 56) return 1.05;
  if (winRate <= 40) return 0.9;
  if (winRate <= 46) return 0.95;
  return 1;
}

function main() {
  const signal = readJson(dataPath("signal-quality-report.json")) || readJson(path.join(ROOT, "data", "signal-quality-report.json")) || {};
  const consistency = readJson(dataPath("data-consistency-report.json")) || readJson(path.join(ROOT, "data", "data-consistency-report.json")) || {};
  const dataQuality = readJson(dataPath("data-quality-report.json")) || readJson(path.join(ROOT, "data", "data-quality-report.json")) || {};
  const strategy2 = signal.strategies?.strategy2 || {};
  const radar = signal.strategies?.realtimeRadar || {};
  const strategy4 = consistency.strategy4 || {};
  const highIssues = Number(dataQuality.high || 0);
  const qualityPenalty = highIssues > 0 ? 0.96 : 1;
  const payload = {
    ok: signal.ok !== false && consistency.ok !== false,
    updatedAt: new Date().toISOString(),
    generatedBy: "generate-strategy-weight-report",
    basis: {
      signalUpdatedAt: signal.updatedAt || "",
      consistencyUpdatedAt: consistency.updatedAt || "",
      dataQualityUpdatedAt: dataQuality.updatedAt || "",
      highIssues,
    },
    weights: {
      strategy2Multiplier: clamp(qualityMultiplier(strategy2) * qualityPenalty, 0.88, 1.12),
      radarMultiplier: clamp(qualityMultiplier(radar) * qualityPenalty, 0.88, 1.12),
      strategy4Multiplier: clamp((strategy4.complete === false ? 0.95 : 1) * qualityPenalty, 0.88, 1.12),
    },
  };
  for (const out of dataOutputPaths("strategy-weight-report.json", { repoEnv: "FUMAN_REPORT_WRITE_CODE_REPO" })) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
  console.log(`strategy weight report wrote ok=${payload.ok} weights=${JSON.stringify(payload.weights)}`);
}

main();
