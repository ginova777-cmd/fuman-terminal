function symbolCode(value) {
  const raw = value && typeof value === "object"
    ? (value.symbol ?? value.code ?? value.stock_id)
    : value;
  const code = String(raw ?? "").trim();
  return /^\d{4}$/.test(code) ? code : "";
}

function mergeCurrentDayCandlePrioritySymbols({
  manifest,
  tradeDate,
  canonicalRunId,
  preferredSymbols = [],
  computedSymbols = [],
}) {
  const payload = manifest && typeof manifest === "object" ? manifest : {};
  const manifestDate = String(payload.tradeDate ?? payload.trade_date ?? "").trim();
  const manifestCanonicalRunId = String(payload.canonicalRunId ?? payload.canonical_run_id ?? "").trim();
  const sameDailyIdentity = manifestDate === String(tradeDate ?? "").trim()
    && manifestCanonicalRunId === String(canonicalRunId ?? "").trim();
  const retainedSymbols = sameDailyIdentity && Array.isArray(payload.daytradeCandlePrioritySymbols)
    ? payload.daytradeCandlePrioritySymbols
    : [];
  const openingSymbols = sameDailyIdentity && Array.isArray(payload.openingPrioritySymbols)
    ? payload.openingPrioritySymbols
    : (sameDailyIdentity && Array.isArray(payload.primaryPrioritySymbols) ? payload.primaryPrioritySymbols : []);
  const seen = new Set();
  const merged = [];
  for (const value of [...preferredSymbols, ...openingSymbols, ...retainedSymbols, ...computedSymbols]) {
    const code = symbolCode(value);
    if (code && !seen.has(code)) {
      seen.add(code);
      merged.push(code);
    }
  }
  return merged;
}

module.exports = { mergeCurrentDayCandlePrioritySymbols };
