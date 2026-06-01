const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { isTwseTradingDay } = require("./twse-trading-day");
const { hasLineConfig, sendLineText } = require("./line-push");
const { hasTelegramConfig, sendTelegramText } = require("./telegram-push");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(RUNTIME_DIR, "data");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const SECRET_DIR = path.join(RUNTIME_DIR, "secrets");
const OUT_FILE = path.join(DATA_DIR, "realtime-radar-health-report.json");
const STATUS_FILE = path.join(STATE_DIR, "realtime-radar-health-status.json");
const ALERT_COOLDOWN_MS = Number(process.env.REALTIME_RADAR_HEALTH_ALERT_COOLDOWN_MS || 15 * 60 * 1000);
const FRONTEND_VERSION = process.env.FUMAN_EXPECTED_FRONTEND_VERSION || "realtime-radar-after-close-20260601-03";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function readText(file, fallback = "") {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function todayKey() {
  const p = taipeiParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function marketMinute() {
  const p = taipeiParts();
  return Number(p.hour) * 60 + Number(p.minute);
}

function marketPhase() {
  const minutes = marketMinute();
  if (minutes < 9 * 60) return "preopen";
  if (minutes <= 13 * 60 + 30) return "intraday";
  return "after_close";
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function payloadUpdatedAtMs(payload = {}) {
  return cleanNumber(payload.updatedAtMs)
    || Date.parse(payload.updatedAt || payload.timestamp || "")
    || cleanNumber(payload.updatedAt)
    || 0;
}

function pushIssue(issues, severity, code, message) {
  issues.push({ severity, code, message });
}

function maxSeverity(issues) {
  if (issues.some((item) => item.severity === "critical")) return "critical";
  if (issues.some((item) => item.severity === "warning")) return "warning";
  return "ok";
}

function taskInfo(name) {
  try {
    const output = execFileSync("schtasks", ["/Query", "/TN", name, "/V", "/FO", "LIST"], { encoding: "utf8" });
    const get = (label) => {
      const line = output.split(/\r?\n/).find((item) => item.trim().startsWith(`${label}:`));
      return line ? line.split(":").slice(1).join(":").trim() : "";
    };
    return {
      exists: true,
      status: get("Status"),
      nextRunTime: get("Next Run Time"),
      lastRunTime: get("Last Run Time"),
      lastResult: get("Last Result"),
    };
  } catch (error) {
    return { exists: false, error: String(error?.message || error) };
  }
}

async function fetchJson(url, headers = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function readSupabaseLatest() {
  const base = readText(path.join(SECRET_DIR, "supabase-url.txt"));
  const key = readText(path.join(SECRET_DIR, "supabase-anon-key.txt"));
  if (!base || !key) return { ok: false, error: "missing supabase url/anon key" };
  const url = `${base.replace(/\/+$/, "")}/rest/v1/fuman_realtime_radar_cache?id=eq.latest&select=payload,updated_at&limit=1`;
  const rows = await fetchJson(url, { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, 6000);
  const row = Array.isArray(rows) ? rows[0] : rows;
  return { ok: Boolean(row?.payload), updatedAt: row?.updated_at || "", payload: row?.payload || null };
}

async function readStaticLatest() {
  const payload = await fetchJson(`https://fuman-terminal.vercel.app/data/realtime-radar-latest.json?t=${Date.now()}`, {}, 8000);
  return { ok: Boolean(payload?.rows?.length), payload };
}

async function readFrontendGuard() {
  const home = await fetch(`https://fuman-terminal.vercel.app/?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
  const app = await fetch(`https://fuman-terminal.vercel.app/terminal-app.js?v=${FRONTEND_VERSION}&t=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
  return {
    ok: home.includes(FRONTEND_VERSION) && app.includes("shouldRefreshRealtimeRadarRemoteCache") && app.includes("shouldRunLivePolling() || !isKnownNonTradingMarketDate()"),
    pageVersion: home.includes(FRONTEND_VERSION),
    afterCloseGuard: app.includes("shouldRefreshRealtimeRadarRemoteCache"),
    afterCloseSupabase: app.includes("shouldRunLivePolling() || !isKnownNonTradingMarketDate()"),
  };
}

async function notify(report) {
  if (process.env.REALTIME_RADAR_HEALTH_NOTIFY === "0") return "";
  const status = readJson(STATUS_FILE, {});
  const signature = report.issues.map((item) => `${item.severity}:${item.code}:${item.message}`).join("|");
  const lastAlertAt = Date.parse(status.lastAlertAt || "");
  if (status.lastSignature === signature && Number.isFinite(lastAlertAt) && Date.now() - lastAlertAt < ALERT_COOLDOWN_MS) return "";
  const lines = [
    `即時雷達健康警示｜${report.date} ${report.phase}`,
    "",
    `狀態：${report.status}`,
    `資料：${report.radar.date || "--"} ${report.radar.timestamp || "--"} rows=${report.radar.rows}`,
    `failed=${report.radar.failedBatchCount}/${report.radar.totalBatchCount} stale=${report.radar.staleQuoteCount}`,
    "",
    ...report.issues.slice(0, 8).map((item) => `[${item.severity}] ${item.code}｜${item.message}`),
  ];
  let channel = "";
  if (hasTelegramConfig()) {
    await sendTelegramText(lines.join("\n"));
    channel = "telegram";
  } else if (hasLineConfig()) {
    await sendLineText(lines.join("\n"));
    channel = "line";
  }
  if (channel) {
    writeJson(STATUS_FILE, {
      ok: report.status === "ok",
      updatedAt: new Date().toISOString(),
      lastAlertAt: new Date().toISOString(),
      lastSignature: signature,
      channel,
    });
  }
  return channel;
}

async function main() {
  const issues = [];
  const warnings = [];
  const date = todayKey();
  const phase = marketPhase();
  const tradingDay = await isTwseTradingDay(new Date(), { stateDir: STATE_DIR });
  const latest = readJson(path.join(DATA_DIR, "realtime-radar-latest.json"), {});
  const rows = Array.isArray(latest.rows) ? latest.rows : [];
  const updatedMs = payloadUpdatedAtMs(latest);
  const ageSeconds = updatedMs ? Math.round((Date.now() - updatedMs) / 1000) : null;
  const failedBatchCount = cleanNumber(latest.failedBatchCount);
  const totalBatchCount = cleanNumber(latest.totalBatchCount);
  const staleQuoteCount = cleanNumber(latest.staleQuoteCount);

  if (!tradingDay.isTradingDay) {
    const report = { ok: true, status: "ok", date, phase, tradingDay, skipped: "non_trading_day", updatedAt: new Date().toISOString(), issues: [] };
    writeJson(OUT_FILE, report);
    console.log(`realtime radar health ok: skipped non-trading day ${tradingDay.date}`);
    return;
  }

  if (latest.date && latest.date !== date && phase !== "preopen") pushIssue(issues, "critical", "radar-date", `runtime latest date is ${latest.date}, expected ${date}`);
  if (!rows.length && phase !== "preopen") pushIssue(issues, "critical", "radar-empty", "runtime latest has no rows");
  if (phase === "intraday" && (!ageSeconds || ageSeconds > 180)) pushIssue(issues, "critical", "radar-stale-runtime", `runtime latest age ${ageSeconds ?? "--"}s exceeds 180s`);
  if (phase === "after_close" && updatedMs && latest.date === date) {
    const p = taipeiParts(new Date(updatedMs));
    const minutes = Number(p.hour) * 60 + Number(p.minute);
    if (minutes < 13 * 60 + 20) pushIssue(issues, "warning", "radar-early-close-snapshot", `last snapshot time ${latest.timestamp || latest.updatedAt} is before 13:20`);
  }
  if (failedBatchCount > 0) {
    const severity = totalBatchCount && failedBatchCount / totalBatchCount >= 0.35 ? "critical" : "warning";
    pushIssue(issues, severity, "api-realtime-failed-batches", `${failedBatchCount}/${totalBatchCount || "--"} realtime batches failed`);
  }
  if (staleQuoteCount >= 80) pushIssue(issues, "critical", "stale-quotes-high", `staleQuoteCount=${staleQuoteCount}`);
  else if (staleQuoteCount >= 20) pushIssue(issues, "warning", "stale-quotes-elevated", `staleQuoteCount=${staleQuoteCount}`);

  const failedQueue = readJson(path.join(STATE_DIR, "realtime-radar-failed-batches.json"), {});
  if (cleanNumber(failedQueue.count) > 0) pushIssue(issues, "warning", "failed-queue-pending", `failed queue has ${failedQueue.count} batch(es)`);

  const supabaseStatus = readJson(path.join(STATE_DIR, "realtime-radar-supabase-status.json"), {});
  if (supabaseStatus.ok === false || cleanNumber(supabaseStatus.consecutiveFailures) > 0) {
    pushIssue(issues, "critical", "supabase-upload-failed", `supabase consecutiveFailures=${supabaseStatus.consecutiveFailures || 0}`);
  }

  let supabase = { ok: false, error: "" };
  try {
    supabase = await readSupabaseLatest();
    const supMs = payloadUpdatedAtMs(supabase.payload || {});
    if (!supabase.ok) pushIssue(issues, "critical", "supabase-readback-missing", "Supabase latest payload missing");
    else if (updatedMs && supMs && Math.abs(updatedMs - supMs) > 5 * 60 * 1000) {
      pushIssue(issues, "critical", "supabase-readback-lag", `Supabase latest differs from runtime by ${Math.round(Math.abs(updatedMs - supMs) / 1000)}s`);
    }
  } catch (error) {
    supabase = { ok: false, error: String(error?.message || error) };
    pushIssue(issues, "warning", "supabase-readback-error", supabase.error);
  }

  let staticLatest = { ok: false, error: "" };
  try {
    staticLatest = await readStaticLatest();
    const staticMs = payloadUpdatedAtMs(staticLatest.payload || {});
    if (!staticLatest.ok) pushIssue(issues, "warning", "static-fallback-missing", "static realtime-radar latest missing rows");
    else if (updatedMs && staticMs && Math.abs(updatedMs - staticMs) > 10 * 60 * 1000) {
      pushIssue(issues, "warning", "static-fallback-lag", `static fallback differs from runtime by ${Math.round(Math.abs(updatedMs - staticMs) / 1000)}s`);
    }
  } catch (error) {
    staticLatest = { ok: false, error: String(error?.message || error) };
    pushIssue(issues, "warning", "static-fallback-error", staticLatest.error);
  }

  let frontend = { ok: false, error: "" };
  try {
    frontend = await readFrontendGuard();
    if (!frontend.ok) pushIssue(issues, "warning", "frontend-guard-missing", "deployed frontend version/after-close guard not visible");
  } catch (error) {
    frontend = { ok: false, error: String(error?.message || error) };
    pushIssue(issues, "warning", "frontend-verify-error", frontend.error);
  }

  const google = readJson(path.join(STATE_DIR, "google-sheet-upload-status.json"), {});
  if (google.ok === false || cleanNumber(google.consecutiveFailures) > 0) pushIssue(issues, "warning", "google-sheet-failed", `Google Sheet consecutiveFailures=${google.consecutiveFailures || 0}`);
  if (cleanNumber(google.pendingCount) > 0) pushIssue(issues, "warning", "google-sheet-queue", `Google Sheet pending queue=${google.pendingCount}`);
  const tokenExists = fs.existsSync(path.join(SECRET_DIR, "google-sheets-token.json"));
  const tokenBackupExists = fs.existsSync(path.join(SECRET_DIR, "google-sheets-token.backup.json"));
  if (!tokenExists && !tokenBackupExists) pushIssue(issues, "critical", "google-token-missing", "Google Sheet token and backup missing");
  else if (!tokenExists) pushIssue(issues, "warning", "google-token-restorable", "Google Sheet token missing but backup exists");
  else if (!tokenBackupExists) pushIssue(issues, "warning", "google-token-backup-missing", "Google Sheet token backup missing");

  const radarTask = taskInfo("\\Fuman 即時雷達");
  if (!radarTask.exists) pushIssue(issues, "critical", "schedule-missing", "Fuman realtime radar task missing");
  else if (!/Ready|Running/i.test(radarTask.status || "")) pushIssue(issues, "warning", "schedule-not-ready", `radar task status=${radarTask.status}`);
  if (radarTask.exists && radarTask.lastResult && !["0", "267009", "267011"].includes(String(radarTask.lastResult))) pushIssue(issues, "warning", "schedule-last-result", `radar task lastResult=${radarTask.lastResult}`);

  const wakeTask = taskInfo("\\Fuman PC Wake 0430");
  if (wakeTask.exists && wakeTask.lastResult && String(wakeTask.lastResult) !== "0") pushIssue(warnings, "warning", "wake-task-last-result", `PC Wake lastResult=${wakeTask.lastResult}`);

  const status = maxSeverity(issues);
  const report = {
    ok: status === "ok",
    status,
    date,
    phase,
    tradingDay,
    updatedAt: new Date().toISOString(),
    radar: {
      date: latest.date || "",
      timestamp: latest.timestamp || latest.updatedAt || "",
      updatedAtMs: updatedMs,
      ageSeconds,
      status: latest.status || "",
      rows: rows.length,
      failedBatchCount,
      totalBatchCount,
      staleQuoteCount,
      staleQuoteDetails: Array.isArray(latest.staleQuoteDetails) ? latest.staleQuoteDetails.slice(0, 20) : [],
      failedBatchDetails: Array.isArray(latest.failedBatchDetails) ? latest.failedBatchDetails.slice(0, 20) : [],
    },
    supabase: {
      statusFile: supabaseStatus,
      readbackOk: supabase.ok,
      readbackUpdatedAt: supabase.updatedAt || "",
      readbackTimestamp: supabase.payload?.timestamp || "",
      readbackRows: Array.isArray(supabase.payload?.rows) ? supabase.payload.rows.length : 0,
      error: supabase.error || "",
    },
    staticFallback: {
      ok: staticLatest.ok,
      timestamp: staticLatest.payload?.timestamp || "",
      rows: Array.isArray(staticLatest.payload?.rows) ? staticLatest.payload.rows.length : 0,
      error: staticLatest.error || "",
    },
    frontend,
    googleSheet: google,
    tasks: { realtimeRadar: radarTask, pcWake0430: wakeTask },
    warnings,
    issues,
  };

  writeJson(OUT_FILE, report);
  const previousStatus = readJson(STATUS_FILE, {});
  writeJson(STATUS_FILE, {
    ok: report.ok,
    status: report.status,
    updatedAt: report.updatedAt,
    issueCount: report.issues.length,
    warningCount: report.warnings.length,
    lastSuccessAt: report.ok ? report.updatedAt : (previousStatus.lastSuccessAt || ""),
    lastAlertAt: previousStatus.lastAlertAt || "",
    lastSignature: previousStatus.lastSignature || "",
    channel: previousStatus.channel || "",
  });
  if (status !== "ok") {
    const channel = await notify(report);
    if (channel) console.log(`realtime radar health alert sent via ${channel}`);
  }
  console.log(`realtime radar health ${status}: issues=${issues.length} warnings=${warnings.length}`);
  if (status === "critical") process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
