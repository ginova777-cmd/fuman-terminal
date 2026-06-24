const fs = require("fs");
const path = require("path");
const https = require("https");
const { buildAndWriteDesktopRouteSnapshot } = require("../lib/desktop-route-snapshot-builder");
const { serviceRoleKey } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:/fuman-runtime";
const DEFAULT_BASE_URL = (process.env.FUMAN_PRODUCTION_URL || process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg === name || arg.startsWith(prefix));
  if (!found) return fallback;
  if (found === name) return "1";
  return found.slice(prefix.length);
}

function hasArg(name) {
  return process.argv.includes(name) || process.argv.some((arg) => arg.startsWith(`${name}=`));
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReceipt(payload) {
  const out = argValue("--out", process.env.FUMAN_DESKTOP_SNAPSHOT_RECEIPT || path.join(RUNTIME_DIR, "data", "scan-receipts", "desktop-route-snapshot.json"));
  if (!out) return;
  mkdirp(path.dirname(out));
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
}

function requestJson(url, headers = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body || "{}"), raw: body });
        } catch (error) {
          reject(new Error(`invalid JSON from ${url}: ${error.message}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

async function writeRemote() {
  const baseUrl = argValue("--base-url", DEFAULT_BASE_URL);
  const allowPartial = hasArg("--allow-partial") ? "1" : "0";
  const source = encodeURIComponent(argValue("--source", "scanner-desktop-route-snapshot"));
  const url = `${baseUrl}/api/desktop-route-snapshot-refresh?allowPartial=${allowPartial}&source=${source}`;
  const secret = process.env.SCHEDULE_DISPATCH_SECRET || process.env.FUMAN_CRON_SECRET || process.env.CRON_SECRET || "";
  const headers = secret ? { "x-schedule-secret": secret } : { "x-vercel-cron": "1" };
  const result = await requestJson(url, headers);
  return {
    ok: result.status >= 200 && result.status < 300 && result.body?.ok !== false,
    mode: "remote",
    status: result.status,
    write: result.body?.write || null,
    partial: Boolean(result.body?.partial),
    endpointCount: Number(result.body?.endpointCount || 0),
    misses: Array.isArray(result.body?.misses) ? result.body.misses : [],
    updatedAt: result.body?.updatedAt || new Date().toISOString(),
    raw: result.body,
  };
}

async function writeLocal() {
  const allowPartial = hasArg("--allow-partial");
  const reason = argValue("--reason", argValue("--source", "scanner-desktop-route-snapshot"));
  const request = {
    method: "GET",
    url: `/api/desktop-route-snapshot-refresh?allowPartial=${allowPartial ? "1" : "0"}`,
    headers: { host: "localhost", "x-scanner-snapshot": "1" },
    query: {
      allowPartial: allowPartial ? "1" : "0",
      source: reason,
    },
  };
  const { payload, write } = await buildAndWriteDesktopRouteSnapshot(request, { reason });
  return {
    ok: write?.ok !== false,
    mode: "local",
    write,
    partial: Boolean(payload?.partial),
    endpointCount: Object.keys(payload?.endpoints || {}).length,
    misses: Array.isArray(payload?.misses) ? payload.misses : [],
    timings: payload?.timings || {},
    updatedAt: payload?.updatedAt || new Date().toISOString(),
    summary: payload?.summary || {},
  };
}

async function main() {
  const forceRemote = hasArg("--remote");
  const failOnPartial = hasArg("--fail-on-partial");
  const hasServiceKey = Boolean(serviceRoleKey({ root: ROOT, runtimeDir: RUNTIME_DIR }));
  const result = forceRemote || !hasServiceKey
    ? await writeRemote()
    : await writeLocal();
  writeReceipt({
    ...result,
    hasServiceKey,
    generatedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(2);
  if (failOnPartial && result.partial) process.exit(3);
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: error?.message || String(error),
    generatedAt: new Date().toISOString(),
  };
  try { writeReceipt(payload); } catch {}
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
