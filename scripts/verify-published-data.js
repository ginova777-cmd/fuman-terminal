const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { isTwseTradingDay } = require("./twse-trading-day");

const runtimeDir = process.env.FUMAN_DATA_DIR || "C:\\fuman-runtime\\data";
const syncDir = process.env.FUMAN_SYNC_DATA_DIR || "C:\\fuman-terminal-sync\\data";
const syncRepo = process.env.FUMAN_SYNC_REPO || path.dirname(syncDir);
const gitExe = process.env.FUMAN_GIT_EXE || "C:\\Program Files\\Git\\cmd\\git.exe";
const baseUrl = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

const criticalFiles = [
  "market-summary.json",
  "data-status-index.json",
  "terminal-home-bundle.json",
  "stocks-index.json",
  "stocks-slim.json",
  "stocks-quotes-slim.json",
  "stocks-quotes-mobile-top.json",
  "open-buy-latest.json",
  "strategy2-intraday-latest.json",
  "strategy3-latest.json",
  "strategy4-latest.json",
  "strategy4-summary.json",
  "strategy4-slim.json",
  "strategy4-score-top.json",
  "strategy4-zone-a.json",
  "strategy4-zone-b-page-1.json",
  "strategy5-latest.json",
  "institution-latest.json",
  "institution-slim.json",
  "institution-mobile-top.json",
  "cb-detect-latest.json",
  "warrant-flow-latest.json",
  "warrant-flow-slim.json",
  "warrant-flow-mobile-top.json",
  "realtime-radar-latest.json",
  "health-summary.json",
  "signal-quality-report.json",
  "data-quality-report.json",
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

function taipeiDateFromOffset(offsetDays = 0) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const taipeiMs = utcMs + 8 * 60 * 60000;
  const date = new Date(taipeiMs);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

function taipeiClock() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  const hour = get("hour");
  return { hour: hour === 24 ? 0 : hour, minute: get("minute") };
}

async function latestTradingYmd() {
  const todayTrading = await isTwseTradingDay(taipeiDateFromOffset(0), { stateDir: process.env.FUMAN_STATE_DIR || "C:\\fuman-runtime\\state" });
  const clock = taipeiClock();
  const afterMarketDataReady = clock.hour > 14 || (clock.hour === 14 && clock.minute >= 30);
  const startOffset = todayTrading.isTradingDay && !afterMarketDataReady ? -1 : 0;
  for (let offset = startOffset; offset >= -14; offset -= 1) {
    const probe = taipeiDateFromOffset(offset);
    const tradingDay = await isTwseTradingDay(probe, { stateDir: process.env.FUMAN_STATE_DIR || "C:\\fuman-runtime\\state" });
    if (tradingDay.isTradingDay) return normalizeDate(tradingDay.date);
  }
  return todayYmd();
}

function normalizeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function isNotOlderThanLatestTradeDate(value, latestTradeDate) {
  const ymd = normalizeDate(value);
  return ymd && ymd >= latestTradeDate;
}

function fetchJson(pathname, timeoutMs = 60000) {
  const sep = pathname.includes("?") ? "&" : "?";
  const url = `${baseUrl}${pathname}${sep}verify-published=${Date.now()}`;
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

function git(args) {
  return spawnSync(gitExe, args, { cwd: syncRepo, encoding: "utf8" });
}

function verifyGitState() {
  const lockPath = path.join(syncRepo, ".git", "index.lock");
  assert(!fs.existsSync(lockPath), `sync repo has stale git index.lock: ${lockPath}`);

  const status = git(["status", "-sb"]);
  assert(status.status === 0, `git status failed: ${(status.stderr || status.stdout).trim()}`);
  const lines = String(status.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  assert(lines.length === 1 && lines[0] === "## main...origin/main", `sync repo not clean/even with origin: ${lines.join(" | ") || "(empty status)"}`);

  const head = git(["rev-parse", "HEAD"]);
  const origin = git(["rev-parse", "origin/main"]);
  assert(head.status === 0, `git rev-parse HEAD failed: ${(head.stderr || head.stdout).trim()}`);
  assert(origin.status === 0, `git rev-parse origin/main failed: ${(origin.stderr || origin.stdout).trim()}`);
  const headSha = String(head.stdout || "").trim();
  const originSha = String(origin.stdout || "").trim();
  assert(headSha && originSha && headSha === originSha, `sync repo HEAD != origin/main head=${headSha} origin=${originSha}`);
  console.log(`[published] git ok ${headSha.slice(0, 12)}`);
}

function assertDateIsLatest(name, label, value, context) {
  const ymd = normalizeDate(value);
  if (!ymd) return;
  assert(ymd === context.latestTradeDate, `${name} stale ${label}=${value} latestTradeDate=${context.latestTradeDate} today=${context.today}`);
}

function validateMarketSummary(name, payload, context) {
  assert(payload.ok === true, `${name} ok=false`);
  assert(normalizeDate(payload.today) === context.today, `${name} today=${payload.today} expected=${context.today}`);
  assert(normalizeDate(payload.resolvedTradeDate) === context.today, `${name} resolvedTradeDate=${payload.resolvedTradeDate} today=${context.today}`);
  assert(payload.isFallbackDate === false, `${name} isFallbackDate=${payload.isFallbackDate}`);
  assert(normalizeDate(payload.marketDates?.twse) === context.today, `${name} marketDates.twse=${payload.marketDates?.twse} today=${context.today}`);
  assert(normalizeDate(payload.marketDates?.tpex) === context.today, `${name} marketDates.tpex=${payload.marketDates?.tpex} today=${context.today}`);
  assert(count(payload) > 0, `${name} empty stocks`);
}

function validateDataStatusIndex(name, payload, context) {
  assert(payload.ok === true, `${name} ok=false`);
  const entries = payload.entries || {};
  for (const required of ["market-summary.json", "stocks-index.json", "strategy4-summary.json", "institution-slim.json"]) {
    assert(entries[required], `${name} missing ${required}`);
  }
  validateMarketSummaryEntry(name, entries["market-summary.json"], context);
  Object.entries(entries).forEach(([file, entry]) => {
    assert(entry.ok !== false, `${name} ${file} ok=false`);
    if (entry.status === "retired_intraday_snapshot") return;
    if (entry.date) assertDateIsLatest(name, `${file}.date`, entry.date, context);
  });
}

function validateMarketSummaryEntry(name, entry, context) {
  assert(entry, `${name} missing market-summary entry`);
  assert(normalizeDate(entry.date) === context.today, `${name} market-summary date=${entry.date} today=${context.today}`);
  assert(entry.ok !== false, `${name} market-summary ok=false`);
}

function validateTerminalHomeBundle(name, payload, context) {
  assert(payload.ok === true, `${name} ok=false`);
  validateDataStatusIndex(`${name}.status`, payload.status || {}, context);
  assert(normalizeDate(payload.stocks?.resolvedTradeDate) === context.today, `${name} stocks.resolvedTradeDate=${payload.stocks?.resolvedTradeDate} today=${context.today}`);
  assert(Number(payload.stocks?.count || 0) > 1000, `${name} stocks count too low`);
}

function validatePayload(name, payload, context) {
  const today = context.today;
  const latestTradeDate = context.latestTradeDate;
  if (name === "market-summary.json") validateMarketSummary(name, payload, context);
  if (name === "data-status-index.json") validateDataStatusIndex(name, payload, context);
  if (name === "terminal-home-bundle.json") validateTerminalHomeBundle(name, payload, context);
  if (name === "stocks-index.json" || name === "stocks-slim.json" || name === "stocks-quotes-slim.json" || name === "stocks-quotes-mobile-top.json") {
    assert(normalizeDate(payload.resolvedTradeDate || payload.date) === latestTradeDate, `${name} stale resolvedTradeDate=${payload.resolvedTradeDate || payload.date} latestTradeDate=${latestTradeDate}`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "open-buy-latest.json") {
    assertDateIsLatest(name, "date", payload.usedDate || payload.date, context);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "strategy2-intraday-latest.json") {
    assert(normalizeDate(payload.date || payload.updatedAt) === latestTradeDate || payload.status === "retired_intraday_snapshot", `${name} stale date=${payload.date} latestTradeDate=${latestTradeDate}`);
  }
  if (name === "strategy3-latest.json") {
    assert(normalizeDate(payload.usedDate) === latestTradeDate, `${name} stale usedDate=${payload.usedDate} latestTradeDate=${latestTradeDate} today=${today}`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "strategy4-latest.json") {
    assert(isNotOlderThanLatestTradeDate(payload.scanStamp || payload.dataDate || payload.updatedAt, latestTradeDate), `${name} stale scanStamp=${payload.scanStamp || payload.dataDate || payload.updatedAt} latestTradeDate=${latestTradeDate} today=${today}`);
    assert(payload.complete === true, `${name} incomplete`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "strategy4-summary.json") {
    assert(isNotOlderThanLatestTradeDate(payload.scanStamp || payload.dataDate || payload.updatedAt, latestTradeDate), `${name} stale scanStamp=${payload.scanStamp || payload.dataDate || payload.updatedAt} latestTradeDate=${latestTradeDate} today=${today}`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name.startsWith("strategy4-") && name !== "strategy4-latest.json" && name !== "strategy4-summary.json") {
    assert(isNotOlderThanLatestTradeDate(payload.scanStamp || payload.dataDate || payload.updatedAt, latestTradeDate), `${name} stale scanStamp=${payload.scanStamp || payload.dataDate || payload.updatedAt} latestTradeDate=${latestTradeDate}`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "strategy5-latest.json") {
    assertDateIsLatest(name, "date", payload.usedDate || payload.date || payload.dataDate, context);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "institution-latest.json" || name === "institution-slim.json" || name === "institution-mobile-top.json") {
    assertDateIsLatest(name, "date", payload.usedDate || payload.date || payload.dataDate, context);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "cb-detect-latest.json") {
    assert(payload.ok !== false, `${name} ok=false`);
    assert(isNotOlderThanLatestTradeDate(payload.updatedAt, latestTradeDate), `${name} stale updatedAt=${payload.updatedAt} latestTradeDate=${latestTradeDate}`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "warrant-flow-latest.json" || name === "warrant-flow-slim.json" || name === "warrant-flow-mobile-top.json") {
    assert(payload.ok !== false, `${name} ok=false`);
    assert(count(payload) > 0, `${name} empty`);
  }
  if (name === "realtime-radar-latest.json") {
    assert(payload.ok !== false, `${name} ok=false`);
    assert(normalizeDate(payload.date || payload.updatedAt) === latestTradeDate || payload.status === "retired_intraday_snapshot", `${name} stale date=${payload.date} latestTradeDate=${latestTradeDate}`);
  }
  if (name === "health-summary.json") assert(payload.ok === true, `${name} ok=false risk=${payload.risk}`);
  if (name === "signal-quality-report.json") assert(payload.ok === true, `${name} ok=false`);
  if (name === "data-quality-report.json") assert(payload.ok === true, `${name} ok=false`);
  if (name === "data-consistency-report.json") assert(payload.ok === true, `${name} ok=false`);
  if (name === "strategy-weight-report.json") assert(payload.weights && Number.isFinite(Number(payload.weights.strategy2Multiplier)), `${name} missing weights`);
}

async function main() {
  const issues = [];
  const context = { today: todayYmd(), latestTradeDate: await latestTradingYmd() };
  try {
    verifyGitState();
  } catch (error) {
    issues.push(error.message);
  }
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
      validatePayload(name, localPayload, context);
      const remotePayload = await fetchJson(`/data/${name}`);
      validatePayload(name, remotePayload, context);
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

