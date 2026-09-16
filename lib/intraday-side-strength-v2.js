"use strict";

function median(values) { const a=values.filter(Number.isFinite).slice().sort((x,y)=>x-y); if(!a.length)return null; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function detect(row, options = {}) {
  const outside = Number(row?.outside_1m);
  const inside = Number(row?.inside_1m);
  const total = Number(row?.total_1m);
  const maxAge = Number.isFinite(options.maxAgeSeconds) ? options.maxAgeSeconds : 120;
  const age = Number(row?.side_volume_age_seconds);
  const reasons = [];
  if (!Number.isFinite(outside) || outside < 0) reasons.push("OUTSIDE_MISSING_OR_INVALID");
  if (!Number.isFinite(inside) || inside < 0) reasons.push("INSIDE_MISSING_OR_INVALID");
  if (!Number.isFinite(total) || total < 0) reasons.push("TOTAL_MISSING_OR_INVALID");
  if (Number.isFinite(outside) && Number.isFinite(inside) && Number.isFinite(total) && Math.abs(total - outside - inside) > 1e-9) reasons.push("TOTAL_NOT_OUTSIDE_PLUS_INSIDE");
  if (!Number.isFinite(age) || age > maxAge) reasons.push("SIDE_VOLUME_STALE_OR_MISSING");
  const outsideOnly = outside > 0 && inside === 0;
  const noValid = outside === 0 && inside === 0;
  const ratio = Number.isFinite(outside) && inside > 0 ? outside / inside : null;
  if (outsideOnly) reasons.push("OUTSIDE_ONLY");
  if (noValid) reasons.push("NO_VALID_SIDE_VOLUME");
  const historical = Array.isArray(options.historicalStrength) ? options.historicalStrength.filter(Number.isFinite) : [];
  const rolling = Array.isArray(options.rollingStrength) ? options.rollingStrength.filter(Number.isFinite) : [];
  const sameBaseline = median(historical);
  const rollingBaseline = median(rolling);
  const minute = String(row?.event_time ?? row?.timestamp ?? "").slice(11,16);
  const early = minute >= "09:00" && minute <= "09:20";
  const dynamicBaseline = early ? sameBaseline : rollingBaseline;
  const baselineZero = dynamicBaseline !== null && dynamicBaseline <= 0;
  const insufficientSample = (early ? historical.length : rolling.length) < 10;
  const rawStrong = ratio !== null && ratio >= 2;
  return {
    symbol: row?.symbol ?? null,
    event_time: row?.event_time ?? row?.timestamp ?? null,
    outside_1m: Number.isFinite(outside) ? outside : null,
    inside_1m: Number.isFinite(inside) ? inside : null,
    total_1m: Number.isFinite(total) ? total : null,
    neutral_1m: Number.isFinite(Number(row?.neutral_1m)) ? Number(row.neutral_1m) : null,
    outside_strength: ratio === null ? null : Number(ratio.toFixed(6)),
    raw_outside_ratio: ratio === null ? null : Number(ratio.toFixed(6)),
    b14_raw_strong: rawStrong,
    b14_dynamic_strong: rawStrong,
    same_minute_baseline: sameBaseline,
    same_minute_strength_ratio: sameBaseline > 0 && ratio !== null ? Number((ratio / sameBaseline).toFixed(6)) : null,
    rolling20_baseline: rollingBaseline,
    rolling20_strength_ratio: rollingBaseline > 0 && ratio !== null ? Number((ratio / rollingBaseline).toFixed(6)) : null,
    baseline_method: early ? "SAME_MINUTE_HISTORICAL" : "ROLLING_20M_MEDIAN",
    baseline_value: dynamicBaseline,
    sample_count: early ? historical.length : rolling.length,
    side_volume_age_seconds: Number.isFinite(age) ? age : null,
    baseline_zero: baselineZero,
    insufficient_sample: insufficientSample,
    data_status: reasons.length || baselineZero || insufficientSample ? "DATA_GAP_SIDE_VOLUME" : "READY",
    reasons
  };
}

module.exports = { detect };
