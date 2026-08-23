const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LIVE = process.argv.includes("--live") || process.argv.includes("--retry");
const RETRY = process.argv.includes("--retry");
const ATTEMPTS = Number(process.env.FUMAN_VERIFY_SNAPSHOT_ATTEMPTS || (RETRY ? 12 : 1));
const DELAY_MS = Number(process.env.FUMAN_VERIFY_SNAPSHOT_DELAY_MS || 10000);
const SNAPSHOT_CONTRACT = "terminal-display-snapshot-v1";
const DISPLAY_VERSION_MARKER = "terminal-display-v2-20260823-06";
const DAILY_KLINE_CONTRACT = "terminal-daily-kline-v1";
const DAILY_KLINE_MARKER = "terminal-display-v2-kline-20260823-01";
const DAILY_KLINE_TEST_CODE = process.env.FUMAN_VERIFY_DAILY_KLINE_CODE || "6830";
const THREE_GATE_CONTRACT = "terminal-three-gate-prices-v1";
const THREE_GATE_TEST_CODE = process.env.FUMAN_VERIFY_THREE_GATE_CODE || DAILY_KLINE_TEST_CODE;
const SNAPSHOT_ROUTES = ["strategy2", "strategy3", "strategy4", "strategy5", "institution"];
const REQUIRED_DATA_ROUTES = ["strategy3", "strategy4", "strategy5", "institution"];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fetchText(pathname, timeoutMs = 20000) {
  const url = `${BASE_URL}${pathname}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ url, status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function parseJson(name, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} JSON parse failed: ${error.message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function verifyStatic() {
  const api = read("api/terminal-display-snapshot.js");
  const dailyKlineApi = read("api/daily-kline.js");
  const display = read("terminal-display-v2.js");
  const pkg = read("package.json");
  const sync = read("scripts/sync-main-deploy-source.js");
  const sourceSync = read("scripts/verify-source-sync.js");
  const publishGate = read("scripts/verify-publish-gate.js");

  assert(api.includes(SNAPSHOT_CONTRACT), `snapshot API missing ${SNAPSHOT_CONTRACT}`);
  assert(api.includes("readDesktopRouteSnapshotForRoute"), "snapshot API must prefer route-specific desktop snapshots");
  assert(api.includes("endpointPayloadFromSnapshot"), "snapshot API must normalize through endpointPayloadFromSnapshot");
  for (const route of SNAPSHOT_ROUTES) {
    assert(api.includes(`${route}: {`), `snapshot API missing route mapping ${route}`);
    assert(api.includes(`endpoint: "/api/${route === "institution" ? "institution" : route}-latest"`), `snapshot API missing endpoint for ${route}`);
    assert(display.includes(`/api/terminal-display-snapshot?route=${route}`), `terminal-display-v2 missing snapshot route ${route}`);
  }

  assert(dailyKlineApi.includes(DAILY_KLINE_CONTRACT), `daily-K API missing ${DAILY_KLINE_CONTRACT}`);
  for (const marker of ["strategy4_daily_ohlcv_view", "open", "high", "low", "close", "volumeLots", "MAX_LIMIT = 260"]) {
    assert(dailyKlineApi.includes(marker), `daily-K API contract missing ${marker}`);
  }

  assert(display.includes(DISPLAY_VERSION_MARKER), `terminal-display-v2 missing marker ${DISPLAY_VERSION_MARKER}`);
  assert(display.includes("loadSnapshotFallback"), "terminal-display-v2 missing loadSnapshotFallback");
  for (const marker of [
    DAILY_KLINE_MARKER,
    "FUMAN_TERMINAL_DISPLAY_V2_KLINE",
    "function codeOf(value)",
    "function markCards()",
    "async function openCard(card)",
    "new MutationObserver(markCards)",
    ".terminal-display-v2-card[data-terminal-display-v2-kline-code]",
    ".terminal-display-v2-kline-panel",
    ".terminal-display-v2-kline-svg",
    "data-terminal-display-v2-kline-range",
    "[60, 120, 240]",
    "MA5",
    "MA10",
    "MA20",
    "下方為成交量（張）",
    "/api/daily-kline?code=${encodeURIComponent(code)}&limit=260",
  ]) {
    assert(display.includes(marker), `terminal-display-v2 daily-K takeover missing ${marker}`);
  }
  for (const marker of [
    "function threeGateHtml(row, code, date)",
    "async function hydrateThreeGatePrices(routeKey, rows, date)",
    "function paintThreeGatePrices(levels = [])",
    "terminal-display-v2-three-gate",
    "data-terminal-display-v2-three-gate-upper",
    "data-terminal-display-v2-three-gate-middle",
    "data-terminal-display-v2-three-gate-lower",
    "data-terminal-display-v2-three-gate-reference",
    "/api/three-gate-prices?${query.toString()}",
    "terminal-three-gate-prices-v1",
    "正式日K資料不足",
  ]) {
    assert(display.includes(marker), `terminal-display-v2 three-gate takeover missing ${marker}`);
  }
  assert(display.includes("window.FUMAN_TERMINAL_DISPLAY_V2"), "terminal-display-v2 missing debug export");
  assert(display.includes("route.snapshot"), "terminal-display-v2 must call the snapshot path during route activation");
  assert(pkg.includes('"verify:terminal-display-snapshot"'), "package.json missing verify:terminal-display-snapshot script");
  assert(pkg.includes("npm run verify:terminal-display-snapshot -- --retry"), "postdeploy must run terminal-display-snapshot live verifier");
  assert(publishGate.includes("terminal_display_snapshot"), "publish gate missing terminal_display_snapshot check");
  assert(sync.includes("scripts/verify-terminal-display-snapshot.js"), "sync-main-deploy-source missing verifier script");
  assert(sourceSync.includes("scripts/verify-terminal-display-snapshot.js"), "verify-source-sync missing verifier script");
  assert(sync.includes("api/daily-kline.js"), "sync-main-deploy-source missing api/daily-kline.js");
  assert(sourceSync.includes("api/daily-kline.js"), "verify-source-sync missing api/daily-kline.js");
  console.log(`[terminal-display-snapshot] static ok snapshot=${SNAPSHOT_CONTRACT} dailyK=${DAILY_KLINE_CONTRACT}`);
}

async function fetchSnapshot(route) {
  const result = await fetchText(`/api/terminal-display-snapshot?route=${encodeURIComponent(route)}&verify=${Date.now()}`);
  assert(result.status >= 200 && result.status < 300, `${route} snapshot HTTP ${result.status}`);
  const payload = parseJson(`${route} snapshot`, result.body);
  assert(payload && payload.ok === true, `${route} snapshot ok must be true`);
  assert(payload.contract === SNAPSHOT_CONTRACT, `${route} snapshot contract mismatch`);
  assert(payload.route === route, `${route} snapshot route mismatch`);
  assert(payload.snapshotHit === true, `${route} snapshotHit must be true`);
  assert(Array.isArray(payload.rows), `${route} snapshot rows must be an array`);
  if (REQUIRED_DATA_ROUTES.includes(route)) {
    assert(Number(payload.count) > 0, `${route} snapshot count must be > 0`);
    assert(payload.rows.length > 0, `${route} snapshot rows must be > 0`);
    assert(payload.rows[0] && payload.rows[0].code, `${route} snapshot first row must include code`);
  }
  return {
    route,
    count: Number(payload.count || 0),
    rows: payload.rows.length,
    source: payload.source || "",
    first: payload.rows[0]?.code || "",
  };
}

async function fetchThreeGate(code) {
  const result = await fetchText(`/api/three-gate-prices?codes=${encodeURIComponent(code)}&asOf=2026-08-21&verify=${Date.now()}`, 30000);
  assert(result.status >= 200 && result.status < 300, `three-gate ${code} HTTP ${result.status}`);
  const payload = parseJson(`three-gate ${code}`, result.body);
  assert(payload?.ok === true, `three-gate ${code} ok must be true`);
  assert(payload.contract === THREE_GATE_CONTRACT, `three-gate ${code} contract mismatch`);
  assert(String(payload.source || "").startsWith("supabase:"), `three-gate ${code} source must be supabase`);
  const levels = Array.isArray(payload.levels) ? payload.levels : [];
  const level = levels.find((item) => String(item?.code || "") === String(code));
  assert(level, `three-gate ${code} level missing`);
  for (const field of ["upperGate", "middleGate", "lowerGate", "referenceDate"]) {
    assert(level[field] !== undefined && level[field] !== null && level[field] !== "", `three-gate ${code} missing ${field}`);
  }
  assert(Number(level.upperGate) > Number(level.middleGate), `three-gate ${code} upper must exceed middle`);
  assert(Number(level.middleGate) > Number(level.lowerGate), `three-gate ${code} middle must exceed lower`);
  return { code, contract: payload.contract, source: payload.source, upperGate: level.upperGate, middleGate: level.middleGate, lowerGate: level.lowerGate, referenceDate: level.referenceDate };
}
async function fetchDailyKline(code) {
  const result = await fetchText(`/api/daily-kline?code=${encodeURIComponent(code)}&limit=60&verify=${Date.now()}`, 30000);
  assert(result.status >= 200 && result.status < 300, `daily-K ${code} HTTP ${result.status}`);
  const payload = parseJson(`daily-K ${code}`, result.body);
  assert(payload?.ok === true, `daily-K ${code} ok must be true`);
  assert(payload.contract === DAILY_KLINE_CONTRACT, `daily-K ${code} contract mismatch`);
  assert(String(payload.source || "").startsWith("supabase:"), `daily-K ${code} source must be supabase`);
  const bars = Array.isArray(payload.bars) ? payload.bars : [];
  assert(bars.length >= 20, `daily-K ${code} bars must be >= 20`);
  for (const [index, bar] of bars.entries()) {
    for (const field of ["date", "open", "high", "low", "close", "volumeLots"]) {
      assert(bar?.[field] !== undefined && bar?.[field] !== null && bar?.[field] !== "", `daily-K ${code} bar ${index} missing ${field}`);
    }
    assert(Number(bar.high) >= Math.max(Number(bar.open), Number(bar.close)), `daily-K ${code} bar ${index} high violates OHLC`);
    assert(Number(bar.low) <= Math.min(Number(bar.open), Number(bar.close)), `daily-K ${code} bar ${index} low violates OHLC`);
  }
  return { code, contract: payload.contract, source: payload.source, bars: bars.length, latestDate: payload.latestDate || bars[bars.length - 1]?.date || "" };
}

async function verifyLiveOnce() {
  const version = parseJson("version", read("version.json")).version;
  const asset = await fetchText(`/terminal-display-v2.js?v=${encodeURIComponent(version)}&verify=${Date.now()}`);
  assert(asset.status >= 200 && asset.status < 300, `terminal-display-v2 HTTP ${asset.status}`);
  assert(asset.body.includes(DISPLAY_VERSION_MARKER), `live terminal-display-v2 missing ${DISPLAY_VERSION_MARKER}`);
  assert(asset.body.includes("loadSnapshotFallback"), "live terminal-display-v2 missing loadSnapshotFallback");
  assert(asset.body.includes("/api/terminal-display-snapshot?route=strategy5"), "live terminal-display-v2 missing snapshot API route");
  assert(asset.body.includes(DAILY_KLINE_MARKER), `live terminal-display-v2 missing ${DAILY_KLINE_MARKER}`);
  assert(asset.body.includes("FUMAN_TERMINAL_DISPLAY_V2_KLINE"), "live terminal-display-v2 missing daily-K export");
  assert(asset.body.includes("/api/daily-kline?code="), "live terminal-display-v2 missing daily-K API fetch");
  assert(asset.body.includes("data-terminal-display-v2-kline-range"), "live terminal-display-v2 missing daily-K range controls");
  assert(asset.body.includes("terminal-display-v2-three-gate"), "live terminal-display-v2 missing three-gate display");
  assert(asset.body.includes("/api/three-gate-prices?"), "live terminal-display-v2 missing three-gate API fetch");
  assert(asset.body.includes("terminal-three-gate-prices-v1"), "live terminal-display-v2 missing three-gate contract guard");

  const rows = [];
  for (const route of SNAPSHOT_ROUTES) rows.push(await fetchSnapshot(route));
  const dailyKline = await fetchDailyKline(DAILY_KLINE_TEST_CODE);
  const threeGate = await fetchThreeGate(THREE_GATE_TEST_CODE);
  console.log("[terminal-display-snapshot] live ok " + JSON.stringify({ snapshots: rows, dailyKline, threeGate }));
}

async function verifyLive() {
  let lastError = null;
  const attempts = Math.max(1, ATTEMPTS);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) console.log(`[terminal-display-snapshot] retry ${attempt}/${attempts}`);
      await verifyLiveOnce();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      console.warn(`[terminal-display-snapshot] waiting for propagation: ${error.message}`);
      await sleep(DELAY_MS);
    }
  }
  throw lastError || new Error("live snapshot verification failed");
}

async function main() {
  verifyStatic();
  if (LIVE) await verifyLive();
}

main().catch((error) => {
  console.error(`[terminal-display-snapshot] failed: ${error.message}`);
  process.exit(1);
});


