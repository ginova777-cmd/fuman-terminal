"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateJiangCore } = require("../lib/jiang-intraday-signal-core");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const CACHE_FILE = process.env.FUGLE_WS_CANDLES_FILE
  || path.join(RUNTIME_DIR, "cache", "intraday", "fugle-daytrade-ws-candles-v2.json");
const DEFAULT_TIMES = ["09:01", "09:04", "09:24", "09:35", "11:02"];

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function parseTimes(value) {
  const values = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return values.length ? values : DEFAULT_TIMES;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function formalCandle(row, tradeDate, symbol) {
  const code = String(row?.code || row?.symbol || "").replace(/\D/g, "").slice(0, 4);
  const candleTime = String(row?.candleTime || row?.candle_time || "");
  return code === symbol
    && candleTime.startsWith(`${tradeDate}T`)
    && Number(row?.close) > 0
    && row?.synthetic !== true
    && String(row?.source || "") === "fugle-ws-candles"
    && String(row?.sourceChannel || "") === "candles";
}

function atTime(tradeDate, time) {
  return `${tradeDate}T${time}:00`;
}

function main() {
  const symbol = String(arg("symbol", "")).replace(/\D/g, "").slice(0, 4);
  const tradeDate = arg("trade-date", "");
  const times = parseTimes(arg("times", ""));
  const failures = [];

  if (!/^\d{4}$/.test(symbol)) failures.push("symbol_must_be_four_digits");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) failures.push("trade_date_required_yyyy_mm_dd");

  const cache = readJson(CACHE_FILE);
  if (!cache) failures.push("formal_fugle_candle_cache_missing_or_invalid");
  const candles = Array.isArray(cache?.candles) ? cache.candles
    .filter((row) => formalCandle(row, tradeDate, symbol))
    .sort((left, right) => String(left.candleTime || left.candle_time).localeCompare(String(right.candleTime || right.candle_time)))
    : [];

  const checkpoints = times.map((time) => {
    const cutoff = atTime(tradeDate, time);
    const exact = candles.find((row) => String(row.candleTime || row.candle_time).startsWith(cutoff));
    const prefix = candles.filter((row) => String(row.candleTime || row.candle_time) <= cutoff);
    const evaluation = prefix.length ? evaluateJiangCore(prefix, { symbol }) : null;
    const dataGap = !exact
      ? "no_formal_1m_candle_at_checkpoint"
      : evaluation?.status === "DATA_GAP"
        ? evaluation.reasonCode
        : null;
    if (dataGap) failures.push(`${time}:${dataGap}`);
    return {
      time,
      candle_present: Boolean(exact),
      candle_count: prefix.length,
      first_candle_time: prefix[0]?.candleTime || prefix[0]?.candle_time || null,
      last_candle_time: prefix.at(-1)?.candleTime || prefix.at(-1)?.candle_time || null,
      status: dataGap ? "DATA_GAP" : "OK",
      reason_code: dataGap || evaluation?.reasonCode || "",
      primary_signal: evaluation?.primarySignal?.id || null,
      primary_label: evaluation?.primarySignal?.label || null,
      secondary_labels: evaluation?.secondaryLabels || [],
      n_large_chase_guard: evaluation?.guards?.some((guard) => guard.id === "jiang_n_large_chase_guard") === true,
    };
  });

  const payload = {
    ok: failures.length === 0,
    contract: "jiang_formal_candle_replay_readonly_v1",
    trade_date: tradeDate,
    symbol,
    cache_file: CACHE_FILE,
    cache_updated_at: cache?.updatedAt || null,
    formal_candle_count: candles.length,
    first_candle_time: candles[0]?.candleTime || candles[0]?.candle_time || null,
    last_candle_time: candles.at(-1)?.candleTime || candles.at(-1)?.candle_time || null,
    checkpoints,
    failed_checks: failures,
    first_blocker: failures[0] || null,
    read_only: true,
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.ok ? 0 : 1;
}

main();
