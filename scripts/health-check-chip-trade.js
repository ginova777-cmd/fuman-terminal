const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { isTwseTradingDay } = require("./twse-trading-day");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.FUMAN_SYNC_DATA_DIR || path.join(ROOT, "data");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const OUT_FILE = path.join(DATA_DIR, "chip-trade-health-latest.json");

const DATA_FILES = [
  "institution-latest.json",
  "institution-backup.json",
  "institution-summary.json",
  "institution-slim.json",
  "institution-mobile-top.json",
  "institution-joint-top.json",
  "institution-foreign-top.json",
  "institution-trust-top.json",
];

const TASKS = [
  "\\Fuman 買賣超 Cache 0600",
  "\\Fuman 買賣超 Watchdog 0620",
  "\\Fuman 買賣超 Cache 2100",
  "\\Fuman 買賣超 Watchdog 2120",
  "\\Fuman GitHub 統一同步 0612",
  "\\Fuman GitHub 統一同步 2112",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function safeReadJson(file) {
  try {
    return readJson(file);
  } catch (error) {
    return { __error: error.message };
  }
}

function num(value) {
  if (value === undefined || value === null || value === "") return 0;
  return Number(String(value).replace(/[,%]/g, "").trim()) || 0;
}

function countPayload(payload) {
  if (!payload || payload.__error) return 0;
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.matches)) return payload.matches.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  if (payload.data && typeof payload.data === "object") return Object.keys(payload.data).length;
  return num(payload.count || payload.total || payload.stockCount);
}

function normalizeDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function taipeiDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const date = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00+08:00`);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

async function latestTradingYmd() {
  for (let offset = 0; offset >= -14; offset -= 1) {
    const probe = taipeiDate(offset);
    const result = await isTwseTradingDay(probe, { stateDir: process.env.FUMAN_STATE_DIR || "C:\\fuman-runtime\\state" });
    if (result?.isTradingDay) return normalizeDate(result.date);
  }
  return normalizeDate(taipeiDate().toISOString());
}

function chipCounts(data) {
  const rows = Object.entries(data || {}).map(([code, inst]) => {
    const foreign = num(inst.foreign);
    const trust = num(inst.trust);
    const dealer = num(inst.dealer);
    return {
      code,
      name: inst.name || code,
      foreign,
      trust,
      total: num(inst.total) || foreign + trust + dealer,
      jointStreak: num(inst.jointStreak),
    };
  }).filter((row) => row.code && row.name);
  return {
    total: rows.length,
    joint: rows.filter((row) => row.foreign > 0 && row.trust > 0).length,
    trust: rows.filter((row) => row.trust > 0).length,
    foreign: rows.filter((row) => row.foreign > 0).length,
    legal: rows.filter((row) => row.total > 0).length,
    defaultVisible: rows
      .filter((row) => row.foreign > 0 && row.trust > 0)
      .sort((a, b) => b.jointStreak - a.jointStreak || (b.foreign + b.trust) - (a.foreign + a.trust))
      .slice(0, 80)
      .length,
  };
}

function issue(severity, message, detail = {}) {
  return { severity, message, detail };
}

function fileStatus(name) {
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return { name, ok: false, exists: false, count: 0, error: "missing" };
  const stat = fs.statSync(file);
  const payload = safeReadJson(file);
  return {
    name,
    ok: !payload.__error,
    exists: true,
    bytes: stat.size,
    mtime: stat.mtime.toISOString(),
    updatedAt: payload.updatedAt || "",
    usedDate: payload.usedDate || payload.date || "",
    count: countPayload(payload),
    error: payload.__error || "",
  };
}

function queryTask(taskName) {
  try {
    const output = execFileSync("schtasks", ["/Query", "/TN", taskName, "/FO", "CSV", "/V"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
    const rows = output.trim().split(/\r?\n/);
    const row = rows[1] || "";
    const fields = [];
    const pattern = /"([^"]*)",?/g;
    let match;
    while ((match = pattern.exec(row)) && fields.length < 8) fields.push(match[1]);
    return {
      taskName,
      ok: true,
      status: fields[3] || "",
      nextRunTime: fields[2] || "",
      lastRunTime: fields[5] || "",
      lastResult: fields[6] || "",
      enabled: output.includes('"Enabled"') ? "Enabled" : "",
    };
  } catch (error) {
    return { taskName, ok: false, error: error.message };
  }
}

async function fetchJson(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}?health=${Date.now()}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}`);
  return response.json();
}

async function remoteStatus(name) {
  try {
    const payload = await fetchJson(`/data/${name}`);
    return {
      name,
      ok: true,
      updatedAt: payload.updatedAt || "",
      usedDate: payload.usedDate || payload.date || "",
      count: countPayload(payload),
    };
  } catch (error) {
    return { name, ok: false, count: 0, error: error.message };
  }
}

function frontEndStatus() {
  const runtimeConfig = fs.readFileSync(path.join(ROOT, "terminal-runtime-config.js"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "terminal-app.js"), "utf8");
  const chipModule = fs.readFileSync(path.join(ROOT, "terminal-chip-flow.js"), "utf8");
  const endpoints = [
    "institutionCache",
    "institutionSlim",
    "institutionBackup",
    "institutionSummary",
    "institutionMobileTop",
  ];
  const helpers = [
    "isMobileViewport",
    "valueOf",
    "normalizeTradeVolumeLots",
    "stockChange",
  ];
  return {
    endpoints: Object.fromEntries(endpoints.map((name) => [name, runtimeConfig.includes(name)])),
    helperInjection: Object.fromEntries(helpers.map((name) => [name, app.includes(name)])),
    moduleGuard: chipModule.includes("chip flow module missing dependencies") && chipModule.includes("買賣超模組缺少依賴"),
  };
}

async function main() {
  const issues = [];
  const latestTradeDate = await latestTradingYmd();
  const files = Object.fromEntries(DATA_FILES.map((name) => [name, fileStatus(name)]));
  const latest = safeReadJson(path.join(DATA_DIR, "institution-latest.json"));
  const counts = chipCounts(latest.data || {});
  const tasks = TASKS.map(queryTask);
  const remoteFiles = Object.fromEntries((await Promise.all([
    "institution-latest.json",
    "institution-slim.json",
    "institution-mobile-top.json",
    "institution-summary.json",
  ].map(remoteStatus))).map((item) => [item.name, item]));
  const frontend = frontEndStatus();

  if (latest.__error) issues.push(issue("critical", "institution-latest.json 讀取失敗", { error: latest.__error }));
  if (counts.total < 1000) issues.push(issue("critical", "法人資料總筆數過低", { total: counts.total }));
  if (counts.defaultVisible < 1) issues.push(issue("critical", "終端預設外資+投信同買可顯示筆數為 0", counts));
  if (normalizeDate(latest.usedDate) !== latestTradeDate) {
    issues.push(issue("warning", "法人資料日期不是最近交易日", { usedDate: latest.usedDate || "", latestTradeDate }));
  }

  for (const status of Object.values(files)) {
    if (!status.exists) issues.push(issue("critical", `${status.name} 不存在`));
    else if (!status.ok) issues.push(issue("critical", `${status.name} JSON 解析失敗`, { error: status.error }));
    else if (status.count <= 0 && !status.name.includes("summary")) issues.push(issue("warning", `${status.name} count 為 0`, { count: status.count }));
  }

  for (const status of Object.values(remoteFiles)) {
    if (!status.ok) issues.push(issue("critical", `線上 ${status.name} 無法讀取`, { error: status.error }));
  }
  if (remoteFiles["institution-latest.json"]?.count !== counts.total) {
    issues.push(issue("warning", "線上/本機 institution-latest 筆數不同", {
      local: counts.total,
      remote: remoteFiles["institution-latest.json"]?.count,
    }));
  }

  for (const task of tasks) {
    if (!task.ok) issues.push(issue("warning", `排程查詢失敗：${task.taskName}`, { error: task.error }));
    else if (task.lastResult && task.lastResult !== "0") issues.push(issue("warning", `排程上次結果非 0：${task.taskName}`, { lastResult: task.lastResult }));
  }

  for (const [name, ok] of Object.entries(frontend.endpoints)) {
    if (!ok) issues.push(issue("critical", `前端缺少 endpoint：${name}`));
  }
  for (const [name, ok] of Object.entries(frontend.helperInjection)) {
    if (!ok) issues.push(issue("critical", `買賣超 lazy module 缺少 helper 注入：${name}`));
  }
  if (!frontend.moduleGuard) issues.push(issue("warning", "terminal-chip-flow.js 尚未啟用缺依賴防呆"));

  const payload = {
    ok: issues.filter((item) => item.severity === "critical").length === 0,
    source: "chip-trade-health",
    updatedAt: new Date().toISOString(),
    latestTradeDate,
    counts,
    files,
    remoteFiles,
    tasks,
    frontend,
    issues,
  };

  fs.writeFileSync(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
