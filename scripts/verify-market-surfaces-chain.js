"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_MARKET_SURFACES_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const OUT_DIR = path.join(ROOT, "outputs", "market-surfaces-chain");
const CHECK_UI_REPORT = !process.argv.includes("--skip-ui-report");

function readText(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeRows(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.signals)) return payload.signals;
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.market?.stocks)) return payload.market.stocks;
  if (payload?.byCode && typeof payload.byCode === "object") return Object.values(payload.byCode);
  return [];
}

function heatmapRows(payload) {
  return (Array.isArray(payload?.sectors) ? payload.sectors : [])
    .flatMap((sector) => Array.isArray(sector?.stocks) ? sector.stocks : Array.isArray(sector?.rows) ? sector.rows : []);
}

function addCheck(checks, ok, id, message, detail = {}) {
  checks.push({ id, ok: Boolean(ok), message, detail });
}

function obviousStaticFallback(payload) {
  const text = [
    payload?.cacheSource,
    payload?.source,
    payload?.transport?.source,
    payload?.cache?.source,
    payload?.error,
    payload?.reason,
  ].filter(Boolean).join(" ");
  return /static|fallback|data\/|local|bootstrap|none/i.test(text) && !/supabase|api\/market-ai-live/.test(text);
}

function fetchText(pathname, timeoutMs = 35000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}t=${Date.now()}`;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache", accept: "application/json, text/html, */*" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode || 0, headers: response.headers, body, url }));
    });
    request.on("timeout", () => request.destroy(new Error(`timeout ${url}`)));
    request.on("error", reject);
  });
}

async function fetchJson(pathname, timeoutMs = 35000) {
  const response = await fetchText(pathname, timeoutMs);
  let json = null;
  try {
    json = JSON.parse(response.body || "null");
  } catch (error) {
    return { ...response, ok: false, json: null, error: `json_parse_failed:${error.message}` };
  }
  return { ...response, ok: response.status >= 200 && response.status < 300, json };
}

function uiReportRows() {
  if (!CHECK_UI_REPORT) return [];
  const outputs = path.join(ROOT, "outputs");
  let files = [];
  try {
    files = fs.readdirSync(outputs, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("terminal-ui-e2e"))
      .map((entry) => path.join(outputs, entry.name, "terminal-ui-e2e-report.json"))
      .filter((file) => fs.existsSync(file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch {
    files = [];
  }
  const rows = [];
  for (const file of files) {
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(payload?.results)) {
        payload.results.forEach((row) => rows.push({ ...row, reportFile: file, reportGeneratedAt: payload.generatedAt || "" }));
      }
    } catch {}
  }
  return rows;
}

function latestUiPass(rows, routeKey, kind = "") {
  const candidates = rows.filter((row) => row?.routeKey === routeKey && (!kind || row?.kind === kind));
  return {
    routeKey,
    kind,
    checked: candidates.length,
    pass: candidates.filter((row) => row.ok === true).length,
    rowsVisible: Math.max(0, ...candidates.map((row) => cleanNumber(row.rowsVisible))),
    samples: candidates.slice(-4).map((row) => ({
      kind: row.kind,
      viewport: row.viewportKey || "",
      theme: row.theme || "",
      rowsVisible: row.rowsVisible || 0,
      ok: row.ok,
      freshnessText: row.freshnessText || row.statusText || "",
    })),
  };
}

async function main() {
  const checks = [];
  const details = {};

  const market = await fetchJson("/api/market", 35000);
  const marketRows = normalizeRows(market.json);
  details.market = {
    status: market.status,
    ok: market.json?.ok !== false,
    source: market.json?.source || "",
    cacheSource: market.json?.cacheSource || "",
    rows: marketRows.length,
    updatedAt: market.json?.updatedAt || "",
  };
  addCheck(checks, market.ok && market.json?.ok !== false, "market-api-ok", "市場總覽 /api/market must return ok 2xx", details.market);
  addCheck(checks, marketRows.length >= 3 || Array.isArray(market.json?.indexes), "market-api-content", "市場總覽 must expose index/futures rows", details.market);
  addCheck(checks, !obviousStaticFallback(market.json), "market-no-static-fallback", "市場總覽 must not use static/local fallback as authority", details.market);

  const heatmap = await fetchJson("/api/heatmap?limit=999&stocks=999&source=market-surfaces-chain", 45000);
  const heatRows = heatmapRows(heatmap.json);
  details.heatmap = {
    status: heatmap.status,
    ok: heatmap.json?.ok !== false,
    source: heatmap.json?.source || "",
    cacheSource: heatmap.json?.cacheSource || "",
    sectors: Array.isArray(heatmap.json?.sectors) ? heatmap.json.sectors.length : 0,
    rows: heatRows.length,
    stockCount: cleanNumber(heatmap.json?.stockCount || heatmap.json?.health?.stockCount),
    realtimeStockCount: cleanNumber(heatmap.json?.realtimeStockCount || heatmap.json?.health?.realtimeStockCount),
    health: heatmap.json?.health || {},
    heatmapDetectWindow: heatmap.json?.heatmapDetectWindow || {},
  };
  addCheck(checks, heatmap.ok && heatmap.json?.ok !== false, "heatmap-api-ok", "熱力圖 /api/heatmap must return ok 2xx", details.heatmap);
  addCheck(checks, details.heatmap.sectors >= 5 && Math.max(details.heatmap.rows, details.heatmap.stockCount, cleanNumber(details.heatmap.health?.stockCount)) >= 500, "heatmap-coverage", "熱力圖 must have sector groups and at least 500 stock rows", details.heatmap);
  addCheck(checks, details.heatmap.health?.isHealthy !== false && cleanNumber(details.heatmap.health?.badDate) === 0 && cleanNumber(details.heatmap.health?.noPrice) === 0, "heatmap-health", "熱力圖 health must not report stale dates or missing prices", details.heatmap);
  addCheck(checks, !obviousStaticFallback(heatmap.json), "heatmap-no-static-fallback", "熱力圖 must not use static/local fallback as authority", details.heatmap);

  const ai = await fetchJson("/api/market-ai-live", 35000);
  const aiRows = normalizeRows(ai.json);
  details.ai = {
    status: ai.status,
    ok: ai.json?.ok !== false,
    source: ai.json?.source || "",
    cacheSource: ai.json?.cacheSource || "",
    updatedAt: ai.json?.updatedAt || "",
    rows: aiRows.length,
    summary: ai.json?.summary || {},
    breadthSample: cleanNumber(ai.json?.breadth?.sample),
    strategy2Count: cleanNumber(ai.json?.summary?.strategy2Count),
    realtimeRadarCount: cleanNumber(ai.json?.summary?.realtimeRadarCount),
    aiDetectWindow: ai.json?.aiDetectWindow || {},
    marketSession: ai.json?.marketSession || {},
  };
  addCheck(checks, ai.ok && ai.json?.ok !== false, "ai-api-ok", "AI 判讀 /api/market-ai-live must return ok 2xx", details.ai);
  addCheck(checks, details.ai.breadthSample > 0 || details.ai.strategy2Count > 0 || details.ai.realtimeRadarCount > 0, "ai-api-content", "AI 判讀 must expose breadth, strategy2, or realtime radar content", details.ai);
  addCheck(checks, !obviousStaticFallback(ai.json), "ai-no-static-fallback", "AI 判讀 must not use static/local fallback as authority", details.ai);

  const realtime = await fetchJson("/api/realtime-radar-latest", 35000);
  const realtimeRows = normalizeRows(realtime.json);
  details.realtime = {
    status: realtime.status,
    ok: realtime.json?.ok !== false,
    source: realtime.json?.source || "",
    cacheSource: realtime.json?.cacheSource || "",
    transport: realtime.json?.transport || {},
    rows: realtimeRows.length || cleanNumber(realtime.json?.count),
    date: realtime.json?.date || realtime.json?.tradeDate || "",
    marketSession: realtime.json?.marketSession || {},
  };
  addCheck(checks, realtime.ok && realtime.json?.ok !== false, "realtime-api-ok", "即時雷達 /api/realtime-radar-latest must return ok 2xx", details.realtime);
  addCheck(checks, details.realtime.rows > 0, "realtime-api-content", "即時雷達 must expose rows/cards", details.realtime);
  addCheck(checks, /supabase/i.test(`${details.realtime.cacheSource} ${details.realtime.transport?.source || ""}`), "realtime-supabase-source", "即時雷達 must read Supabase cache/quote source", details.realtime);
  addCheck(checks, !obviousStaticFallback(realtime.json), "realtime-no-static-fallback", "即時雷達 must not use static/local fallback as authority", details.realtime);

  const watch = await fetchJson("/api/watchlist-match-index", 30000);
  details.watch = {
    status: watch.status,
    ok: watch.json?.ok !== false,
    source: watch.json?.source || "",
    cacheSource: watch.json?.cacheSource || "",
    runId: watch.json?.runId || "",
    count: cleanNumber(watch.json?.count || Object.keys(watch.json?.byCode || {}).length),
    hasByCode: Boolean(watch.json?.byCode && typeof watch.json.byCode === "object"),
    watchlistDetectWindow: watch.json?.watchlistDetectWindow || {},
    transport: watch.json?.transport || {},
  };
  addCheck(checks, watch.ok && watch.json?.ok !== false, "watch-api-ok", "自選股 /api/watchlist-match-index must return ok 2xx", details.watch);
  addCheck(checks, details.watch.hasByCode && Boolean(details.watch.runId), "watch-index-contract", "自選股 must expose byCode index and runId even when the user's watchlist is empty", details.watch);
  addCheck(checks, /supabase/i.test(`${details.watch.cacheSource} ${details.watch.transport?.source || ""}`), "watch-supabase-source", "自選股 match index must come from Supabase snapshot", details.watch);

  const marketUi = readText("terminal-market-overview-restore.js");
  details.uiContract = {
    hasMarketTabs: /data-market-mode="overview"/.test(marketUi) && /data-market-mode="ai"/.test(marketUi),
    hasHeatmapTabs: ["all", "official", "electronics", "themes", "groups"].every((mode) => marketUi.includes(`data-market-heatmap-mode="${mode}"`)),
    hasHeatmapModal: /openMarket|modal|drilldown/i.test(marketUi) && /__fumanMarketHeatmap/i.test(marketUi),
    hasAiPanel: /market-ai-panel/.test(marketUi) && /renderMarketAiPanel|paintMarketAi/.test(marketUi),
    hasRealtimeEntry: /data-view="realtime-radar"/.test(marketUi),
    noGenericTableRegression: !/Rank\s*\/\s*Code\s*\/\s*Signal/.test(marketUi),
  };
  addCheck(checks, Object.values(details.uiContract).every(Boolean), "desktop-ui-contract", "桌面市場總覽/熱力圖/AI/即時雷達 UI contract must be present", details.uiContract);

  const uiRows = uiReportRows();
  details.uiE2E = {
    reportRows: uiRows.length,
    desktopMarket: latestUiPass(uiRows, "market", "desktop"),
    desktopRealtime: latestUiPass(uiRows, "realtime-radar", "desktop"),
    mobileAi: latestUiPass(uiRows, "ai", "mobile"),
    mobileWatch: latestUiPass(uiRows, "watch", "mobile"),
  };
  if (CHECK_UI_REPORT) {
    addCheck(checks, details.uiE2E.desktopMarket.pass > 0 && details.uiE2E.desktopMarket.rowsVisible > 0, "ui-e2e-market", "UI E2E must have visible desktop market overview rows/cards", details.uiE2E.desktopMarket);
    addCheck(checks, details.uiE2E.desktopRealtime.pass > 0 && details.uiE2E.desktopRealtime.rowsVisible > 0, "ui-e2e-realtime", "UI E2E must have visible desktop realtime radar rows/cards", details.uiE2E.desktopRealtime);
    addCheck(checks, details.uiE2E.mobileAi.pass > 0 && details.uiE2E.mobileAi.rowsVisible > 0, "ui-e2e-ai", "UI E2E must have visible mobile AI rows/cards", details.uiE2E.mobileAi);
    addCheck(checks, details.uiE2E.mobileWatch.pass > 0, "ui-e2e-watch", "UI E2E must cover mobile watchlist surface; empty watchlist is allowed", details.uiE2E.mobileWatch);
  }

  const ok = checks.every((check) => check.ok);
  const report = {
    ok,
    checkedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    contract: "market-surfaces-chain-v1",
    checks,
    details,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "market-surfaces-chain.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "market-surfaces-chain.md"), [
    "# Market Surfaces Chain",
    "",
    `ok: ${ok}`,
    `checkedAt: ${report.checkedAt}`,
    `baseUrl: ${BASE_URL}`,
    "",
    "| Surface | Check | Result | Detail |",
    "|---|---|---|---|",
    ...checks.map((check) => `| ${check.id.split("-")[0]} | ${check.id} | ${check.ok ? "PASS" : "FAIL"} | ${String(check.message).replace(/\|/g, "/")} |`),
    "",
  ].join("\n"), "utf8");

  console.log(`[market-surfaces-chain] wrote ${path.join(OUT_DIR, "market-surfaces-chain.md")}`);
  if (!ok) {
    checks.filter((check) => !check.ok).forEach((check) => console.error(`- ${check.id}: ${check.message}`));
    process.exitCode = 1;
    return;
  }
  console.log("[market-surfaces-chain] ok");
}

main().catch((error) => {
  console.error(`[market-surfaces-chain] failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
