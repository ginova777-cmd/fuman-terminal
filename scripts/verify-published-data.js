const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");

const runtimeDir = process.env.FUMAN_DATA_DIR || "C:\\fuman-runtime\\data";
const syncDir = process.env.FUMAN_SYNC_DATA_DIR || "C:\\fuman-terminal-sync\\data";
const baseUrl = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

const criticalFiles = [
  "strategy3-latest.json",
  "strategy4-latest.json",
  "strategy4-summary.json",
  "strategy4-slim.json",
  "health-summary.json",
  "signal-quality-report.json",
  "data-consistency-report.json",
  "strategy-weight-report.json",
];

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function count(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload.matches)) return payload.matches.length;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  if (Array.isArray(payload.stocks)) return payload.stocks.length;
  return Number(payload.count || payload.stockCount || 0);
}

function todayYmd() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}${get("month")}${get("day")}`;
}

function normalizeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function fetchJson(pathname, timeoutMs = 60000) {
  const url = `${baseUrl}${pathname}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`${pathname} HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(new Error(`${pathname} invalid JSON: ${error.message}`)); }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validatePayload(name, payload) {
  const today = todayYmd();
  if (name === "strategy3-latest.json") {
    assert(normalizeDate(payload.usedDate) === today, `${name} stale usedDate=${payload.usedDate} today=${today}`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "strategy4-latest.json") {
    assert(normalizeDate(payload.scanStamp || payload.dataDate || payload.updatedAt) === today, `${name} stale scanStamp=${payload.scanStamp || payload.dataDate || payload.updatedAt} today=${today}`);
    assert(payload.complete === true, `${name} incomplete`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "strategy4-summary.json") {
    assert(normalizeDate(payload.scanStamp || payload.dataDate || payload.updatedAt) === today, `${name} stale scanStamp=${payload.scanStamp || payload.dataDate || payload.updatedAt} today=${today}`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "health-summary.json") assert(payload.ok === true, `${name} ok=false risk=${payload.risk}`);
  if (name === "signal-quality-report.json") assert(payload.ok === true, `${name} ok=false`);
  if (name === "data-consistency-report.json") assert(payload.ok === true, `${name} ok=false`);
  if (name === "strategy-weight-report.json") assert(payload.weights && Number.isFinite(Number(payload.weights.strategy2Multiplier)), `${name} missing weights`);
}

async function main() {
  const issues = [];
  for (const name of criticalFiles) {
    const runtimeFile = path.join(runtimeDir, name);
    const syncFile = path.join(syncDir, name);
    try {
      assert(fs.existsSync(runtimeFile), `${name} missing runtime file`);
      assert(fs.existsSync(syncFile), `${name} missing sync file`);
      const runtimeHash = sha(runtimeFile);
      const syncHash = sha(syncFile);
      assert(runtimeHash === syncHash, `${name} runtime/sync hash mismatch runtime=${runtimeHash.slice(0, 12)} sync=${syncHash.slice(0, 12)}`);
      const localPayload = readJson(syncFile);
      validatePayload(name, localPayload);
      const remotePayload = await fetchJson(`/data/${name}?verify-published=${Date.now()}`);
      validatePayload(name, remotePayload);
      assert(count(remotePayload) === count(localPayload), `${name} remote/local count mismatch remote=${count(remotePayload)} local=${count(localPayload)}`);
      console.log(`[published] ${name} ok count=${count(localPayload)} hash=${syncHash.slice(0, 12)}`);
    } catch (error) {
      issues.push(error.message);
    }
  }
  if (issues.length) {
    console.error("[published] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log("[published] all critical data ok");
}

main().catch((error) => {
  console.error(`[published] failed: ${error.message}`);
  process.exit(1);
});

