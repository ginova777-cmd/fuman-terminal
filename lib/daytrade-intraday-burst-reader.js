"use strict";

const VIEW = "v_fugle_daytrade_intraday_burst_readback";

function latestBySymbol(rows = []) {
  const bySymbol = new Map();
  for (const row of rows) {
    const symbol = String(row?.symbol || "").replace(/\D/g, "").slice(0, 4);
    if (!symbol) continue;
    const current = bySymbol.get(symbol);
    if (!current || String(row?.candle_time || "").localeCompare(String(current?.candle_time || "")) > 0) bySymbol.set(symbol, row);
  }
  return bySymbol;
}

async function readBurstReadback(source, tradeDate, readRows) {
  try {
    const rows = await readRows(source, VIEW, {
      select: "trade_date,symbol,name,candle_time,checked_at,latest_1m_close,latest_1m_volume,prior_rolling60_high_close,prior_rolling60_average_volume,instant_pullup,instant_volume,burst_type,source_name,data_status,stale_seconds,reason_code,source_run_id",
      trade_date: `eq.${tradeDate}`,
      order: "candle_time.desc",
      limit: "5000",
    });
    return {
      available: true,
      reasonCode: "",
      rows,
      bySymbol: latestBySymbol(rows),
    };
  } catch (error) {
    const message = String(error?.message || error || "");
    return {
      available: false,
      reasonCode: /HTTP 404|PGRST205|not find the table/i.test(message) ? "burst_readback_missing" : "burst_readback_unavailable",
      error: message,
      rows: [],
      bySymbol: new Map(),
    };
  }
}

module.exports = { VIEW, latestBySymbol, readBurstReadback };
