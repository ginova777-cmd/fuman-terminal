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
const PRODUCTION_URL = (process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const ALERT_COOLDOWN_MS = Number(process.env.REALTIME_RADAR_HEALTH_ALERT_COOLDOWN_MS || 15 * 60 * 1000);
const MIN_INTRADAY_ROWS = Number(process.env.REALTIME_RADAR_HEALTH_MIN_ROWS || 1200);
const MAX_HEALTH_FAILED_BATCHES = Number(process.env.REALTIME_RADAR_HEALTH_MAX_FAILED_BATCHES || 0);
const EXPECTED_SOURCE_EXCLUDED_CODES = ["1475", "2254", "7732", "8488"];

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

function normalizedCodes(value) {
  return Array.isArray(value)
    ? value.map((code) => String(code || "").replace(/\D/g, "").slice(0, 4)).filter(Boolean).sort()
    : [];
}

function sameCodeSet(left, right) {
  const a = normalizedCodes(left);
  const b = normalizedCodes(right);
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

function parseSchtasksOutput(output) {
  const get = (label) => {
    const line = output.split(/\r?\n/).find((item) => item.trim().startsWith(label + ":"));
    return line ? line.split(":").slice(1).join(":").trim() : "";
  };
  return {
    status: get("Status"),
    nextRunTime: get("Next Run Time"),
    lastRunTime: get("Last Run Time"),
    lastResult: get("Last Result"),
  };
}

function powershellTaskInfo(name) {
  const taskName = String(name).replace(/^\\+/, "").replace(/'/g, "''");
  const pwsh = fs.existsSync("C:/Program Files/PowerShell/7/pwsh.exe")
    ? "C:/Program Files/PowerShell/7/pwsh.exe"
    : "powershell.exe";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$OutputEncoding = [Console]::OutputEncoding",
    "$task = Get-ScheduledTask | Where-Object { $_.TaskName -eq '" + taskName + "' } | Select-Object -First 1",
    "if (-not $task) { throw 'scheduled task not found: " + taskName + "' }",
    "$info = Get-ScheduledTaskInfo -TaskPath $task.TaskPath -TaskName $task.TaskName",
    "[pscustomobject]@{",
    "  exists = $true",
    "  status = [string]$task.State",
    "  nextRunTime = if ($info.NextRunTime) { $info.NextRunTime.ToString('yyyy/M/d tt hh:mm:ss') } else { '' }",
    "  lastRunTime = if ($info.LastRunTime) { $info.LastRunTime.ToString('yyyy/M/d tt hh:mm:ss') } else { '' }",
    "  lastResult = [string]$info.LastTaskResult",
    "} | ConvertTo-Json -Compress",
  ].join("\n");
  const output = execFileSync(pwsh, ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
  return JSON.parse(output);
}

function taskInfo(name) {
  try {
    const output = execFileSync("schtasks", ["/Query", "/TN", name, "/V", "/FO", "LIST"], { encoding: "utf8" });
    const parsed = parseSchtasksOutput(output);
    if (parsed.status || parsed.nextRunTime || parsed.lastRunTime || parsed.lastResult) {
      return { exists: true, ...parsed };
    }
    return powershellTaskInfo(name);
  } catch (error) {
    try {
      return powershellTaskInfo(name);
    } catch (fallbackError) {
      return { exists: false, error: String(fallbackError?.message || error?.message || error) };
    }
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

async function readProductionApiLatest() {
  const payload = await fetchJson(`${PRODUCTION_URL}/api/realtime-radar-latest?full=1&limit=1200&compact=1&shell=1&t=${Date.now()}`, {}, 10000);
  return { ok: payload?.ok !== false && Boolean(payload?.rows?.length), payload };
}

async function readFrontendGuard() {
  const home = await fetch(`${PRODUCTION_URL}/?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
  const fastShell = await fetch(`${PRODUCTION_URL}/terminal-desktop-fast-shell.js?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
  const css = await fetch(`${PRODUCTION_URL}/terminal-realtime-radar.css?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
  const pageLoadsFastShell = /terminal-desktop-fast-shell\.js\?/.test(home);
  const pageHasRealtimeRoute = /data-view=["']realtime-radar["']/.test(home) && /id=["']realtime-radar-view["']/.test(home);
  const fullSessionApi = fastShell.includes("/api/realtime-radar-latest?full=1") && fastShell.includes("marketJsonCacheKey(\"/api/realtime-radar-latest?full=1\", 1200)");
  const noSnapshotOnRealtimeError = fastShell.includes("if (isRealtimeRadarRoute(route))") && fastShell.includes("return [];");
  const healthBanner = fastShell.includes("radarDomHealthBanner") && css.includes(".radar-health-banner");
  const stateGuard = fastShell.includes("realtimeRadarDomSideUserSelected") && fastShell.includes("realtimeRadarDomHealth");
  const longShortLedger = fastShell.includes('realtimeRadarDomSide = "long"')
    && fastShell.includes('data-radar-dom-side="long"')
    && fastShell.includes('data-radar-dom-side="short"')
    && !fastShell.includes('data-radar-dom-side="all"')
    && fastShell.includes("09:00-13:30 流水帳逐筆記錄");
  return {
    ok: pageLoadsFastShell && pageHasRealtimeRoute && fullSessionApi && noSnapshotOnRealtimeError && healthBanner && stateGuard && longShortLedger,
    pageLoadsFastShell,
    pageHasRealtimeRoute,
    fullSessionApi,
    noSnapshotOnRealtimeError,
    healthBanner,
    stateGuard,
    longShortLedger,
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
    `failed=${report.radar.failedBatchCount}/${report.radar.totalBatchCount} sourceStale=${report.radar.staleQuoteCount} lastTradeStale=${report.radar.lastTradeStaleCount || 0}`,
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
  const lastTradeStaleCount = cleanNumber(latest.lastTradeStaleCount);
  const quoteSourceText = latest.quoteSourceCounts && typeof latest.quoteSourceCounts === "object"
    ? Object.entries(latest.quoteSourceCounts).map(([key, value]) => `${key}:${value}`).join(",")
    : "";
  const fallbackText = latest.fallbackRecovered && typeof latest.fallbackRecovered === "object"
    ? Object.entries(latest.fallbackRecovered).map(([key, value]) => `${key}:${value}`).join(",")
    : "";

  if (!tradingDay.isTradingDay) {
    const report = { ok: true, status: "ok", date, phase, tradingDay, skipped: "non_trading_day", updatedAt: new Date().toISOString(), issues: [] };
    writeJson(OUT_FILE, report);
    console.log(`realtime radar health ok: skipped non-trading day ${tradingDay.date}`);
    return;
  }

  if (latest.date && latest.date !== date && phase !== "preopen") pushIssue(issues, "critical", "radar-date", `runtime latest date is ${latest.date}, expected ${date}`);
  if (!rows.length && phase !== "preopen") pushIssue(issues, "critical", "radar-empty", "runtime latest has no rows");
  if (phase === "intraday" && rows.length < MIN_INTRADAY_ROWS) pushIssue(issues, "critical", "radar-row-count-low", `runtime latest rows ${rows.length} below ${MIN_INTRADAY_ROWS}`);
  if (phase === "intraday" && (!ageSeconds || ageSeconds > 180)) pushIssue(issues, "critical", "radar-stale-runtime", `runtime latest age ${ageSeconds ?? "--"}s exceeds 180s`);
  if (phase === "after_close" && updatedMs && latest.date === date) {
    const p = taipeiParts(new Date(updatedMs));
    const minutes = Number(p.hour) * 60 + Number(p.minute);
    if (minutes < 13 * 60 + 20) pushIssue(issues, "warning", "radar-early-close-snapshot", `last snapshot time ${latest.timestamp || latest.updatedAt} is before 13:20`);
  }
  if (failedBatchCount > 0) {
    const severity = phase === "intraday" && failedBatchCount > MAX_HEALTH_FAILED_BATCHES
      ? "critical"
      : totalBatchCount && failedBatchCount / totalBatchCount >= 0.35 ? "critical" : "warning";
    pushIssue(issues, severity, "api-realtime-failed-batches", `${failedBatchCount}/${totalBatchCount || "--"} realtime batches failed`);
  }
  if (staleQuoteCount >= 80) pushIssue(issues, "critical", "stale-quotes-high", `staleQuoteCount=${staleQuoteCount} sources=${quoteSourceText || "--"} fallbackRecovered=${fallbackText || "--"}`);
  else if (staleQuoteCount >= 20) pushIssue(issues, "warning", "stale-quotes-elevated", `staleQuoteCount=${staleQuoteCount} sources=${quoteSourceText || "--"} fallbackRecovered=${fallbackText || "--"}`);
  if (!sameCodeSet(latest.sourceExcludedCodes, EXPECTED_SOURCE_EXCLUDED_CODES)) {
    pushIssue(issues, "critical", "source-excluded-codes-mismatch", `sourceExcludedCodes=${normalizedCodes(latest.sourceExcludedCodes).join(",") || "--"} expected=${EXPECTED_SOURCE_EXCLUDED_CODES.join(",")}`);
  }

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

  let productionApi = { ok: false, error: "" };
  try {
    productionApi = await readProductionApiLatest();
    const apiMs = payloadUpdatedAtMs(productionApi.payload || {});
    const apiRows = Array.isArray(productionApi.payload?.rows) ? productionApi.payload.rows.length : 0;
    const apiReason = String(productionApi.payload?.reason || productionApi.payload?.error || "");
    if (!productionApi.ok && phase !== "preopen") pushIssue(issues, "critical", "production-api-unavailable", `production API unavailable: ${productionApi.payload?.reason || productionApi.payload?.error || "no rows"}`);
    else if (updatedMs && apiMs && Math.abs(updatedMs - apiMs) > 5 * 60 * 1000) {
      pushIssue(issues, "critical", "production-api-runtime-lag", `production API differs from runtime by ${Math.round(Math.abs(updatedMs - apiMs) / 1000)}s`);
    }
    if (phase === "intraday" && apiRows < MIN_INTRADAY_ROWS) {
      pushIssue(issues, "critical", "production-api-row-count-low", `production API rows ${apiRows} below ${MIN_INTRADAY_ROWS}`);
    }
    if (phase === "intraday" && apiReason === "stale-radar-cache-quote-view-fallback") {
      pushIssue(issues, "critical", "production-api-using-quote-view-fallback", "production API is still serving quote-view fallback instead of Supabase radar cache");
    }
    if (productionApi.payload?.displayWindow && productionApi.payload.displayWindow !== "09:00-13:30") {
      pushIssue(issues, "critical", "production-api-display-window", `production API displayWindow=${productionApi.payload.displayWindow}`);
    }
    if (Array.isArray(latest.sourceExcludedCodes) && !sameCodeSet(productionApi.payload?.sourceExcludedCodes, latest.sourceExcludedCodes)) {
      pushIssue(issues, "critical", "production-api-source-exclusions-mismatch", `production API sourceExcludedCodes=${normalizedCodes(productionApi.payload?.sourceExcludedCodes).join(",") || "--"} runtime=${normalizedCodes(latest.sourceExcludedCodes).join(",")}`);
    }
  } catch (error) {
    productionApi = { ok: false, error: String(error?.message || error) };
    pushIssue(issues, "critical", "production-api-error", productionApi.error);
  }

  let frontend = { ok: false, error: "" };
  try {
    frontend = await readFrontendGuard();
    if (!frontend.ok) pushIssue(issues, "warning", "frontend-guard-missing", "deployed frontend version/after-close guard not visible");
  } catch (error) {
    frontend = { ok: false, error: String(error?.message || error) };
    pushIssue(issues, "warning", "frontend-verify-error", frontend.error);
  }

  // Google Sheet scorecard checks retired: scorecard website / Supabase is the source of truth.
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
      lastTradeStaleCount,
      quoteSourceCounts: latest.quoteSourceCounts || {},
      fallbackRecovered: latest.fallbackRecovered || {},
      sourceExcludedCodes: Array.isArray(latest.sourceExcludedCodes) ? latest.sourceExcludedCodes : [],
      staleQuoteDetails: Array.isArray(latest.staleQuoteDetails) ? latest.staleQuoteDetails.slice(0, 20) : [],
      lastTradeStaleDetails: Array.isArray(latest.lastTradeStaleDetails) ? latest.lastTradeStaleDetails.slice(0, 20) : [],
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
    productionApi: {
      ok: productionApi.ok,
      status: productionApi.payload?.status || "",
      reason: productionApi.payload?.reason || productionApi.payload?.error || "",
      timestamp: productionApi.payload?.timestamp || productionApi.payload?.updatedAt || "",
      rows: Array.isArray(productionApi.payload?.rows) ? productionApi.payload.rows.length : 0,
      displayWindow: productionApi.payload?.displayWindow || "",
      sourceExcludedCodes: normalizedCodes(productionApi.payload?.sourceExcludedCodes),
      marketSession: productionApi.payload?.marketSession || null,
      error: productionApi.error || "",
    },
    frontend,
    googleSheet: { retired: true, reason: "scorecard website / Supabase is the source of truth" },
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
