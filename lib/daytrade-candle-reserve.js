"use strict";

const fs = require("fs");
const path = require("path");

function normalizeCode(value) {
  return String(value?.symbol || value?.code || value || "").replace(/\D/g, "").slice(0, 4);
}

function normalizeSymbols(values) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const symbol = normalizeCode(value);
    if (!/^\d{4}$/.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    output.push(symbol);
  }
  return output;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function reservePath(runtimeDir, tradeDate) {
  return path.join(runtimeDir, "cache", "intraday", `fugle-daytrade-ws-candle-reserve-${String(tradeDate || "").replace(/\D/g, "")}.json`);
}

function validReserve(payload, tradeDate, capacity) {
  const symbols = normalizeSymbols(payload?.symbols);
  return String(payload?.tradeDate || "") === tradeDate
    && symbols.length === capacity;
}

function resolveCandleReserve({ runtimeDir, tradeDate, capacity, prioritySymbols, universeSymbols, nowIso = new Date().toISOString(), persist = true }) {
  const normalizedCapacity = Math.max(0, Math.trunc(Number(capacity) || 0));
  const universe = normalizeSymbols(universeSymbols);
  const file = reservePath(runtimeDir, tradeDate);
  const existing = readJson(file);
  if (validReserve(existing, tradeDate, normalizedCapacity)) {
    return {
      symbols: normalizeSymbols(existing.symbols),
      file,
      created: false,
      frozenAt: existing.frozenAt || existing.updatedAt || "",
      source: "same_day_frozen_reserve",
      priorityCountAtFreeze: Number(existing.priorityCountAtFreeze || 0),
    };
  }

  const symbols = normalizeSymbols([...normalizeSymbols(prioritySymbols), ...universe]).slice(0, normalizedCapacity);
  const payload = {
    contract: "daytrade_stable_candle_reserve_v1",
    tradeDate,
    frozenAt: nowIso,
    updatedAt: nowIso,
    capacity: normalizedCapacity,
    symbols,
    priorityCountAtFreeze: normalizeSymbols(prioritySymbols).length,
    universeCountAtFreeze: universe.length,
    policy: "same_day_candle_roster_is_frozen_after_market_subscription; priority_changes_must_not_replace_existing_formal_1m_symbols",
  };
  if (persist) writeJson(file, payload);
  return {
    symbols,
    file,
    created: true,
    frozenAt: nowIso,
    source: "new_same_day_frozen_reserve",
    priorityCountAtFreeze: payload.priorityCountAtFreeze,
  };
}

module.exports = { normalizeSymbols, reservePath, resolveCandleReserve };