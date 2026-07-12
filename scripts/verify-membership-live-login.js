const AUTH_URL = "https://jxnqyqnigsppqsxinlrq.supabase.co";
const AUTH_KEY = "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";
const ACCESS_TABLE = "fuman_user_access";
const PRODUCTION_URL = (process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

const email = String(process.env.FUMAN_TEST_MEMBER_EMAIL || "").trim();
const password = String(process.env.FUMAN_TEST_MEMBER_PASSWORD || "");
const issues = [];

async function fetchText(url, options = {}) {
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
    json = { raw: text.slice(0, 500) };
  }
  return { status: response.status, text, json };
}

async function login() {
  if (!email || !password) {
    throw new Error("missing FUMAN_TEST_MEMBER_EMAIL / FUMAN_TEST_MEMBER_PASSWORD");
  }
  const result = await fetchText(`${AUTH_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: AUTH_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (result.status !== 200 || !result.json?.access_token) {
    throw new Error(`member login failed status=${result.status} error=${result.json?.error_description || result.json?.msg || result.text.slice(0, 160)}`);
  }
  return result.json;
}

async function readAccessRows(token) {
  const encodedEmail = encodeURIComponent(email);
  const result = await fetchText(`${AUTH_URL}/rest/v1/${ACCESS_TABLE}?select=*&email=eq.${encodedEmail}&limit=3`, {
    headers: {
      apikey: AUTH_KEY,
      authorization: `Bearer ${token}`,
    },
  });
  if (result.status !== 200 || !Array.isArray(result.json)) {
    issues.push(`access row readback must return HTTP 200 array; status=${result.status}`);
    return [];
  }
  if (!result.json.length) issues.push(`access row missing for ${email}`);
  return result.json;
}

function hasAllowedAccess(row = {}) {
  const status = String(row.status || row.member_status || row.plan_status || "").toLowerCase();
  const plan = String(row.plan || row.plan_code || row.tier || "").toLowerCase();
  const permissions = row.permissions || row.features || {};
  return row.allowed === true
    || row.strategy_terminal === true
    || row.premium_terminal === true
    || permissions.strategyTerminal === true
    || permissions.premiumTerminal === true
    || permissions.scorecard === true
    || ["active", "approved", "admin", "paid", "pro", "premium"].includes(status)
    || ["active", "approved", "admin", "paid", "pro", "premium"].includes(plan);
}

async function verifyJsonEndpoint(token, path, options = {}) {
  const result = await fetchText(`${PRODUCTION_URL}${path}${path.includes("?") ? "&" : "?"}member_probe=${Date.now()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const forbiddenErrors = new Set(["membership_required", "membership_not_enabled"]);
  if (result.status !== 200 || forbiddenErrors.has(result.json?.error)) {
    issues.push(`${path} must open for active member; status=${result.status} error=${result.json?.error || ""}`);
  }
  if (options.mustContain) {
    const misses = options.mustContain.filter((marker) => !result.text.includes(marker));
    if (misses.length) issues.push(`${path} opened but missing expected marker(s): ${misses.join(",")}`);
  }
  if (options.mustNotContain) {
    const leaks = options.mustNotContain.filter((marker) => result.text.includes(marker));
    if (leaks.length) issues.push(`${path} contains blocked marker(s): ${leaks.join(",")}`);
  }
  return { path, status: result.status, error: result.json?.error || "", ok: result.status === 200 && !forbiddenErrors.has(result.json?.error) };
}

async function verifyHtmlEndpoint(token, path, options = {}) {
  const result = await fetchText(`${PRODUCTION_URL}${path}${path.includes("?") ? "&" : "?"}member_probe=${Date.now()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (result.status !== 200) issues.push(`${path} must return HTTP 200 for active member; status=${result.status}`);
  if (options.mustContain) {
    const misses = options.mustContain.filter((marker) => !result.text.includes(marker));
    if (misses.length) issues.push(`${path} opened but missing expected marker(s): ${misses.join(",")}`);
  }
  if (options.mustNotContain) {
    const leaks = options.mustNotContain.filter((marker) => result.text.includes(marker));
    if (leaks.length) issues.push(`${path} contains forbidden marker(s): ${leaks.join(",")}`);
  }
  return { path, status: result.status, ok: result.status === 200 };
}

async function main() {
  const session = await login();
  const token = session.access_token;
  const accessRows = await readAccessRows(token);
  const accessAllowed = accessRows.some(hasAllowedAccess);
  if (!accessAllowed) issues.push(`access row exists but does not grant strategy terminal permission for ${email}`);

  const apiRows = [];
  apiRows.push(await verifyJsonEndpoint(token, "/api/strategy2-latest?live=1"));
  apiRows.push(await verifyJsonEndpoint(token, "/api/strategy4-latest?live=1"));
  apiRows.push(await verifyJsonEndpoint(token, "/api/scorecard?live=1"));
  apiRows.push(await verifyJsonEndpoint(token, "/api/source-reports"));
  apiRows.push(await verifyJsonEndpoint(token, "/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70", {
    mustNotContain: ["membershipRequired\":true"],
  }));
  apiRows.push(await verifyJsonEndpoint(token, "/api/mobile-boot", {
    mustContain: ["strategy2"],
    mustNotContain: ["membershipRequired\":true"],
  }));

  const htmlRows = [];
  htmlRows.push(await verifyHtmlEndpoint(token, "/api/mobile-fragment?tab=strategy2", {
    mustContain: ["data-mobile-fragment-key=\"strategy2\""],
    mustNotContain: ["data-membership-required=\"1\""],
  }));

  if (issues.length) {
    console.error(JSON.stringify({
      ok: false,
      contract: "membership-live-login-v1",
      email,
      issues,
      accessRows: accessRows.map((row) => ({
        email: row.email,
        status: row.status,
        plan: row.plan,
        allowed: row.allowed,
        strategy_terminal: row.strategy_terminal,
        premium_terminal: row.premium_terminal,
        permissions: row.permissions || null,
      })),
      apiRows,
      htmlRows,
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    contract: "membership-live-login-v1",
    email,
    userId: session.user?.id || "",
    accessRows: accessRows.map((row) => ({
      email: row.email,
      status: row.status,
      plan: row.plan,
      allowed: row.allowed,
      strategy_terminal: row.strategy_terminal,
      premium_terminal: row.premium_terminal,
      permissions: row.permissions || null,
    })),
    apiRows,
    htmlRows,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, contract: "membership-live-login-v1", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
