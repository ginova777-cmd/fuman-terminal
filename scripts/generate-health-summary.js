const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT, dataPath } = require("./runtime-paths");

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] || ""])));
}

function getFumanTasks() {
  const result = spawnSync("schtasks", ["/Query", "/FO", "CSV", "/V"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "schtasks failed").trim());
  const rows = parseCsv(result.stdout).filter((row) => String(row.TaskName || "").startsWith("\\Fuman"));
  rows.queryMethod = "schtasks";
  return rows;
}

function isBadResult(code) {
  return !["0", "267009", "267011"].includes(String(code || ""));
}

const REPLACED_OR_LEGACY_TASKS = new Set([
  "\\Fuman Data Freshness Verify 1555",
  "\\Fuman GitHub 統一同步 0612",
  "\\Fuman GitHub 統一同步 0715",
  "\\Fuman GitHub 統一同步 1445",
  "\\Fuman GitHub 統一同步 2112",
  "\\Fuman Market Overview Patrol 0900",
  "\\Fuman Market Summary Repair 1405",
  "\\Fuman Open Buy Cache 0700",
  "\\Fuman Open Buy Cache 1600",
  "\\Fuman Open Buy Sync Retry",
  "\\Fuman Scorecard Final 1530",
  "\\Fuman Scorecard Initial 1410",
  "\\Fuman Strategy2 Intraday Scan",
  "\\Fuman Strategy2 Intraday Warmup 0845",
  "\\Fuman Strategy3 Cache 1230",
  "\\Fuman Strategy3 Cache 1300",
  "\\Fuman Strategy3 Watchdog 1320",
  "\\Fuman Strategy4 Cache 1600",
  "\\Fuman Strategy4 Postflight 1610",
  "\\Fuman Strategy5 Cache 0600",
  "\\Fuman Strategy5 Cache 2100",
  "\\Fuman 即時雷達",
  "\\Fuman 權證走向 Cache 0530",
  "\\Fuman 權證走向 Cache 2030",
  "\\Fuman 權證走向 Watchdog 0550",
  "\\Fuman 權證走向 Watchdog 2050",
  "\\Fuman 買賣超 Cache 0600",
  "\\Fuman 買賣超 Cache 2100",
  "\\Fuman 買賣超 Watchdog 0620",
  "\\Fuman 買賣超 Watchdog 2120",
]);

const NON_TERMINAL_DATA_TASKS = new Set([
  "\\Fuman Trade Manager Patrol 0900",
  "\\Fuman Trade Manager Settlement 1340",
]);

function isIgnorableTaskResult(task) {
  const name = String(task.TaskName || "");
  const code = String(task["Last Result"] || "");
  const legacyHealthRunnerFixed = new Set([
    "\\Fuman Daily Health Summary 1545",
    "\\Fuman 即時雷達健檢 0910",
  ]);
  if (name === "\\Fuman Strategy2 Intraday Warmup 0845" && code === "-1073741510" && task.Status === "Ready") {
    const latest = dataFileStatus("strategy2-intraday-latest.json");
    const ageMs = Date.now() - Date.parse(latest.updatedAt || "");
    const freshEnough = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 20 * 60 * 1000;
    return latest.ok && latest.date === taipeiDateText() && freshEnough;
  }
  return (
    name === "\\Fuman PC Wake 0430" && code === "-2147020576" && task.Status === "Ready"
  ) || (
    legacyHealthRunnerFixed.has(name) && code === "-2147020576" && task.Status === "Ready"
  ) || (
    REPLACED_OR_LEGACY_TASKS.has(name) && task.Status === "Ready"
  ) || (
    NON_TERMINAL_DATA_TASKS.has(name) && task.Status === "Ready"
  );
}

function outboxStatus() {
  const root = path.join(process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime", "outbox", "cache-sync");
  let pending = 0;
  if (fs.existsSync(root)) {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name === "manifest.json") pending += 1;
      }
    }
  }
  return { pendingCount: pending, ok: pending === 0 };
}

function dataFileStatus(name) {
  const candidates = [dataPath(name), path.join(ROOT, "data", name)];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) return { file: name, ok: false, count: 0, updatedAt: "", bytes: 0 };
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      file: name,
      ok: true,
      status: payload.status || "",
      date: payload.date || payload.usedDate || payload.tradeDate || "",
      count: Number(payload.count || (Array.isArray(payload.matches) ? payload.matches.length : 0) || 0),
      updatedAt: payload.updatedAt || "",
      bytes: fs.statSync(file).size,
    };
  } catch {
    return { file: name, ok: false, count: 0, updatedAt: "", bytes: fs.statSync(file).size };
  }
}

function riskItem(level, area, message, meta = {}) {
  return { level, area, message, ...meta };
}

const DATA_SLA_HOURS = {
  "market-summary.json": 12,
  "strategy4-summary.json": 30,
  "strategy5-latest.json": 30,
  "institution-summary.json": 42,
  "warrant-flow-summary.json": 42,
  "strategy2-intraday-latest.json": 6,
  "realtime-radar-latest.json": 6,
  "performance-report.json": 36,
  "signal-quality-report.json": 36,
  "data-quality-report.json": 36,
  "data-consistency-report.json": 36,
  "strategy-weight-report.json": 36,
};

function isWeekendTaipei(date = new Date()) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(date);
  return day === "Sat" || day === "Sun";
}

function taipeiMinuteOfDay(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function taipeiDateText(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function effectiveSlaHours(file) {
  if (isWeekendTaipei()) {
    if (file === "realtime-radar-latest.json") return 72;
    if (file === "strategy2-intraday-latest.json") return 72;
    if (file === "market-summary.json") return 72;
  }
  if (file === "strategy4-summary.json" && taipeiMinuteOfDay() < 15 * 60 + 30) return 96;
  return DATA_SLA_HOURS[file] || 36;
}

function buildRisks({ badTasks, outbox, data }) {
  const risks = [];
  if (badTasks.length) {
    risks.push(riskItem("high", "schedule", `排程異常 ${badTasks.length} 個`, { items: badTasks.slice(0, 8) }));
  }
  if (outbox.pendingCount > 2) {
    risks.push(riskItem("high", "github", `GitHub outbox 待補 ${outbox.pendingCount} 筆`));
  } else if (outbox.pendingCount > 0) {
    risks.push(riskItem("medium", "github", `GitHub outbox 待補 ${outbox.pendingCount} 筆`));
  }
  const missing = data.filter((item) => !item.ok);
  if (missing.length) {
    risks.push(riskItem("high", "runtime", `資料檔缺失或不可解析 ${missing.length} 個`, { files: missing.map((item) => item.file) }));
  }
  const missingIntradaySnapshots = data.filter((item) => item.status === "no_latest_intraday_snapshot");
  if (missingIntradaySnapshots.length) {
    risks.push(riskItem("medium", "intraday", `最新交易日盤中快照未完成 ${missingIntradaySnapshots.length} 個`, { files: missingIntradaySnapshots.map((item) => item.file) }));
  }
  const now = Date.now();
  const stale = data.map((item) => {
    const at = Date.parse(item.updatedAt || "");
    const slaHours = effectiveSlaHours(item.file);
    const ageHours = Number.isFinite(at) ? (now - at) / 3600000 : null;
    return { ...item, slaHours, ageHours };
  }).filter((item) => item.ok && item.ageHours !== null && item.ageHours > item.slaHours);
  const highStale = stale.filter((item) => item.ageHours > item.slaHours * 1.75);
  if (highStale.length) {
    risks.push(riskItem("high", "freshness", `資料超過 SLA 嚴重逾時 ${highStale.length} 個`, { files: highStale.map((item) => item.file), stale }));
  } else if (stale.length) {
    risks.push(riskItem("medium", "freshness", `資料超過 SLA ${stale.length} 個`, { files: stale.map((item) => item.file), stale }));
  }
  return risks;
}

function classifyRawRefresh(rawRefresh = []) {
  return rawRefresh.map((item) => {
    const warnings = Array.isArray(item.warnings) ? item.warnings : [];
    const blocking = !item.ok;
    const sourceWarnings = warnings.filter((line) => /HTTP 403|HTTP 404|supabase|source warnings|skipped outside market time/i.test(line));
    const level = blocking ? "blocking" : sourceWarnings.length ? "source_warning" : warnings.length ? "warning" : "ok";
    return {
      label: item.label || "",
      ok: Boolean(item.ok),
      exitCode: item.exitCode ?? null,
      checkedAt: item.checkedAt || "",
      level,
      warningCount: Number(item.warningCount || warnings.length || 0),
      sourceWarningCount: sourceWarnings.length,
      warnings: warnings.slice(0, 8),
    };
  });
}

function main() {
  const tasks = getFumanTasks();
  const badTasks = tasks
    .filter((task) => task["Scheduled Task State"] === "Enabled" && isBadResult(task["Last Result"]) && !isIgnorableTaskResult(task))
    .map((task) => ({
      taskName: task.TaskName,
      lastRunTime: task["Last Run Time"],
      lastResult: task["Last Result"],
      status: task.Status,
    }));
  const replacedOrLegacyTasks = tasks
    .filter((task) => REPLACED_OR_LEGACY_TASKS.has(String(task.TaskName || "")))
    .map((task) => ({
      taskName: task.TaskName,
      lastRunTime: task["Last Run Time"],
      lastResult: task["Last Result"],
      status: task.Status,
      handling: "replaced_by_official_freshness_gate_or_legacy_guard",
    }));
  const data = [
    "market-summary.json",
    "strategy4-summary.json",
    "strategy5-latest.json",
    "institution-summary.json",
    "warrant-flow-summary.json",
    "strategy2-intraday-latest.json",
    "realtime-radar-latest.json",
    "performance-report.json",
    "signal-quality-report.json",
    "data-quality-report.json",
    "data-consistency-report.json",
    "strategy-weight-report.json",
  ].map(dataFileStatus);
  const gateStatus = dataFileStatus("live-freshness-ok.json");
  let gatePayload = null;
  if (gateStatus.ok) {
    try {
      gatePayload = JSON.parse(fs.readFileSync(dataPath("live-freshness-ok.json"), "utf8"));
    } catch {
      try { gatePayload = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "live-freshness-ok.json"), "utf8")); } catch {}
    }
  }
  const outbox = outboxStatus();
  const risks = buildRisks({ badTasks, outbox, data });
  const rawRefresh = classifyRawRefresh(gatePayload?.rawRefresh || []);
  const blockingSources = rawRefresh.filter((item) => item.level === "blocking");
  const warningSources = rawRefresh.filter((item) => item.level === "source_warning" || item.level === "warning");
  if (blockingSources.length) {
    risks.push(riskItem("high", "source", `raw scanner failed ${blockingSources.length} 個`, { items: blockingSources }));
  } else if (warningSources.length) {
    risks.push(riskItem("medium", "source", `raw scanner 非阻斷警告 ${warningSources.length} 個`, { items: warningSources }));
  }
  const high = risks.filter((item) => item.level === "high").length;
  const medium = risks.filter((item) => item.level === "medium").length;
  const summary = {
    ok: high === 0 && badTasks.length === 0 && outbox.ok && data.every((item) => item.ok),
    updatedAt: new Date().toISOString(),
    risk: high ? "high" : medium ? "medium" : "low",
    risks,
    schedule: {
      ok: badTasks.length === 0,
      total: tasks.length,
      badCount: badTasks.length,
      badTasks,
      replacedOrLegacyCount: replacedOrLegacyTasks.length,
      replacedOrLegacyTasks,
      queryMethod: tasks.queryMethod || "schtasks",
      note: "Official freshness gate tasks are authoritative. Replaced legacy data tasks are ignored here because their scripts redirect through legacy-entrypoint-guard.ps1 when they run.",
    },
    githubSync: outbox,
    freshnessGate: {
      ok: Boolean(gatePayload?.ok),
      statusFile: gateStatus,
      checkedAt: gatePayload?.checkedAt || "",
      publishHead: gatePayload?.publishHead || "",
      mode: gatePayload?.mode || "",
      rawRefresh,
    },
    runtime: { ok: data.every((item) => item.ok), data },
  };
  writeJson(path.join(ROOT, "data", "health-summary.json"), summary);
  writeJson(dataPath("health-summary.json"), summary);
  console.log(`health summary wrote ok=${summary.ok} badTasks=${badTasks.length}`);
}

main();
