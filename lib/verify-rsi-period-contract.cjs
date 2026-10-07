'use strict';
// Verification only: producer must be supplied by the trusted caller, never by payload.
function verifyAuthority(producer) {
  const p = producer?.PARAMETERS;
  if (p?.rsiFast !== 5 || p?.rsiSlow !== 15) return ['RSI_PRODUCER_PERIOD_MISMATCH'];
  if (!producer.CONTRACT || typeof producer.indicatorTrend !== 'function') return ['RSI_ALGORITHM_EVIDENCE_MISSING'];
  return [];
}
function verifyRow(trend, producer) {
  const errors = verifyAuthority(producer);
  if (errors.length) return errors;
  if (!trend || trend.contract !== producer.CONTRACT) return ['RSI_PRODUCER_CONTRACT_MISMATCH'];
  const p = trend.parameters;
  if (p && (p.rsiFast !== 5 || p.rsiSlow !== 15 || p.rsiMethod !== producer.PARAMETERS.rsiMethod)) errors.push('RSI_METADATA_MISMATCH');
  // Metadata alone cannot establish how the published numeric values were calculated.
  const bars = trend.rsiVerificationBars;
  if (!Array.isArray(bars) || !bars.length) return [...errors, 'RSI_ALGORITHM_INPUT_EVIDENCE_MISSING'];
  let expected;
  try { expected = producer.indicatorTrend(bars); } catch (_) { return [...errors, 'RSI_RECOMPUTE_FAILED']; }
  if (expected?.available !== true || expected.contract !== producer.CONTRACT || expected.parameters?.rsiFast !== 5 || expected.parameters?.rsiSlow !== 15) return [...errors, 'RSI_PRODUCER_OUTPUT_MISMATCH'];
  for (const field of ['rsi5', 'rsi5Prev', 'rsi15', 'rsi15Prev']) {
    // Same authoritative JS algorithm and unrounded output; no period guessed from proximity.
    if (!Number.isFinite(trend[field]) || !Number.isFinite(expected[field]) || trend[field] !== expected[field]) errors.push('RSI_VALUE_MISMATCH:' + field);
  }
  return errors;
}
module.exports = { verifyAuthority, verifyRow };
