const fs = require("fs");
const path = require("path");
const { hasLineConfig, sendLineText } = require("./line-push");
const { hasTelegramConfig, sendTelegramText } = require("./telegram-push");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(RUNTIME_DIR, "data");
const STATE_DIR = process.env.FUMAN_STATE_DIR || path.join(RUNTIME_DIR, "state");
const REPORT_DIR = process.env.BACKTEST_REPORT_DIR || path.join(process.env.USERPROFILE || "C:\\Users\\ginov", "OneDrive", "Desktop", "回測報告");

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function todayStamp() {
  const arg = process.argv.find((value) => /^\d{8}$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (arg) return arg.replace(/-/g, "");
  const files = fs.existsSync(REPORT_DIR)
    ? fs.readdirSync(REPORT_DIR).filter((name) => /^backtest-strategy2-manager-radar-\d{8}\.json$/.test(name)).sort()
    : [];
  return files.length ? files.at(-1).match(/(\d{8})/)?.[1] : new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function dateText(stamp) {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-TW") : "--";
}

function summarizeIssues(radar = {}) {
  const issues = Array.isArray(radar.externalSourceIssues) ? radar.externalSourceIssues : [];
  if (!issues.length) return "無";
  return issues.slice(0, 5).map((item) => (
    `${item.source || ""}:${item.type || ""}${item.status ? ` HTTP ${item.status}` : ""} x${item.count || 0}${item.sampleCodes ? ` ${item.sampleCodes}` : ""}`
  )).join("；");
}

function staleSummary(radar = {}) {
  const details = Array.isArray(radar.staleQuoteDetails) ? radar.staleQuoteDetails : [];
  if (!Number(radar.staleQuoteCount || 0)) return "0";
  const codes = details.slice(0, 10).map((item) => `${item.code}${item.quoteAgeSeconds ? `(${item.quoteAgeSeconds}s)` : ""}`).join(",");
  return `${radar.staleQuoteCount}${codes ? `｜${codes}` : "｜details missing"}`;
}

async function sendOpsText(text) {
  if (process.env.DAILY_HEALTH_NOTIFY === "0") return "";
  if (hasTelegramConfig()) {
    await sendTelegramText(text);
    return "telegram";
  }
  if (hasLineConfig()) {
    await sendLineText(text);
    return "line";
  }
  return "";
}

async function main() {
  const stamp = todayStamp();
  const report = readJson(path.join(REPORT_DIR, `backtest-strategy2-manager-radar-${stamp}.json`), {});
  const radar = readJson(path.join(DATA_DIR, "realtime-radar-latest.json"), {});
  const google = readJson(path.join(STATE_DIR, "google-sheet-upload-status.json"), {});
  const manager = report.manager?.summary || {};
  const radarSummary = report.radar?.summary || {};
  const lines = [
    `綜合策略每日健康摘要｜${dateText(stamp)}`,
    "",
    `管家交易：${manager.total ?? "--"}｜勝率：${Number.isFinite(Number(manager.winRate)) ? `${Number(manager.winRate).toFixed(1)}%` : "--"}｜損益：${money(manager.pnl)}`,
    `雷達股票去重：${radarSummary.uniqueCodeCount ?? "--"}｜時間桶：${radarSummary.total ?? "--"}｜候選：${radarSummary.entryCandidateRecords ?? "--"}`,
    `即時巡邏：${radar.status || "--"}｜rows=${Array.isArray(radar.rows) ? radar.rows.length : "--"}｜updated=${radar.updatedAt || "--"}`,
    `stale quote：${staleSummary(radar)}`,
    `外部資料源：${summarizeIssues(radar)}`,
    `failed batch：${radar.failedBatchCount ?? "--"}/${radar.totalBatchCount ?? "--"}`,
    `Google Sheet：${google.ok === true ? "ok" : google.ok === false ? "failed" : "--"}｜pending=${google.pendingCount ?? 0}｜last=${google.lastStamp || "--"}`,
  ];
  const text = lines.join("\n");
  console.log(text);
  const channel = await sendOpsText(text);
  if (channel) console.log(`daily health summary sent via ${channel}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
