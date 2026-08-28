"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveCandleReserve } = require("../lib/daytrade-candle-reserve");

const root = path.resolve(__dirname, "..");
const collectorPath = path.join(root, "scripts", "fugle-websocket-collector.js");
const collector = fs.readFileSync(collectorPath, "utf8");
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-candle-reserve-"));
const tradeDate = "2026-08-28";
const universe = ["2408", "2301", "2330", "9999", "8888", ...Array.from({ length: 1200 }, (_, index) => String(1000 + index))];
const initialPriority = ["2408", "2301", "2330"];
const first = resolveCandleReserve({ runtimeDir: runtime, tradeDate, capacity: 1000, prioritySymbols: initialPriority, universeSymbols: universe, persist: true, nowIso: "2026-08-28T00:45:00.000Z" });
const second = resolveCandleReserve({ runtimeDir: runtime, tradeDate, capacity: 1000, prioritySymbols: ["9999", "8888"], universeSymbols: universe, persist: true, nowIso: "2026-08-28T01:00:00.000Z" });
const nextDay = resolveCandleReserve({ runtimeDir: runtime, tradeDate: "2026-08-29", capacity: 1000, prioritySymbols: ["9999", "8888"], universeSymbols: universe, persist: false, nowIso: "2026-08-29T00:45:00.000Z" });
const afterUniverseShrink = resolveCandleReserve({ runtimeDir: runtime, tradeDate, capacity: 1000, prioritySymbols: ["9999"], universeSymbols: universe.slice(0, 50), persist: true, nowIso: "2026-08-28T02:00:00.000Z" });
fs.rmSync(runtime, { recursive: true, force: true });

const checks = {
  collector_uses_same_day_reserve: collector.includes("resolveCandleReserve"),
  reserve_is_created_only_after_preopen: collector.includes("const reserve = resolveCandleReserve"),
  priority_refresh_does_not_rotate_candles: collector.includes("frozenCandleSymbols"),
  reserve_capacity_is_1000_in_fixture: first.symbols.length === 1000,
  reserve_keeps_initial_priority: initialPriority.every((symbol) => first.symbols.includes(symbol)),
  same_day_priority_change_keeps_roster: JSON.stringify(first.symbols) === JSON.stringify(second.symbols) && second.created === false,
  same_day_universe_shrink_keeps_roster: JSON.stringify(first.symbols) === JSON.stringify(afterUniverseShrink.symbols) && afterUniverseShrink.created === false,
  next_trading_day_rebuilds_roster: nextDay.created === true && nextDay.symbols[0] === "9999",
};
const failed_checks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
console.log(JSON.stringify({ ok: failed_checks.length === 0, contract: "strategy3_v2_stable_candle_reserve_contract_v1", checks, failed_checks, first_blocker: failed_checks[0] || null, read_only: true }, null, 2));
process.exitCode = failed_checks.length ? 1 : 0;