const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LIVE = process.argv.includes("--live") || process.env.FUMAN_WARRANT_FRESHNESS_LIVE === "1";
const LOCAL_DATA_DIR = process.env.FUMAN_VERIFY_DATA_DIR || path.join(ROOT, "data");

const FILES = {
  latest: "data/warrant-flow-latest.json",
  slim: "data/warrant-flow-slim.json",
  priority: "data/warrant-priority-top.json",
  mobile: "data/warrant-flow-mobile-top.json",
};

function fetchText(pathname, timeoutMs = 20000) {
  const url = `${BASE_URL}/${pathname}?v=warrant-freshness-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${pathname} HTTP ${res.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("timeout", () => req.destroy(new Error(`${pathname} timeout`)));
    req.on("error", reject);
  });
}

async function readJson(rel) {
  if (LIVE) return JSON.parse(await fetchText(rel));
  return JSON.parse(fs.readFileSync(path.join(LOCAL_DATA_DIR, rel.replace(/^data[\\/]/, "")), "utf8"));
}

function rows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (payload.data && typeof payload.data === "object") return Object.values(payload.data);
  return [];
}

function volumeRows(payload) {
  return Array.isArray(payload?.volumeMatches) ? payload.volumeMatches : [];
}

function count(payload) {
  if (!payload) return 0;
  if (Number.isFinite(Number(payload.count))) return Number(payload.count);
  return rows(payload).length;
}

function volumeCount(payload) {
  if (!payload) return 0;
  if (Number.isFinite(Number(payload.volumeCount))) return Number(payload.volumeCount);
  return volumeRows(payload).length;
}

function assertOk(condition, message, issues) {
  if (!condition) issues.push(message);
}

async function main() {
  const payloads = {};
  for (const [key, file] of Object.entries(FILES)) payloads[key] = await readJson(file);

  const issues = [];
  const latestRows = rows(payloads.latest);
  const slimRows = rows(payloads.slim);
  const priorityRows = rows(payloads.priority);
  const mobileRows = rows(payloads.mobile);
  const latestVolumeRows = volumeRows(payloads.latest);
  const slimVolumeRows = volumeRows(payloads.slim);

  assertOk(payloads.latest?.ok !== false, "warrant-flow-latest ok=false", issues);
  assertOk(payloads.slim?.ok !== false, "warrant-flow-slim ok=false", issues);
  assertOk(count(payloads.latest) >= 50, `warrant-flow-latest matches too small count=${count(payloads.latest)}`, issues);
  assertOk(count(payloads.slim) >= 50, `warrant-flow-slim matches too small count=${count(payloads.slim)}`, issues);
  assertOk(priorityRows.length >= 50, `warrant-priority-top too small rows=${priorityRows.length}`, issues);
  assertOk(mobileRows.length >= 20, `warrant-flow-mobile-top too small rows=${mobileRows.length}`, issues);
  assertOk(volumeCount(payloads.latest) >= 50, `warrant-flow-latest volumeMatches too small count=${volumeCount(payloads.latest)}`, issues);
  assertOk(volumeCount(payloads.slim) === volumeCount(payloads.latest), `warrant-flow-slim volumeCount mismatch slim=${volumeCount(payloads.slim)} latest=${volumeCount(payloads.latest)}`, issues);
  assertOk(slimVolumeRows.length === volumeCount(payloads.slim), `warrant-flow-slim volumeMatches length mismatch rows=${slimVolumeRows.length} count=${volumeCount(payloads.slim)}`, issues);

  const latestFirst = latestRows[0];
  const slimFirst = slimRows[0];
  const priorityFirst = priorityRows[0];
  if (latestFirst && slimFirst) {
    assertOk(String(latestFirst.code || latestFirst.underlyingCode || "") === String(slimFirst.code || slimFirst.underlyingCode || ""), "warrant-flow latest/slim first code mismatch", issues);
  }
  if (latestFirst && priorityFirst) {
    assertOk(String(latestFirst.code || latestFirst.underlyingCode || "") === String(priorityFirst.code || priorityFirst.underlyingCode || ""), "warrant priority first code mismatch", issues);
  }

  for (const row of slimVolumeRows.slice(0, 20)) {
    const code = String(row.code || row.underlyingCode || "").trim();
    assertOk(Boolean(code), "warrant volume row missing code", issues);
    assertOk(Number(row.thirtyMinuteVolume || 0) > 0, `warrant volume ${code} thirtyMinuteVolume missing`, issues);
    assertOk(Number(row.floatingUnits || 0) > 0, `warrant volume ${code} floatingUnits missing`, issues);
    assertOk(Number(row.volumeMultiple || 0) > 0, `warrant volume ${code} volumeMultiple missing`, issues);
  }

  if (issues.length) {
    console.error(`[warrant-freshness] failed ${LIVE ? "live" : "local"}`);
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  console.log(`[warrant-freshness] ok ${LIVE ? "live" : "local"} matches=${count(payloads.slim)} volume=${volumeCount(payloads.slim)} updatedAt=${payloads.slim?.updatedAt || "--"}`);
}

main().catch((error) => {
  console.error(`[warrant-freshness] error ${error.message}`);
  process.exit(1);
});
