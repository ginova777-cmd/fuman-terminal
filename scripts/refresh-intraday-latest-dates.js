const fs = require("fs");
const path = require("path");
const { ROOT, DATA_DIR, dataPath } = require("./runtime-paths");
const { isTwseTradingDay } = require("./twse-trading-day");

const syncRoot = process.env.FUMAN_SYNC_DIR || "C:\\fuman-terminal-sync";
const stateDir = process.env.FUMAN_STATE_DIR || path.join(process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime", "state");

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeDate(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function taipeiProbeDate(offsetDays = 0) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const taipei = new Date(utcMs + 8 * 60 * 60000);
  taipei.setDate(taipei.getDate() + offsetDays);
  return taipei;
}

async function latestTradingDate() {
  for (let offset = 0; offset >= -14; offset -= 1) {
    const result = await isTwseTradingDay(taipeiProbeDate(offset), { stateDir });
    if (result.isTradingDay) return result.date;
  }
  return normalizeDate(new Date().toISOString());
}

function allDataTargets(name) {
  return [...new Set([
    path.join(DATA_DIR, name),
    path.join(ROOT, "data", name),
    path.join(syncRoot, "data", name),
  ])];
}

function writeDataFile(name, payload) {
  for (const file of allDataTargets(name)) writeJson(file, payload);
}

function payloadDate(payload) {
  return normalizeDate(payload?.date || payload?.usedDate || payload?.tradeDate || payload?.updatedAt);
}

function previousSnapshot(payload) {
  if ((payload?.status === "no_latest_intraday_snapshot" || payload?.status === "retired_intraday_snapshot") && payload?.previousSnapshot) {
    return payload.previousSnapshot;
  }
  return {
    date: payloadDate(payload),
    updatedAt: payload?.updatedAt || "",
    status: payload?.status || payload?.source || "",
    records: Array.isArray(payload?.records) ? payload.records.length : 0,
    events: Array.isArray(payload?.events) ? payload.events.length : 0,
    rows: Array.isArray(payload?.rows) ? payload.rows.length : 0,
  };
}

function refreshStrategy2(latestDate) {
  const current = readJson(dataPath("strategy2-intraday-latest.json"), readJson(path.join(ROOT, "data", "strategy2-intraday-latest.json"), {}));
  const currentDate = payloadDate(current);
  if (currentDate >= latestDate && current.status === "retired_intraday_snapshot" && current.count === 0) return false;
  const updatedAt = new Date().toISOString();
  const payload = {
    ok: true,
    source: "strategy2-intraday-latest",
    status: "retired_intraday_snapshot",
    reason: "latest trading day has no completed strategy2 intraday patrol snapshot; stale signals retired and empty snapshot archived",
    date: latestDate,
    updatedAt,
    realtime: {
      requested: 0,
      received: 0,
      failed: 0,
      usable: 0,
      coverage: 0,
      entrySourceHealthy: false,
      staleSignalsRetired: true,
    },
    records: [],
    events: [],
    count: 0,
    entryCount: 0,
    aCount: 0,
    bOnlyCount: 0,
    previousSnapshot: previousSnapshot(current),
  };
  writeDataFile("strategy2-intraday-latest.json", payload);
  console.log(`[intraday-date] strategy2 retired stale ${currentDate || "none"} -> ${latestDate}`);
  return true;
}

function refreshRealtimeRadar(latestDate) {
  const current = readJson(dataPath("realtime-radar-latest.json"), readJson(path.join(ROOT, "data", "realtime-radar-latest.json"), {}));
  const currentDate = payloadDate(current);
  if (currentDate >= latestDate && current.status === "retired_intraday_snapshot" && current.count === 0) return false;
  const updatedAt = new Date().toISOString();
  const payload = {
    ok: true,
    source: "mini-pc-realtime-radar",
    status: "retired_intraday_snapshot",
    reason: "latest trading day has no completed realtime radar snapshot; stale signals retired and empty snapshot archived",
    date: latestDate,
    timestamp: "closed",
    updatedAt,
    updatedAtMs: Date.now(),
    staleAfterMs: Number(current?.staleAfterMs || 300000),
    maxQuoteAgeSeconds: Number(current?.maxQuoteAgeSeconds || 120),
    staleQuoteCount: 0,
    failedBatchCount: 0,
    count: 0,
    rows: [],
    longCount: 0,
    shortCount: 0,
    previousSnapshot: previousSnapshot(current),
  };
  writeDataFile("realtime-radar-latest.json", payload);
  console.log(`[intraday-date] realtime radar retired stale ${currentDate || "none"} -> ${latestDate}`);
  return true;
}

async function main() {
  const latestDate = await latestTradingDate();
  const changed = [
    refreshStrategy2(latestDate),
    refreshRealtimeRadar(latestDate),
  ].some(Boolean);
  if (!changed) console.log(`[intraday-date] strategy2/realtime already at latest trading date ${latestDate}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
