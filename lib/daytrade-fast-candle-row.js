'use strict';
function finite(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
function mapNaturalCandle(c, { tradeDate, nowMs, maxSeenAgeMs = 180000 }) {
  if (!c || typeof c !== 'object' || !Number.isFinite(nowMs)) return null;
  if (c.source !== 'fugle-ws-candles' || c.sourceChannel !== 'candles' || c.candleOrigin !== 'websocket_candle') return null;
  if (c.restRepairRow === true || c.intradayOddLot === true) return null;
  const time = Date.parse(c.candleTime || c.date || '');
  const seen = Date.parse(c.candleSeenAt || '');
  const values = ['open', 'high', 'low', 'close'].map(k => finite(c[k]));
  const volume = finite(c.volume);
  const symbol = String(c.symbol || c.code || '');
  const localDate = Number.isFinite(time) ? new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time)) : '';
  if (!/^\d{4}$/.test(symbol) || c.tradeDate !== tradeDate || localDate !== tradeDate) return null;
  if (!Number.isFinite(time) || time % 60000 !== 0 || time + 60000 > nowMs || !Number.isFinite(seen) || seen < time || seen > nowMs || nowMs - seen > maxSeenAgeMs) return null;
  if (c.synthetic !== false || c.volumeStrategyUsable !== true || c.payload?.is_synthetic === true) return null;
  if (values.some(v => v === null || v <= 0) || volume === null || volume < 0) return null;
  const [open, high, low, close] = values;
  if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null;
  return { symbol, market:c.market || '', trade_date:tradeDate, candle_time:new Date(time).toISOString(),
    open, high, low, close, volume, updated_at:new Date(seen).toISOString(),
    source:'fugle_daytrade_fast_sync:websocket_candles', synthetic:false, volume_strategy_usable:true,
    payload:{...(c.payload || {}),fastSync:true,sourceCandleSeenAt:new Date(seen).toISOString(), originalSource:c.source, originalChannel:c.sourceChannel, candleOrigin:c.candleOrigin} };
}
module.exports = { finite, mapNaturalCandle };
