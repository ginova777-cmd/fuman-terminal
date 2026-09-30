"use strict";

// All consumers in one process share this cache. The database snapshot is the
// durable cache shared by different machines and serverless instances.
function createMainForceReadCache({ now = Date.now, successMs = 6 * 3600000,
  missingMs = 3600000, failureMs = 1800000, maxEntries = 6000 } = {}) {
  const entries = new Map(), flights = new Map(), failures = new Map();
  const keyOf = (scope, date, code) => JSON.stringify([scope, date, code]);
  return async function read({ scope, date, codes, load }) {
    const batchKey = JSON.stringify([scope, date]);
    while (true) {
      const missing = codes.filter(code => {
        const key = keyOf(scope, date, code), value = entries.get(key);
        if (value && value.until > now()) return false;
        entries.delete(key);
        return true;
      });
      if (!missing.length) return codes.map(code => entries.get(keyOf(scope, date, code)).row).filter(Boolean).map(row => structuredClone(row));
      const failure = failures.get(scope);
      if (failure && failure.until > now()) {
        const error = new Error("main_force_cost_backoff");
        error.code = "main_force_cost_backoff";
        error.retryAt = new Date(failure.until).toISOString();
        throw error;
      }
      if (flights.has(batchKey)) { await flights.get(batchKey); continue; }
      const flight = Promise.resolve().then(async () => {
        try {
          const rows = await load(missing);
          const byCode = new Map(rows.map(row => [row.code, row]));
          for (const code of missing) {
            const row = byCode.get(code) || null;
            entries.set(keyOf(scope, date, code), { row: row && structuredClone(row), until: now() + (row ? successMs : missingMs) });
          }
          while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
          failures.delete(scope);
        } catch (error) {
          const count = Math.min(3, (failures.get(scope)?.count || 0) + 1);
          failures.set(scope, { count, until: now() + failureMs * 2 ** (count - 1) });
          while (failures.size > 32) failures.delete(failures.keys().next().value);
          throw error;
        }
      });
      flights.set(batchKey, flight);
      try { await flight; } finally { if (flights.get(batchKey) === flight) flights.delete(batchKey); }
    }
  };
}

module.exports = { createMainForceReadCache };
