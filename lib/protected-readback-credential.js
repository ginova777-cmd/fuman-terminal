"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TOKEN_ENV_NAMES = [
  "FUMAN_VERIFY_BEARER_TOKEN",
  "FUMAN_MEMBERSHIP_BEARER_TOKEN",
  "FUMAN_AUTH_BEARER_TOKEN",
  "FUMAN_TEST_MEMBER_ACCESS_TOKEN",
  "FUMAN_SMOKE_BEARER_TOKEN",
];
const EMAIL_ENV = "FUMAN_TEST_MEMBER_EMAIL";
const PASSWORD_ENV = "FUMAN_TEST_MEMBER_PASSWORD";
const AUTH_URL_ENV = "FUMAN_MEMBERSHIP_AUTH_URL";
const AUTH_KEY_ENV = "FUMAN_MEMBERSHIP_AUTH_KEY";
const DEFAULT_AUTH_URL = "https://jxnqyqnigsppqsxinlrq.supabase.co";
const DEFAULT_AUTH_KEY = "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm";

function runtimeDir(env = process.env) {
  return env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
}

function defaultCredentialFile(env = process.env) {
  return path.join(runtimeDir(env), "secrets", "protected-readback-credential.json");
}

function configuredCredentialFile(env = process.env) {
  return env.FUMAN_PROTECTED_READBACK_CREDENTIAL_FILE || defaultCredentialFile(env);
}

function sha(value) {
  return value ? crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : "";
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function clean(value) {
  return String(value || "").trim();
}

function readCredentialFile(env = process.env) {
  const file = configuredCredentialFile(env);
  const json = readJson(file);
  const exists = fs.existsSync(file);
  if (!json || typeof json !== "object") {
    return { file, exists, loaded: false, token: "", email: "", password: "", authUrl: "", authKey: "" };
  }
  return {
    file,
    exists,
    loaded: true,
    token: clean(json.bearerToken || json.accessToken || json.token || json.FUMAN_VERIFY_BEARER_TOKEN || json.FUMAN_MEMBERSHIP_BEARER_TOKEN),
    email: clean(json.email || json.FUMAN_TEST_MEMBER_EMAIL),
    password: String(json.password || json.FUMAN_TEST_MEMBER_PASSWORD || ""),
    authUrl: clean(json.authUrl || json.FUMAN_MEMBERSHIP_AUTH_URL),
    authKey: clean(json.authKey || json.FUMAN_MEMBERSHIP_AUTH_KEY),
  };
}

function directEnvToken(env = process.env) {
  for (const name of TOKEN_ENV_NAMES) {
    const value = clean(env[name]);
    if (value) return { token: value, source: name };
  }
  return { token: "", source: "" };
}

function visibleCredentialState(env = process.env) {
  const file = readCredentialFile(env);
  const direct = directEnvToken(env);
  const email = clean(env[EMAIL_ENV] || file.email);
  const password = String(env[PASSWORD_ENV] || file.password || "");
  return {
    tokenArmed: Boolean(direct.token || file.token),
    tokenSource: direct.source || (file.token ? "runtime-file-token" : ""),
    emailArmed: Boolean(email),
    passwordArmed: Boolean(password),
    emailHash: sha(email),
    runtimeFile: {
      path: file.file,
      exists: file.exists,
      loaded: file.loaded,
      hasToken: Boolean(file.token),
      hasEmail: Boolean(file.email),
      hasPassword: Boolean(file.password),
    },
  };
}

function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  return fetch(url, { ...options, signal: controller.signal, cache: "no-store" })
    .then(async (response) => ({
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      headers: Object.fromEntries(response.headers.entries()),
      text: await response.text(),
    }))
    .finally(() => clearTimeout(timer));
}

function parseJson(text) {
  try { return JSON.parse(text || "{}"); } catch { return null; }
}

async function resolveProtectedReadbackCredential(options = {}) {
  const env = options.env || process.env;
  const timeoutMs = Number(options.timeoutMs || env.FUMAN_PROTECTED_READBACK_TIMEOUT_MS || 20000);
  const file = readCredentialFile(env);
  const direct = directEnvToken(env);
  if (direct.token) {
    return {
      ok: true,
      attempted: false,
      enabled: true,
      source: direct.source,
      status: 0,
      elapsedMs: 0,
      reason: "ok",
      error: "",
      token: direct.token,
      env: visibleCredentialState(env),
    };
  }
  if (file.token) {
    return {
      ok: true,
      attempted: false,
      enabled: true,
      source: "runtime-file-token",
      status: 0,
      elapsedMs: 0,
      reason: "ok",
      error: "",
      token: file.token,
      env: visibleCredentialState(env),
    };
  }
  const email = clean(env[EMAIL_ENV] || file.email);
  const password = String(env[PASSWORD_ENV] || file.password || "");
  if (!email || !password) {
    return {
      ok: false,
      attempted: false,
      enabled: false,
      source: "none",
      status: 0,
      elapsedMs: 0,
      reason: "protected_readback_credential_not_armed",
      error: "",
      token: "",
      env: visibleCredentialState(env),
    };
  }
  const authUrl = clean(env[AUTH_URL_ENV] || file.authUrl || DEFAULT_AUTH_URL).replace(/\/+$/, "");
  const authKey = clean(env[AUTH_KEY_ENV] || file.authKey || DEFAULT_AUTH_KEY);
  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(`${authUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: authKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ email, password }),
    }, timeoutMs);
    const json = parseJson(response.text);
    if (!response.ok || !json?.access_token) {
      return {
        ok: false,
        attempted: true,
        enabled: false,
        source: file.email || file.password ? "runtime-file-email-password" : "email-password",
        status: response.status,
        elapsedMs: response.elapsedMs,
        reason: "protected_readback_login_failed",
        error: json?.error_description || json?.msg || String(response.text || "").slice(0, 160),
        token: "",
        env: visibleCredentialState(env),
      };
    }
    return {
      ok: true,
      attempted: true,
      enabled: true,
      source: file.email || file.password ? "runtime-file-email-password" : "email-password",
      status: response.status,
      elapsedMs: response.elapsedMs || (Date.now() - startedAt),
      reason: "ok",
      error: "",
      userHash: sha(json.user?.id || ""),
      token: String(json.access_token || ""),
      env: visibleCredentialState(env),
    };
  } catch (error) {
    return {
      ok: false,
      attempted: true,
      enabled: false,
      source: file.email || file.password ? "runtime-file-email-password" : "email-password",
      status: 0,
      elapsedMs: Date.now() - startedAt,
      reason: "protected_readback_login_error",
      error: error?.message || String(error),
      token: "",
      env: visibleCredentialState(env),
    };
  }
}

function protectedReadbackHeaders(credentialOrToken) {
  const token = typeof credentialOrToken === "string" ? credentialOrToken : credentialOrToken?.token;
  if (!token) return {};
  return {
    authorization: `Bearer ${token}`,
    Authorization: `Bearer ${token}`,
    "x-fuman-readback-auth": "membership-bearer",
    "X-Fuman-Readback-Auth": "membership-bearer",
  };
}

function publicCredentialSummary(credential = {}) {
  return {
    attempted: credential.attempted === true,
    enabled: credential.enabled === true,
    source: credential.source || "none",
    status: credential.status || 0,
    elapsedMs: credential.elapsedMs || 0,
    userHash: credential.userHash || "",
    reason: credential.reason || (credential.ok ? "ok" : "protected_readback_credential_not_armed"),
    error: credential.ok ? "" : String(credential.error || "").slice(0, 160),
    env: credential.env || visibleCredentialState(),
  };
}

module.exports = {
  TOKEN_ENV_NAMES,
  EMAIL_ENV,
  PASSWORD_ENV,
  configuredCredentialFile,
  visibleCredentialState,
  resolveProtectedReadbackCredential,
  protectedReadbackHeaders,
  publicCredentialSummary,
};
