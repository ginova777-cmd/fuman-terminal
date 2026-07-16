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

function requireExcludes(file, marker) {
  if (read(file).includes(marker)) issues.push(`${file}: must not include ${marker}`);
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
    "/api/strategy2-latest?live=1",
    "/api/strategy3-latest?live=1",
    "/api/strategy4-latest?live=1",
    "/api/strategy5-latest?live=1",
    "/api/institution-latest?live=1",
    "/api/cb-detect-latest?live=1",
    "/api/warrant-flow-latest?live=1",
    "/api/scorecard?live=1",
    "/api/source-reports?live=1",
  ];
  const protectedRows = [];
  for (const apiPath of protectedPaths) {
    const result = await fetchJson(`${PRODUCTION_URL}${apiPath}`);
    protectedRows.push({ path: apiPath, status: result.status, error: result.json?.error, protected: result.json?.protected === true });
    if (result.status !== 401 || result.json?.error !== "membership_required" || result.json?.protected !== true) {
      issues.push(`${apiPath} must reject unauthenticated direct access with 401 membership_required; status=${result.status} error=${result.json?.error || ""}`);
    }
  }
  const publicPaths = ["/", "/auth.html", "/api/market-ai-live", "/api/scorecard-health?live=1"];
  const publicRows = [];
  for (const apiPath of publicPaths) {
    const result = await fetchJson(`${PRODUCTION_URL}${apiPath}`);
    publicRows.push({ path: apiPath, status: result.status });
    if (result.status !== 200) issues.push(`${apiPath} must remain public HTTP 200; status=${result.status}`);
  }

  const bundle = await fetchJson(`${PRODUCTION_URL}/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70&membership_probe=${Date.now()}`);
  const bundleText = bundle.text || JSON.stringify(bundle.json || {});
  const forbiddenBundleMarkers = [
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
    "/api/warrant-flow-latest"
  ];
  const bundleLeaks = forbiddenBundleMarkers.filter((marker) => bundleText.includes(marker));
  if (bundle.status !== 200 || bundle.json?.membershipRequired !== true || bundleLeaks.length) {
    issues.push(`terminal-fast-bundle unauthenticated payload must be public-only redacted; status=${bundle.status} membershipRequired=${bundle.json?.membershipRequired} leaks=${bundleLeaks.join(",")}`);
  }

  const mobileBoot = await fetchJson(`${PRODUCTION_URL}/api/mobile-boot?membership_probe=${Date.now()}`);
  const mobileBootText = mobileBoot.text || JSON.stringify(mobileBoot.json || {});
  const mobileBootLeaks = ["strategy2", "strategy3", "strategy4", "strategy5", "chip", "cb", "warrant"].filter((marker) => mobileBootText.includes(`"${marker}"`));
  if (mobileBoot.status !== 200 || mobileBoot.json?.membershipRequired !== true || mobileBootLeaks.length) {
    issues.push(`mobile-boot unauthenticated payload must expose public tabs only; status=${mobileBoot.status} membershipRequired=${mobileBoot.json?.membershipRequired} leaks=${mobileBootLeaks.join(",")}`);
  }

  const mobileStrategy2 = await fetchJson(`${PRODUCTION_URL}/api/mobile-fragment?tab=strategy2&membership_probe=${Date.now()}`);
  const mobileStrategy2Text = String(mobileStrategy2.text || "");
  const mobileLoginMarkers = [
    "data-membership-required=\"1\"",
    "data-mobile-membership-login=\"1\"",
    "data-mobile-orientation-login=\"portrait-landscape\"",
    "/auth.html?mode=login",
    "/auth.html?mode=signup",
    "data-mobile-login-action=\"login\"",
    "data-mobile-login-action=\"signup\"",
  ];
  const mobileLoginMisses = mobileLoginMarkers.filter((marker) => !mobileStrategy2Text.includes(marker));
  if (mobileStrategy2.status !== 401 || mobileLoginMisses.length) {
    issues.push(`mobile-fragment strategy2 unauthenticated must return locked fragment HTTP 401 with mobile portrait/landscape login actions; status=${mobileStrategy2.status} misses=${mobileLoginMisses.join(",")}`);
  }

  const scorecardPage = await fetchJson(`${PRODUCTION_URL}/88?membership_probe=${Date.now()}`);
  if (scorecardPage.status !== 200) {
    issues.push(`/88 page shell must remain HTTP 200 so visitors can see the public scorecard shell; status=${scorecardPage.status}`);
  }

  return {
    protectedRows,
    publicRows,
    redactedSurfaces: {
      terminalFastBundle: { status: bundle.status, membershipRequired: bundle.json?.membershipRequired === true, leaks: bundleLeaks },
      mobileBoot: { status: mobileBoot.status, membershipRequired: mobileBoot.json?.membershipRequired === true, leaks: mobileBootLeaks },
      mobileStrategy2Fragment: { status: mobileStrategy2.status, locked: mobileStrategy2Text.includes("data-membership-required=\"1\""), loginActions: mobileLoginMisses.length === 0 },
      scorecardPage88: { status: scorecardPage.status, publicShellVisible: scorecardPage.status === 200 },
    }
  };
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
  requireIncludes("auth.html", "function writeSessionCache(session, access)");
  requireIncludes("auth.html", "function persistSessionFast(session, source)");
  requireIncludes("auth.html", "shouldFastRedirectAfterAuth()");
  requireIncludes("auth.html", "google_mobile_fast_redirect");
  requireIncludes("auth.html", "password_mobile_fast_redirect");
  requireIncludes("auth.html", "function finishSignupSession(session)");
  requireIncludes("auth.html", "signup_mobile_fast_redirect");
  requireIncludes("auth.html", "fuman-mobile-member-notice-v1");
  requireIncludes("auth.html", "註冊完成，請聯繫作者開通權限。");
  requireIncludes("mobile.html", "function consumeMemberNotice()");
  requireIncludes("mobile.html", "請聯繫作者開通權限");
  requireIncludes("auth.html", "recovery_mobile_fast_redirect");
  requireIncludes("auth.html", "location.replace(nextUrl || \"/?desktop=1\")");

  const authHtml = read("auth.html");
  if (/await finishPasswordLogin\(credentials, \"註冊完成/.test(authHtml)) issues.push("forbid signup from calling finishPasswordLogin after signUp session; mobile signup must fast redirect from signUp session");
  requireIncludes("auth.html", "googleAuthorizeUrl()");
  requireIncludes("auth.html", "finishOAuthRedirect()");
  requireIncludes("auth.html", "exchangeCodeForSession(code)");
  requireIncludes("auth.html", "googleFallbackLink");
  requireIncludes("auth.html", "AUTH_STORAGE_KEY");
  requireIncludes("auth.html", "pruneAuthStorage");
  requireIncludes("auth.html", "safeSetStorage");
  requireIncludes("auth.html", "storageKey: AUTH_STORAGE_KEY");
  requireIncludes("auth.html", "PRESERVE_STORAGE_KEYS");
  requireIncludes("auth.html", `const table = config.accessTable || "${ACCESS_TABLE}"`);
  requireIncludes("auth.html", "isAlreadyRegisteredError(error)");
  requireIncludes("auth.html", "already registered|already exists");
  requireIncludes("auth.html", "finishPasswordLogin(credentials");
  requireIncludes("auth.html", "resetPasswordForEmail");
  requireIncludes("auth.html", "redirect.searchParams.set(\"next\", nextUrl");
  requireIncludes("auth.html", "isPasswordRecoveryUrl()");
  requireIncludes("auth.html", "finishPasswordRecovery()");
  requireIncludes("auth.html", "recoveryCode");
  requireIncludes("auth.html", "client.auth.updateUser({ password: password.value })");
  requireIncludes("auth.html", "更新密碼");
  requireIncludes("auth.html", "重設密碼連結已失效");
  requireIncludes("auth.html", "帳號已存在，正在自動登入並進入終端");
  requireIncludes("auth.html", "登入成功，正在進入終端；策略內容會先以會員罩顯示");
  requireIncludes("index.html", "<span class=\"strategy-nav learning-plan-disabled\"");
  requireIncludes("index.html", "data-learning-plan-disabled=\"1\"");
  requireIncludes("index.html", "學習方案建置中，暫不開放連結");
  requireIncludes("terminal-entitlement-guard.js", "installProtectedApiBearer");
  requireIncludes("terminal-entitlement-guard.js", "authorization");
  requireIncludes("terminal-entitlement-guard.js", "terminal-fast-bundle");
  requireIncludes("terminal-entitlement-guard.js", "mobile-boot");
  requireIncludes("terminal-entitlement-guard.js", "mobile-fragment");
  requireIncludes("terminal-entitlement-guard.js", "回測研究");
  requireIncludes("terminal-entitlement-guard.js", "會員：尚未開通");
  requireIncludes("terminal-entitlement-guard.js", "會員：已開通");
  requireIncludes("terminal-entitlement-guard.js", 'action: "登入"');
  requireIncludes("terminal-entitlement-guard.js", 'action: "登出"');
  requireIncludes("terminal-entitlement-guard.js", "syncMemberStatusBadge");
  requireIncludes("terminal-member-module.js", 'actionMode === "logout"');
  requireIncludes("styles.css", "membership-footer-status-20260713");
  requireIncludes("terminal-entitlement-guard.js", "handleMemberAuthAction");
  requireIncludes("terminal-entitlement-guard.js", "openLoginPage");
  requireIncludes("index.html", "membership-lock=20260713-11");
  requireIncludes("mobile.html", "membership-lock=20260713-11");
  requireIncludes("mobile.html", "mobile-auth-actions");
  requireIncludes("mobile.html", "mobile-login-link");
  requireExcludes("mobile.html", "mobile-signup-link");
  requireIncludes("mobile.html", "mobile-logout-button");
  requireIncludes("mobile.html", "data-mobile-auth-lock");
  requireIncludes("mobile.html", "function renderAuthGate");
  requireIncludes("88.html", "membership-lock=20260713-11");
  requireIncludes("api/mobile-fragment.js", "data-mobile-membership-login=\"1\"");
  requireIncludes("api/mobile-fragment.js", "data-mobile-orientation-login=\"portrait-landscape\"");
  requireIncludes("api/mobile-fragment.js", "data-mobile-login-action=\"login\"");
  requireIncludes("api/mobile-fragment.js", "data-mobile-login-action=\"signup\"");
  requireIncludes("api/mobile-fragment.js", "/auth.html?mode=login");
  requireIncludes("api/mobile-fragment.js", "/auth.html?mode=signup");
  requireIncludes("api/scorecard.js", "withEntitlementRequired(handler, \"scorecard\")");
  requireIncludes("api/source-reports.js", "withEntitlementRequired(handler, \"source-reports\")");
  requireExcludes("terminal-entitlement-guard.js", "data-testid=\"scorecard-locked\"");
  requireExcludes("terminal-entitlement-guard.js", "/auth.html?next=%2F88");
  requireIncludes("index.html", "membership-footer=20260713-02");
  requireIncludes("styles.css", "membership-footer-status-readable-20260713");
  requireIncludes("terminal-entitlement-guard.js", "forceActivePanel");
  requireIncludes("api/terminal-fast-bundle.js", "filterPublicBundlePayload");
  requireIncludes("api/terminal-fast-bundle.js", "verifyRequestEntitlement");
  requireIncludes("api/mobile-boot.js", "PUBLIC_FRAGMENT_TABS");
  requireIncludes("api/mobile-boot.js", "MOBILE_BOOT_SNAPSHOT_TIMEOUT_MS");
  requireIncludes("api/mobile-boot.js", "membership_locked");
  requireIncludes("api/mobile-fragment.js", "lockedFragment");
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
