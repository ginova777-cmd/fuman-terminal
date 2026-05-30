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
  return parseCsv(result.stdout).filter((row) => String(row.TaskName || "").startsWith("\\Fuman"));
}

function isBadResult(code) {
  return !["0", "267009", "267011"].includes(String(code || ""));
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
  "realtime-radar-latest.json": 6,
};

function isWeekendTaipei(date = new Date()) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(date);
  return day === "Sat" || day === "Sun";
}

function effectiveSlaHours(file) {
  if (isWeekendTaipei()) {
    if (file === "realtime-radar-latest.json") return 72;
    if (file === "market-summary.json") return 72;
  }
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

function main() {
  const tasks = getFumanTasks();
  const badTasks = tasks
    .filter((task) => task["Scheduled Task State"] === "Enabled" && isBadResult(task["Last Result"]))
    .map((task) => ({
      taskName: task.TaskName,
      lastRunTime: task["Last Run Time"],
      lastResult: task["Last Result"],
      status: task.Status,
    }));
  const data = [
    "market-summary.json",
    "strategy4-summary.json",
    "strategy5-latest.json",
    "institution-summary.json",
    "warrant-flow-summary.json",
    "realtime-radar-latest.json",
  ].map(dataFileStatus);
  const outbox = outboxStatus();
  const risks = buildRisks({ badTasks, outbox, data });
  const high = risks.filter((item) => item.level === "high").length;
  const medium = risks.filter((item) => item.level === "medium").length;
  const summary = {
    ok: high === 0 && badTasks.length === 0 && outbox.ok && data.every((item) => item.ok),
    updatedAt: new Date().toISOString(),
    risk: high ? "high" : medium ? "medium" : "low",
    risks,
    schedule: { ok: badTasks.length === 0, total: tasks.length, badCount: badTasks.length, badTasks },
    githubSync: outbox,
    runtime: { ok: data.every((item) => item.ok), data },
  };
  writeJson(path.join(ROOT, "data", "health-summary.json"), summary);
  writeJson(dataPath("health-summary.json"), summary);
  console.log(`health summary wrote ok=${summary.ok} badTasks=${badTasks.length}`);
}

main();
