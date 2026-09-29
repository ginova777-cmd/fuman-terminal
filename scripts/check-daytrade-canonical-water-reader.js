"use strict";

const fs = require("fs");
const { statePath } = require("./runtime-paths");
const { readCanonicalDaytradeWater, taipeiDate } = require("../lib/daytrade-canonical-water-reader");

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

async function main() {
  const tradeDate = process.argv.find((arg) => arg.startsWith("--trade-date="))?.slice("--trade-date=".length) || taipeiDate();
  const explicitSymbols = process.argv.find((arg) => arg.startsWith("--symbols="))?.slice("--symbols=".length).split(",").filter(Boolean) || [];
  const telegramObservation = process.argv.includes("--telegram-observation");
  const outbox = readJson(statePath("daytrade-intraday-burst-telegram-outbox.json"), {});
  const outboxSymbols = Array.isArray(outbox?.events) ? outbox.events.map((event) => event?.symbol).filter(Boolean) : [];
  const result = await readCanonicalDaytradeWater({ tradeDate, symbols: explicitSymbols.length ? explicitSymbols : outboxSymbols, barsPerSymbol: 61, telegramObservation });
  const sideVolumeQualifyingRows = [...result.poolBySymbol.values()].filter((row) => {
    const inside = Number(row?.inside_volume);
    const outside = Number(row?.outside_volume);
    const total = Number(row?.side_volume_total);
    return row?.side_volume_available === true
      && row?.side_volume_unit === "lots"
      && row?.side_volume_ge_2000_lots === true
      && Number.isFinite(total) && total >= 2000
      && Number.isFinite(inside) && inside >= 0
      && Number.isFinite(outside) && outside > inside * 2;
  });
  console.log(JSON.stringify({
    ok: result.ok,
    contract: "daytrade_canonical_water_reader_check_v1",
    checked_at: new Date().toISOString(),
    receipt: result.receipt,
    failed_checks: result.failedChecks,
    first_blocker: result.firstBlocker,
    side_volume_qualifying_count: sideVolumeQualifyingRows.length,
    side_volume_qualifying_symbols: sideVolumeQualifyingRows.map((row) => row.symbol),
    read_only: true,
  }, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, first_blocker: "canonical_water_check_exception", error: error?.message || String(error), read_only: true }, null, 2));
  process.exitCode = 1;
});
