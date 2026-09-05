"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const SKIP_LIVE = process.argv.includes("--skip-live");
const issues = [];
const mobile = fs.readFileSync(path.join(ROOT, "mobile.html"), "utf8");
const api = fs.readFileSync(path.join(ROOT, "api", "daily-kline.js"), "utf8");
const requiredMobileMarkers = [
  'data-mobile-daily-kline="mobile-daily-kline-v2"',
  "[60,120,240]",
  'data-mobile-kline-range="${range}"',
  'chartSvg(payload.bars,range)',
  'ma(5,"#f4c656")',
  'ma(10,"#4aa7ff")',
  'ma(20,"#b18ae3")',
  "MA5", "MA10", "MA20",
  "/api/daily-kline?code=${encodeURIComponent(code)}&limit=260",
];
for (const marker of requiredMobileMarkers) if (!mobile.includes(marker)) issues.push(`mobile contract marker missing: ${marker}`);
for (const marker of ['contract: "terminal-daily-kline-v1"', "strategy4_daily_ohlcv_view", "volumeLots"]) if (!api.includes(marker)) issues.push(`daily-kline source contract missing: ${marker}`);

function requestJson(pathname) {
  return new Promise((resolve) => {
    const request = https.get(`${BASE_URL}${pathname}&verify=${Date.now()}`, { timeout: 30000, headers: { accept: "application/json", "cache-control": "no-cache" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode || 0, body: JSON.parse(body || "{}") }); }
        catch (error) { resolve({ status: response.statusCode || 0, body: { error: error.message } }); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", (error) => resolve({ status: 0, body: { error: error.message } }));
  });
}

(async () => {
  const live = { skipped: SKIP_LIVE };
  if (!SKIP_LIVE) {
    const response = await requestJson("/api/daily-kline?code=2408&limit=260");
    const bars = Array.isArray(response.body?.bars) ? response.body.bars : [];
    Object.assign(live, { status: response.status, ok: response.body?.ok === true, contract: response.body?.contract || "", source: response.body?.source || "", count: bars.length, latestDate: response.body?.latestDate || "" });
    if (response.status !== 200 || response.body?.ok !== true) issues.push(`live daily-kline failed: ${response.status} ${response.body?.error || ""}`);
    if (response.body?.contract !== "terminal-daily-kline-v1") issues.push(`live contract invalid: ${response.body?.contract || "missing"}`);
    if (!String(response.body?.source || "").startsWith("supabase:")) issues.push(`live source invalid: ${response.body?.source || "missing"}`);
    if (bars.length < 60) issues.push(`live bars insufficient: ${bars.length}`);
    for (const field of ["date", "open", "high", "low", "close", "volumeLots"]) if (bars.some((bar) => bar?.[field] === undefined || bar?.[field] === null)) issues.push(`live bars missing field: ${field}`);
  }
  const ok = issues.length === 0;
  console.log(JSON.stringify({ contract: "mobile-daily-kline-verifier-v1", ok, status: ok ? "PASS" : "FAIL_CLOSED", complete: ok, checkedAt: new Date().toISOString(), baseUrl: BASE_URL, ranges: [60, 120, 240], movingAverages: [5, 10, 20], sourceAuthority: "api/daily-kline.js -> supabase:strategy4_daily_ohlcv_view", issues, live }, null, 2));
  if (!ok) process.exitCode = 1;
})().catch((error) => { console.error(JSON.stringify({ contract: "mobile-daily-kline-verifier-v1", ok: false, status: "FAIL_CLOSED", complete: false, error: error.message }, null, 2)); process.exitCode = 1; });
