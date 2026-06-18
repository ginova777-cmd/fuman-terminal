const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const DEFAULT_SUPABASE_URL = "https://cpmpfhbzutkiecccekfr.supabase.co";

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

function changedKeysFromBoot(boot) {
  const keys = new Set(["mobile-boot"]);
  if (boot?.digest?.ultraHash || boot?.digest?.aiHash) keys.add("ai");
  if (boot?.digest) keys.add("digest");
  if (boot?.aiSummary || boot?.breadth) keys.add("breadth");
  for (const key of Object.keys(boot?.fragments || {})) keys.add(key);
  return [...keys];
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

  const boot = readJson("data/mobile-boot.json");
  const digest = boot?.digest || {};
  const version = boot?.updatedAt || digest.aiUpdatedAt || new Date().toISOString();
  const bootHash = digest.ultraHash || digest.aiHash || digest.mobileHash || "";
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

  const response = await fetch(`${supabaseUrl}/rest/v1/mobile_update_events`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    const message = `[mobile-event] publish failed status=${response.status} body=${detail.slice(0, 500)}`;
    if (strict) throw new Error(message);
    console.warn(message);
    return;
  }

  console.log(`[mobile-event] published version=${version} hash=${bootHash} keys=${payload.changed_keys.join(",")}`);
}

publish().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
