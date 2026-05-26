const fs = require("fs");
const path = require("path");
const { formatTradePrice } = require("./intraday-radar-rules");
const { hasLineConfig, sendLineFlex, sendLineText } = require("./line-push");
const { strategy2LiveFlex } = require("./line-flex-templates");

const { ROOT, dataPath, statePath } = require("./runtime-paths");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const LIVE_LIMIT = Math.max(1, Number(process.env.STRATEGY2_LIVE_LIMIT || 3));

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
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

function dateSlash(value) {
  return String(value || "").replace(/-/g, "/");
}

function eventLine(event, index) {
  return [
    `${index + 1}. ${event.code} ${event.name || ""}`,
    `A區 ${event.firstAAt || "--"}｜進場價格${formatTradePrice(event.firstAPrice)}`,
  ].join("\n");
}

function buildMessage(events) {
  return [
    "策略2 當沖通知A區",
    "",
    events.map(eventLine).join("\n\n"),
  ].filter(Boolean).join("\n");
}

async function main() {
  const today = taipeiDateKey();
  const payload = readJson(STRATEGY2_REPORT_FILE, { date: "", events: [] });
  if (payload.date !== today) {
    console.log(`strategy2 live alert skipped: stale date ${payload.date || "--"}`);
    return;
  }
  const aEvents = (payload.events || [])
    .filter((event) => event.firstAAt)
    .sort((a, b) => String(a.firstAAt).localeCompare(String(b.firstAAt)));
  const latestEvents = aEvents.slice(-LIVE_LIMIT);
  if (!latestEvents.length) {
    console.log("strategy2 live alert skipped: no A-zone events");
    return;
  }
  const altText = `策略2 A區通知：${latestEvents.map((event) => `${event.code} ${event.name || ""}`.trim()).join("、")}`;
  if (process.env.STRATEGY2_LIVE_DRY_RUN === "1" || process.env.LINE_DRY_RUN === "1") {
    console.log(`[dry-run] ${altText}`);
    console.log(buildMessage(latestEvents));
    return;
  }
  if (!hasLineConfig()) {
    throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN and LINE_TO or LINE_USER_ID");
  }
  if (process.env.LINE_FLEX_DISABLED === "1") {
    await sendLineText(buildMessage(latestEvents));
  } else {
    await sendLineFlex(altText, strategy2LiveFlex(latestEvents, today));
  }
  console.log(`strategy2 live alert sent: latest ${latestEvents.length}${process.env.LINE_FLEX_DISABLED === "1" ? " text" : " flex"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});




