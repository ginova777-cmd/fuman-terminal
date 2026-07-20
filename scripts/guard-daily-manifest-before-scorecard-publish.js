const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_DATE = (process.argv.find((arg) => arg.startsWith("--expected-date="))?.slice("--expected-date=".length) || taipeiDateKey()).replace(/\D/g, "").slice(0, 8);
const MANIFEST_FILE = path.resolve(process.argv.find((arg) => arg.startsWith("--manifest="))?.slice("--manifest=".length)
  || path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"));
const CANARY_FILE = path.resolve(process.argv.find((arg) => arg.startsWith("--canary="))?.slice("--canary=".length)
  || path.join(ROOT, "outputs", "terminal-canary-publish", "terminal-canary-publish.json"));
const ALLOW_DEGRADED = process.argv.includes("--allow-degraded") || process.env.FUMAN_SCORECARD_ALLOW_DEGRADED_MANIFEST === "1";

function taipeiDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replace(/\D/g, "");
}


function clean(value) {
  return String(value ?? "").trim();
}

function modulesGreen(manifest = {}) {
  const rows = Array.isArray(manifest.modules) ? manifest.modules : [];
  return rows.length > 0 && rows.every((row) => row.ok === true
    && row.complete === true
    && row.fallback !== true
    && clean(row.runId));
}

function allowMarketClosedClosurePublish(manifest = {}) {
  return manifest.ok === true
    && String(manifest.unattendedStatus || "") === "PREVIOUS_GOOD_HOLD"
    && modulesGreen(manifest);
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
  const marketClosedClosureAllowed = allowMarketClosedClosurePublish(manifest);
  if (manifest.ok !== true || (manifest.unattendedStatus !== "YES" && !marketClosedClosureAllowed)) {
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
  let canary;
  try {
    canary = readJson(CANARY_FILE);
  } catch (error) {
    fail("canary_publish_missing_or_invalid", { canary: CANARY_FILE, error: String(error.message || error) });
  }
  if (String(canary.contract || "") !== "terminal-canary-publish-v1") {
    fail("canary_publish_contract_invalid", { contract: canary.contract || "", canary: CANARY_FILE });
  }
  if (String(canary.tradeDate || "") !== EXPECTED_DATE) {
    fail("canary_publish_tradeDate_mismatch", { tradeDate: canary.tradeDate || "", expectedDate: EXPECTED_DATE });
  }
  if (canary.ok !== true) {
    fail("canary_publish_not_green", { status: canary.status || "", issues: canary.issues || [] });
  }
  if (canary.scorecardPublishAllowed !== true && !ALLOW_DEGRADED) {
    fail("canary_publish_not_armed_refuse_scorecard_publish", {
      status: canary.status || "",
      reason: canary.issues?.[0] || "scorecard_publish_not_allowed_by_canary",
    });
  }
  console.log(JSON.stringify({
    ok: true,
    status: manifest.ok ? "green" : "degraded_allowed",
    tradeDate: manifest.tradeDate,
    unattendedStatus: manifest.unattendedStatus,
    modules: Array.isArray(manifest.modules) ? manifest.modules.length : 0,
    manifest: MANIFEST_FILE,
    canary: CANARY_FILE,
  }, null, 2));
}

main();
