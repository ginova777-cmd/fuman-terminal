"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const issues = [];
const REGRESSION_CODES = ["6187", "2464", "1718", "1717", "2033", "1714", "1605", "1608"];
const REGRESSION_AS_OF = "2026-08-13";

function read(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), "utf8"); }
function failWhen(condition, message) { if (condition) issues.push(message); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : NaN; }
function requestJson(pathname, timeoutMs = 30000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}verify=${Date.now()}`;
  return new Promise((resolve) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { accept: "application/json", "cache-control": "no-cache" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode || 0, body: JSON.parse(body || "{}") }); }
        catch (error) { resolve({ ok: false, status: response.statusCode || 0, body: { error: `json_parse_failed:${error.message}` } }); }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", (error) => resolve({ ok: false, status: 0, body: { error: error.message } }));
  });
}
function requestText(pathname, timeoutMs = 30000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}verify=${Date.now()}`;
  return new Promise((resolve) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode || 0, body }));
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", (error) => resolve({ ok: false, status: 0, body: String(error?.message || error) }));
  });
}
function assertLevel(level, asOfDate, prefix) {
  failWhen(!level || !/^\d{4}$/.test(String(level?.code || "")), `${prefix} missing stock code`);
  failWhen(!/^\d{4}-\d{2}-\d{2}$/.test(String(level?.referenceDate || "")), `${prefix} missing reference date`);
  failWhen(String(level?.referenceDate || "") >= asOfDate, `${prefix} reference date is not before displayed data date`);
  const high = number(level?.previousHigh);
  const low = number(level?.previousLow);
  const upper = number(level?.upperGate);
  const middle = number(level?.middleGate);
  const lower = number(level?.lowerGate);
  failWhen(!(high > 0 && low > 0 && high >= low), `${prefix} invalid formal high/low`);
  failWhen(!Number.isFinite(upper) || !Number.isFinite(middle) || !Number.isFinite(lower), `${prefix} missing gate values`);
  failWhen(Math.abs(upper - Math.round((low + (high - low) * 1.382) * 100) / 100) > 0.001, `${prefix} upper-gate formula mismatch`);
  failWhen(Math.abs(middle - Math.round(((high + low) / 2) * 100) / 100) > 0.001, `${prefix} middle-gate formula mismatch`);
  failWhen(Math.abs(lower - Math.round((high - (high - low) * 1.382) * 100) / 100) > 0.001, `${prefix} lower-gate formula mismatch`);
}

async function main() {
  const api = read("api/three-gate-prices.js");
  const desktop = read("terminal-desktop-fast-shell.js");
  const serviceWorker = read("fuman-sw.js");
  const pkg = read("package.json");
  const calculator = require(path.join(ROOT, "api", "three-gate-prices.js")).calculateThreeGate;

  for (const marker of [
    "terminal-three-gate-prices-v1", "FIBONACCI_RANGE_MULTIPLIER = 1.382", "previous_low + (previous_high - previous_low) * 1.382",
    "(previous_high + previous_low) / 2", "previous_high - (previous_high - previous_low) * 1.382", "trade_date.desc,symbol.asc",
    "MAX_CODES = 300", "missingCodes", "referenceDate",
  ]) failWhen(!api.includes(marker), `three-gate API contract missing: ${marker}`);
  failWhen(api.includes("symbol.asc,trade_date.desc"), "three-gate API regressed to code-first ordering and can starve batch results");

  for (const marker of [
    "isStrategy3Route(route) || isStrategy4Route(route) || isStrategy5Route(route) || isChipTradeRoute(route)",
    "threeGatePriceHtml", "hydrateThreeGatePrices", "paintThreeGatePrices", "data-three-gate-upper", "data-three-gate-middle",
    "data-three-gate-lower", "data-three-gate-reference", "data-three-gate-state", "threeGatePriceCache", "正式日K資料不足", "strategy5-inline-kline-card", "strategy5-inline-kline-row",
    "supportsThreeGatePrices(route) ? \"\" : `<p>${escapeHtml(unifiedListSummary(row))}</p>`", ".three-gate-prices",
  ]) failWhen(!desktop.includes(marker), `terminal three-gate display contract missing: ${marker}`);
  failWhen(desktop.includes("node.outerHTML = threeGatePriceHtml"), "three-gate display must update its visible fields, not replace an entire card fragment");
  failWhen(!serviceWorker.includes("/\\/api\\/three-gate-prices/i"), "service worker must treat three-gate API as live network data");
  failWhen(!pkg.includes('"verify:three-gate-prices": "node --use-system-ca scripts/verify-three-gate-prices.js"'), "package verifier must point to dedicated three-gate verifier");

  const sample = calculator({ symbol: "1234", trade_date: "2026-08-13", high: 110, low: 100 });
  failWhen(sample?.upperGate !== 113.82 || sample?.middleGate !== 105 || sample?.lowerGate !== 96.18, "local three-gate formula regression");

  const serviceWorkerResponse = await requestText("/fuman-sw.js", 30000);
  failWhen(!serviceWorkerResponse.ok || !serviceWorkerResponse.body.includes("/\\/api\\/three-gate-prices/i"), `production service worker missing live three-gate API rule status=${serviceWorkerResponse.status}`);
  const response = await requestJson(`/api/three-gate-prices?codes=${REGRESSION_CODES.join(",")}&asOf=${REGRESSION_AS_OF}`, 30000);
  const levels = Array.isArray(response.body?.levels) ? response.body.levels : [];
  failWhen(!response.ok || response.body?.ok !== true, `production three-gate batch failed status=${response.status}`);
  failWhen(response.body?.contract !== "terminal-three-gate-prices-v1", "production three-gate contract missing");
  failWhen(response.body?.source !== "supabase:strategy4_daily_ohlcv_view", `production three-gate source=${response.body?.source || "missing"}`);
  failWhen(response.body?.requestedCount !== REGRESSION_CODES.length || levels.length !== REGRESSION_CODES.length, `production three-gate batch count=${levels.length}/${REGRESSION_CODES.length}`);
  const missingCodes = Array.isArray(response.body?.missingCodes) ? response.body.missingCodes : [];
  failWhen(missingCodes.length > 0, `production three-gate false unavailable=${missingCodes.join(",")}`);
  if (response.ok && response.body?.ok === true && response.body?.contract === "terminal-three-gate-prices-v1") {
    for (const stockCode of REGRESSION_CODES) {
      const level = levels.find((item) => item?.code === stockCode);
      assertLevel(level, REGRESSION_AS_OF, `production ${stockCode}`);
    }
  }

  const checkedAt = new Date().toISOString();
  const payload = { ok: issues.length === 0, status: issues.length === 0 ? "YES" : "NO", checkedAt, baseUrl: BASE_URL, scope: { routes: ["策略3", "策略4", "綜合策略", "買賣超"], regressionCodes: REGRESSION_CODES, asOfDate: REGRESSION_AS_OF }, issues };
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, status: "NO", error: error?.message || String(error) }, null, 2)); process.exit(1); });