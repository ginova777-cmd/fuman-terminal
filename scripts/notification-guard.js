const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { statePath, repoPath } = require("./runtime-paths");

const CLAIM_DIR = statePath("notification-guard", "claims");
const LOG_FILE = statePath("notification-guard", "sent-notifications.jsonl");
const DEFAULT_MAX_EVENT_AGE_SEC = 6 * 60 * 60;

function envFlag(name, fallback = false) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function disabledFlag(name) {
  return /^(0|false|no|off)$/i.test(String(process.env[name] ?? "").trim());
}

function sha(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function taipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function detectRuntimeVersion() {
  const fromEnv = process.env.NOTIFY_RUNTIME_VERSION
    || process.env.FUMAN_NOTIFY_RUNTIME_VERSION
    || process.env.FUMAN_EXPECTED_FRONTEND_VERSION
    || "";
  if (fromEnv) return fromEnv;
  try {
    const version = JSON.parse(fs.readFileSync(repoPath("version.json"), "utf8"));
    if (version?.version) return String(version.version);
  } catch {}
  try {
    const core = fs.readFileSync(repoPath("terminal-core.js"), "utf8");
    const match = core.match(/const\s+version\s*=\s*["']([^"']+)["']/);
    if (match) return match[1];
  } catch {}
  return "";
}

function versionRank(value) {
  return String(value || "")
    .match(/\d+/g)
    ?.map((item) => Number(item))
    .filter((item) => Number.isFinite(item)) || [];
}

function compareVersionLike(left, right) {
  if (!right) return 0;
  if (!left) return -1;
  if (left === right) return 0;
  const a = versionRank(left);
  const b = versionRank(right);
  if (!a.length || !b.length) return left.localeCompare(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function normalizeChannels(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function channelAllowed(channel) {
  if (disabledFlag("NOTIFY_ENABLED")) return false;
  if (disabledFlag(`NOTIFY_${String(channel).toUpperCase()}_ENABLED`)) return false;
  const channels = normalizeChannels(process.env.NOTIFY_CHANNELS || process.env.FUMAN_NOTIFY_CHANNELS || "");
  return !channels.length || channels.includes(String(channel).toLowerCase());
}

function eventTimeMs(options = {}) {
  const value = options.eventTime || options.event_time || options.eventAt || options.updatedAt || "";
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localGate(channel, options = {}) {
  if (envFlag("NOTIFICATION_GUARD_DISABLED") || envFlag("NOTIFY_GUARD_DISABLED")) {
    return { ok: true, reason: "guard-disabled" };
  }
  if (!channelAllowed(channel)) return { ok: false, reason: "channel-disabled" };
  if (options.dataConfirmed === false || options.confirmed === false) return { ok: false, reason: "data-not-confirmed" };

  const runtimeVersion = detectRuntimeVersion();
  const minRuntimeVersion = process.env.NOTIFY_MIN_RUNTIME_VERSION || process.env.FUMAN_NOTIFY_MIN_RUNTIME_VERSION || "";
  if (minRuntimeVersion && compareVersionLike(runtimeVersion, minRuntimeVersion) < 0) {
    return { ok: false, reason: "runtime-version-too-old", runtimeVersion, minRuntimeVersion };
  }

  const timestamp = eventTimeMs(options);
  if (timestamp) {
    const maxAgeSec = Number(options.maxEventAgeSec || process.env.NOTIFY_MAX_EVENT_AGE_SEC || DEFAULT_MAX_EVENT_AGE_SEC);
    if (Number.isFinite(maxAgeSec) && maxAgeSec > 0 && Date.now() - timestamp > maxAgeSec * 1000) {
      return { ok: false, reason: "event-too-old", eventTime: new Date(timestamp).toISOString(), maxAgeSec };
    }
  }

  return { ok: true, runtimeVersion };
}

function notificationKey({ channel, target, payload, options = {} }) {
  if (options.idempotencyKey) return String(options.idempotencyKey);
  const scope = options.dedupeScope || process.env.NOTIFY_DEDUPE_SCOPE || taipeiDateKey();
  return [
    scope,
    channel,
    target || "",
    sha(stableJson(payload)),
  ].join(":");
}

function claimNotification({ channel, target, payload, options = {} }) {
  const gate = localGate(channel, options);
  const key = notificationKey({ channel, target, payload, options });
  const payloadHash = sha(stableJson(payload));
  const runtimeVersion = gate.runtimeVersion || detectRuntimeVersion();
  const base = {
    channel,
    target: target || "",
    idempotencyKey: key,
    payloadHash,
    runtimeVersion,
    claimedAt: new Date().toISOString(),
  };
  if (!gate.ok) return { ok: false, duplicate: false, skipped: true, reason: gate.reason, ...base };
  if (envFlag("NOTIFY_DEDUPE_DISABLED")) return { ok: true, duplicate: false, ...base };

  fs.mkdirSync(CLAIM_DIR, { recursive: true });
  const claimFile = path.join(CLAIM_DIR, `${sha(key)}.json`);
  try {
    const fd = fs.openSync(claimFile, "wx");
    fs.writeFileSync(fd, `${JSON.stringify({ ...base, status: "pending" })}\n`, "utf8");
    fs.closeSync(fd);
    return { ok: true, duplicate: false, claimFile, ...base };
  } catch (error) {
    if (error?.code === "EEXIST") return { ok: false, duplicate: true, skipped: true, reason: "duplicate", claimFile, ...base };
    throw error;
  }
}

function recordNotification(claim, status, details = {}) {
  const payload = {
    ...claim,
    status,
    ...details,
    recordedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${JSON.stringify(payload)}\n`, "utf8");
  } catch (error) {
    console.warn(`notification guard log skipped: ${error.message}`);
  }
  if (claim?.claimFile && status !== "pending") {
    try {
      fs.writeFileSync(claim.claimFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } catch {}
  }
}

function guardSummary(claim) {
  return `${claim.channel}:${claim.reason || claim.status || "ok"}:${claim.idempotencyKey}`;
}

async function guardedSend({ channel, target, payload, options = {}, send }) {
  const claim = claimNotification({ channel, target, payload, options });
  if (!claim.ok) {
    recordNotification(claim, "skipped");
    return { sent: false, claim, reason: claim.reason };
  }
  try {
    const result = await send();
    recordNotification(claim, "sent");
    return { sent: true, claim, result };
  } catch (error) {
    recordNotification(claim, "failed", { error: error?.message || String(error) });
    throw error;
  }
}

module.exports = {
  channelAllowed,
  claimNotification,
  compareVersionLike,
  detectRuntimeVersion,
  guardedSend,
  guardSummary,
  localGate,
  notificationKey,
  recordNotification,
  stableJson,
};
