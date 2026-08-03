const SESSION_START_MINUTE = 9 * 60;
const SESSION_END_MINUTE = 13 * 60 + 30;

function taipeiParts(value) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

function expectedMinuteLabels({ endMinute = SESSION_END_MINUTE } = {}) {
  const end = Math.max(SESSION_START_MINUTE, Math.min(SESSION_END_MINUTE, Number(endMinute)));
  const labels = [];
  for (let minute = SESSION_START_MINUTE; minute <= end; minute += 1) {
    labels.push(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
  }
  return labels;
}

function taipeiMinute(value) {
  const parts = taipeiParts(value);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function isSynthetic(row) {
  return row?.synthetic === true || row?.payload?.synthetic === true;
}

function buildTimelineAudit({ symbol, tradeDate, rows = [], expectedMinutes = expectedMinuteLabels() }) {
  const expected = new Set(expectedMinutes);
  const real = new Set();
  const synthetic = new Set();
  let websocketRows = 0;
  let restRows = 0;
  let latest = "";
  for (const row of rows) {
    if (!row?.candle_time || String(row.trade_date || tradeDate) !== String(tradeDate)) continue;
    const label = taipeiMinute(row.candle_time);
    if (!expected.has(label)) continue;
    const source = String(row.source_channel || row.payload?.source_channel || row.source || "").toLowerCase();
    const usable = row.volume_strategy_usable !== false && !source.includes("quote_derived");
    if (Date.parse(row.candle_time) > Date.parse(latest || "1970-01-01")) latest = row.candle_time;
    if (row.websocket_row === true || source.includes("websocket")) websocketRows += 1;
    if (row.rest_repair_row === true || source.includes("rest")) restRows += 1;
    if (!usable) continue;
    if (isSynthetic(row)) {
      if (!real.has(label)) synthetic.add(label);
    } else {
      real.add(label);
      synthetic.delete(label);
    }
  }
  const covered = new Set([...real, ...synthetic]);
  const missing = expectedMinutes.filter((label) => !covered.has(label));
  return {
    symbol: String(symbol), trade_date: tradeDate, expected_minutes: expectedMinutes.length,
    real_candles: real.size, synthetic_candles: synthetic.size, missing_minutes: missing,
    latest_candle_time: latest || null, repair_count: restRows, websocket_rows: websocketRows,
    rest_rows: restRows, replay_allowed: missing.length === 0,
  };
}
module.exports = { SESSION_START_MINUTE, SESSION_END_MINUTE, expectedMinuteLabels, taipeiMinute, buildTimelineAudit, isSynthetic };
