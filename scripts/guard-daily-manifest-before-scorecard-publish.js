const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);
const MANIFEST_FILE = path.resolve(process.argv.find((arg) => arg.startsWith("--manifest="))?.slice("--manifest=".length)
  || path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"));
const ALLOW_DEGRADED = process.argv.includes("--allow-degraded") || process.env.FUMAN_SCORECARD_ALLOW_DEGRADED_MANIFEST === "1";

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(reason, detail = {}) {
  console.error(JSON.stringify({ ok: false, reason, manifest: MANIFEST_FILE, ...detail }, null, 2));
  process.exit(1);
}

function main() {
  let manifest;
  try {
    manifest = readJson(MANIFEST_FILE);
  } catch (error) {
    fail("manifest_missing_or_invalid", { error: String(error.message || error) });
  }
  if (String(manifest.contract || "") !== "daily-terminal-run-manifest-v1") {
    fail("manifest_contract_invalid", { contract: manifest.contract || "" });
  }
  if (String(manifest.tradeDate || "") !== EXPECTED_DATE) {
    fail("manifest_tradeDate_mismatch", { tradeDate: manifest.tradeDate || "", expectedDate: EXPECTED_DATE });
  }
  if (manifest.ok !== true || manifest.unattendedStatus !== "YES") {
    if (!ALLOW_DEGRADED) {
      fail("manifest_not_green_refuse_scorecard_publish", {
        unattendedStatus: manifest.unattendedStatus || "",
        blocker: manifest.blocker || "",
        issues: manifest.issues || [],
      });
    }
  }
  const badModules = Array.isArray(manifest.modules)
    ? manifest.modules.filter((row) => row.ok !== true || row.complete !== true || row.fallback === true)
    : [];
  if (badModules.length && !ALLOW_DEGRADED) {
    fail("manifest_modules_not_green", {
      modules: badModules.map((row) => ({ key: row.key, runId: row.runId, issues: row.issues || [] })),
    });
  }
  console.log(JSON.stringify({
    ok: true,
    status: manifest.ok ? "green" : "degraded_allowed",
    tradeDate: manifest.tradeDate,
    unattendedStatus: manifest.unattendedStatus,
    modules: Array.isArray(manifest.modules) ? manifest.modules.length : 0,
    manifest: MANIFEST_FILE,
  }, null, 2));
}

main();
