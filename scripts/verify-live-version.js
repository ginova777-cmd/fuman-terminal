const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RETRY = process.argv.includes("--retry");
const ATTEMPTS = Number(process.env.FUMAN_VERIFY_LIVE_ATTEMPTS || (RETRY ? 12 : 1));
const DELAY_MS = Number(process.env.FUMAN_VERIFY_LIVE_DELAY_MS || 10000);
const RELEASE_SHA = normalizeSha(process.env.FUMAN_RELEASE_SHA || process.env.FUMAN_DEPLOY_SHA);

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex").toUpperCase();
}

function normalizeSha(value) {
  return String(value || "").trim().toLowerCase();
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

function detectLocalVersion() {
  const match = read("terminal-core.js").match(/const\s+version\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error("Unable to detect local version");
  return match[1];
}

async function expectOk(name, pathname, check) {
  const fresh = pathname.includes("?") ? `&fresh=${Date.now()}` : `?fresh=${Date.now()}`;
  const result = await fetchText(`${pathname}${fresh}`);
  if (result.status < 200 || result.status >= 300) throw new Error(`${name} HTTP ${result.status}`);
  if (!check(result.body)) throw new Error(`${name} check failed`);
  console.log(`[live-version] ${name} ok`);
  return result.body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function desktopFastShellSrc(version) {
  return `terminal-desktop-fast-shell.js?buy-sell-derived-fields=20260629-01&strategy2-history=20260629-01&protected-no-stale-first-paint=20260724-01&v=${version}`;
}

function verifyUnifiedFrontendRelease(home, desktopShell, version) {
  const expectedScripts = [
    "terminal-entitlement-guard.js",
    "terminal-ai-risk-guard.js",
    "terminal-hotfix.js",
    "terminal-watchlist-shell.js",
    "terminal-desktop-fast-shell.js",
    "terminal-core.js",
    "terminal-market-ai-live-watchdog.js",
    "terminal-market-overview-restore.js",
  ];
  for (const file of expectedScripts) {
    if (file === "terminal-desktop-fast-shell.js") continue;
    if (!home.includes(`src="${file}?v=${version}"`)) {
      throw new Error(`unified frontend release missing ${file}?v=${version}`);
    }
  }
  if (!home.includes(`src="${desktopFastShellSrc(version)}"`)) {
    throw new Error(`unified frontend release missing ${desktopFastShellSrc(version)}`);
  }
  const desktopEntry = home.match(/src="(terminal-desktop-fast-shell\.js[^"]*)"/);
  if (!desktopEntry || desktopEntry[1] !== desktopFastShellSrc(version)) {
    throw new Error("desktop fast-shell must use the buy-sell field contract marker and exactly one release version token");
  }
  if (home.includes("strategy4-daily-kline=") || home.includes("watchlist-mainforce-resonance=") || home.includes("market-overview-restore=")) {
    throw new Error("legacy per-feature frontend version token remains in production entry");
  }
  if (!desktopShell.includes(`window.FUMAN_TERMINAL_BOOT?.version || window.FUMAN_TERMINAL_VERSION || "${version}"`)) {
    throw new Error("desktop fast-shell fallback must use the unified release version");
  }
  if (!desktopShell.includes("`/terminal-app.js?v=${encodeURIComponent(version)}`")) {
    throw new Error("desktop dynamic terminal app must use the unified release version");
  }
  console.log("[live-version] unified frontend release ok");
}

function verifyAllUnifiedFrontendRelease({ scorecard, mobile, auth, serviceWorker, desktopShell, watchlistModule, watchlistShell, version }) {
  for (const [page, body, asset] of [
    ["/88", scorecard, `terminal-entitlement-guard.js?v=${version}`],
    ["/mobile.html", mobile, `terminal-entitlement-guard.js?v=${version}`],
    ["/auth.html", auth, `terminal-runtime-config.js?v=${version}`],
  ]) {
    if (!body.includes(asset)) throw new Error(`${page} must use the unified release ${asset}`);
    if (/membership-lock=|public-terminal-fast-20260714-(?:19|20)/.test(body)) throw new Error(`${page} retains a legacy frontend cache token`);
  }
  if (!desktopShell.includes("terminal-watchlist-shell.js?v=${encodeURIComponent(version)}") || !desktopShell.includes("terminal-realtime-radar.css?v=${encodeURIComponent(terminalFastVersion())}")) {
    throw new Error("desktop dynamic assets must use the unified release version");
  }
  if (!watchlistModule.includes("function releaseVersion()") || !watchlistModule.includes("terminal-watchlist-shell.js?v=${encodeURIComponent(releaseVersion())}")) {
    throw new Error("watchlist module must load the shell with the unified release version");
  }
  if (!watchlistShell.includes(`const VERSION = \"${version}\"`)) throw new Error("watchlist shell must report the unified release version");
  for (const asset of ["terminal-core.js", "terminal-desktop-fast-shell.js", "terminal-watchlist-shell.js", "terminal-market-overview-restore.js", "terminal-realtime-radar.css"]) {
    if (!serviceWorker.includes(`/${asset}?v=${version}`)) throw new Error(`service worker missing unified ${asset}`);
  }
  if (/ASSET_EPOCH|desktop-fast-shell-core-|watchlist-mainforce-resonance/.test(serviceWorker)) throw new Error("service worker retains a legacy feature cache epoch");
  console.log("[live-version] all terminal entry points share one release version");
}
function verifyMarketOverviewDirectApiFallback(restore) {
  const required = [
    'typeof window.FUMAN_MARKET_DIRECT_PAINT === "function"',
    'if (window.__fumanDesktopFastShell) {',
    'window.FUMAN_MARKET_DIRECT_PAINT = run',
    'xhrJson("/api/market?canvas=1&compact=1&shell=1&limit=24")',
    '[600, 2400, 6800, 12000, 25000].forEach((delay) => setTimeout(run, delay))',
  ];
  for (const marker of required) {
    if (!restore.includes(marker)) throw new Error("market overview direct API fallback missing " + marker);
  }
  if (restore.includes('window.__fumanDesktopFastShell === "20260623-09"')) {
    throw new Error("market overview direct API fallback is restricted to a retired desktop shell version");
  }
  console.log("[live-version] market overview direct API fallback ok");
}

function verifyMarketEventReminderGuard(app, desktopShell) {
  const required = [
    "installMarketSettlementTitleBadgeGuard",
    "台指期大結算",
    "美股四巫日",
    "market-nav-label",
    'title.appendChild(document.createTextNode(" "))',
  ];
  for (const marker of required) {
    if (!app.includes(marker)) throw new Error(`market event reminder guard missing ${marker}`);
  }
  const taiexIndex = app.indexOf("台指期大結算");
  const witchingIndex = app.indexOf("美股四巫日");
  if (taiexIndex < 0 || witchingIndex < 0 || taiexIndex > witchingIndex) {
    throw new Error("market event reminder order must be 台指期大結算 before 美股四巫日");
  }
  console.log("[live-version] market event reminders ok");

  const desktopRequired = [
    "installMarketSettlementDesktopBadge",
    "data-market-settlement-title",
    "data-market-settlement-nav",
    "data-market-settlement-banner",
    "市場事件：",
    "MutationObserver",
    "台指期大結算",
    "window.setInterval(render, 60000)",
  ];
  for (const marker of desktopRequired) {
    if (!desktopShell.includes(marker)) throw new Error(`desktop market event reminder missing ${marker}`);
  }
  const normalizedDesktopShell = desktopShell.replace(/\r\n/g, "\n");
  const watchlistStart = normalizedDesktopShell.indexOf("installMarketAiWatchlistActions");
  const watchlistClose = normalizedDesktopShell.indexOf("\n  })();", watchlistStart);
  const settlementStart = normalizedDesktopShell.indexOf("installMarketSettlementDesktopBadge");
  if (watchlistStart < 0 || watchlistClose < 0 || settlementStart <= watchlistClose) {
    throw new Error("desktop market event reminder must be initialized outside the watchlist guard");
  }
  console.log("[live-version] desktop market event reminder ok");
}

function verifyMarketAiPriorityRiskGuard(text) {
  const required = [
    "installMarketAiPriorityRiskGuard",
    "installMarketAiLiveContractPanel",
    "installMarketHeatmapLiveContractPanel",
    "載入今日正式 AI 判讀/熱力圖資料中",
    "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40",
    "/api/heatmap?limit=999&stocks=999&source=desktop-live-contract",
    "staleLegacyPanel",
    "staleLegacyHeatmap",
    "事件波動風險最高",
    "個股極端波動風險",
    "AI 盤中/盤後模式風險",
  ];
  for (const marker of required) {
    if (!text.includes(marker)) throw new Error(`AI priority risk guard missing ${marker}`);
  }
  console.log("[live-version] AI priority risk guard ok");
}

async function verifyOnce() {
  const version = detectLocalVersion();
  await expectOk("version-json", "/version.json", (body) => {
    try {
      return JSON.parse(body)?.version === version;
    } catch {
      return false;
    }
  });
  if (RELEASE_SHA) {
    await expectOk("release-manifest", "/api/release-manifest", (body) => {
      try {
        const payload = JSON.parse(body);
        return payload?.version === version && normalizeSha(payload?.gitSha) === RELEASE_SHA;
      } catch {
        return false;
      }
    });
  }
  const home = await expectOk("home", "/", (body) => body.includes(`terminal-core.js?v=${version}`) && body.includes(`terminal-ai-risk-guard.js?v=${version}`) && body.includes(`terminal-market-ai-live-watchdog.js?v=${version}`) && body.includes(`styles.css?v=${version}`));
  await expectOk("core", `/terminal-core.js?v=${version}`, (body) => body.includes(`const version = "${version}"`) && body.includes("FUMAN_TERMINAL_VERSION"));
  await expectOk("bootstrap", `/terminal.js?v=${version}`, (body) => body.includes("terminal-app.js"));
  await expectOk("service-worker", `/fuman-sw.js?v=${version}`, (body) => body.includes(`fuman-terminal-sw-${version}`) && body.includes(`/terminal-app.js?v=${version}`) && body.includes(`/terminal-market-ai-live-watchdog.js?v=${version}`) && body.includes("networkFirstStatic"));
  const app = await expectOk("terminal-app", `/terminal-app.js?v=${version}`, (body) => body.includes("FUMAN_SUPABASE_URL") && body.includes("renderWatchlist"));
  const localAppHash = sha256(read("terminal-app.js"));
  const liveAppHash = sha256(app);
  if (localAppHash !== liveAppHash) {
    throw new Error(`terminal-app hash mismatch local=${localAppHash} live=${liveAppHash}`);
  }
  const watchdog = await expectOk("market-ai-live-watchdog", `/terminal-market-ai-live-watchdog.js?v=${version}`, (body) => body.includes("installMarketAiLiveWatchdog") && body.includes("/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40") && body.includes("不顯示舊 panel cache"));
  const localWatchdogHash = sha256(read("terminal-market-ai-live-watchdog.js"));
  const liveWatchdogHash = sha256(watchdog);
  if (localWatchdogHash !== liveWatchdogHash) {
    throw new Error(`market-ai-live-watchdog hash mismatch local=${localWatchdogHash} live=${liveWatchdogHash}`);
  }
  const desktopShell = await expectOk("desktop-fast-shell", `/terminal-desktop-fast-shell.js?v=${version}`, (body) => body.includes("FUMAN_DESKTOP_ROUTE_SNAPSHOT"));
  const localDesktopShellHash = sha256(read("terminal-desktop-fast-shell.js"));
  const liveDesktopShellHash = sha256(desktopShell);
  if (localDesktopShellHash !== liveDesktopShellHash) {
    throw new Error("desktop-fast-shell hash mismatch local=" + localDesktopShellHash + " live=" + liveDesktopShellHash);
  }
  const marketRestore = await expectOk("market-overview-restore", "/terminal-market-overview-restore.js?v=" + version, (body) => body.includes("window.FUMAN_MARKET_DIRECT_PAINT = run"));
  const localMarketRestoreHash = sha256(read("terminal-market-overview-restore.js"));
  const liveMarketRestoreHash = sha256(marketRestore);
  if (localMarketRestoreHash !== liveMarketRestoreHash) {
    throw new Error("market-overview-restore hash mismatch local=" + localMarketRestoreHash + " live=" + liveMarketRestoreHash);
  }
  verifyMarketOverviewDirectApiFallback(marketRestore);
  verifyUnifiedFrontendRelease(home, desktopShell, version);
  const scorecard = await expectOk("scorecard-page", "/88", (body) => body.includes(`terminal-entitlement-guard.js?v=${version}`));
  const mobile = await expectOk("mobile-page", "/mobile", (body) => body.includes(`terminal-entitlement-guard.js?v=${version}`));
  const auth = await expectOk("auth-page", "/auth", (body) => body.includes(`terminal-runtime-config.js?v=${version}`));
  const watchlistModule = await expectOk("watchlist-module", `/terminal-watchlist-module.js?v=${version}`, (body) => body.includes("function releaseVersion()"));
  const watchlistShell = await expectOk("watchlist-shell", `/terminal-watchlist-shell.js?v=${version}`, (body) => body.includes(`const VERSION = "${version}"`));
  const serviceWorker = await expectOk("service-worker-unified", `/fuman-sw.js?v=${version}`, (body) => body.includes(`fuman-terminal-sw-${version}`));
  verifyAllUnifiedFrontendRelease({ scorecard, mobile, auth, serviceWorker, desktopShell, watchlistModule, watchlistShell, version });
  verifyMarketEventReminderGuard(app, desktopShell);
  const riskGuard = await expectOk("AI priority risk guard", `/terminal-ai-risk-guard.js?v=${version}`, (body) => body.includes("installMarketAiPriorityRiskGuard"));
  verifyMarketAiPriorityRiskGuard(riskGuard);
  console.log(`[live-version] ok version=${version} release=${RELEASE_SHA ? RELEASE_SHA.slice(0, 8) : "none"} terminal-app=${liveAppHash}`);
}

async function main() {
  let lastError = null;
  const attempts = Math.max(1, ATTEMPTS);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (attempt > 1) console.log(`[live-version] retry ${attempt}/${attempts}`);
      await verifyOnce();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      console.warn(`[live-version] waiting for alias/version propagation: ${error.message}`);
      await sleep(DELAY_MS);
    }
  }
  throw lastError || new Error("live version verification failed");
}

main().catch((error) => {
  console.error(`[live-version] failed: ${error.message}`);
  process.exit(1);
});
