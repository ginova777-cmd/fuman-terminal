const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_HOTFIX = "20260623-09";
const EXPECTED_FRONTEND_VERSION = "public-terminal-fast-20260623-09";
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LIVE = process.argv.includes("--live");

const issues = [];

function filePath(file) {
  return path.join(ROOT, file);
}

function read(file) {
  const target = filePath(file);
  if (!fs.existsSync(target)) {
    issues.push(`${file} is missing`);
    return "";
  }
  return fs.readFileSync(target, "utf8");
}

function requireMarker(file, marker, label = marker) {
  const text = read(file);
  if (!text.includes(marker)) {
    issues.push(`${file} missing ${label}`);
  }
  return text;
}

function requireJsonHeader(vercel, source, value) {
  const normalized = vercel.replace(/\s+/g, " ");
  if (!normalized.includes(`"source": "${source}"`)) {
    issues.push(`vercel.json missing header source ${source}`);
  }
  if (!normalized.includes(`"value": "${value}"`)) {
    issues.push(`vercel.json missing header value ${value}`);
  }
}

function fetchText(pathname, timeoutMs = 25000) {
  const fresh = pathname.includes("?") ? `&guard=${Date.now()}` : `?guard=${Date.now()}`;
  const url = `${BASE_URL}${pathname}${fresh}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        resolve({ url, status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function assertLiveText(name, result, markers) {
  if (result.status < 200 || result.status >= 300) {
    issues.push(`${name} live HTTP ${result.status}: ${result.url}`);
    return;
  }
  for (const marker of markers) {
    if (!result.body.includes(marker)) {
      issues.push(`${name} live missing ${marker}`);
    }
  }
  const cacheControl = String(result.headers["cache-control"] || "");
  if (name !== "terminal-fast-bundle" && !cacheControl.toLowerCase().includes("no-store")) {
    issues.push(`${name} live cache-control is not no-store: ${cacheControl || "(empty)"}`);
  }
  console.log(`[runtime-hotfix] live ${name} ok`);
}

async function verifyLive() {
  const hotfix = await fetchText("/terminal-hotfix.js");
  assertLiveText("terminal-hotfix", hotfix, [
    EXPECTED_HOTFIX,
    "terminal-fast-bundle",
    "FUMAN_HOTFIX_PRIME_API_CACHE",
  ]);

  const serviceWorker = await fetchText("/fuman-sw.js");
  assertLiveText("fuman-sw", serviceWorker, [
    "/api/terminal-fast-bundle",
    "DATA_PATTERNS",
  ]);

  const mobilePage = await fetchText("/api/mobile-page");
  assertLiveText("mobile-page", mobilePage, [
    "輔滿極速手機版",
    "API-only live",
    "slice(0,10)",
    "自選股已達 10 檔上限",
    "data-watch-remove",
  ]);
  if (mobilePage.body.includes("輔滿 股票終端")) {
    issues.push("mobile-page live returned desktop terminal HTML");
  }

  const bundle = await fetchText("/api/terminal-fast-bundle", 35000);
  if (bundle.status < 200 || bundle.status >= 300) {
    issues.push(`terminal-fast-bundle live HTTP ${bundle.status}: ${bundle.url}`);
    return;
  }
  try {
    const payload = JSON.parse(bundle.body);
    if (payload.source !== "terminal-fast-bundle") {
      issues.push(`terminal-fast-bundle live source mismatch: ${payload.source || "(empty)"}`);
    }
    if (!payload.endpoints || typeof payload.endpoints !== "object") {
      issues.push("terminal-fast-bundle live endpoints missing");
    }
    if (!Array.isArray(payload.misses)) {
      issues.push("terminal-fast-bundle live misses missing");
    }
    console.log(
      `[runtime-hotfix] live terminal-fast-bundle ok partial=${Boolean(payload.partial)} misses=${payload.misses?.length || 0}`,
    );
  } catch (error) {
    issues.push(`terminal-fast-bundle live invalid JSON: ${error.message}`);
  }
}

async function main() {
  requireMarker("terminal-hotfix.js", EXPECTED_HOTFIX, `hotfix ${EXPECTED_HOTFIX}`);
  requireMarker("terminal-hotfix.js", "/api/terminal-fast-bundle");
  requireMarker("terminal-hotfix.js", "FUMAN_HOTFIX_PRIME_API_CACHE");
  requireMarker("terminal-hotfix.js", "installHotPathDataWarmup");
  requireMarker("terminal-hotfix.js", "primeApiCache");
  requireMarker("terminal-hotfix.js", "FUMAN_DESKTOP_API_SESSION_CACHE");
  requireMarker("terminal-hotfix.js", "readSessionRecord");
  requireMarker("terminal-hotfix.js", "fuman-desktop-fast-path");
  requireMarker("terminal-hotfix.js", "installDesktopViewSnapshotCache");
  requireMarker("terminal-hotfix.js", "FUMAN_DESKTOP_VIEW_SNAPSHOT");
  requireMarker("terminal-hotfix.js", "FUMAN_HOTFIX_RESTORE_VIEW_SNAPSHOT");
  requireMarker("terminal-hotfix.js", "__fumanWatchlistAddBridge = \"20260628-06\"", "watchlist bridge 20260628-06");
  requireMarker("terminal-hotfix.js", "finishShellAdd", "watchlist async shell add bridge");
  requireMarker("terminal-hotfix.js", "watchlist-storage-guard-20260628-03", "watchlist placeholder storage blocker");
  requireMarker("terminal-hotfix.js", "scheduleShellValidation", "watchlist storage validation handoff");
  requireMarker("terminal-watchlist-shell.js", "watchlist-rich-shell-20260711-03", "watchlist redesigned shell 20260711-03");
  requireMarker("terminal-watchlist-shell.js", "memoryRows", "watchlist memory-backed rows");
  requireMarker("terminal-watchlist-shell.js", "validateTaiwanStockCode", "watchlist Taiwan stock validation");
  requireMarker("terminal-watchlist-shell.js", "不是有效上市/上櫃台股代號", "watchlist invalid stock blocker");
  requireMarker("terminal-watchlist-shell.js", "mode: \"watchlist-redesign\"", "watchlist redesign mode");
  requireMarker("fuman-sw.js", "purgeOldWatchlistAssets", "watchlist stale cache purge");
  requireMarker("fuman-sw.js", "CLEAR_WATCHLIST_CACHE", "watchlist cache clear message");
  requireMarker("terminal-hotfix.js", "stale-while-revalidate");
  requireMarker("terminal-hotfix.js", "stale-if-error");
  requireMarker("terminal-hotfix.js", "observedPanels");
  requireMarker("terminal.js", "unlockPublicTerminalShell");
  requireMarker("terminal.js", "FUMAN_PUBLIC_TERMINAL_UNLOCK");
  requireMarker("terminal-app.js", "status:\"public_terminal\"");
  requireMarker("terminal-app.js", "FUMAN_SUPABASE_URL&&FUMAN_SUPABASE_KEY");
  requireMarker("version.json", EXPECTED_FRONTEND_VERSION);
  requireMarker("terminal-core.js", `const version = "${EXPECTED_FRONTEND_VERSION}"`);
  requireMarker("index.html", `terminal-core.js?v=${EXPECTED_FRONTEND_VERSION}`);
  requireMarker("index.html", "terminal-hotfix.js?watchlist-bridge=20260628-06");
  requireMarker("fuman-sw.js", `fuman-terminal-sw-${EXPECTED_FRONTEND_VERSION}`);
  for (const file of ["version.json", "index.html", "terminal-core.js", "fuman-sw.js"]) {
    if (read(file).includes("strategy1-two-cards-20260623-03")) {
      issues.push(`${file} still contains retired frontend version`);
    }
  }

  requireMarker("index.html", "/api/mobile-page");
  requireMarker("index.html", "public-terminal");
  if (read("index.html").includes('<body class="auth-pending">')) {
    issues.push("index.html must not start in auth-pending mode");
  }
  if (read("index.html").includes("fuman_force_desktop")) {
    issues.push("index.html must not persist mobile users into desktop mode");
  }
  requireMarker(path.join("api", "mobile-page.js"), "mobile.html");
  requireMarker(path.join("api", "mobile-page.js"), "text/html; charset=utf-8");
  requireMarker("mobile.html", "slice(0,10)", "mobile watchlist cap slice");
  requireMarker("mobile.html", "自選股已達 10 檔上限", "mobile watchlist cap toast");
  requireMarker("mobile.html", "data-watch-remove", "mobile watchlist remove control");

  requireMarker(path.join("api", "terminal-fast-bundle.js"), "source: \"terminal-fast-bundle\"");
  requireMarker(path.join("api", "terminal-fast-bundle.js"), "partial");
  requireMarker(path.join("api", "terminal-fast-bundle.js"), "misses");
  requireMarker(path.join("api", "terminal-fast-bundle.js"), "fast_bundle_timeout");
  requireMarker(path.join("api", "terminal-fast-bundle.js"), "Promise.all");

  requireMarker("fuman-sw.js", "/api/terminal-fast-bundle");
  requireMarker("fuman-sw.js", "DATA_PATTERNS");
  requireMarker("fuman-sw.js", "PREFETCH_CORE_DATA_ASSETS");

  const vercel = read("vercel.json");
  requireMarker("vercel.json", "/api/mobile-page");
  requireMarker("vercel.json", "includeFiles");
  requireMarker("vercel.json", "mobile.html");
  requireJsonHeader(vercel, "/terminal-hotfix.js", "no-store");
  requireJsonHeader(vercel, "/fuman-sw.js", "no-store");
  if (!vercel.includes("terminal-hotfix\\\\.js$")) {
    issues.push("vercel.json immutable JS rule does not exclude terminal-hotfix.js");
  }
  if (!vercel.includes("fuman-sw\\\\.js$")) {
    issues.push("vercel.json immutable JS rule does not exclude fuman-sw.js");
  }

  if (LIVE) {
    await verifyLive();
  }

  if (issues.length > 0) {
    console.error("[runtime-hotfix] rollback guard failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log(`[runtime-hotfix] ok hotfix=${EXPECTED_HOTFIX}${LIVE ? " live=ok" : ""}`);
}

main().catch((error) => {
  console.error(`[runtime-hotfix] failed: ${error.stack || error.message}`);
  process.exit(1);
});
