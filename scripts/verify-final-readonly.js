const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const RELEASE_SHA = normalizeSha(
  readArg("--release-sha") ||
  process.env.FUMAN_RELEASE_SHA ||
  process.env.FUMAN_DEPLOY_SHA
);
const EXPECTED_VERSION = String(readArg("--version") || process.env.FUMAN_RELEASE_VERSION || "").trim();

const issues = [];
const warnings = [];

function readArg(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] || "";
  return "";
}

function normalizeSha(value) {
  return String(value || "").trim().toLowerCase();
}

function requestJson(pathname, timeoutMs = 30000) {
  const fresh = pathname.includes("?") ? `&readonly=${Date.now()}` : `?readonly=${Date.now()}`;
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

function runMirrorGuard() {
  const args = ["scripts/verify-production-mirror-guard.js"];
  if (RELEASE_SHA) args.push(`--release-sha=${RELEASE_SHA}`);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env: process.env,
  });
  if (result.status !== 0) {
    issues.push(`production mirror guard failed: ${`${result.stdout || ""}${result.stderr || ""}`.trim()}`);
  }
}

function issueWhen(condition, message) {
  if (condition) issues.push(message);
}

async function main() {
  if (!RELEASE_SHA) {
    issues.push("FUMAN_RELEASE_SHA is required for final read-only verification; do not verify against moving main");
  }
  runMirrorGuard();

  const [manifestResult, versionResult, healthResult, bundleResult] = await Promise.all([
    requestJson("/api/release-manifest", 25000).catch((error) => ({ status: 0, body: { ok: false, error: error.message } })),
    requestJson("/version.json", 15000).catch((error) => ({ status: 0, body: { ok: false, error: error.message } })),
    requestJson("/api/production-health", 35000).catch((error) => ({ status: 0, body: { ok: false, error: error.message } })),
    requestJson("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1", 35000).catch((error) => ({ status: 0, body: { ok: false, error: error.message } })),
  ]);

  const manifest = manifestResult.body || {};
  const version = versionResult.body || {};
  const health = healthResult.body || {};
  const bundle = bundleResult.body || {};

  issueWhen(manifestResult.status < 200 || manifestResult.status >= 300, `release manifest HTTP ${manifestResult.status}: ${manifest.error || ""}`);
  issueWhen(manifest.ok === false, `release manifest not ok: ${manifest.error || "missing release identity"}`);
  issueWhen(!manifest.gitSha, "release manifest gitSha missing");
  issueWhen(!manifest.deployId && !manifest.deploymentId, "release manifest deployId missing");
  issueWhen(versionResult.status < 200 || versionResult.status >= 300, `version.json HTTP ${versionResult.status}: ${version.error || ""}`);
  issueWhen(healthResult.status < 200 || healthResult.status >= 300 || health.ok === false, `production-health unhealthy HTTP ${healthResult.status}: ${(health.issues || [health.error]).filter(Boolean).join("; ")}`);
  issueWhen(bundleResult.status < 200 || bundleResult.status >= 300 || bundle.ok === false, `terminal-fast-bundle unhealthy HTTP ${bundleResult.status}: ${bundle.error || ""}`);

  if (RELEASE_SHA && normalizeSha(manifest.gitSha) !== RELEASE_SHA) {
    issues.push(`release manifest SHA mismatch: live=${String(manifest.gitSha || "").slice(0, 8) || "(missing)"} release=${RELEASE_SHA.slice(0, 8)}`);
  }
  if (EXPECTED_VERSION && manifest.version !== EXPECTED_VERSION) {
    issues.push(`release manifest version mismatch: live=${manifest.version || "(missing)"} expected=${EXPECTED_VERSION}`);
  }
  if (manifest.version && version.version && manifest.version !== version.version) {
    issues.push(`version.json mismatch: version=${version.version} manifest=${manifest.version}`);
  }

  const healthIssues = Array.isArray(health.issues) ? health.issues : [];
  const healthWarnings = Array.isArray(health.warnings) ? health.warnings : [];
  issueWhen(healthIssues.length > 0, `production-health issues: ${healthIssues.join("; ")}`);
  if (healthWarnings.length) warnings.push(`production-health warnings: ${healthWarnings.join("; ")}`);

  const snapshot = health.snapshot || {};
  issueWhen(snapshot.hit !== true, "production-health snapshot hit is not true");
  issueWhen(snapshot.fresh !== true, "production-health snapshot fresh is not true");
  issueWhen(snapshot.partial !== false, "production-health snapshot partial is not false");
  issueWhen(Number(snapshot.endpointCount || 0) < 10, `production-health snapshot endpoint count too low: ${snapshot.endpointCount || 0}`);

  issueWhen(bundle.snapshotHit !== true, "terminal-fast-bundle snapshotHit is not true");
  issueWhen(bundle.snapshotFresh !== true, "terminal-fast-bundle snapshotFresh is not true");
  issueWhen(bundle.partial !== false, "terminal-fast-bundle partial is not false");
  issueWhen(Number(Object.keys(bundle.endpoints || {}).length) < 10, "terminal-fast-bundle endpoint count too low");
  issueWhen(Object.keys(bundle.endpoints || {}).some((endpoint) => /strategy2-latest/i.test(endpoint)), "terminal-fast-bundle includes strategy2 cold endpoint");

  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    mode: "read-only",
    baseUrl: BASE_URL,
    releaseSha: RELEASE_SHA,
    version: manifest.version || version.version || "",
    issues,
    warnings,
    releaseManifest: {
      status: manifestResult.status,
      gitSha: manifest.gitSha || "",
      deployId: manifest.deployId || manifest.deploymentId || "",
      version: manifest.version || "",
    },
    productionHealth: {
      status: healthResult.status,
      ok: health.ok,
      updatedAt: health.updatedAt || "",
      issueCount: healthIssues.length,
      snapshot: {
        hit: snapshot.hit,
        fresh: snapshot.fresh,
        partial: snapshot.partial,
        endpointCount: snapshot.endpointCount,
        updatedAt: snapshot.updatedAt || "",
      },
    },
    fastBundle: {
      status: bundleResult.status,
      ok: bundle.ok,
      snapshotHit: bundle.snapshotHit,
      snapshotFresh: bundle.snapshotFresh,
      partial: bundle.partial,
      endpointCount: Object.keys(bundle.endpoints || {}).length,
      updatedAt: bundle.updatedAt || "",
    },
  };

  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(`[final-readonly] failed: ${error.stack || error.message}`);
  process.exit(1);
});
