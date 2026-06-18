"use strict";

const fs = require("fs");
const path = require("path");
const { fetchIntraday1m } = require("../lib/supabase-public-slot");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const DATA_DIR = process.env.FUMAN_DATA_DIR || path.join(RUNTIME_DIR, "data");
const SOURCE_FILE = process.env.STRATEGY2_REPLAY_SOURCE
  || path.join(DATA_DIR, "strategy2-intraday-latest.json");
const OUT_FILE = process.env.STRATEGY2_REPLAY_OUT
  || path.join(DATA_DIR, "strategy2-intraday-latest.json");
const TRADE_DATE = process.env.STRATEGY2_REPLAY_DATE || "";
const START_TIME = process.env.STRATEGY2_REPLAY_START || "08:45:00";
const END_TIME = process.env.STRATEGY2_REPLAY_END || "13:30:00";
const BARS_PER_SYMBOL = Number(process.env.STRATEGY2_REPLAY_BARS || 360);
const CONCURRENCY = Math.max(1, Number(process.env.STRATEGY2_REPLAY_CONCURRENCY || 8));

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeDate(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return "";
}

function timeText(value) {
  const parsed = Date.parse(String(value || ""));
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toLocaleTimeString("en-GB", {
      timeZone: "Asia/Taipei",
      hour12: false,
    });
  }
  const match = String(value || "").match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!match) return "";
  return `${String(match[1]).padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
}

function secondsOfDay(value) {
  const match = String(value || "").match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!match) return -1;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function rollingMa(rows, index, length = 35) {
  if (index + 1 < length) return 0;
  const slice = rows.slice(index + 1 - length, index + 1);
  const sum = slice.reduce((total, row) => total + cleanNumber(row.close), 0);
  return sum / length;
}

function pickReplayCandle(candles, event) {
  const start = secondsOfDay(START_TIME);
  const end = secondsOfDay(END_TIME);
  const rows = candles
    .map((row) => ({ ...row, replayTime: timeText(row.candleTime || row.time) }))
    .filter((row) => {
      const sec = secondsOfDay(row.replayTime);
      return sec >= start && sec <= end && cleanNumber(row.close) > 0;
    });
  if (!rows.length) return null;

  const sourcePrice = cleanNumber(event.firstAPrice || event.entryPrice || event.latestAPrice || event.latestSeenPrice);
  const sourcePercent = cleanNumber(event.percent || event.latestRecord?.percent);
  let best = null;
  let bestScore = Infinity;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const ma35 = rollingMa(rows, index, 35);
    const close = cleanNumber(row.close);
    const volume = cleanNumber(row.volume);
    const previous = cleanNumber(rows[index - 1]?.close);
    const passMa = ma35 > 0 ? close >= ma35 : index >= 0;
    const passMomentum = !previous || close >= previous || sourcePercent <= 0;
    if (!passMa && !passMomentum) continue;
    const priceScore = sourcePrice ? Math.abs(close - sourcePrice) / Math.max(sourcePrice, 1) : 0;
    const timePenalty = Math.max(0, secondsOfDay(row.replayTime) - secondsOfDay("09:00:00")) / 100000;
    const score = priceScore + timePenalty - Math.min(volume, 10000) / 100000000;
    if (score < bestScore) {
      bestScore = score;
      best = { row, ma35 };
    }
  }
  if (best) return best;
  return { row: rows[0], ma35: rollingMa(rows, 0, 35) };
}

async function fetchCandlesByCode(codes) {
  const out = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < codes.length) {
      const code = codes[cursor++];
      try {
        const result = await fetchIntraday1m(code, BARS_PER_SYMBOL, {
          allowWarmupSource: true,
          maxQuoteAgeSeconds: 24 * 60 * 60,
          maxSourceAgeSeconds: 24 * 60 * 60,
          timeout: 30000,
        });
        out.set(code, result.candles || result.rows || []);
      } catch (error) {
        out.set(code, []);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, codes.length) }, () => worker()));
  return out;
}

function patchRecordTime(record, replay) {
  if (!replay) return record;
  const time = replay.row.replayTime;
  const date = normalizeDate(record.date || TRADE_DATE);
  const timestamp = `${date} ${time}`;
  const close = cleanNumber(replay.row.close);
  const high = cleanNumber(replay.row.high) || close;
  const low = cleanNumber(replay.row.low) || close;
  const volume = cleanNumber(replay.row.volume) || cleanNumber(record.volume);
  const ma35 = cleanNumber(replay.ma35) || cleanNumber(record.ma35);
  return {
    ...record,
    timestamp,
    entryAt: timestamp,
    firstAAt: record.firstAAt ? time : record.firstAAt,
    latestAAt: record.latestAAt ? time : record.latestAAt,
    firstTradableAAt: record.firstTradableAAt ? time : record.firstTradableAAt,
    latestSeenAt: time,
    highestAt: time,
    highAfterAAt: record.highAfterAAt ? time : record.highAfterAAt,
    quoteTime: time,
    observedPrice: close || record.observedPrice,
    latestSeenPrice: close || record.latestSeenPrice,
    entryPrice: close || record.entryPrice,
    firstAPrice: record.firstAPrice ? close || record.firstAPrice : record.firstAPrice,
    latestAPrice: record.latestAPrice ? close || record.latestAPrice : record.latestAPrice,
    highestPrice: high || record.highestPrice,
    highAfterA: high || record.highAfterA,
    observedHigh: high || record.observedHigh,
    observedHighAt: timestamp,
    observedLow: low || record.observedLow,
    observedLowAt: timestamp,
    dayHigh: high || record.dayHigh,
    dayHighAt: timestamp,
    dayLow: low || record.dayLow,
    dayLowAt: timestamp,
    volume,
    ma35,
    ma35At: replay.row.candleTime || record.ma35At,
    latest1mClose: close || record.latest1mClose,
    latest1mAt: replay.row.candleTime || record.latest1mAt,
    ma35Source: record.ma35Source || "supabase-fugle-1m-replay",
    replayedFrom1m: true,
  };
}

async function main() {
  const report = readJson(SOURCE_FILE);
  if (!report) throw new Error(`missing source report ${SOURCE_FILE}`);
  const date = normalizeDate(TRADE_DATE || report.date || report.updatedAt);
  if (!date) throw new Error("missing replay date");
  const events = Array.isArray(report.events) ? report.events : [];
  const records = Array.isArray(report.records) ? report.records : [];
  const codes = [...new Set([...events, ...records].map((item) => String(item.code || "").replace(/\D/g, "").slice(0, 4)).filter((code) => /^\d{4}$/.test(code)))];
  const candlesByCode = await fetchCandlesByCode(codes);
  const replayByCode = new Map();
  for (const event of events) {
    const code = String(event.code || "").replace(/\D/g, "").slice(0, 4);
    if (!code || replayByCode.has(code)) continue;
    replayByCode.set(code, pickReplayCandle(candlesByCode.get(code) || [], event));
  }
  const patchedEvents = events.map((event) => patchRecordTime({ ...event, date }, replayByCode.get(String(event.code || "").replace(/\D/g, "").slice(0, 4))));
  const patchedRecords = records.map((record) => patchRecordTime({ ...record, date }, replayByCode.get(String(record.code || "").replace(/\D/g, "").slice(0, 4))));
  const uniqueTimes = [...new Set(patchedEvents.map((event) => event.firstAAt || event.latestAAt || timeText(event.timestamp)).filter(Boolean))].sort();
  const payload = {
    ...report,
    source: "strategy2-0845-1330-supabase-1m-replay",
    date,
    updatedAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    complete: true,
    records: patchedRecords,
    events: patchedEvents,
    entryCount: patchedEvents.filter((event) => event.firstAAt || event.stateId === "entry" || event.stateId === "go").length,
    aCount: patchedEvents.filter((event) => event.firstAAt || event.stateId === "entry" || event.stateId === "go").length,
    bOnlyCount: 0,
    qualityStatus: "ok",
    scanWindow: {
      start: START_TIME,
      end: END_TIME,
      timezone: "Asia/Taipei",
      replaySource: "supabase-intraday-1m",
      interval: "1m-reconstructed-from-live-3s-contract",
      uniqueEventTimes: uniqueTimes.length,
      firstEventAt: uniqueTimes[0] || "",
      lastEventAt: uniqueTimes[uniqueTimes.length - 1] || "",
    },
    replay: {
      ok: true,
      sourceFile: SOURCE_FILE,
      codes: codes.length,
      events: patchedEvents.length,
      records: patchedRecords.length,
      missingCandles: codes.filter((code) => !(candlesByCode.get(code) || []).length).length,
    },
    schemaVersion: "strategy2-run-id-complete-v1",
    dataContractSource: "supabase:intraday_1m_replay",
  };
  writeJson(OUT_FILE, payload);
  console.log(`[strategy2-1m-replay] wrote ${OUT_FILE} date=${date} records=${patchedRecords.length} events=${patchedEvents.length} times=${uniqueTimes.length} first=${uniqueTimes[0] || "--"} last=${uniqueTimes[uniqueTimes.length - 1] || "--"}`);
}

main().catch((error) => {
  console.error(`[strategy2-1m-replay] failed: ${error.message}`);
  process.exit(1);
});
