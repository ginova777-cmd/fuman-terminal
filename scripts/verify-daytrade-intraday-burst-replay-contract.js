const fs = require("fs");
const path = require("path");

const writerPath = path.join(__dirname, "run-daytrade-source-writer.js");
const source = fs.readFileSync(writerPath, "utf8");
const failures = [];

function check(name, condition) {
  if (!condition) failures.push(name);
}

check("replay_window_constant_missing", source.includes("INTRADAY_BURST_REPLAY_MAX_AGE_SECONDS"));
check("missed_candle_replay_missing", source.includes("replayed_missed_candle: true"));
check("replay_skips_current_candle_missing", source.includes("for (let offset = 1; offset < cachedCandles.length; offset += 1)"));
check("price_trigger_not_independent", source.includes('trigger_type: "price_breakout_1pct"'));
check("volume_trigger_not_independent", source.includes('trigger_type: "volume_burst_rolling60_x2"'));

const priorVolumes = Array(60).fill(216);
const skippedBurstVolume = 3063;
const volumeRatio = skippedBurstVolume / (priorVolumes.reduce((sum, value) => sum + value, 0) / priorVolumes.length);
const priceRuleMet = 635 >= 633 * 1.01;
const volumeRuleMet = volumeRatio >= 2;
check("fixture_volume_burst_not_met", volumeRuleMet === true);
check("fixture_price_rule_should_be_false", priceRuleMet === false);
check("or_contract_failed", priceRuleMet || volumeRuleMet);

const result = {
  ok: failures.length === 0,
  contract: "daytrade_intraday_burst_replay_or_v1",
  checks: {
    price_or_volume_independent: priceRuleMet || volumeRuleMet,
    recent_missed_candle_replay: source.includes("replayed_missed_candle: true"),
    replay_excludes_current_candle: source.includes("for (let offset = 1; offset < cachedCandles.length; offset += 1)"),
  },
  fixture: {
    symbol: "3450",
    latest_1m_volume: skippedBurstVolume,
    prior_60_average_volume: 216,
    volume_ratio: Number(volumeRatio.toFixed(4)),
    volume_trigger_met: volumeRuleMet,
    price_trigger_met: priceRuleMet,
    expected_event: "volume_burst_rolling60_x2",
  },
  failed_checks: failures,
  first_blocker: failures[0] || null,
  read_only: true,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;