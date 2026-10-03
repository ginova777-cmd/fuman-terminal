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
  return row?.synthetic === true || row?.is_synthetic === true || row?.payload?.synthetic === true || row?.payload?.is_synthetic === true;
}

function buildTimelineAudit({ symbol, tradeDate, rows = [], expectedMinutes = expectedMinuteLabels(), nowMs = Date.now() }) {
  const labels = [...new Set(expectedMinutes)];
  const expected = new Set(labels);
  const real = new Map();
  const synthetic = new Set();
  const conflicts = new Set();
  let websocketRows = 0;
  let restRows = 0;
  let latest = "";
  for (const row of rows) {
    if (String(row?.symbol || "") !== String(symbol) || row?.trade_date !== tradeDate) continue;
    const time = Date.parse(String(row?.candle_time || ""));
    if (!Number.isFinite(time) || time > nowMs || time % 60000 !== 0) continue;
    if (taipeiParts(time).date !== tradeDate) continue;
    const label = taipeiMinute(time);
    if (!expected.has(label)) continue;
    if (isSynthetic(row)) { synthetic.add(label); continue; }
    const source = String(row.source_channel || row.payload?.source_channel || row.source || "").toLowerCase();
    if (row.synthetic !== false || row.volume_strategy_usable !== true || !source || source.includes("quote_derived")) continue;
    if (row.payload?.volume_strategy_usable === false) continue;
    const values = [row.open, row.high, row.low, row.close, row.volume];
    if (!values.every(value => typeof value === "number" && Number.isFinite(value))) continue;
    if (values.slice(0, 4).some(value => value <= 0) || row.volume < 0
      || row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)) continue;
    const fingerprint = JSON.stringify(values);
    if (real.has(label) && real.get(label) !== fingerprint) conflicts.add(label);
    real.set(label, fingerprint);
    if (time > Date.parse(latest || "1970-01-01")) latest = row.candle_time;
    if (row.websocket_row === true || source.includes("websocket")) websocketRows += 1;
    if (row.rest_repair_row === true || source.includes("rest")) restRows += 1;
  }
  for (const label of conflicts) real.delete(label);
  const missing = labels.filter(label => !real.has(label));
  return {
    symbol: String(symbol), trade_date: tradeDate, expected_minutes: labels.length,
    real_candles: real.size, synthetic_candles: [...synthetic].filter(label => !real.has(label)).length, missing_minutes: missing,
    latest_candle_time: latest || null, repair_count: restRows, websocket_rows: websocketRows,
    rest_rows: restRows, replay_allowed: labels.length > 0 && missing.length === 0,
  };
}

module.exports = { SESSION_START_MINUTE, SESSION_END_MINUTE, expectedMinuteLabels, taipeiMinute, buildTimelineAudit, isSynthetic };
