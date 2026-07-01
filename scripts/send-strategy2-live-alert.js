const fs = require("fs");
const path = require("path");
const { formatTradePrice } = require("./intraday-radar-rules");
const { hasLineConfig, sendLineFlex, sendLineText } = require("./line-push");
const { strategy2LiveFlex } = require("./line-flex-templates");
const { hasTelegramConfig, sendTelegramText } = require("./telegram-push");

const { ROOT, dataPath, statePath } = require("./runtime-paths");
const STRATEGY2_REPORT_FILE = dataPath("strategy2-intraday-latest.json");
const LIVE_ALERT_STATE_FILE = statePath("strategy2-live-alert-state.json");
const LIVE_LIMIT = Math.max(1, Number(process.env.STRATEGY2_LIVE_LIMIT || 3));
const STRATEGY2_LIVE_MIN_PERCENT = Number(process.env.STRATEGY2_LIVE_MIN_PERCENT || 2);
const STRATEGY2_LIVE_STOP_AT = String(process.env.STRATEGY2_LIVE_STOP_AT || "13:30:00").trim();
const STRATEGY2_LIVE_DISABLE_ENHANCEMENTS = process.env.STRATEGY2_LIVE_DISABLE_ENHANCEMENTS !== "0";
const ENHANCEMENT_COOLDOWN_MS = Math.max(0, Number(process.env.STRATEGY2_ENHANCEMENT_COOLDOWN_MS || 5 * 60 * 1000));
const ENHANCEMENT_BREAKOUT_PERCENT_DELTA = Number(process.env.STRATEGY2_ENHANCEMENT_BREAKOUT_PERCENT_DELTA || 1);
const ENHANCEMENT_BREAKOUT_VOLUME_RATIO = Number(process.env.STRATEGY2_ENHANCEMENT_BREAKOUT_VOLUME_RATIO || 0.5);
const ENHANCEMENT_BREAKOUT_VOLUME_DELTA = Number(process.env.STRATEGY2_ENHANCEMENT_BREAKOUT_VOLUME_DELTA || 3000);

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

function dateSlash(value) {
  return String(value || "").replace(/-/g, "/");
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[, +%]/g, "").trim()) || 0;
}

function strategy2EventPercent(event) {
  return cleanNumber(event?.percent ?? event?.pct ?? event?.latestRecord?.percent ?? event?.record?.percent);
}

function strategy2EventVolume(event) {
  return cleanNumber(event?.tradeVolume ?? event?.volume ?? event?.latestRecord?.tradeVolume ?? event?.latestRecord?.volume ?? event?.record?.tradeVolume ?? event?.record?.volume);
}

function strategy2OuterInner(event) {
  const record = event?.latestRecord || event?.record || {};
  const outer = cleanNumber(
    event?.cumulativeBidVolume
      ?? event?.cumulative_bid_volume
      ?? event?.outerVolume
      ?? event?.outer_volume
      ?? record?.cumulativeBidVolume
      ?? record?.cumulative_bid_volume
      ?? record?.outerVolume
      ?? record?.outer_volume
  );
  const inner = cleanNumber(
    event?.cumulativeAskVolume
      ?? event?.cumulative_ask_volume
      ?? event?.innerVolume
      ?? event?.inner_volume
      ?? record?.cumulativeAskVolume
      ?? record?.cumulative_ask_volume
      ?? record?.innerVolume
      ?? record?.inner_volume
  );
  return { outer, inner, ok: outer > inner && outer > 0 };
}

function isStrategy2LiveDisplayEvent(event) {
  return strategy2EventPercent(event) > STRATEGY2_LIVE_MIN_PERCENT
    && strategy2OuterInner(event).ok;
}

function normalizeKeyNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || "");
  return number.toFixed(4).replace(/\.?0+$/, "");
}

function ma35SourceLabel(source) {
  const text = String(source || "");
  if (text.includes("yahoo")) return "Yahoo";
  if (text.includes("fugle")) return "Fugle";
  if (text.includes("twelve")) return "Twelve Data";
  if (text.includes("local")) return "Local cache";
  return "";
}

function isWithinStrategy2NotificationWindow(timeText) {
  const value = String(timeText || "");
  const start = String(process.env.STRATEGY2_LIVE_STARTED_AT || "08:45:00").trim();
  const stop = STRATEGY2_LIVE_STOP_AT || "13:30:00";
  return (!start || value >= start) && (!stop || value <= stop);
}

function eventLine(event, index) {
  const source = ma35SourceLabel(event?.ma35Source || event?.latestRecord?.ma35Source);
  return [
    `${index + 1}. ${event.code} ${event.name || ""}`,
    `進場區 ${event.firstAAt || "--"}｜進場價格${formatTradePrice(event.firstAPrice)}`,
    source ? `MA35來源：${source}` : "",
  ].filter(Boolean).join("\n");
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

function enhancementCooldownKey(event, enhancement) {
  return [
    "enhance-cooldown",
    event.code || "",
    enhancement.strategy || "持續放量",
  ].join("|");
}

function todayTimeToMs(today, timeText) {
  const match = String(timeText || "").match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return 0;
  const [, hour, minute, second = "00"] = match;
  const value = Date.parse(`${today}T${hour}:${minute}:${second}+08:00`);
  return Number.isFinite(value) ? value : 0;
}

function recentEnhancementSentAt(state, key, today, event, enhancement) {
  if (state.date !== today) return 0;
  const map = state.enhancementCooldown || {};
  const entry = map[key];
  const value = Date.parse(typeof entry === "object" && entry ? entry.sentAt : entry || "");
  if (Number.isFinite(value)) return value;
  const strategy = enhancement.strategy || "";
  return (state.sent || []).reduce((latest, item) => {
    const parts = String(item || "").split("|");
    if (parts.length < 4 || parts[0] !== "enhance" || parts[1] !== String(event.code || "")) return latest;
    if (strategy && parts[3] !== strategy) return latest;
    return Math.max(latest, todayTimeToMs(today, parts[2]));
  }, 0);
}

function recentEnhancementMetrics(state, key) {
  const entry = state?.enhancementCooldown?.[key];
  if (!entry || typeof entry !== "object") return {};
  return {
    percent: cleanNumber(entry.percent),
    tradeVolume: cleanNumber(entry.tradeVolume),
  };
}

function enhancementBreakoutReason(state, cooldownKey, event) {
  const previous = recentEnhancementMetrics(state, cooldownKey);
  const percent = strategy2EventPercent(event);
  const tradeVolume = strategy2EventVolume(event);
  if (previous.percent > 0 && percent - previous.percent >= ENHANCEMENT_BREAKOUT_PERCENT_DELTA) {
    return `漲幅+${(percent - previous.percent).toFixed(2)}%`;
  }
  if (previous.tradeVolume > 0) {
    const volumeDelta = tradeVolume - previous.tradeVolume;
    if (volumeDelta >= ENHANCEMENT_BREAKOUT_VOLUME_DELTA) return `新增量+${Math.round(volumeDelta).toLocaleString("zh-TW")}張`;
    if (volumeDelta / previous.tradeVolume >= ENHANCEMENT_BREAKOUT_VOLUME_RATIO) return `量增+${Math.round((volumeDelta / previous.tradeVolume) * 100)}%`;
  }
  return "";
}

function enhancementCooldownEntry(event) {
  return {
    sentAt: new Date().toISOString(),
    percent: strategy2EventPercent(event),
    tradeVolume: strategy2EventVolume(event),
  };
}

function buildMessage(events) {
  return [
    "策略2 當沖通知進場區",
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
      const breakout = enhancement.breakoutReason ? `｜突破冷卻：${enhancement.breakoutReason}` : "";
      const source = ma35SourceLabel(enhancement.ma35Source || event?.ma35Source || event?.latestRecord?.ma35Source);
      return `${name} 持續放量${at}${delta}${breakout}${source ? `｜MA35來源：${source}` : ""}`;
    })
    .join("\n");
}

function notificationOptions(kind, today, keys, eventTime = "") {
  return {
    idempotencyKey: ["strategy2-live", kind, today, ...keys].join("|"),
    eventTime: eventTime || new Date().toISOString(),
    dataConfirmed: true,
  };
}

function intradayTimeText(value) {
  const match = String(value || "").match(/(\d{2}:\d{2}(?::\d{2})?)/);
  return match ? match[1] : "";
}

function entryEventFromRecord(record) {
  const stateId = String(record?.stateId || "");
  if (stateId !== "entry" && stateId !== "go") return null;
  const firstAAt = intradayTimeText(record.timestamp || record.entryAt || record.firstAAt);
  if (!firstAAt) return null;
  return {
    code: String(record.code || ""),
    name: record.name || "",
    date: record.date || "",
    stateId: "go",
    stateLabel: record.stateLabel || "進場區",
    stateReason: record.stateReason || record.reason || "",
    reason: record.reason || "",
    firstAAt,
    latestAAt: firstAAt,
    firstAPrice: cleanNumber(record.entryPrice) || cleanNumber(record.observedPrice) || cleanNumber(record.close),
    percent: cleanNumber(record.percent),
    tradeVolume: cleanNumber(record.tradeVolume) || cleanNumber(record.volume),
    primaryStrategy: record.primaryStrategy || "",
    strategyIds: Array.isArray(record.strategyIds) ? record.strategyIds : [],
    strategyTags: Array.isArray(record.strategyTags) ? record.strategyTags : [],
    strategyReasons: Array.isArray(record.strategyReasons) ? record.strategyReasons : [],
    strategies: Array.isArray(record.strategyTags) ? record.strategyTags : [],
    ma35Source: record.ma35Source || "",
    latestRecord: record,
    source: "record",
  };
}

function attachLatestRecords(events, records) {
  const latestRecordByCode = new Map();
  (records || []).forEach((record) => {
    if (!record?.code) return;
    latestRecordByCode.set(String(record.code), record);
  });
  return (events || []).map((event) => ({
    ...event,
    latestRecord: event.latestRecord || latestRecordByCode.get(String(event.code)),
  }));
}

function entryEventsFromPayload(payload) {
  const byKey = new Map();
  attachLatestRecords(payload.events, payload.records)
    .filter((event) => event.firstAAt)
    .forEach((event) => byKey.set(eventKey(event), event));
  (payload.records || [])
    .map(entryEventFromRecord)
    .filter(Boolean)
    .forEach((event) => byKey.set(eventKey(event), event));
  return [...byKey.values()]
    .filter(isStrategy2LiveDisplayEvent)
    .sort((a, b) => String(b.latestAAt || b.firstAAt).localeCompare(String(a.latestAAt || a.firstAAt)));
}

async function main() {
  const today = taipeiDateKey();
  const payload = readJson(STRATEGY2_REPORT_FILE, { date: "", events: [] });
  if (payload.date !== today) {
    console.log(`strategy2 live alert skipped: stale date ${payload.date || "--"}`);
    return;
  }
  const aEvents = entryEventsFromPayload(payload);
  if (!aEvents.length) {
    console.log("strategy2 live alert skipped: no entry-zone events");
    return;
  }

  const state = readJson(LIVE_ALERT_STATE_FILE, { date: today, sent: [] });
  const sent = new Set(state.date === today ? (state.sent || []) : []);
  const enhancementCooldown = state.date === today ? { ...(state.enhancementCooldown || {}) } : {};
  const nowMs = Date.now();
  const newEvents = aEvents.filter((event) => isWithinStrategy2NotificationWindow(event.firstAAt) && !sent.has(eventKey(event)));
  const newEnhancements = [];
  if (STRATEGY2_LIVE_DISABLE_ENHANCEMENTS) {
    console.log("strategy2 live alert: enhancement notifications disabled by whitelist");
  }
  if (!STRATEGY2_LIVE_DISABLE_ENHANCEMENTS) aEvents.forEach((event) => {
    (event.enhancements || []).forEach((enhancement) => {
      const key = enhancementKey(event, enhancement);
      const cooldownKey = enhancementCooldownKey(event, enhancement);
      const lastSentAt = recentEnhancementSentAt(state, cooldownKey, today, event, enhancement);
      const cooldownPassed = !ENHANCEMENT_COOLDOWN_MS || !lastSentAt || nowMs - lastSentAt >= ENHANCEMENT_COOLDOWN_MS;
      const breakoutReason = cooldownPassed ? "" : enhancementBreakoutReason(state, cooldownKey, event);
      if (isWithinStrategy2NotificationWindow(enhancement.at) && !sent.has(key) && (cooldownPassed || breakoutReason)) {
        newEnhancements.push({ event, enhancement: { ...enhancement, breakoutReason }, key, cooldownKey });
      }
    });
  });
  const latestEnhancements = newEnhancements
    .sort((a, b) => String(a.enhancement.at).localeCompare(String(b.enhancement.at)))
    .slice(-LIVE_LIMIT);
  if (!newEvents.length && !latestEnhancements.length) {
    console.log(`strategy2 live alert skipped: no new A-zone or enhancement events after ${process.env.STRATEGY2_LIVE_STARTED_AT || "--"}`);
    return;
  }
  const latestEvents = newEvents.slice(-LIVE_LIMIT);
  const altText = `策略2 進場區通知：${latestEvents.map((event) => `${event.code} ${event.name || ""}`.trim()).join("、")}`;
  if (process.env.STRATEGY2_LIVE_DRY_RUN === "1" || process.env.LINE_DRY_RUN === "1") {
    if (latestEvents.length) {
      console.log(`[dry-run] ${altText}`);
      console.log(buildMessage(latestEvents));
    }
    if (latestEnhancements.length) {
      console.log("[dry-run] 策略2 進場區持續放量");
      console.log(buildEnhancementMessage(latestEnhancements));
    }
    return;
  }
  if (!hasTelegramConfig() && !hasLineConfig()) {
    throw new Error("Missing Telegram or LINE notification config");
  }
  if (latestEvents.length) {
    const options = notificationOptions("entry", today, latestEvents.map(eventKey), `${today}T${latestEvents.at(-1)?.firstAAt || "09:00:00"}+08:00`);
    if (hasTelegramConfig()) {
      await sendTelegramText(buildMessage(latestEvents), options);
    } else if (process.env.LINE_FLEX_DISABLED === "1") {
      await sendLineText(buildMessage(latestEvents), options);
    } else {
      await sendLineFlex(altText, strategy2LiveFlex(latestEvents, today), options);
    }
    latestEvents.forEach((event) => sent.add(eventKey(event)));
  }
  if (latestEnhancements.length) {
    const options = notificationOptions("enhancement", today, latestEnhancements.map((item) => item.key), `${today}T${latestEnhancements.at(-1)?.enhancement?.at || "09:00:00"}+08:00`);
    if (hasTelegramConfig()) {
      await sendTelegramText(buildEnhancementMessage(latestEnhancements), options);
    } else {
      await sendLineText(buildEnhancementMessage(latestEnhancements), options);
    }
    latestEnhancements.forEach((item) => sent.add(item.key));
    latestEnhancements.forEach((item) => {
      if (item.cooldownKey) enhancementCooldown[item.cooldownKey] = enhancementCooldownEntry(item.event);
    });
  }
  writeJson(LIVE_ALERT_STATE_FILE, {
    date: today,
    updatedAt: new Date().toISOString(),
    sent: Array.from(sent),
    enhancementCooldown,
  });
  console.log(`strategy2 live alert sent: new ${latestEvents.length}, enhancements ${latestEnhancements.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});




