const fs = require("fs");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");

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

function requestJson(pathname, timeoutMs = 30000) {
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

async function main() {
  const issues = [];
  const warnings = [];
  const strictGit = process.env.FUMAN_PRODUCTION_MONITOR_STRICT_GIT === "1";
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
  if (bundle.status < 200 || bundle.status >= 300 || b.ok === false) issues.push(`terminal-fast-bundle unhealthy HTTP ${bundle.status}`);
  if (b.snapshotHit !== true) issues.push("terminal-fast-bundle snapshotHit is not true");
  if (b.snapshotFresh !== true) issues.push("terminal-fast-bundle snapshotFresh is not true");
  if (b.partial !== false) issues.push("terminal-fast-bundle partial is not false");
  if (Number(Object.keys(b.endpoints || {}).length) < 10) issues.push("terminal-fast-bundle endpoint count too low");
  if (endpointHasStrategy2(b.endpoints || {})) issues.push("terminal-fast-bundle includes strategy2 cold endpoint");

  const h = health.body || {};
  if (health.status < 200 || health.status >= 300 || h.ok === false) {
    issues.push(`production-health unhealthy HTTP ${health.status}: ${(h.issues || [h.error]).filter(Boolean).join("; ")}`);
  }

  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    version,
    localHead: localHead.stdout || "",
    originHead: originSha,
    issues,
    warnings,
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
