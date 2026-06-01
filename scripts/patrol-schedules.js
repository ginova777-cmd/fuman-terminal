const fs = require("fs");
const path = require("path");
const tls = require("tls");

const { ROOT, dataPath, runtimePath } = require("./runtime-paths");
const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";

const WORKFLOWS = [
  "flow-cache.yml",
  "open-buy-background-scan.yml",
  "strategy3-background-scan.yml",
  "strategy4-background-scan.yml",
  "strategy5-background-scan.yml",
  "intraday-radar-scorecard.yml",
];

const CACHE_RULES = [
  { label: "策略1", file: "data/open-buy-latest.json", slots: ["07:00", "16:00"], graceMinutes: 10, workflow: "open-buy-background-scan.yml", inputs: { full_scan: "true" } },
  { label: "策略3", file: "data/strategy3-latest.json", slots: ["13:00"], graceMinutes: 10, workflow: "strategy3-background-scan.yml" },
  { label: "策略4", file: "data/strategy4-latest.json", slots: ["14:30"], graceMinutes: 10, workflow: "strategy4-background-scan.yml", inputs: { full_scan: "true" }, requireComplete: true, minTotal: 1700 },
  { label: "盤後籌碼", file: "data/institution-latest.json", slots: ["06:00", "21:00"], graceMinutes: 10, workflow: "flow-cache.yml" },
  { label: "權證走向", file: "data/warrant-flow-latest.json", slots: ["06:00", "21:00"], graceMinutes: 10, workflow: "flow-cache.yml" },
  { label: "策略5", file: "data/strategy5-latest.json", slots: ["06:00", "21:00"], graceMinutes: 10, workflow: "strategy5-background-scan.yml" },
];

const API_RULES = [
  {
    label: "市場總覽 /api/market",
    path: "/api/market",
    validate: (payload) => payload && typeof payload === "object" && (
      payload.ok === true ||
      Array.isArray(payload.indexes) ||
      payload.marketStatus ||
      payload.futuresNear
    ),
  },
  {
    label: "市場總覽 /api/stocks",
    path: "/api/stocks",
    validate: (payload) => {
      const rows = Array.isArray(payload) ? payload : payload?.stocks;
      return Array.isArray(rows) && rows.length > 100;
    },
  },
  {
    label: "市場總覽 /api/heatmap",
    path: "/api/heatmap",
    validate: (payload) => payload?.ok === true && Array.isArray(payload?.sectors) && payload.sectors.length > 0,
  },
  {
    label: "自選股 /api/realtime",
    path: "/api/realtime?codes=2330",
    validate: (payload) => {
      const rows = Array.isArray(payload) ? payload : (payload?.quotes || payload?.stocks || payload?.data);
      return payload?.ok === true || (Array.isArray(rows) && rows.length > 0);
    },
  },
  {
    label: "自選股 /api/proxy",
    path: "/api/proxy?code=2330",
    validate: (payload) => Array.isArray(payload?.msgArray) && payload.msgArray.length > 0,
  },
];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || readText(runtimePath("secrets", "github-token.txt"));

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${byType.year}-${byType.month}-${byType.day}`,
    weekday: byType.weekday,
    minutes: Number(byType.hour) * 60 + Number(byType.minute),
  };
}

function slotMinutes(slot) {
  const [hour, minute] = slot.split(":").map(Number);
  return hour * 60 + minute;
}

function latestElapsedSlot(slots, nowMinutes, graceMinutes) {
  return slots
    .map(slotMinutes)
    .filter((minutes) => nowMinutes >= minutes + graceMinutes)
    .sort((a, b) => b - a)[0];
}

function formatMinutes(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function taipeiDateOnly(date = new Date()) {
  const parts = taipeiParts(date);
  return new Date(`${parts.dateKey}T00:00:00+08:00`);
}

function tradingDayGap(fromDate, toDate = new Date()) {
  let cursor = taipeiDateOnly(fromDate);
  const end = taipeiDateOnly(toDate);
  if (!(cursor instanceof Date) || Number.isNaN(cursor.getTime())) return Infinity;
  if (cursor > end) return 0;
  let gap = 0;
  while (cursor < end) {
    cursor = new Date(cursor.getTime() + 86400000);
    const weekday = taipeiParts(cursor).weekday;
    if (weekday !== "Sat" && weekday !== "Sun") gap++;
  }
  return gap;
}

function cacheIssues() {
  const now = new Date();
  const today = taipeiParts(now);
  if (today.weekday === "Sat" || today.weekday === "Sun") return [];
  const issues = [];

  for (const rule of CACHE_RULES) {
    const payload = readJson(dataPath(rule.file.replace(/^data\//, "")), null);
    const updatedAt = Date.parse(payload?.updatedAt || "");
    if (!Number.isFinite(updatedAt)) {
      issues.push({ ...rule, message: `${rule.label}：${rule.file} 沒有可解析的 updatedAt` });
      continue;
    }

    if (rule.requireComplete) {
      const errors = Array.isArray(payload?.errors) ? payload.errors.length : Number(payload?.errorCount || 0);
      const noData = Array.isArray(payload?.noDataCodes) ? payload.noDataCodes.length : Number(payload?.noDataCount || 0);
      if (payload?.complete !== true || payload?.qualityStatus === "incomplete" || errors > 0 || noData > 0) {
        issues.push({ ...rule, message: `${rule.label}：快取未完整，complete=${payload?.complete}，qualityStatus=${payload?.qualityStatus || "--"}，noData=${noData}，errors=${errors}` });
      }
      if (rule.minTotal && Number(payload?.total || 0) < rule.minTotal) {
        issues.push({ ...rule, message: `${rule.label}：股票 universe 過小，total=${payload?.total || 0}/${rule.minTotal}` });
      }
      if (Number(payload?.scannedThisRun || 0) < Number(payload?.total || 0)) {
        issues.push({ ...rule, message: `${rule.label}：掃描數不足，scannedThisRun=${payload?.scannedThisRun || 0}/total=${payload?.total || 0}` });
      }
    }

    const tradingGap = tradingDayGap(new Date(updatedAt), now);
    if (tradingGap > 1) {
      issues.push({ ...rule, message: `${rule.label}：快取超過 1 個交易日未更新，updatedAt=${payload.updatedAt}` });
      continue;
    }

    const dueSlot = latestElapsedSlot(rule.slots, today.minutes, rule.graceMinutes);
    if (dueSlot === undefined) continue;

    const updated = taipeiParts(new Date(updatedAt));
    if (updated.dateKey !== today.dateKey || updated.minutes < dueSlot) {
      issues.push({ ...rule, message: `${rule.label}：已過 ${formatMinutes(dueSlot)} 完整掃容錯時間，但快取仍是 ${payload.updatedAt}` });
    }
  }

  return issues;
}

async function fetchJson(url) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "fuman-terminal-schedule-patrol",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function fetchApiJson(url, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "fuman-terminal-schedule-patrol",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function workflowIssues() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!GITHUB_TOKEN) {
    console.log("Schedule Patrol：未設定 GITHUB_TOKEN，略過 GitHub workflow 最新狀態檢查");
    return [];
  }
  if (!repo) return ["Schedule Patrol：缺少 GITHUB_REPOSITORY"];
  const issues = [];

  for (const workflow of WORKFLOWS) {
    const data = await fetchJson(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?per_page=1`);
    const run = data.workflow_runs?.[0];
    if (!run) {
      issues.push(`${workflow}：找不到任何執行紀錄`);
      continue;
    }
    if (run.status === "completed" && run.conclusion !== "success") {
      issues.push(`${workflow}：最新執行失敗，conclusion=${run.conclusion}，${run.html_url}`);
    }
  }

  return issues;
}

async function dispatchWorkflow(workflow, inputs = {}) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("缺少 GITHUB_REPOSITORY，無法派發補跑 workflow");
  if (!GITHUB_TOKEN) throw new Error("缺少 GITHUB_TOKEN，無法派發補跑 workflow");
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "fuman-terminal-schedule-patrol",
    },
    body: JSON.stringify({
      ref: process.env.GITHUB_REF_NAME || "main",
      inputs,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${workflow} dispatch HTTP ${response.status} ${body}`.trim());
  }
}

async function workflowHasActiveRun(workflow) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !GITHUB_TOKEN) return false;
  const data = await fetchJson(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?per_page=1`);
  const run = data.workflow_runs?.[0];
  return run && ["queued", "pending", "in_progress", "waiting", "requested"].includes(run.status);
}

async function dispatchRecoveryRuns(cacheIssueObjects) {
  if (process.env.AUTO_DISPATCH_STALE === "0") return [];
  const dispatched = [];
  const seen = new Set();
  for (const issue of cacheIssueObjects) {
    if (!issue.workflow || seen.has(issue.workflow)) continue;
    seen.add(issue.workflow);
    if (await workflowHasActiveRun(issue.workflow)) {
      dispatched.push(`${issue.label}：${issue.workflow} 已在執行或排隊，跳過重複派發`);
      continue;
    }
    await dispatchWorkflow(issue.workflow, issue.inputs || {});
    dispatched.push(`${issue.label}：已自動派發 ${issue.workflow} 補跑`);
  }
  return dispatched;
}

async function apiIssues() {
  const issues = [];
  for (const rule of API_RULES) {
    const url = `${BASE_URL}${rule.path}`;
    try {
      const payload = await fetchApiJson(url);
      if (!rule.validate(payload)) {
        issues.push(`${rule.label}：回應格式異常，${url}`);
      }
    } catch (error) {
      issues.push(`${rule.label}：無法取得資料，${url}，${error.message}`);
    }
  }
  return issues;
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk) => {
      data += chunk.toString("utf8");
      const lines = data.trimEnd().split(/\r?\n/);
      const last = lines.at(-1) || "";
      if (/^\d{3} /.test(last)) {
        socket.off("data", onData);
        resolve(data);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function smtpCommand(socket, command, expect = /^[23]/) {
  if (command) socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  if (!expect.test(response)) throw new Error(`SMTP failed after ${command}: ${response}`);
}

async function sendMail({ host, port, user, pass, to, subject, text }) {
  const socket = tls.connect({ host, port, servername: host });
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  await smtpCommand(socket, null);
  await smtpCommand(socket, "EHLO fuman-terminal");
  await smtpCommand(socket, "AUTH LOGIN", /^334/);
  await smtpCommand(socket, Buffer.from(user).toString("base64"), /^334/);
  await smtpCommand(socket, Buffer.from(pass).toString("base64"));
  await smtpCommand(socket, `MAIL FROM:<${user}>`);
  await smtpCommand(socket, `RCPT TO:<${to}>`);
  await smtpCommand(socket, "DATA", /^354/);
  const message = [
    `From: ${user}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    ".",
  ].join("\r\n");
  await smtpCommand(socket, message);
  await smtpCommand(socket, "QUIT");
  socket.end();
}

async function alert(issues) {
  const to = process.env.REPORT_EMAIL_TO;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!to || !user || !pass) throw new Error(`Schedule patrol found issues but email secrets are missing:\n${issues.join("\n")}`);
  const text = [
    "輔滿終端排程巡邏警報",
    "",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "請到 GitHub Actions 檢查並手動重跑失敗 workflow。",
  ].join("\n");
  await sendMail({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    user,
    pass,
    to,
    subject: "輔滿終端排程巡邏警報",
    text,
  });
}

async function main() {
  const staleCacheIssues = cacheIssues();
  const recoveryMessages = await dispatchRecoveryRuns(staleCacheIssues);
  const issues = [
    ...(await workflowIssues()),
    ...(await apiIssues()),
    ...staleCacheIssues.map((issue) => issue.message),
    ...recoveryMessages,
  ];
  if (!issues.length) {
    console.log("schedule patrol passed");
    return;
  }
  console.error(issues.join("\n"));
  await alert(issues);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});


