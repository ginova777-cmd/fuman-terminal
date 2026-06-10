const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LIVE = process.argv.includes("--live") || process.env.FUMAN_DATA_FRESHNESS_LIVE === "1";
const WRITE_REPORT = process.argv.includes("--write") || process.env.FUMAN_WRITE_FRESHNESS_REPORT === "1";

const TARGETS = [
  { name: "data-manifest", file: "data/data-manifest.json", minCount: 25 },
  { name: "terminal-home-bundle", file: "data/terminal-home-bundle.json" },
  { name: "market-summary", file: "data/market-summary.json" },
  { name: "health-summary", file: "data/health-summary.json" },
  { name: "stocks-index", file: "data/stocks-index.json", minCount: 1000 },
  { name: "strategy3-latest", file: "data/strategy3-latest.json", minCount: 1 },
  { name: "strategy4-latest", file: "data/strategy4-latest.json", minCount: 1 },
  { name: "strategy4-summary", file: "data/strategy4-summary.json", minCount: 1 },
  { name: "strategy5-latest", file: "data/strategy5-latest.json" },
  { name: "warrant-flow-latest", file: "data/warrant-flow-latest.json" },
];

function fetchText(pathname, timeoutMs = 20000) {
  const url = `${BASE_URL}/${pathname}?v=freshness-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function readLocal(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function normalizeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function extractDate(payload) {
  return normalizeDate(payload.scanStamp || payload.dataDate || payload.usedDate || payload.date || payload.updatedAt || payload.generatedAt || payload.asOf);
}

function extractCount(payload) {
  if (Number.isFinite(Number(payload.count))) return Number(payload.count);
  if (Number.isFinite(Number(payload.total))) return Number(payload.total);
  if (Array.isArray(payload.items)) return payload.items.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  if (payload.entries && typeof payload.entries === "object") return Object.keys(payload.entries).length;
  return 0;
}

async function loadTarget(target) {
  if (!LIVE) return JSON.parse(readLocal(target.file));
  const result = await fetchText(target.file);
  if (result.status < 200 || result.status >= 300) throw new Error(`${target.name} HTTP ${result.status}`);
  return JSON.parse(result.body);
}

async function main() {
  const report = {
    ok: true,
    mode: LIVE ? "live" : "local",
    checkedAt: new Date().toISOString(),
    entries: {},
  };
  const issues = [];
  for (const target of TARGETS) {
    try {
      const payload = await loadTarget(target);
      const count = extractCount(payload);
      const date = extractDate(payload);
      const ok = target.minCount ? count >= target.minCount : true;
      report.entries[target.name] = { ok, count, date };
      if (!ok) issues.push(`${target.name}: count ${count} < ${target.minCount}`);
    } catch (error) {
      report.entries[target.name] = { ok: false, error: error.message };
      issues.push(`${target.name}: ${error.message}`);
    }
  }
  report.ok = issues.length === 0;
  const outPath = path.join(ROOT, "data", "data-freshness-report.json");
  if (WRITE_REPORT) fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  if (issues.length) {
    console.error("[data-freshness] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log(`[data-freshness] ok mode=${report.mode} entries=${Object.keys(report.entries).length}`);
}

main().catch((error) => {
  console.error(`[data-freshness] failed: ${error.message}`);
  process.exit(1);
});
