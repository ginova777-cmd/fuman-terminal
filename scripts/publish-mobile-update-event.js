const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const DEFAULT_SUPABASE_URL = "https://cpmpfhbzutkiecccekfr.supabase.co";
const DEFAULT_TERMINAL_URL = "https://fuman-terminal.vercel.app";

function readSecret(name) {
  for (const dir of [
    path.join(ROOT, "secrets"),
    path.join(RUNTIME_DIR, "secrets"),
  ]) {
    try {
      const value = fs.readFileSync(path.join(dir, name), "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      "User-Agent": "FumanMobileUpdateEvent/1.0",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${url} returned ${response.status} ${text.slice(0, 160)}`.trim());
  }
  return response.json();
}

function postJson(url, key, payload) {
  const body = JSON.stringify(payload);
  const endpoint = new URL(url);
  return new Promise((resolve, reject) => {
    const request = https.request({
      method: "POST",
      hostname: endpoint.hostname,
      path: `${endpoint.pathname}${endpoint.search}`,
      family: 4,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Prefer: "return=minimal",
      },
      timeout: 15000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          text: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function deleteOldEvents(url, key) {
  return new Promise((resolve) => {
    const retentionDays = Number(process.env.MOBILE_UPDATE_EVENT_RETENTION_DAYS || 14);
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return resolve(null);
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const endpoint = new URL(`${url}/rest/v1/mobile_update_events?created_at=lt.${encodeURIComponent(cutoff)}`);
    const request = https.request({
      method: "DELETE",
      hostname: endpoint.hostname,
      path: `${endpoint.pathname}${endpoint.search}`,
      family: 4,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
      timeout: 15000,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", (error) => resolve({ ok: false, status: 0, text: error.message }));
    request.end();
  });
}

function changedKeysFromBoot(boot) {
  const keys = new Set(["mobile-boot"]);
  if (boot?.digest?.ultraHash || boot?.digest?.aiHash) keys.add("ai");
  if (boot?.digest) keys.add("digest");
  if (boot?.aiSummary || boot?.breadth) keys.add("breadth");
  for (const key of Object.keys(boot?.fragments || {})) keys.add(key);
  return [...keys];
}

async function loadMobileBoot() {
  if (process.env.MOBILE_UPDATE_EVENT_BOOT_SOURCE === "local-static") {
    return readJson("data/mobile-boot.json");
  }
  const baseUrl = String(process.env.FUMAN_TERMINAL_URL || process.env.FUMAN_LIVE_BASE_URL || DEFAULT_TERMINAL_URL).replace(/\/+$/, "");
  try {
    return await fetchJson(`${baseUrl}/api/mobile-boot?mobileEvent=${Date.now()}`);
  } catch (error) {
    if (process.env.MOBILE_UPDATE_EVENT_ALLOW_LOCAL_STATIC_FALLBACK === "1") {
      console.warn(`[mobile-event] API boot unavailable; using legacy local static fallback: ${error.message}`);
      return readJson("data/mobile-boot.json");
    }
    throw error;
  }
}

async function publish() {
  const strict = process.argv.includes("--strict");
  const dryRun = process.argv.includes("--dry-run");
  const sourceArg = process.argv.find((arg) => arg.startsWith("--source="));
  const source = sourceArg ? sourceArg.slice("--source=".length) : "scanner";
  const supabaseUrl = String(
    process.env.SUPABASE_URL ||
    process.env.FUMAN_SUPABASE_URL ||
    DEFAULT_SUPABASE_URL
  ).replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.FUMAN_SUPABASE_SERVICE_KEY ||
    readSecret("supabase-service-role-key.txt");

  if (!supabaseUrl || !serviceKey) {
    const message = "[mobile-event] missing Supabase URL or service role key";
    if (strict) throw new Error(message);
    console.warn(`${message}; skip`);
    return;
  }

  const boot = await loadMobileBoot();
  const digest = boot?.digest || {};
  const version = boot?.updatedAt || digest.aiUpdatedAt || new Date().toISOString();
  const bootHash = boot?.bootHash || digest.ultraHash || digest.aiHash || digest.mobileHash || "";
  const payload = {
    version,
    boot_hash: bootHash,
    changed_keys: changedKeysFromBoot(boot),
    source,
  };

  if (dryRun) {
    console.log(`[mobile-event] dry-run version=${version} hash=${bootHash} keys=${payload.changed_keys.join(",")}`);
    return;
  }

  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await postJson(`${supabaseUrl}/rest/v1/mobile_update_events`, serviceKey, payload);
      if (response.ok || response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }

  if (!response) {
    const message = `[mobile-event] publish failed ${lastError?.message || lastError || "unknown fetch error"}`;
    if (strict) throw new Error(message);
    console.warn(message);
    return;
  }

  if (!response.ok) {
    const detail = response.text || "";
    const message = `[mobile-event] publish failed status=${response.status} body=${detail.slice(0, 500)}`;
    if (strict) throw new Error(message);
    console.warn(message);
    return;
  }

  const cleanup = await deleteOldEvents(supabaseUrl, serviceKey);
  if (cleanup && !cleanup.ok) {
    console.warn(`[mobile-event] cleanup skipped status=${cleanup.status} body=${String(cleanup.text || "").slice(0, 240)}`);
  }

  console.log(`[mobile-event] published version=${version} hash=${bootHash} keys=${payload.changed_keys.join(",")}`);
}

publish().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
