"use strict";

const DEFAULT_AUTH_SUPABASE_URL = "https://jxnqyqnigsppqsxinlrq.supabase.co";
const DEFAULT_AUTH_SUPABASE_KEY = "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";

const ALLOWED_STATUSES = new Set(["active", "approved", "admin", "paid", "pro", "premium"]);
const ADMIN_EMAILS = new Set(
  String(process.env.FUMAN_ADMIN_EMAILS || "ginova777@gmail.com")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

function getHeader(request, name) {
  const headers = request?.headers || {};
  const lower = name.toLowerCase();
  if (typeof headers.get === "function") return headers.get(name) || headers.get(lower) || "";
  return headers[name] || headers[lower] || "";
}

function sendJson(response, status, payload) {
  if (response && typeof response.status === "function") {
    return response.status(status).json(payload);
  }
  response.statusCode = status;
  if (typeof response.setHeader === "function") response.setHeader("content-type", "application/json; charset=utf-8");
  return response.end(JSON.stringify(payload));
}

function readBearerToken(request) {
  const authorization = String(getHeader(request, "authorization") || "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function authConfig() {
  const url = process.env.FUMAN_AUTH_SUPABASE_URL || process.env.NEXT_PUBLIC_FUMAN_AUTH_SUPABASE_URL || DEFAULT_AUTH_SUPABASE_URL;
  const key =
    process.env.FUMAN_AUTH_SUPABASE_KEY ||
    process.env.NEXT_PUBLIC_FUMAN_AUTH_SUPABASE_KEY ||
    process.env.FUMAN_SUPABASE_PUBLISHABLE_KEY ||
    DEFAULT_AUTH_SUPABASE_KEY;
  return { url: String(url || "").replace(/\/+$/, ""), key };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { response, json };
}

function isAccessAllowed(row, user) {
  const email = String(user?.email || row?.email || "").toLowerCase();
  if (email && ADMIN_EMAILS.has(email)) return true;
  const status = String(row?.status || row?.member_status || row?.plan_status || "").toLowerCase();
  const plan = String(row?.plan || row?.plan_code || row?.tier || "").toLowerCase();
  const permissions = row?.permissions || row?.features || {};
  return (
    row?.allowed === true ||
    row?.strategy_terminal === true ||
    row?.premium_terminal === true ||
    permissions.strategyTerminal === true ||
    permissions.premiumTerminal === true ||
    permissions.scorecard === true ||
    ALLOWED_STATUSES.has(status) ||
    ALLOWED_STATUSES.has(plan)
  );
}

async function readAccessRow(config, token, user) {
  const headers = {
    apikey: config.key,
    authorization: `Bearer ${token}`,
    accept: "application/json"
  };
  const userId = encodeURIComponent(user?.id || "");
  const email = encodeURIComponent(user?.email || "");
  const base = `${config.url}/rest/v1/fuman_user_access?select=*&limit=1`;
  const candidates = [];
  if (userId) candidates.push(`${base}&user_id=eq.${userId}`);
  if (email) candidates.push(`${base}&email=eq.${email}`);
  for (const url of candidates) {
    const { response, json } = await fetchJson(url, headers);
    if (response.ok && Array.isArray(json) && json[0]) return json[0];
  }
  return null;
}

async function verifyRequestEntitlement(request, options = {}) {
  const scope = options.scope || "protected-api";
  const token = readBearerToken(request);
  if (!token) {
    return { ok: false, status: 401, error: "membership_required", reason: "missing_bearer_token", scope };
  }
  const config = authConfig();
  try {
    const userResult = await fetchJson(`${config.url}/auth/v1/user`, {
      apikey: config.key,
      authorization: `Bearer ${token}`,
      accept: "application/json"
    });
    if (!userResult.response.ok || !userResult.json?.id) {
      return { ok: false, status: 401, error: "membership_required", reason: "invalid_or_expired_token", scope };
    }
    const user = userResult.json;
    const row = await readAccessRow(config, token, user);
    if (!isAccessAllowed(row, user)) {
      return {
        ok: false,
        status: 403,
        error: "membership_not_enabled",
        reason: "access_row_missing_or_not_active",
        scope,
        email: user.email || ""
      };
    }
    return { ok: true, scope, user, access: row || { status: "admin", source: "admin_email" } };
  } catch (error) {
    return { ok: false, status: 503, error: "membership_check_unavailable", reason: error?.message || String(error), scope };
  }
}

function withEntitlementRequired(handler, scope) {
  async function protectedHandler(request, response) {
    const entitlement = await verifyRequestEntitlement(request, { scope });
    if (!entitlement.ok) {
      return sendJson(response, entitlement.status || 403, {
        ok: false,
        protected: true,
        error: entitlement.error,
        reason: entitlement.reason,
        scope,
        publicSurfaces: ["market-overview", "market-ai", "learning-plan"]
      });
    }
    request.fumanEntitlement = entitlement;
    return handler(request, response);
  }
  Object.assign(protectedHandler, handler);
  return protectedHandler;
}

module.exports = {
  verifyRequestEntitlement,
  withEntitlementRequired,
  readBearerToken,
  isAccessAllowed
};
