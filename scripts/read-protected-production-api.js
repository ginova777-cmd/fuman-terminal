"use strict";
const { resolveProtectedReadbackCredential, protectedReadbackHeaders, publicCredentialSummary } = require("../lib/protected-readback-credential");
function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}
async function main() {
  const baseUrl = String(arg("base-url", process.env.FUMAN_VERCEL_BASE_URL || "https://fuman-terminal.vercel.app")).replace(/\/+$/, "");
  const endpoint = arg("endpoint");
  if (!endpoint || !endpoint.startsWith("/api/")) throw new Error("--endpoint=/api/... is required");
  const credential = await resolveProtectedReadbackCredential({ timeoutMs: 20000 });
  if (!credential.ok || !credential.token) throw new Error(credential.reason || "protected readback credential unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const separator = endpoint.includes("?") ? "&" : "?";
    const response = await fetch(`${baseUrl}${endpoint}${separator}ts=${Date.now()}`, {
      headers: { ...protectedReadbackHeaders(credential), "cache-control": "no-cache" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error(`protected API returned invalid JSON HTTP ${response.status}`); }
    if (!response.ok) throw new Error(`protected API HTTP ${response.status}: ${String(payload?.error || payload?.message || "request failed")}`);
    process.stdout.write(JSON.stringify({ ok: true, status: response.status, endpoint, credential: publicCredentialSummary(credential), payload }));
  } finally {
    clearTimeout(timer);
  }
}
main().catch((error) => {
  process.stderr.write(JSON.stringify({ ok: false, error: error?.message || String(error) }));
  process.exitCode = 1;
});
