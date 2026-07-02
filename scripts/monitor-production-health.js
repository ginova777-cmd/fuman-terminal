const fs = require("fs");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  issue: terminalIssue,
  notifyIfNeeded,
  shouldDetectToday,
  shouldRequireToday,
  taipeiClock,
} = require("./monitor-terminal-api-health");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LOG_FILE = process.env.FUMAN_PRODUCTION_HEALTH_LOG || path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "logs", "production-health.jsonl");
const RELEASE_SHA = String(process.env.FUMAN_RELEASE_SHA || process.env.FUMAN_DEPLOY_SHA || "").trim().toLowerCase();

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function detectVersion() {
  const match = read("terminal-core.js").match(/const\s+version\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error("Unable to detect local version");
  return match[1];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRequestError(error) {
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|timeout/i.test(String(error?.message || error || ""));
}

function requestJsonOnce(pathname, timeoutMs = 30000) {
  const fresh = pathname.includes("?") ? `&health=${Date.now()}` : `?health=${Date.now()}`;
  const url = `${BASE_URL}${pathname}${fresh}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ url, status: res.statusCode, body: JSON.parse(body || "{}") });
        } catch (error) {
          reject(new Error(`invalid JSON from ${url}: ${error.message}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

async function requestJson(pathname, timeoutMs = 30000) {
  const attempts = Math.max(1, Number(process.env.FUMAN_PRODUCTION_MONITOR_REQUEST_ATTEMPTS || 3) || 3);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await requestJsonOnce(pathname, timeoutMs);
      if (attempt > 1) result.retried = attempt - 1;
      return result;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientRequestError(error)) throw error;
      await sleep(750 * attempt);
    }
  }
  throw lastError;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function writeLog(payload) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {}
}

function endpointHasStrategy2(endpoints = {}) {
  return Object.keys(endpoints || {}).some((endpoint) => /strategy2-latest/i.test(endpoint));
}

function num(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replace(/[,%]/g, "").trim()) || 0;
}

function liveContractIssueTarget(clock, issues, warnings) {
  return shouldRequireToday(clock, false) ? issues : warnings;
}

function pushLiveContractIssue(clock, issues, warnings, message) {
  liveContractIssueTarget(clock, issues, warnings).push(message);
}

function compactDate(value) {
  const text = String(value || "");
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(parsed)).replace(/\D/g, "");
  }
  return text.replace(/\D/g, "").slice(0, 8);
}

async function checkHeatmapLiveContract(clock) {
  const result = await requestJson("/api/heatmap?limit=999&stocks=999&source=desktop-live-contract", 120000).catch((error) => ({
    status: 0,
    body: { ok: false, error: error.message },
  }));
  const body = result.body || {};
  const health = body.health || {};
  const contract = health.contract || body.sourceInfo || {};
  const formalSource = body.formalSource || health.formalSource || contract.source || "";
  const tradeDate = compactDate(body.today || body.resolvedTradeDate || body.tradeDate || health.today || body.meta?.today);
  const stockCount = num(body.stockCount || health.stockCount);
  const badDate = num(health.badDate ?? health.badDateCount ?? body.meta?.badDateCount);
  const fallbackUsed = body.fallbackUsed === true || health.formalSourceFallbackUsed === true || contract.fallbackUsed === true;
  const todayRequired = shouldRequireToday(clock, false);
  const issues = [];
  const warnings = [];
  const liveMessages = todayRequired ? issues : warnings;

  if (result.status < 200 || result.status >= 300 || body.ok === false) {
    liveMessages.push(`heatmap live API unhealthy HTTP ${result.status}: ${body.error || body.reason || health.formalSourceIssue || (todayRequired ? "ok=false" : "premarket waiting for today's live quote")}`);
  }
  if (formalSource !== "supabase:fugle_quotes_live") {
    issues.push(`heatmap formalSource mismatch: ${formalSource || "(missing)"}`);
  }
  if (stockCount < 500) liveMessages.push(`heatmap stockCount too low: ${stockCount}`);
  if (health.isHealthy === false) liveMessages.push(`heatmap health.isHealthy=false: ${health.issue || health.formalSourceIssue || body.error || ""}`);
  if (todayRequired && tradeDate !== clock.ymd) issues.push(`heatmap tradeDate stale: live=${tradeDate || "(missing)"} today=${clock.ymd}`);
  if (todayRequired && badDate > 0) issues.push(`heatmap badDate rows: ${badDate}`);
  if (todayRequired && fallbackUsed) issues.push(`heatmap fallbackUsed=true`);

  return {
    ok: issues.length === 0,
    status: result.status,
    endpoint: "/api/heatmap?limit=999&stocks=999&source=desktop-live-contract",
    formalSource,
    tradeDate,
    stockCount,
    badDate,
    fallbackUsed,
    isHealthy: health.isHealthy !== false,
    todayRequired,
    issues,
    warnings,
  };
}

async function checkMarketAiLiveContract(clock) {
  const result = await requestJson("/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40", 120000).catch((error) => ({
    status: 0,
    body: { ok: false, error: error.message },
  }));
  const body = result.body || {};
  const freshness = body.dataFreshness || {};
  const sourceIssues = Array.isArray(freshness.sourceIssues) ? freshness.sourceIssues.filter(Boolean) : [];
  const staleSources = Array.isArray(freshness.staleSources) ? freshness.staleSources.filter(Boolean) : [];
  const payloadClosed = body.marketSession?.closed === true;
  const todayRequired = shouldRequireToday(clock, payloadClosed);
  const dashboardTradeDate = compactDate(body.dashboard?.tradeDate);
  const heatmapTradeDate = compactDate(freshness.heatmapTradeDate);
  const radarTradeDate = compactDate(freshness.radarTradeDate);
  const baseTradeDate = compactDate(freshness.baseTradeDate);
  const issues = [];
  const warnings = [];
  const liveMessages = todayRequired ? issues : warnings;

  if (result.status < 200 || result.status >= 300 || body.ok === false) {
    issues.push(`market-ai-live unhealthy HTTP ${result.status}: ${body.error || "ok=false"}`);
  }
  if (body.source !== "live-api-bundle") liveMessages.push(`market-ai-live source mismatch: ${body.source || "(missing)"}`);
  if (body.cacheSource !== "api/market-ai-live") liveMessages.push(`market-ai-live cacheSource mismatch: ${body.cacheSource || "(missing)"}`);
  if (todayRequired && dashboardTradeDate !== clock.ymd) issues.push(`market-ai dashboardTradeDate stale: live=${dashboardTradeDate || "(missing)"} today=${clock.ymd}`);
  if (todayRequired && heatmapTradeDate !== clock.ymd) issues.push(`market-ai heatmapTradeDate stale: live=${heatmapTradeDate || "(missing)"} today=${clock.ymd}`);
  if (todayRequired && freshness.heatmapUsable !== true) issues.push(`market-ai heatmapUsable=false`);
  if (staleSources.length) liveMessages.push(`market-ai staleSources: ${staleSources.join("; ")}`);
  if (sourceIssues.length) liveMessages.push(`market-ai sourceIssues: ${sourceIssues.join("; ")}`);
  if (todayRequired && body.marketSession?.stale === true) {
    issues.push(`market-ai marketSession.stale=true: ${body.marketSession?.reason || ""}`);
  }

  return {
    ok: issues.length === 0,
    status: result.status,
    endpoint: "/api/market-ai-live?canvas=1&compact=1&shell=1&limit=40",
    source: body.source || "",
    cacheSource: body.cacheSource || "",
    dashboardTradeDate,
    heatmapTradeDate,
    radarTradeDate,
    baseTradeDate,
    heatmapUsable: freshness.heatmapUsable === true,
    staleSources,
    sourceIssues,
    todayRequired,
    marketSession: body.marketSession || null,
    issues,
    warnings,
  };
}

async function main() {
  const issues = [];
  const warnings = [];
  const strictGit = process.env.FUMAN_PRODUCTION_MONITOR_STRICT_GIT === "1";
  const clock = taipeiClock();
  const version = detectVersion();
  const localHead = git(["rev-parse", "HEAD"]);
  const originHead = git(["ls-remote", "origin", "refs/heads/main"]);
  const originSha = originHead.stdout.split(/\s+/)[0] || "";

  const health = await requestJson("/api/production-health", 35000).catch((error) => ({
    status: 0,
    body: { ok: false, error: error.message },
  }));
  const manifest = await requestJson("/api/release-manifest", 25000).catch((error) => ({
    status: 0,
    body: { ok: false, error: error.message },
  }));
  const bundle = await requestJson("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1", 35000).catch((error) => ({
    status: 0,
    body: { ok: false, error: error.message },
  }));
  const versionJson = await requestJson("/version.json", 15000).catch((error) => ({
    status: 0,
    body: { ok: false, error: error.message },
  }));
  const heatmapLive = await checkHeatmapLiveContract(clock);
  const marketAiLive = await checkMarketAiLiveContract(clock);

  if (!localHead.ok) (strictGit ? issues : warnings).push(`local git head unavailable: ${localHead.stderr}`);
  if (originHead.ok && originSha && localHead.stdout && originSha !== localHead.stdout) {
    (strictGit ? issues : warnings).push(`local HEAD differs from origin/main: local=${localHead.stdout.slice(0, 8)} origin=${originSha.slice(0, 8)}`);
  }
  if (versionJson.body?.version !== version) issues.push(`live version mismatch: live=${versionJson.body?.version || "(missing)"} local=${version}`);

  const m = manifest.body || {};
  if (manifest.status < 200 || manifest.status >= 300 || m.ok === false) {
    issues.push(`release-manifest unhealthy HTTP ${manifest.status}: ${m.error || "missing release identity"}`);
  }
  if (!m.gitSha) issues.push("release-manifest gitSha missing");
  if (!m.deployId && !m.deploymentId) issues.push("release-manifest deployId missing");
  if (RELEASE_SHA && String(m.gitSha || "").trim().toLowerCase() !== RELEASE_SHA) {
    issues.push(`release-manifest SHA mismatch: live=${String(m.gitSha || "").slice(0, 8) || "(missing)"} release=${RELEASE_SHA.slice(0, 8)}`);
  }

  const b = bundle.body || {};
  if (bundle.status < 200 || bundle.status >= 300 || b.ok === false) pushLiveContractIssue(clock, issues, warnings, `terminal-fast-bundle unhealthy HTTP ${bundle.status}`);
  if (b.snapshotHit !== true) pushLiveContractIssue(clock, issues, warnings, "terminal-fast-bundle snapshotHit is not true");
  if (b.snapshotFresh !== true) pushLiveContractIssue(clock, issues, warnings, "terminal-fast-bundle snapshotFresh is not true");
  if (b.partial !== false) pushLiveContractIssue(clock, issues, warnings, "terminal-fast-bundle partial is not false");
  if (Number(Object.keys(b.endpoints || {}).length) < 10) pushLiveContractIssue(clock, issues, warnings, "terminal-fast-bundle endpoint count too low");
  if (endpointHasStrategy2(b.endpoints || {})) issues.push("terminal-fast-bundle includes strategy2 cold endpoint");

  const h = health.body || {};
  if (health.status < 200 || health.status >= 300 || h.ok === false) {
    const message = `production-health unhealthy HTTP ${health.status}: ${(h.issues || [h.error]).filter(Boolean).join("; ")}`;
    if (health.status === 0) {
      issues.push(message);
    } else {
      pushLiveContractIssue(clock, issues, warnings, message);
    }
  }
  for (const item of heatmapLive.issues) issues.push(item);
  for (const item of heatmapLive.warnings || []) warnings.push(item);
  for (const item of marketAiLive.issues) issues.push(item);
  for (const item of marketAiLive.warnings || []) warnings.push(item);

  const notification = await notifyIfNeeded({
    ok: issues.length === 0,
    source: "production-health-monitor",
    baseUrl: BASE_URL,
    updatedAt: new Date().toISOString(),
    issues: issues.map((message) => terminalIssue("critical", message)),
  });

  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    version,
    localHead: localHead.stdout || "",
    originHead: originSha,
    issues,
    warnings,
    monitorWindow: {
      taipeiDate: clock.ymd,
      taipeiTime: clock.time,
      detectToday: shouldDetectToday(clock, false),
      alertCritical: shouldRequireToday(clock, false),
      rule: "detect_today_from_0900_alert_critical_from_0905",
    },
    notification,
    releaseManifest: {
      status: manifest.status,
      ok: m.ok,
      gitSha: m.gitSha || "",
      deployId: m.deployId || m.deploymentId || "",
      version: m.version || "",
    },
    health: h,
    fastBundle: {
      ok: b.ok,
      snapshotHit: b.snapshotHit,
      snapshotFresh: b.snapshotFresh,
      partial: b.partial,
      endpointCount: Object.keys(b.endpoints || {}).length,
      hasStrategy2Snapshot: endpointHasStrategy2(b.endpoints || {}),
      cacheSource: b.cacheSource || "",
      updatedAt: b.updatedAt || "",
    },
    liveContracts: {
      heatmap: heatmapLive,
      marketAi: marketAiLive,
    },
  };

  writeLog(payload);
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  const payload = {
    ok: false,
    checkedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    error: error?.message || String(error),
  };
  writeLog(payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
