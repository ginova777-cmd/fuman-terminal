"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const SKIP_LIVE = process.argv.includes("--skip-live");
const issues = [];
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function failWhen(condition, message) { if (condition) issues.push(message); }
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

async function main() {
  const watchlist = read("terminal-watchlist-shell.js");
  const desktop = read("terminal-desktop-fast-shell.js");
  const api = read("api/daily-kline.js");
  const pkg = read("package.json");
  for (const marker of [
    'const VERSION = "watchlist-rich-shell-20260813-daily-kline-01"', "function dailyKlineHtml(row)", "function klineSvg(rows)",
    "dailyKlineCache", "dailyKlineRanges", "/api/daily-kline?code=${encodeURIComponent(target)}&limit=260", "data-watch-k-range", "[60, 120, 240]",
    "MA5", "MA10", "MA20", "下方為成交量（張）", ".watch-kline-panel", ".watch-kline-svg", "height:300px", ".watch-kline-range.active",
  ]) failWhen(!watchlist.includes(marker), `watchlist daily-K contract missing: ${marker}`);
  for (const marker of ['contract: "terminal-daily-kline-v1"', "strategy4_daily_ohlcv_view", "open", "high", "low", "close", "volumeLots"]) failWhen(!api.includes(marker), `daily-K API contract missing: ${marker}`);
  for (const marker of ["strategy4DailyKlineHtml", "strategy4DailyKlineSvg", "hydrateStrategy4DailyKline", "/api/daily-kline?code=${encodeURIComponent(code)}&limit=260", "data-strategy4-kline-range", "canvasState.selectedIndex === index", "hideCanvasDetail()", "desktop-strategy4-canvas-detail", "strategy4CanvasPointerOpenedAt", "document.addEventListener(\"pointerup\""]) failWhen(!desktop.includes(marker), `strategy4 daily-K contract missing: ${marker}`);
  failWhen(desktop.indexOf('<div class="desktop-canvas-detail" hidden></div>') > desktop.indexOf('<canvas class="desktop-route-canvas"'), "strategy4 daily-K detail must render before the Canvas list");  failWhen(!/verify:watchlist-daily-kline/.test(pkg), "package.json missing verify:watchlist-daily-kline script");
  const live = { skipped: SKIP_LIVE };
  if (!SKIP_LIVE) {
    const response = await requestJson("/api/daily-kline?code=2464&limit=60", 30000);
    const bars = Array.isArray(response.body?.bars) ? response.body.bars : [];
    live.status = response.status; live.contract = response.body?.contract || ""; live.source = response.body?.source || ""; live.count = bars.length;
    failWhen(!response.ok || response.body?.ok !== true, `live daily-K API failed status=${response.status}`);
    failWhen(response.body?.contract !== "terminal-daily-kline-v1", `live daily-K contract=${response.body?.contract || "missing"}`);
    failWhen(!String(response.body?.source || "").startsWith("supabase:"), `live daily-K source=${response.body?.source || "missing"}`);
    failWhen(bars.length < 20, `live daily-K has insufficient bars=${bars.length}`);
    for (const [index, bar] of bars.entries()) {
      for (const field of ["date", "open", "high", "low", "close", "volumeLots"]) failWhen(bar?.[field] === undefined || bar?.[field] === null || bar?.[field] === "", `live daily-K bar ${index} missing ${field}`);
      failWhen(Number(bar.high) < Math.max(Number(bar.open), Number(bar.close)), `live daily-K bar ${index} high violates OHLC`);
      failWhen(Number(bar.low) > Math.min(Number(bar.open), Number(bar.close)), `live daily-K bar ${index} low violates OHLC`);
    }
  }
  const payload = { ok: issues.length === 0, status: issues.length === 0 ? "YES" : "NO", checkedAt: new Date().toISOString(), baseUrl: BASE_URL, issues, live };
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, status: "NO", error: error?.message || String(error) }, null, 2)); process.exit(1); });