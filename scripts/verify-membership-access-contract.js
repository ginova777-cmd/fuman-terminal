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

  const accessTableProbe = await verifyAuthAccessTableProbe();
  const production = await verifyProductionProtection();

  if (issues.length) {
    console.error(JSON.stringify({ ok: false, issues, warnings, accessTableProbe, production }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    contract: "membership-access-contract-v1",
    authProject: AUTH_URL,
    accessTable: ACCESS_TABLE,
    accessTableProbe,
    production,
    warnings
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error?.stack || error?.message || String(error) }, null, 2));
  process.exit(1);
});
