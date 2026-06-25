const https = require("https");
const { spawnSync } = require("child_process");
const path = require("path");
const { isTwseTradingDay } = require("./twse-trading-day");

const baseUrl = (process.env.FUMAN_SMOKE_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

function fetchText(pathname, timeoutMs = 20000) {
  const url = `${baseUrl}${pathname}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ url, status: res.statusCode, headers: res.headers, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function postJson(pathname, payload, timeoutMs = 20000) {
  const url = new URL(`${baseUrl}${pathname}`);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: "POST",
      timeout: timeoutMs,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ url: url.toString(), status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
    req.end(body);
  });
}

function assertOk(name, result, check = () => true) {
  if (result.status < 200 || result.status >= 300) throw new Error(`${name} HTTP ${result.status}`);
  if (!check(result)) throw new Error(`${name} content check failed`);
  console.log(`[smoke] ${name} ok ${result.status}`);
}

function parseJson(result) {
  return JSON.parse(result.body);
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

async function latestTradingYmd() {
  for (let offset = 0; offset >= -14; offset -= 1) {
    const tradingDay = await isTwseTradingDay(taipeiDateFromOffset(offset), { stateDir: process.env.FUMAN_STATE_DIR || "C:\\fuman-runtime\\state" });
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

function taipeiMinuteOfDay() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

async function strategy4ExpectedTradeDate(latestTradeDate) {
  if (taipeiMinuteOfDay() >= 15 * 60 + 30) return latestTradeDate;
  for (let offset = -1; offset >= -14; offset -= 1) {
    const tradingDay = await isTwseTradingDay(taipeiDateFromOffset(offset), { stateDir: process.env.FUMAN_STATE_DIR || "C:\\fuman-runtime\\state" });
    if (tradingDay.isTradingDay) return normalizeDate(tradingDay.date);
  }
  return latestTradeDate;
}

async function strategy3ExpectedTradeDate(latestTradeDate) {
  for (let offset = -1; offset >= -14; offset -= 1) {
    const tradingDay = await isTwseTradingDay(taipeiDateFromOffset(offset), { stateDir: process.env.FUMAN_STATE_DIR || "C:\\fuman-runtime\\state" });
    if (tradingDay.isTradingDay) return normalizeDate(tradingDay.date);
  }
  return latestTradeDate;
}

function detectVersion(homeBody) {
  if (process.env.FUMAN_SMOKE_VERSION) return process.env.FUMAN_SMOKE_VERSION;
  const match = homeBody.match(/terminal-core\.js\?v=([^"'&<>]+)/);
  if (!match) throw new Error("Unable to detect frontend version from home HTML");
  return match[1];
}

function verifyVersionConsistency() {
  const script = path.join(__dirname, "verify-version-consistency.js");
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "version consistency failed").trim());
  process.stdout.write(result.stdout);
}

async function main() {
  verifyVersionConsistency();
  const home = await fetchText("/");
  const version = detectVersion(home.body);
  const latestTradeDate = await latestTradingYmd();
  const strategy3TradeDate = await strategy3ExpectedTradeDate(latestTradeDate);
  assertOk("home", home, (r) => r.body.includes(`terminal-core.js?v=${version}`));
  const checks = [
    ["core", `/terminal-core.js?v=${version}`, (r) => r.body.includes("terminal-modules.js")],
    ["modules", `/terminal-modules.js?v=${version}`, (r) => r.body.includes("FUMAN_TERMINAL_MODULES") && r.body.includes("terminal-market-snapshot-module.js") && r.body.includes("terminal-watchlist-shell.js") && r.body.includes("terminal-chip-snapshot-module.js")],
    ["worker", `/terminal-worker.js?v=${version}`, (r) => r.body.includes("swingBuckets")],
    ["service-worker", `/fuman-sw.js?v=${version}`, (r) => r.body.includes("terminal-fast-bundle") && r.body.includes("terminal-market-snapshot-module.js") && r.body.includes("terminal-watchlist-shell.js") && r.body.includes("terminal-chip-snapshot-module.js")],
    ["terminal-bootstrap", `/terminal.js?v=${version}`, (r) => r.body.includes("FUMAN_TERMINAL_LOAD_APP") && r.body.includes("FUMAN_TERMINAL_LOAD_FEATURE_MODULE") && r.body.includes("terminal-app.js")],
    ["terminal-app", `/terminal-app.js?v=${version}`, (r) => r.body.includes("FUMAN_LIVE_MEMORY_TTL_MS") && r.body.includes("loadStrategyWeights")],
    ["strategy3-api", "/api/strategy3-latest?v=verify", (r) => { const p = parseJson(r); return p.ok === true && isNotOlderThanLatestTradeDate(p.usedDate || p.date || p.updatedAt, strategy3TradeDate) && Number(p.count) > 0 && !!p.runId; }],
    ["strategy4-api", "/api/strategy4-latest?v=verify", (r) => { const p = parseJson(r); return p.ok === true && p.complete === true && Number(p.count) > 0 && !!p.runId; }],
    ["terminal-fast-bundle", "/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&v=verify", (r) => {
      const p = parseJson(r);
      const endpointKeys = Object.keys(p.endpoints || {});
      return p.ok === true
        && p.snapshotHit === true
        && p.cacheSource === "supabase:desktop_route_snapshot"
        && p.partial === false
        && endpointKeys.length >= 10
        && !endpointKeys.some((endpoint) => endpoint.includes("strategy2-latest"));
    }],
    ["desktop-route-snapshot", "/api/desktop-route-snapshot?v=verify", (r) => {
      const p = parseJson(r);
      return p.ok === true
        && p.snapshotHit === true
        && p.cacheSource === "supabase:desktop_route_snapshot"
        && p.partial === false
        && Object.keys(p.endpoints || {}).length >= 10;
    }],
    ["stocks-index", "/data/stocks-index.json?v=verify", (r) => { const p = parseJson(r); return p.ok === true && Number(p.count) > 1000; }],
    ["signal-quality", "/data/signal-quality-report.json?v=verify", (r) => parseJson(r).ok === true],
    ["data-consistency", "/data/data-consistency-report.json?v=verify", (r) => parseJson(r).ok === true],
    ["strategy-weights", "/data/strategy-weight-report.json?v=verify", (r) => !!parseJson(r).weights],
  ];
  for (const [name, pathname, check] of checks) assertOk(name, await fetchText(pathname), check);
  const frontendError = await postJson("/api/frontend-error", { source: "verify", message: "deployment smoke" });
  assertOk("frontend-error-api", frontendError, (r) => typeof parseJson(r).ok === "boolean");
  const performanceReport = await postJson("/api/performance-report", {
    source: "desktop-route-latency",
    url: "verify:smoke",
    summary: {
      count: 1,
      focus: "nav",
      maxNav: 1,
      maxShell: 1,
      maxApi: 1,
      firstFix: "verify",
      routes: [{ key: "verify|smoke", count: 1, focus: "nav", nav: { avg: 1, p95: 1, max: 1 }, shell: { avg: 1, p95: 1, max: 1 }, api: { avg: 1, p95: 1, max: 1 }, worst: 1, lastAt: Date.now() }],
    },
    rows: [{ key: "verify|smoke", source: "verify", stage: "api", nav: 1, shell: 1, api: 1, at: Date.now() }],
  });
  assertOk("performance-report-api", performanceReport, (r) => typeof parseJson(r).ok === "boolean");
  assertOk("desktop-latency-latest", await fetchText("/api/desktop-latency-latest?v=verify"), (r) => {
    const p = parseJson(r);
    return p.ok === true && p.summary?.count >= 1 && Array.isArray(p.rows);
  });
  console.log(`[smoke] e2e smoke ok version=${version}`);
}

main().catch((error) => {
  console.error(`[smoke] failed: ${error.message}`);
  process.exit(1);
});
