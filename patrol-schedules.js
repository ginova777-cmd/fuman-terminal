const fs = require("fs");
const path = require("path");
const tls = require("tls");

const ROOT = path.resolve(__dirname, "..");

const WORKFLOWS = [
  "flow-cache.yml",
  "strategy3-background-scan.yml",
  "strategy4-background-scan.yml",
  "strategy5-background-scan.yml",
  "intraday-radar-scorecard.yml",
];

const CACHE_RULES = [
  { label: "策略1", file: "data/open-buy-latest.json", slots: ["07:00", "14:30"], graceMinutes: 75 },
  { label: "策略3", file: "data/strategy3-latest.json", slots: ["13:00"], graceMinutes: 75 },
  { label: "策略4", file: "data/strategy4-latest.json", slots: ["07:00", "14:30"], graceMinutes: 75 },
  { label: "盤後籌碼", file: "data/institution-latest.json", slots: ["06:00", "21:00"], graceMinutes: 90 },
  { label: "權證走向", file: "data/warrant-flow-latest.json", slots: ["06:00", "21:00"], graceMinutes: 90 },
  { label: "策略5", file: "data/strategy5-latest.json", slots: ["21:00"], graceMinutes: 90 },
];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

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

function cacheIssues() {
  const now = new Date();
  const today = taipeiParts(now);
  if (today.weekday === "Sat" || today.weekday === "Sun") return [];
  const issues = [];

  for (const rule of CACHE_RULES) {
    const payload = readJson(path.join(ROOT, rule.file), null);
    const updatedAt = Date.parse(payload?.updatedAt || "");
    if (!Number.isFinite(updatedAt)) {
      issues.push(`${rule.label}：${rule.file} 沒有可解析的 updatedAt`);
      continue;
    }

    const ageHours = (now.getTime() - updatedAt) / 3600000;
    if (ageHours > 48) {
      issues.push(`${rule.label}：快取超過 48 小時未更新，updatedAt=${payload.updatedAt}`);
      continue;
    }

    const dueSlot = latestElapsedSlot(rule.slots, today.minutes, rule.graceMinutes);
    if (dueSlot === undefined) continue;

    const updated = taipeiParts(new Date(updatedAt));
    if (updated.dateKey !== today.dateKey || updated.minutes < dueSlot) {
      issues.push(`${rule.label}：已過 ${formatMinutes(dueSlot)} 完整掃容錯時間，但快取仍是 ${payload.updatedAt}`);
    }
  }

  return issues;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${process.env.GITHUB_TOKEN || ""}`,
      "User-Agent": "fuman-terminal-schedule-patrol",
    },
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function workflowIssues() {
  const repo = process.env.GITHUB_REPOSITORY;
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
  const issues = [
    ...(await workflowIssues()),
    ...cacheIssues(),
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
