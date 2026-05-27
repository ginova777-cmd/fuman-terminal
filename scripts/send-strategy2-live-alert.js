const fs = require("fs");
const path = require("path");
const { formatTradePrice } = require("./intraday-radar-rules");
const { hasLineConfig, sendLineFlex, sendLineText } = require("./line-push");
const { strategy2LiveFlex } = require("./line-flex-templates");

const { dataPath, statePath } = require("./runtime-paths");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const LIVE_ALERT_STATE_FILE = statePath("strategy2-live-alert-state.json");
const LIVE_LIMIT = Math.max(1, Number(process.env.STRATEGY2_LIVE_LIMIT || 3));

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

function normalizeKeyNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || "");
  return number.toFixed(4).replace(/\.?0+$/, "");
}

function isAtOrAfterCutoff(timeText) {
  const cutoff = String(process.env.STRATEGY2_LIVE_STARTED_AT || "").trim();
  if (!cutoff) return true;
  return String(timeText || "") >= cutoff;
}

function eventLine(event, index) {
  return [
    `${index + 1}. ${event.code} ${event.name || ""}`,
    `A區 ${event.firstAAt || "--"}｜進場價格${formatTradePrice(event.firstAPrice)}`,
  ].join("\n");
}

function eventKey(event) {
  return [
    event.code || "",
    event.firstAAt || "",
    normalizeKeyNumber(event.firstAPrice),
  ].join("|");
}

function enhancementKey(event, enhancement) {
  return [
    "enhance",
    event.code || "",
    enhancement.at || "",
    enhancement.strategy || "",
    normalizeKeyNumber(enhancement.price),
    normalizeKeyNumber(enhancement.deltaVolume),
  ].join("|");
}

function buildMessage(events) {
  return [
    "策略2 當沖通知A區",
    "",
    events.map(eventLine).join("\n\n"),
  ].filter(Boolean).join("\n");
}

function buildEnhancementMessage(items) {
  return items
    .map(({ event, enhancement }) => {
      const name = `${event.code} ${event.name || ""}`.trim();
      const at = enhancement.at ? ` ${enhancement.at}` : "";
      const delta = Number(enhancement.deltaVolume) > 0 ? `｜新增量 ${Math.round(Number(enhancement.deltaVolume)).toLocaleString("zh-TW")} 張` : "";
      return `${name} 持續放量${at}${delta}`;
    })
    .join("\n");
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
  if (!aEvents.length) {
    console.log("strategy2 live alert skipped: no A-zone events");
    return;
  }

  const state = readJson(LIVE_ALERT_STATE_FILE, { date: today, sent: [] });
  const sent = new Set(state.date === today ? (state.sent || []) : []);
  const newEvents = aEvents.filter((event) => isAtOrAfterCutoff(event.firstAAt) && !sent.has(eventKey(event)));
  const newEnhancements = [];
  aEvents.forEach((event) => {
    (event.enhancements || []).forEach((enhancement) => {
      const key = enhancementKey(event, enhancement);
      if (isAtOrAfterCutoff(enhancement.at) && !sent.has(key)) {
        newEnhancements.push({ event, enhancement, key });
      }
    });
  });
  if (!newEvents.length && !newEnhancements.length) {
    console.log(`strategy2 live alert skipped: no new A-zone or enhancement events after ${process.env.STRATEGY2_LIVE_STARTED_AT || "--"}`);
    return;
  }

  const latestEvents = newEvents.slice(-LIVE_LIMIT);
  const altText = `策略2 A區通知：${latestEvents.map((event) => `${event.code} ${event.name || ""}`.trim()).join("、")}`;
  if (process.env.STRATEGY2_LIVE_DRY_RUN === "1" || process.env.LINE_DRY_RUN === "1") {
    if (latestEvents.length) {
      console.log(`[dry-run] ${altText}`);
      console.log(buildMessage(latestEvents));
    }
    if (newEnhancements.length) {
      console.log("[dry-run] 策略2 A區持續放量");
      console.log(buildEnhancementMessage(newEnhancements));
    }
    return;
  }
  if (!hasLineConfig()) {
    throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN and LINE_TO or LINE_USER_ID");
  }
  if (latestEvents.length) {
    if (process.env.LINE_FLEX_DISABLED === "1") {
      await sendLineText(buildMessage(latestEvents));
    } else {
      await sendLineFlex(altText, strategy2LiveFlex(latestEvents, today));
    }
    latestEvents.forEach((event) => sent.add(eventKey(event)));
  }
  if (newEnhancements.length) {
    await sendLineText(buildEnhancementMessage(newEnhancements));
    newEnhancements.forEach((item) => sent.add(item.key));
  }
  writeJson(LIVE_ALERT_STATE_FILE, {
    date: today,
    updatedAt: new Date().toISOString(),
    sent: Array.from(sent),
  });
  console.log(`strategy2 live alert sent: new ${latestEvents.length}, enhancements ${newEnhancements.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
