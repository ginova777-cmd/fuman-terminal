"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  resolveProtectedReadbackCredential,
  protectedReadbackHeaders,
  publicCredentialSummary,
} = require("../lib/protected-readback-credential");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || path.join(ROOT, "outputs", "protected-readback-credential"));
const BASE_URL = String(process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.FUMAN_PROTECTED_READBACK_TIMEOUT_MS || 20000);
const DIRECT_ENDPOINTS = [
  { key: "terminal_ops_status", path: "/api/terminal-ops-status" },
  { key: "scorecard", path: "/api/scorecard?live=1" },
  { key: "source_reports", path: "/api/source-reports?live=1" },
];

function safeJson(text, fallback) {
  try { return JSON.parse(text || ""); } catch { return fallback; }
}

function windowsEnvironmentPresence() {
  if (process.platform !== "win32") return { supported: false, rows: [] };
  const names = [
    "FUMAN_VERIFY_BEARER_TOKEN",
    "FUMAN_MEMBERSHIP_BEARER_TOKEN",
    "FUMAN_AUTH_BEARER_TOKEN",
    "FUMAN_TEST_MEMBER_ACCESS_TOKEN",
    "FUMAN_SMOKE_BEARER_TOKEN",
    "FUMAN_TEST_MEMBER_EMAIL",
    "FUMAN_TEST_MEMBER_PASSWORD",
    "FUMAN_PROTECTED_READBACK_CREDENTIAL_FILE",
  ];
  const quotedNames = names.map((name) => `'${name}'`).join(",");
  const script = `$names = @(${quotedNames}); $rows = @(); foreach ($target in @('Process','User','Machine')) { foreach ($name in $names) { $value = [Environment]::GetEnvironmentVariable($name, $target); $rows += [pscustomobject]@{ target=$target; name=$name; present=(-not [string]::IsNullOrWhiteSpace($value)); length=$(if ($null -eq $value) { 0 } else { $value.Length }) } } }; $rows | ConvertTo-Json -Compress`;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const parsed = safeJson(output.trim(), []);
    return { supported: true, rows: Array.isArray(parsed) ? parsed : [parsed].filter(Boolean) };
  } catch (error) {
    return { supported: true, rows: [], error: String(error?.message || error).slice(0, 160) };
  }
}

function runtimeFileDiagnostics(envSummary = {}) {
  const runtimeFile = envSummary?.runtimeFile || {};
  const file = runtimeFile.path || "";
  const stat = file ? (() => {
    try {
      const row = fs.statSync(file);
      return { exists: true, bytes: row.size, modifiedAt: row.mtime.toISOString() };
    } catch {
      return { exists: false, bytes: 0, modifiedAt: "" };
    }
  })() : { exists: false, bytes: 0, modifiedAt: "" };
  return {
    path: file,
    exists: stat.exists,
    bytes: stat.bytes,
    modifiedAt: stat.modifiedAt,
    loaded: runtimeFile.loaded === true,
    hasToken: runtimeFile.hasToken === true,
    hasEmail: runtimeFile.hasEmail === true,
    hasPassword: runtimeFile.hasPassword === true,
  };
}

function buildNextActions(payload) {
  const runtimeFile = payload?.diagnostics?.runtimeFile || {};
  const expectedFile = runtimeFile.path || "C:\\fuman-runtime\\secrets\\protected-readback-credential.json";
  const hasRuntimeFile = runtimeFile.exists === true && runtimeFile.loaded === true;
  const actions = [];
  if (!payload?.armed) {
    actions.push({
      code: "setup_runtime_credential_from_any_directory",
      command: "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\fuman-terminal\\scripts\\setup-protected-readback-credential.ps1 -Email \"<member-email>\" -Force",
      expectedFile,
      note: "Run this in PowerShell from any directory. Enter the password only when the script prompts; do not paste it into chat or source files.",
    });
  }
  if (!hasRuntimeFile) {
    actions.push({
      code: "verify_runtime_file_created",
      command: `Test-Path ${expectedFile}`,
      expected: "True",
    });
  }
  actions.push({
    code: "verify_credential",
    command: "cd C:\\fuman-terminal; npm run verify:protected-readback-credential",
    expected: "ok=true, armed=true",
  });
  return actions;
}
async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      headers: Object.fromEntries(response.headers.entries()),
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function classifyProtectedResponse(item) {
  const text = String(item.text || "").slice(0, 2000).toLowerCase();
  if (item.status === 401) return "protected_readback_unauthorized";
  if (text.includes("missing_bearer_token")) return "protected_readback_missing_bearer_token_rendered";
  if (text.includes("membership_required") || text.includes("membership-required")) return "protected_readback_membership_required";
  if (item.status >= 500) return "protected_readback_server_error";
  if (!item.ok) return "protected_readback_http_not_ok";
  return "ok";
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const credential = await resolveProtectedReadbackCredential({ timeoutMs: TIMEOUT_MS });
  const authSummary = publicCredentialSummary(credential);
  const endpoints = [];
  if (credential.ok && credential.token) {
    for (const endpoint of DIRECT_ENDPOINTS) {
      const separator = endpoint.path.includes("?") ? "&" : "?";
      const probeUrl = `${BASE_URL}${endpoint.path}${separator}protected_readback_probe=${Date.now()}`;
      const response = await fetchText(probeUrl, {
        headers: {
          ...protectedReadbackHeaders(credential),
          accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        },
      });
      const reason = classifyProtectedResponse(response);
      endpoints.push({
        key: endpoint.key,
        path: endpoint.path,
        ok: reason === "ok",
        status: response.status,
        elapsedMs: response.elapsedMs,
        reason,
        noStore: /no-store/i.test(String(response.headers?.["cache-control"] || "")),
      });
    }
  }

  const failures = [];
  if (!credential.ok || !credential.token) failures.push(credential.reason || "protected_readback_credential_not_armed");
  for (const endpoint of endpoints.filter((row) => !row.ok)) failures.push(`${endpoint.key}:${endpoint.reason}`);
  const payload = {
    contract: "protected-readback-credential-v1",
    checkedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    ok: failures.length === 0,
    armed: Boolean(credential.ok && credential.token),
    source: credential.source || "none",
    auth: authSummary,
    env: authSummary.env,
    endpoints,
    failures,
    diagnostics: {
      runtimeFile: runtimeFileDiagnostics(authSummary.env),
      windowsEnvironment: windowsEnvironmentPresence(),
    },
  };
  payload.nextActions = buildNextActions(payload);
  const file = path.join(OUT_DIR, "protected-readback-credential.json");
  await fs.promises.writeFile(file, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: payload.ok,
    armed: payload.armed,
    source: payload.source,
    failures: payload.failures,
    runtimeFile: payload.diagnostics.runtimeFile,
    nextActions: payload.nextActions,
    output: file,
  }, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch(async (error) => {
  await fs.promises.mkdir(OUT_DIR, { recursive: true }).catch(() => {});
  const payload = {
    contract: "protected-readback-credential-v1",
    checkedAt: new Date().toISOString(),
    ok: false,
    armed: false,
    source: "error",
    failures: ["protected_readback_verifier_error"],
    error: error?.message || String(error),
  };
  await fs.promises.writeFile(path.join(OUT_DIR, "protected-readback-credential.json"), JSON.stringify(payload, null, 2)).catch(() => {});
  console.error(`[protected-readback-credential] failed: ${error.stack || error.message || error}`);
  process.exit(1);
});
