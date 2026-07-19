"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-ops-production-live");
const BASE_URL = String(process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.FUMAN_VERIFY_PRODUCTION_LIVE_TIMEOUT_MS || 25000);
const EXPECTED_SHA = normalizeSha(process.env.FUMAN_RELEASE_SHA || process.env.FUMAN_DEPLOY_SHA || git(["rev-parse", "HEAD"]).stdout);

const DIRECT_PROTECTED_ENDPOINTS = [
  { name: "terminal_ops_status", path: "/api/terminal-ops-status" },
  { name: "scorecard", path: "/api/scorecard?live=1" },
  { name: "source_reports", path: "/api/source-reports?live=1" },
];

const REDACTED_LOCKED_ENDPOINTS = [
  {
    name: "terminal_fast_bundle",
    path: "/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70",
    forbiddenMarkers: [
      "strategy2-",
      "strategy3-",
      "strategy4-",
      "strategy5-",
      "institution-",
      "cb-detect-",
      "warrant-flow-",
      "/api/strategy2-latest",
      "/api/strategy3-latest",
      "/api/strategy4-latest",
      "/api/strategy5-latest",
      "/api/institution-latest",
      "/api/cb-detect-latest",
      "/api/warrant-flow-latest",
    ],
  },
  {
    name: "mobile_boot",
    path: "/api/mobile-boot",
    forbiddenMarkers: [
      "\"strategy2\"",
      "\"strategy3\"",
      "\"strategy4\"",
      "\"strategy5\"",
      "\"chip\"",
      "\"cb\"",
      "\"warrant\"",
    ],
  },
];

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function normalizeSha(value) {
  return String(value || "").trim().toLowerCase();
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function appendFreshParam(pathname) {
  const separator = pathname.includes("?") ? "&" : "?";
  return `${pathname}${separator}opsLive=${Date.now()}`;
}

function absoluteUrl(pathname) {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return `${BASE_URL}${appendFreshParam(pathname)}`;
}

function fetchText(pathname, options = {}, redirects = 0) {
  const url = absoluteUrl(pathname);
  const headers = {
    "cache-control": "no-cache",
    accept: options.accept || "application/json,text/html;q=0.9,*/*;q=0.8",
    ...(options.headers || {}),
  };
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: TIMEOUT_MS, headers }, (res) => {
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(Number(res.statusCode)) && location && redirects < 5) {
        res.resume();
        const nextUrl = new URL(location, url).toString();
        fetchText(nextUrl, options, redirects + 1).then(resolve, reject);
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ url, status: res.statusCode, headers: res.headers, body, redirects }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cacheControl(headers = {}) {
  return [
    headers["cache-control"],
    headers["cdn-cache-control"],
    headers["vercel-cdn-cache-control"],
  ].filter(Boolean).join(" ");
}

function noStore(headers = {}) {
  return /no-store/i.test(cacheControl(headers));
}

function hasShortLockedCache(headers = {}) {
  const value = cacheControl(headers);
  return noStore(headers) || /max-age=0/i.test(value) || /max-age=3/i.test(value);
}

function stripInvisibleHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<template[\s\S]*?<\/template>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

function assert(condition, issues, issue, details = {}) {
  if (!condition) issues.push({ issue, details });
}

function memberLockReason(payload) {
  return String(payload?.reason || payload?.protectedReason || payload?.error || payload?.code || "");
}

async function verifyReleaseManifest(issues) {
  const result = await fetchText("/api/release-manifest");
  const payload = parseJson(result.body);
  assert(result.status === 200, issues, "release_manifest_http_not_200", { status: result.status, url: result.url });
  assert(payload?.ok === true, issues, "release_manifest_not_ok", { payload });
  assert(Boolean(payload?.gitSha), issues, "release_manifest_missing_git_sha", { payload });
  assert(!EXPECTED_SHA || normalizeSha(payload?.gitSha) === EXPECTED_SHA, issues, "release_manifest_sha_mismatch", {
    live: payload?.gitSha || "",
    expected: EXPECTED_SHA,
  });
  assert(Boolean(payload?.deployId || payload?.deploymentId), issues, "release_manifest_missing_deploy_id", { payload });
  assert(noStore(result.headers), issues, "release_manifest_missing_no_store", { headers: result.headers });
  return {
    name: "release_manifest",
    url: result.url,
    status: result.status,
    ok: result.status === 200 && payload?.ok === true && (!EXPECTED_SHA || normalizeSha(payload?.gitSha) === EXPECTED_SHA),
    version: payload?.version || "",
    gitSha: payload?.gitSha || "",
    deployId: payload?.deployId || payload?.deploymentId || "",
    deploymentUrl: payload?.deploymentUrl || "",
    branch: payload?.branch || "",
    noStore: noStore(result.headers),
  };
}

async function verifyDirectProtectedEndpoint(item, issues) {
  const result = await fetchText(item.path);
  const payload = parseJson(result.body);
  const isProtected = result.status === 401
    && payload?.protected === true
    && payload?.error === "membership_required"
    && /missing_bearer_token|membership_required|invalid_or_expired_token|membership_not_enabled/i.test(memberLockReason(payload));
  assert(isProtected, issues, `direct_protected_endpoint_not_membership_required:${item.name}`, {
    path: item.path,
    status: result.status,
    payload,
    bodyPreview: String(result.body || "").slice(0, 240),
  });
  assert(noStore(result.headers), issues, `direct_protected_endpoint_missing_no_store:${item.name}`, { headers: result.headers });
  return {
    name: item.name,
    path: item.path,
    mode: "401-membership-required",
    status: result.status,
    protected: payload?.protected === true,
    error: payload?.error || "",
    reason: memberLockReason(payload),
    noStore: noStore(result.headers),
    ok: isProtected && noStore(result.headers),
  };
}

async function verifyRedactedLockedEndpoint(item, issues) {
  const result = await fetchText(item.path);
  const payload = parseJson(result.body);
  const bodyText = result.body || JSON.stringify(payload || {});
  const leaks = item.forbiddenMarkers.filter((marker) => bodyText.includes(marker));
  const isLocked = result.status === 200
    && payload?.protected === true
    && payload?.membershipRequired === true
    && leaks.length === 0;
  assert(isLocked, issues, `redacted_locked_endpoint_not_safe:${item.name}`, {
    path: item.path,
    status: result.status,
    membershipRequired: payload?.membershipRequired,
    protected: payload?.protected,
    leaks,
    bodyPreview: String(result.body || "").slice(0, 260),
  });
  assert(hasShortLockedCache(result.headers), issues, `redacted_locked_endpoint_cache_too_loose:${item.name}`, { headers: result.headers });
  return {
    name: item.name,
    path: item.path,
    mode: "200-redacted-locked-shell",
    status: result.status,
    protected: payload?.protected === true,
    membershipRequired: payload?.membershipRequired === true,
    reason: memberLockReason(payload),
    leaks,
    cacheControl: cacheControl(result.headers),
    ok: isLocked && hasShortLockedCache(result.headers),
    artifactVersion: payload?.bootHash || payload?.digest?.fragmentVersion || payload?.cacheSource || payload?.source || "",
    updatedAt: payload?.updatedAt || payload?.status?.updatedAt || "",
  };
}

async function verifyShell(pathname, markers, issues) {
  const result = await fetchText(pathname, { accept: "text/html,*/*;q=0.8" });
  const body = String(result.body || "");
  const visibleHtml = stripInvisibleHtml(body);
  assert(result.status === 200, issues, `shell_http_not_200:${pathname}`, { status: result.status, url: result.url });
  for (const marker of markers) {
    assert(body.includes(marker), issues, `shell_marker_missing:${pathname}:${marker}`, { url: result.url });
  }
  assert(!/>[^<]*missing_bearer_token[^<]*</i.test(visibleHtml), issues, `shell_visible_raw_missing_bearer_token:${pathname}`, { url: result.url });
  return {
    path: pathname,
    url: result.url,
    status: result.status,
    ok: result.status === 200 && markers.every((marker) => body.includes(marker)) && !/>[^<]*missing_bearer_token[^<]*</i.test(visibleHtml),
    markers,
    shellVersion: body.match(/(?:version|cache|membership-lock)=([0-9A-Za-z._-]+)/)?.[1] || "",
  };
}

function localOpsStatusSummary(issues) {
  const payload = readJson(path.join(ROOT, "data", "terminal-ops-status-latest.json"), {});
  assert(payload.contract === "terminal-ops-status-v1", issues, "local_ops_status_contract_missing", { contract: payload.contract });
  assert(payload.unattendedStatus === "YES", issues, "local_ops_status_unattended_not_yes", { unattendedStatus: payload.unattendedStatus, reason: payload.reason });
  assert(payload.actionMatrix?.protectedInvariants?.includes("membership_auth_only_gates_display_not_scanner_compute"), issues, "local_ops_status_membership_invariant_missing", {
    protectedInvariants: payload.actionMatrix?.protectedInvariants,
  });
  return {
    contract: payload.contract || "",
    state: payload.state || "",
    unattendedStatus: payload.unattendedStatus || "",
    tradeDate: payload.tradeDate || "",
    modules: Array.isArray(payload.modules) ? payload.modules.length : 0,
  };
}

function markdown(payload) {
  const lines = [];
  lines.push("# Terminal Ops Production Live Readback");
  lines.push("");
  lines.push(`- checkedAt: ${payload.checkedAt}`);
  lines.push(`- ok: ${payload.ok}`);
  lines.push(`- baseUrl: ${payload.baseUrl}`);
  lines.push(`- expectedSha: ${payload.expectedSha || "--"}`);
  lines.push(`- issues: ${payload.issues.map((row) => row.issue).join("; ") || "none"}`);
  lines.push("");
  lines.push("## Release");
  lines.push(`- status: ${payload.release.status}`);
  lines.push(`- version: ${payload.release.version || "--"}`);
  lines.push(`- gitSha: ${payload.release.gitSha || "--"}`);
  lines.push(`- deployId: ${payload.release.deployId || "--"}`);
  lines.push("");
  lines.push("## Protected Endpoints");
  lines.push("| endpoint | mode | status | ok | reason | artifactVersion |");
  lines.push("|---|---|---:|---:|---|---|");
  for (const row of payload.protectedEndpoints) {
    lines.push(`| ${row.name} | ${row.mode} | ${row.status} | ${row.ok} | ${row.reason || row.error || "--"} | ${row.artifactVersion || "--"} |`);
  }
  lines.push("");
  lines.push("## Shells");
  lines.push("| path | status | ok | shellVersion |");
  lines.push("|---|---:|---:|---|");
  for (const row of payload.shells) lines.push(`| ${row.path} | ${row.status} | ${row.ok} | ${row.shellVersion || "--"} |`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  const issues = [];
  const release = await verifyReleaseManifest(issues);
  const protectedEndpoints = [];
  for (const item of DIRECT_PROTECTED_ENDPOINTS) {
    protectedEndpoints.push(await verifyDirectProtectedEndpoint(item, issues));
  }
  for (const item of REDACTED_LOCKED_ENDPOINTS) {
    protectedEndpoints.push(await verifyRedactedLockedEndpoint(item, issues));
  }
  const shells = [];
  shells.push(await verifyShell("/", ["terminal-core.js"], issues));
  shells.push(await verifyShell("/88", ["FUMAN SCORECARD", "/api/scorecard", "scorecard-membership-lock"], issues));
  shells.push(await verifyShell("/auth.html", ["Fuman", "Google"], issues));
  const localOpsStatus = localOpsStatusSummary(issues);
  const payload = {
    contract: "terminal-ops-production-live-readback-v2",
    checkedAt: new Date().toISOString(),
    ok: issues.length === 0,
    baseUrl: BASE_URL,
    expectedSha: EXPECTED_SHA,
    release,
    protectedEndpoints,
    shells,
    desktopArtifactVersion: protectedEndpoints.find((row) => row.name === "terminal_fast_bundle")?.artifactVersion || "",
    mobileArtifactVersion: protectedEndpoints.find((row) => row.name === "mobile_boot")?.artifactVersion || "",
    scorecardShellVersion: shells.find((row) => row.path === "/88")?.shellVersion || "",
    localOpsStatus,
    issues,
  };
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const jsonFile = path.join(OUT_DIR, "terminal-ops-production-live-readback.json");
  const mdFile = path.join(OUT_DIR, "terminal-ops-production-live-readback.md");
  await fs.promises.writeFile(jsonFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.promises.writeFile(mdFile, markdown(payload), "utf8");
  console.log(JSON.stringify({
    ok: payload.ok,
    contract: payload.contract,
    baseUrl: payload.baseUrl,
    releaseSha: payload.release.gitSha,
    protectedEndpoints: payload.protectedEndpoints.map((row) => `${row.name}:${row.status}:${row.mode}:${row.ok}`),
    shellCount: payload.shells.length,
    desktopArtifactVersion: payload.desktopArtifactVersion || "",
    mobileArtifactVersion: payload.mobileArtifactVersion || "",
    scorecardShellVersion: payload.scorecardShellVersion || "",
    issues: issues.map((row) => row.issue),
    output: jsonFile,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[terminal-ops-production-live] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
