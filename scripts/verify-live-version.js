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

function verifyMarketEventReminderGuard(app) {
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
  const home = await expectOk("home", "/", (body) => body.includes(`terminal-core.js?v=${version}`) && body.includes(`terminal-ai-risk-guard.js?v=${version}`) && body.includes(`styles.css?v=${version}`));
  await expectOk("core", `/terminal-core.js?v=${version}`, (body) => body.includes(`const version = "${version}"`) && body.includes("FUMAN_TERMINAL_VERSION"));
  await expectOk("bootstrap", `/terminal.js?v=${version}`, (body) => body.includes("terminal-app.js"));
  await expectOk("service-worker", `/fuman-sw.js?v=${version}`, (body) => body.includes(`fuman-terminal-sw-${version}`) && body.includes(`/terminal-app.js?v=${version}`) && body.includes("networkFirstStatic"));
  const app = await expectOk("terminal-app", `/terminal-app.js?v=${version}`, (body) => body.includes("FUMAN_SUPABASE_URL") && body.includes("renderWatchlist"));
  const localAppHash = sha256(read("terminal-app.js"));
  const liveAppHash = sha256(app);
  if (localAppHash !== liveAppHash) {
    throw new Error(`terminal-app hash mismatch local=${localAppHash} live=${liveAppHash}`);
  }
  verifyMarketEventReminderGuard(app);
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
