const fs = require("fs");
const path = require("path");
const { ROOT, dataPath } = require("./runtime-paths");

function readJson(name) {
  const candidates = [dataPath(name), path.join(ROOT, "data", name)];
  const target = candidates.find((file) => fs.existsSync(file));
  if (!target) throw new Error(`${name} missing`);
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function countRows(payload) {
  if (!payload) return 0;
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload.matches)) return payload.matches.length;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  return Number(payload.count || 0);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const strategy4 = readJson("strategy4-latest.json");
  const strategy4Slim = readJson("strategy4-slim.json");
  const zones = ["strategy4-zone-a.json", "strategy4-zone-b.json", "strategy4-zone-c.json"].map(readJson);
  const reports = [
    ["health-summary.json", (p) => typeof p.ok === "boolean"],
    ["signal-quality-report.json", (p) => p.ok === true],
    ["data-quality-report.json", (p) => typeof p.ok === "boolean"],
    ["data-consistency-report.json", (p) => p.ok === true],
    ["strategy-weight-report.json", (p) => p.weights && Number.isFinite(Number(p.weights.strategy2Multiplier))],
    ["performance-report.json", (p) => Array.isArray(p.assets) && p.assets.length > 0],
  ];
  const fullCount = countRows(strategy4);
  const slimCount = countRows(strategy4Slim);
  const zoneCount = zones.reduce((sum, payload) => sum + countRows(payload), 0);
  assert(fullCount > 0, "strategy4-latest is empty");
  assert(slimCount > 0, "strategy4-slim is empty");
  assert(Math.abs(fullCount - slimCount) <= 2, `strategy4 slim mismatch full=${fullCount} slim=${slimCount}`);
  assert(Math.abs(zoneCount - slimCount) <= 2, `strategy4 zone mismatch zones=${zoneCount} slim=${slimCount}`);
  for (const [name, check] of reports) {
    const payload = readJson(name);
    assert(check(payload), `${name} contract failed`);
  }
  console.log(`[contracts] ok strategy4=${fullCount} slim=${slimCount} zones=${zoneCount}`);
}

main();
