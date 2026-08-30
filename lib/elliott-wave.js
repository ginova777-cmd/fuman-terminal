"use strict";

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function rowsOf(input) {
  return (Array.isArray(input) ? input : []).map((row, index) => ({
    index,
    date: String(row?.trade_date || row?.date || "").slice(0, 10),
    high: n(row?.high),
    low: n(row?.low),
  })).filter((row) => row.date && row.high > 0 && row.low > 0 && row.high >= row.low);
}

function pivotsOf(rows, thresholdPct) {
  const candidates = [];
  const window = Math.max(2, Math.min(4, Math.floor(rows.length / 35)));
  const first = rows[0];
  candidates.push({ index: first.index, date: first.date, price: first.low, type: "low" });
  for (let index = window; index < rows.length - window; index += 1) {
    const row = rows[index];
    const nearby = rows.slice(index - window, index + window + 1);
    if (nearby.every((item) => row.high >= item.high)) candidates.push({ index, date: row.date, price: row.high, type: "high" });
    if (nearby.every((item) => row.low <= item.low)) candidates.push({ index, date: row.date, price: row.low, type: "low" });
  }
  const last = rows.at(-1);
  candidates.push({ index: last.index, date: last.date, price: last.high, type: "high" });
  const reduced = [];
  for (const pivot of candidates.sort((left, right) => left.index - right.index)) {
    const previous = reduced.at(-1);
    if (!previous) { reduced.push(pivot); continue; }
    if (previous.type === pivot.type) {
      if ((pivot.type === "high" && pivot.price >= previous.price) || (pivot.type === "low" && pivot.price <= previous.price)) reduced[reduced.length - 1] = pivot;
      continue;
    }
    if (pivot.index - previous.index >= 2 && Math.abs((pivot.price - previous.price) / previous.price) * 100 >= thresholdPct) reduced.push(pivot);
  }
  return reduced;
}

function detectImpulse(pivots) {
  for (let start = Math.max(0, pivots.length - 10); start <= pivots.length - 6; start += 1) {
    const points = pivots.slice(start, start + 6);
    if (points.map((point) => point.type).join() !== "low,high,low,high,low,high") continue;
    const [p0, p1, p2, p3, p4, p5] = points;
    const w1 = p1.price - p0.price, w3 = p3.price - p2.price, w5 = p5.price - p4.price;
    const r2 = w1 > 0 ? (p1.price - p2.price) / w1 : 2, r4 = w3 > 0 ? (p3.price - p4.price) / w3 : 2;
    if (!(p2.price > p0.price && p3.price > p1.price && p4.price > p2.price && p5.price > p3.price)) continue;
    if (r2 <= 0.15 || r2 >= 0.9 || r4 <= 0.1 || r4 >= 0.75 || w3 < Math.min(w1, w5) * 0.9) continue;
    const confidence = Math.min(0.94, 0.65 + (w3 >= w1 ? 0.1 : 0) + (r2 <= 0.618 ? 0.07 : 0) + (r4 <= 0.5 ? 0.06 : 0));
    return { pattern: "impulse_1_5", direction: "bullish", points: points.map((point, index) => ({ ...point, label: String(index) })), confidence, invalidationPrice: p4.price, ratios: { wave2Retrace: r2, wave4Retrace: r4, wave3ToWave1: w3 / w1, wave5ToWave1: w5 / w1 } };
  }
  return null;
}

function detectCorrection(pivots) {
  for (let start = Math.max(0, pivots.length - 7); start <= pivots.length - 4; start += 1) {
    const points = pivots.slice(start, start + 4);
    if (points.map((point) => point.type).join() !== "high,low,high,low") continue;
    const [origin, a, b, c] = points;
    const legA = origin.price - a.price, rB = legA > 0 ? (b.price - a.price) / legA : 2, cToA = legA > 0 ? (b.price - c.price) / legA : 0;
    if (!(b.price < origin.price && c.price < a.price) || rB < 0.2 || rB > 0.9 || cToA < 0.5) continue;
    const confidence = Math.min(0.9, 0.6 + (rB <= 0.618 ? 0.1 : 0.04) + (cToA >= 0.8 && cToA <= 1.3 ? 0.12 : 0.04));
    return { pattern: "correction_abc", direction: "bearish", points: points.map((point, index) => ({ ...point, label: ["起", "A", "B", "C"][index] })), confidence, invalidationPrice: b.price, ratios: { bRetrace: rB, cToA } };
  }
  return null;
}

function detectElliottWave(input, options = {}) {
  const rows = rowsOf(input).slice(-Math.max(60, n(options.lookback) || 120));
  if (rows.length < 40) return { status: "DATA_GAP", reasonCode: "elliott_daily_rows_under_40", rowCount: rows.length, points: [] };
  const pivots = pivotsOf(rows, n(options.thresholdPct) || 4);
  const match = detectImpulse(pivots) || detectCorrection(pivots);
  if (!match) return { status: "ambiguous", reasonCode: "elliott_structure_not_confirmed", rowCount: rows.length, pivotCount: pivots.length, points: pivots.slice(-6) };
  return { status: match.confidence >= 0.82 ? "confirmed" : "probable", reasonCode: match.pattern === "impulse_1_5" ? "elliott_impulse_1_5" : "elliott_correction_abc", rowCount: rows.length, pivotCount: pivots.length, ...match };
}

module.exports = { detectElliottWave };
