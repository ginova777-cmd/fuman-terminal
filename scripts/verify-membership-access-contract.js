const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const issues = [];
const warnings = [];
const AUTH_URL = "https://jxnqyqnigsppqsxinlrq.supabase.co";
const AUTH_KEY = "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";
const ACCESS_TABLE = "fuman_user_access";
const PRODUCTION_URL = (process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function requireIncludes(file, marker) {
  if (!read(file).includes(marker)) issues.push(`${file}: missing ${marker}`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: response.status, json, text };
}

async function verifyAuthAccessTableProbe() {
  const url = `${AUTH_URL}/rest/v1/${ACCESS_TABLE}?select=status,email,user_id&limit=1`;
  const result = await fetchJson(url, {
    headers: {
      apikey: AUTH_KEY,
      authorization: `Bearer ${AUTH_KEY}`,
    },
  });
  if (result.status !== 200) {
    issues.push(`${ACCESS_TABLE} anon probe must return HTTP 200 with RLS-filtered array; status=${result.status}`);
    return { status: result.status, rows: null };
  }
  if (!Array.isArray(result.json)) {
    issues.push(`${ACCESS_TABLE} anon probe must return JSON array; payload=${JSON.stringify(result.json).slice(0, 160)}`);
    return { status: result.status, rows: null };
  }
  if (result.json.length > 0) {
    warnings.push(`${ACCESS_TABLE} anon probe returned ${result.json.length} row(s); verify RLS is not exposing private member rows`);
  }
  return { status: result.status, rows: result.json.length };
}

async function verifyProductionProtection() {
  const protectedPaths = [
    "/api/open-buy-latest?live=1",
    "/api/strategy2-latest?live=1",
    "/api/strategy3-latest?live=1",
    "/api/strategy4-latest?live=1",
    "/api/strategy5-latest?live=1",
    "/api/institution-latest?live=1",
    "/api/cb-detect-latest?live=1",
    "/api/warrant-flow-latest?live=1",
    "/api/scorecard?live=1",
    "/api/source-reports",
  ];
  const protectedRows = [];
  for (const apiPath of protectedPaths) {
    const result = await fetchJson(`${PRODUCTION_URL}${apiPath}`);
    protectedRows.push({ path: apiPath, status: result.status, error: result.json?.error, protected: result.json?.protected === true });
    if (result.status !== 401 || result.json?.error !== "membership_required" || result.json?.protected !== true) {
      issues.push(`${apiPath} must reject unauthenticated direct access with 401 membership_required; status=${result.status} error=${result.json?.error || ""}`);
    }
  }
  const publicPaths = ["/", "/auth.html", "/api/market-ai-live"];
  const publicRows = [];
  for (const apiPath of publicPaths) {
    const result = await fetchJson(`${PRODUCTION_URL}${apiPath}`);
    publicRows.push({ path: apiPath, status: result.status });
    if (result.status !== 200) issues.push(`${apiPath} must remain public HTTP 200; status=${result.status}`);
  }
  return { protectedRows, publicRows };
}

async function verifyLocalEntitlementMatrix() {
  const { isAccessAllowed, withEntitlementRequired } = require("../lib/server-entitlement-guard");
  const user = { id: "user-1", email: "member@example.com" };
  const cases = [
    { name: "admin_email", row: null, user: { email: "ginova777@gmail.com" }, expected: true },
    { name: "active_status", row: { status: "active" }, user, expected: true },
    { name: "paid_plan", row: { plan: "paid" }, user, expected: true },
    { name: "explicit_allowed", row: { allowed: true, status: "pending" }, user, expected: true },
    { name: "strategy_terminal_permission", row: { permissions: { strategyTerminal: true } }, user, expected: true },
    { name: "pending_without_permission", row: { status: "pending" }, user, expected: false },
    { name: "missing_row_non_admin", row: null, user, expected: false },
  ];
  const results = cases.map((item) => {
    const allowed = isAccessAllowed(item.row, item.user);
    if (allowed !== item.expected) issues.push(`local entitlement matrix ${item.name} expected=${item.expected} actual=${allowed}`);
    return { name: item.name, expected: item.expected, actual: allowed };
  });

  let opened = false;
  const protectedHandler = withEntitlementRequired(async (request, response) => {
    opened = true;
    return response.status(200).json({ ok: true, scope: request.fumanEntitlement?.scope || "" });
  }, "membership-open-path-test");
  let statusCode = 200;
  let payload = null;
  const response = {
    status(code) { statusCode = Number(code) || 200; return this; },
    setHeader() {},
    json(value) { payload = value; return this; },
    end(value) { payload = value; return this; },
  };
  await protectedHandler({ method: "GET", headers: {}, fumanInternalVerify: true }, response);
  if (statusCode !== 200 || payload?.ok !== true || opened !== true) {
    issues.push(`internal verified open path must reach wrapped handler; status=${statusCode} payload=${JSON.stringify(payload)}`);
  }

  return { results, internalVerifiedOpenPath: { status: statusCode, ok: payload?.ok === true, opened } };
}

async function verifyOptionalLiveMemberToken() {
  const token = String(process.env.FUMAN_TEST_MEMBER_TOKEN || "").trim();
  if (!token) return { configured: false, status: "not_configured" };
  const result = await fetchJson(`${PRODUCTION_URL}/api/strategy2-latest?live=1&verify_member=${Date.now()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (result.status !== 200 || result.json?.ok === false) {
    issues.push(`FUMAN_TEST_MEMBER_TOKEN live readback must return protected API 200 ok!=false; status=${result.status} error=${result.json?.error || ""}`);
  }
  return { configured: true, status: result.status, ok: result.json?.ok !== false, runId: result.json?.runId || "" };
}

async function main() {
  requireIncludes("terminal-runtime-config.js", `supabaseUrl: "${AUTH_URL}"`);
  requireIncludes("terminal-runtime-config.js", `accessTable: "${ACCESS_TABLE}"`);
  requireIncludes("terminal-runtime-config.js", `adminEmails: ["ginova777@gmail.com"]`);
  requireIncludes("auth.html", "accessToken: session?.access_token");
  requireIncludes("auth.html", "expiresAt: session?.expires_at");
  requireIncludes("auth.html", `const table = config.accessTable || "${ACCESS_TABLE}"`);
  requireIncludes("terminal-entitlement-guard.js", "installProtectedApiBearer");
  requireIncludes("terminal-entitlement-guard.js", "authorization");
  requireIncludes("lib/server-entitlement-guard.js", "DEFAULT_AUTH_SUPABASE_URL");
  requireIncludes("lib/server-entitlement-guard.js", "DEFAULT_AUTH_SUPABASE_KEY");
  requireIncludes("lib/server-entitlement-guard.js", ACCESS_TABLE);
  requireIncludes("lib/server-entitlement-guard.js", "missing_bearer_token");
  requireIncludes("lib/server-entitlement-guard.js", "membership_not_enabled");

  const localEntitlementMatrix = await verifyLocalEntitlementMatrix();
  const accessTableProbe = await verifyAuthAccessTableProbe();
  const production = await verifyProductionProtection();
  const liveMemberToken = await verifyOptionalLiveMemberToken();

  if (issues.length) {
    console.error(JSON.stringify({ ok: false, issues, warnings, localEntitlementMatrix, accessTableProbe, production, liveMemberToken }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    contract: "membership-access-contract-v1",
    authProject: AUTH_URL,
    accessTable: ACCESS_TABLE,
    localEntitlementMatrix,
    accessTableProbe,
    production,
    liveMemberToken,
    warnings
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.stack || error?.message || String(error) }, null, 2));
  process.exit(1);
});
