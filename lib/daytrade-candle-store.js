'use strict';
// Single Collector owns this cache. Downstream readers keep the existing JSON contract.
function createCandleStore({ read, write, now = Date.now, retentionMs, observe = () => {} }) {
  let initialized = false, dirty = false;
  const rows = new Map();
  // Receive timestamps are not market revisions. Preserve every other field,
  // including the exchange payload and quality flags, in the comparison.
  const content = row => {
    if (!row) return null;
    const copy = { ...row };
    delete copy.candleSeenAt;
    delete copy.updatedAt;
    return JSON.stringify(copy);
  };
  const keyOf = row => `${row.code || row.symbol}|${row.candleTime || row.date || ''}`;
  const valid = row => /^\d{4}$/.test(String(row.code || row.symbol || '')) && Boolean(row.candleTime || row.date);
  return {
    merge(batch) {
      if (!initialized) {
        const saved = read() || {};
        for (const row of saved.candles || []) {
          const seen = Date.parse(row.candleSeenAt || row.updatedAt || saved.updatedAt || '');
          if (valid(row) && Number.isFinite(seen) && seen >= now() - retentionMs) rows.set(keyOf(row), row);
          else dirty = true;
        }
        initialized = true;
      }
      for (const row of batch) {
        if (!valid(row)) throw new Error('INVALID_CANDLE_IDENTITY');
        const key = keyOf(row);
        const previousContent = content(rows.get(key)), mergedContent = content(row);
        const changed = previousContent !== mergedContent;
        // Observer is a side path; evidence failure cannot decide cache publication.
        // These existing comparison strings are immutable and precede persistence.
        // Observers may reuse them; the store never mutates a row object in place.
        try { observe(rows.get(key), row, changed, {previousContent,mergedContent}); } catch (_) {}
        if (changed) { rows.set(key, row); dirty = true; }
      }
      for (const [key, row] of rows) {
        const seen = Date.parse(row.candleSeenAt || row.updatedAt || '');
        if (Number.isFinite(seen) && seen < now() - retentionMs) { rows.delete(key); dirty = true; }
      }
      if (dirty) {
        const candles = [...rows.values()].sort((a,b) => String(a.code || a.symbol).localeCompare(String(b.code || b.symbol)) || Date.parse(a.candleTime || a.date) - Date.parse(b.candleTime || b.date));
        write({ source:'fugle-websocket-streaming', channel:'websocket:candles', updatedAt:new Date(now()).toISOString(), count:candles.length, candles }, key => rows.get(key));
        dirty = false; // Keep pending state if write throws; never report a failed flush as saved.
      }
      return rows.size;
    }
  };
}
module.exports = { createCandleStore };
