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
const AUTH_URL = String(process.env.FUMAN_MEMBERSHIP_AUTH_URL || "https://jxnqyqnigsppqsxinlrq.supabase.co").replace(/\/+$/, "");
const AUTH_KEY = process.env.FUMAN_MEMBERSHIP_AUTH_KEY || "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";
const MEMBER_EMAIL = String(process.env.FUMAN_TEST_MEMBER_EMAIL || "").trim();
const MEMBER_PASSWORD = String(process.env.FUMAN_TEST_MEMBER_PASSWORD || "");
let MEMBER_BEARER_TOKEN = [
  process.env.FUMAN_VERIFY_BEARER_TOKEN,
  process.env.FUMAN_MEMBERSHIP_BEARER_TOKEN,
  process.env.FUMAN_AUTH_BEARER_TOKEN,
  process.env.FUMAN_TEST_MEMBER_ACCESS_TOKEN,
  process.env.FUMAN_SMOKE_BEARER_TOKEN,
].map((value) => String(value || "").trim()).find(Boolean) || "";
const REQUIRE_PROTECTED_READBACK = /^(1|true|yes)$/i.test(String(process.env.FUMAN_REQUIRE_PROTECTED_READBACK || "")) || process.argv.includes("--require-protected-readback");

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

function protectedReadbackHeaders() {
  if (!MEMBER_BEARER_TOKEN) return {};
  return {
    authorization: `Bearer ${MEMBER_BEARER_TOKEN}`,
    "x-fuman-readback-auth": "membership-bearer",
  };
}

async function ensureMemberToken() {
  if (MEMBER_BEARER_TOKEN) return { attempted: false, enabled: true, source: "env-token", status: 0, error: "" };
  if (!MEMBER_EMAIL || !MEMBER_PASSWORD) return { attempted: false, enabled: false, source: "none", status: 0, error: "protected readback token not armed" };
  const startedAt = Date.now();
  try {
    const response = await fetch(`${AUTH_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: AUTH_KEY,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ email: MEMBER_EMAIL, password: MEMBER_PASSWORD }),
    });
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok || !payload?.access_token) {
      return {
        attempted: true,
        enabled: false,
        source: "email-password",
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        error: payload?.error_description || payload?.msg || String(text || "").slice(0, 160),
      };
    }
    MEMBER_BEARER_TOKEN = String(payload.access_token || "");
    return {
      attempted: true,
      enabled: true,
      source: "email-password",
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      userId: payload.user?.id || "",
      email: MEMBER_EMAIL,
      error: "",
    };
  } catch (error) {
    return {
      attempted: true,
      enabled: false,
      source: "email-password",
      status: 0,
      elapsedMs: Date.now() - startedAt,
      error: error?.message || String(error),
    };
  }
}

function membershipError(payload = {}) {
  return payload?.error === "membership_required" || payload?.membershipRequired === true;
}

function collectRunIds(value, out = new Set()) {
  if (value == null) return out;
  if (typeof value === "string") {
    for (const match of value.matchAll(/\b(?:strategy2|strategy3|strategy4|strategy5|institution|cb-detect|warrant-flow)-\d{8}[\w-]*/g)) out.add(match[0]);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectRunIds(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectRunIds(item, out);
  }
  return out;
}

async function verifyAuthenticatedProtectedReadback(issues) {
  const auth = await ensureMemberToken();
  const result = {
    attempted: auth.attempted,
    enabled: auth.enabled,
    source: auth.source,
    status: auth.status,
    error: auth.error || "",
    endpoints: [],
    ok: true,
  };
  if (!auth.enabled) {
    result.ok = !REQUIRE_PROTECTED_READBACK;
    result.mode = "not_armed";
    if (REQUIRE_PROTECTED_READBACK) issues.push({ issue: "authenticated_protected_readback_not_armed", details: auth });
    return result;
  }
  result.mode = "authenticated-readback";
  const targets = [
    { name: "terminal_ops_status", path: "/api/terminal-ops-status" },
    { name: "scorecard", path: "/api/scorecard?live=1" },
    { name: "source_reports", path: "/api/source-reports?live=1" },
    { name: "terminal_fast_bundle", path: "/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70" },
    { name: "mobile_boot", path: "/api/mobile-boot" },
  ];
  for (const target of targets) {
    const response = await fetchText(target.path, { headers: protectedReadbackHeaders() });
    const payload = parseJson(response.body);
    const runIds = Array.from(collectRunIds(payload || response.body)).sort();
    const row = {
      name: target.name,
      path: target.path,
      status: response.status,
      ok: response.status === 200 && !membershipError(payload || {}),
      membershipRequired: membershipError(payload || {}),
      runIds,
      runIdCount: runIds.length,
      noStore: noStore(response.headers),
      error: payload?.error || "",
      reason: memberLockReason(payload),
    };
    if (!row.ok) issues.push({ issue: `authenticated_protected_endpoint_not_open:${target.name}`, details: row });
    result.endpoints.push(row);
  }

  const reference = result.endpoints.find((row) => row.name === "terminal_ops_status" && row.ok && row.runIds.length);
  const expectedRunIds = new Set(reference?.runIds || []);
  if (expectedRunIds.size) {
    for (const row of result.endpoints) {
      if (!row.runIds.length) continue;
      const unexpectedRunIds = row.runIds.filter((runId) => !expectedRunIds.has(runId));
      row.unexpectedRunIds = unexpectedRunIds;
      if (unexpectedRunIds.length) {
        row.ok = false;
        issues.push({
          issue: `authenticated_protected_endpoint_has_stale_or_unexpected_run_id:${row.name}`,
          details: {
            endpoint: row.path,
            unexpectedRunIds,
            expectedRunIds: Array.from(expectedRunIds).sort(),
          },
        });
      }
    }
  }

  result.ok = result.endpoints.every((row) => row.ok);
  return result;
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
  const previousGoodHold = payload.unattendedStatus === "PREVIOUS_GOOD_HOLD"
    && payload.state === "MARKET_CLOSED_PRESERVE_PREVIOUS_GOOD"
    && payload.canaryPublish?.scorecardPublishAllowed === false;
  assert(payload.unattendedStatus === "YES" || previousGoodHold, issues, "local_ops_status_not_fresh_yes_or_previous_good_hold", { unattendedStatus: payload.unattendedStatus, state: payload.state, reason: payload.reason });
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
  lines.push("## Authenticated Protected Readback");
  lines.push(`- mode: ${payload.authenticatedReadback?.mode || "--"}`);
  lines.push(`- ok: ${payload.authenticatedReadback?.ok}`);
  lines.push(`- source: ${payload.authenticatedReadback?.source || "--"}`);
  lines.push(`- endpoints: ${(payload.authenticatedReadback?.endpoints || []).map((row) => `${row.name}:${row.status}:${row.runIdCount}`).join(" / ") || "--"}`);
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
  const authenticatedReadback = await verifyAuthenticatedProtectedReadback(issues);
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
    authenticatedReadback,
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
    authenticatedReadback: `${payload.authenticatedReadback.mode || ""}:${payload.authenticatedReadback.ok}:${payload.authenticatedReadback.endpoints?.length || 0}`,
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
