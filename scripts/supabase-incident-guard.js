const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const INCIDENT_DIR = path.join(RUNTIME_DIR, "locks");
const RECEIPT_DIR = path.join(RUNTIME_DIR, "data", "scan-receipts");
const INCIDENT_FILE = path.join(INCIDENT_DIR, "supabase-rest-pool-incident.json");

const HEAVY_CLASSES = new Set([
  "battle-verifier",
  "full-verifier",
  "guard",
  "monitor",
  "patrol",
  "replay",
  "scorecard",
  "snapshot",
  "writer",
]);

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readIncident() {
  try {
    return JSON.parse(fs.readFileSync(INCIDENT_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isActive(incident = readIncident()) {
  if (!incident || incident.status !== "active") return false;
  const untilMs = Date.parse(incident.activeUntil || "");
  return Number.isFinite(untilMs) && untilMs > Date.now();
}

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function parseTtlMinutes() {
  const raw = argValue("--ttl-minutes", process.env.FUMAN_SUPABASE_INCIDENT_TTL_MINUTES || "45");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 5) return 45;
  return Math.min(parsed, 240);
}

function writeBlockedReceipt(actionClass, action, incident) {
  const stamp = nowIso().replace(/[-:.TZ]/g, "").slice(0, 14);
  const receipt = {
    ok: false,
    status: "blocked",
    reason: "supabase_rest_pool_incident_active",
    actionClass,
    action,
    blockedAt: nowIso(),
    incident: {
      activeUntil: incident.activeUntil,
      reason: incident.reason,
      owner: incident.owner,
      enteredAt: incident.enteredAt,
    },
    policy: {
      writeLatest: false,
      writeEmptyResult: false,
      updateLatestPointer: false,
      preservePreviousGood: true,
      allowedWhileActive: ["status", "light-probe"],
    },
  };
  const file = path.join(RECEIPT_DIR, `supabase-incident-blocked-${stamp}.json`);
  writeJson(file, receipt);
  return { file, receipt };
}

function enter() {
  const ttl = parseTtlMinutes();
  const activeUntil = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  const incident = {
    status: "active",
    code: "supabase_rest_pool_incident",
    enteredAt: nowIso(),
    activeUntil,
    ttlMinutes: ttl,
    reason: argValue("--reason", "Supabase REST 522 / DB pool checkout timeout"),
    owner: argValue("--owner", process.env.USERNAME || "release-owner"),
    policy: {
      stopHeavySupabaseWork: true,
      allowOnlyOneLightProbe: true,
      doNotRun: [
        "guard:production",
        "monitor:production",
        "verify:production-api-freshness",
        "verify:api-unattended-scorecard",
        "snapshot:desktop",
        "scorecard:sync",
        "battle verifiers",
        "replay/backtest loops",
        "Supabase upsert/backfill",
      ],
      noLatestWritesWhenBlocked: true,
      preservePreviousGood: true,
    },
  };
  writeJson(INCIDENT_FILE, incident);
  console.log(JSON.stringify({ ok: true, action: "enter", incidentFile: INCIDENT_FILE, incident }, null, 2));
}

function exit() {
  const previous = readIncident();
  const resolved = {
    ...(previous || {}),
    status: "resolved",
    resolvedAt: nowIso(),
    resolvedBy: argValue("--owner", process.env.USERNAME || "release-owner"),
  };
  writeJson(INCIDENT_FILE, resolved);
  console.log(JSON.stringify({ ok: true, action: "exit", incidentFile: INCIDENT_FILE, incident: resolved }, null, 2));
}

function status() {
  const incident = readIncident();
  console.log(JSON.stringify({
    ok: true,
    incidentFile: INCIDENT_FILE,
    active: isActive(incident),
    incident,
  }, null, 2));
}

function check() {
  const actionClass = argValue("--class", "guard");
  const action = argValue("--action", process.env.npm_lifecycle_event || "unknown");
  const incident = readIncident();
  if (!isActive(incident)) {
    console.log(JSON.stringify({ ok: true, active: false, actionClass, action }, null, 2));
    return;
  }
  const allowed = actionClass === "status" || actionClass === "light-probe" || !HEAVY_CLASSES.has(actionClass);
  if (allowed) {
    console.log(JSON.stringify({ ok: true, active: true, allowed: true, actionClass, action, incident }, null, 2));
    return;
  }
  const blocked = writeBlockedReceipt(actionClass, action, incident);
  console.error(JSON.stringify({
    ok: false,
    active: true,
    blocked: true,
    actionClass,
    action,
    receipt: blocked.file,
    incident,
  }, null, 2));
  process.exitCode = 2;
}

function main() {
  const command = process.argv[2] || "status";
  if (command === "enter") return enter();
  if (command === "exit") return exit();
  if (command === "check") return check();
  if (command === "status") return status();
  console.error(`Unknown command: ${command}`);
  console.error("Usage: node scripts/supabase-incident-guard.js <enter|exit|status|check>");
  process.exitCode = 1;
}

main();
