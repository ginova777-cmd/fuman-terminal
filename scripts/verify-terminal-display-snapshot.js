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
const DISPLAY_VERSION_MARKER = "terminal-display-v2-20260823-05";
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
  const display = read("terminal-display-v2.js");
  const pkg = read("package.json");
  const sync = read("scripts/sync-main-deploy-source.js");
  const sourceSync = read("scripts/verify-source-sync.js");

  assert(api.includes(SNAPSHOT_CONTRACT), `snapshot API missing ${SNAPSHOT_CONTRACT}`);
  assert(api.includes("readDesktopRouteSnapshotForRoute"), "snapshot API must prefer route-specific desktop snapshots");
  assert(api.includes("endpointPayloadFromSnapshot"), "snapshot API must normalize through endpointPayloadFromSnapshot");
  for (const route of SNAPSHOT_ROUTES) {
    assert(api.includes(`${route}: {`), `snapshot API missing route mapping ${route}`);
    assert(api.includes(`endpoint: "/api/${route === "institution" ? "institution" : route}-latest"`), `snapshot API missing endpoint for ${route}`);
    assert(display.includes(`/api/terminal-display-snapshot?route=${route}`), `terminal-display-v2 missing snapshot route ${route}`);
  }

  assert(display.includes(DISPLAY_VERSION_MARKER), `terminal-display-v2 missing marker ${DISPLAY_VERSION_MARKER}`);
  assert(display.includes("loadSnapshotFallback"), "terminal-display-v2 missing loadSnapshotFallback");
  assert(display.includes("terminal-display-v2-kline-20260823-01"), "terminal-display-v2 missing target daily-K takeover marker");
  assert(display.includes("/api/daily-kline?code=${encodeURIComponent(code)}&limit=260"), "terminal-display-v2 missing daily-K API fetch");
  assert(display.includes("FUMAN_TERMINAL_DISPLAY_V2_KLINE"), "terminal-display-v2 missing daily-K debug export");
  assert(display.includes("window.FUMAN_TERMINAL_DISPLAY_V2"), "terminal-display-v2 missing debug export");
  assert(display.includes("route.snapshot"), "terminal-display-v2 must call the snapshot path during route activation");
  assert(pkg.includes('"verify:terminal-display-snapshot"'), "package.json missing verify:terminal-display-snapshot script");
  assert(sync.includes("scripts/verify-terminal-display-snapshot.js"), "sync-main-deploy-source missing verifier script");
  assert(sourceSync.includes("scripts/verify-terminal-display-snapshot.js"), "verify-source-sync missing verifier script");
  console.log(`[terminal-display-snapshot] static ok contract=${SNAPSHOT_CONTRACT}`);
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

async function verifyLiveOnce() {
  const version = parseJson("version", read("version.json")).version;
  const asset = await fetchText(`/terminal-display-v2.js?v=${encodeURIComponent(version)}&verify=${Date.now()}`);
  assert(asset.status >= 200 && asset.status < 300, `terminal-display-v2 HTTP ${asset.status}`);
  assert(asset.body.includes(DISPLAY_VERSION_MARKER), `live terminal-display-v2 missing ${DISPLAY_VERSION_MARKER}`);
  assert(asset.body.includes("loadSnapshotFallback"), "live terminal-display-v2 missing loadSnapshotFallback");
  assert(asset.body.includes("/api/terminal-display-snapshot?route=strategy5"), "live terminal-display-v2 missing snapshot API route");

  const rows = [];
  for (const route of SNAPSHOT_ROUTES) rows.push(await fetchSnapshot(route));
  console.log("[terminal-display-snapshot] live ok " + JSON.stringify(rows));
}

async function verifyLive() {
  let lastError = null;
  for (let attempt = 1; attempt <= Math.max(1, ATTEMPTS); attempt += 1) {
    try {
      if (attempt > 1) console.log(`[terminal-display-snapshot] retry ${attempt}/${ATTEMPTS}`);
      await verifyLiveOnce();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= ATTEMPTS) break;
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
