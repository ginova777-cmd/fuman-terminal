const handler = require("../api/scan-strategy4");

const scanStrategy4 = handler.scanStrategy4;

function dateAt(index) {
  const date = new Date(Date.UTC(2026, 0, 2 + index));
  return date.toISOString().slice(0, 10);
}

function makeRow(index, open, high, low, close, volume = 5200) {
  return {
    date: dateAt(index),
    open,
    high,
    low,
    close,
    volume,
    volumeUnit: "lots",
    value: close * volume * 1000,
  };
}

function makeTriangleRows() {
  const rows = [];
  for (let index = 0; index < 48; index += 1) {
    const close = 82 + index * 0.42;
    rows.push(makeRow(index, close - 0.3, close + 1.2, close - 1.1, close, 4800));
  }

  for (let index = 0; index < 36; index += 1) {
    const high = 118 - index * 0.24;
    const low = 92 + index * 0.25;
    const close = low + (high - low) * 0.52;
    rows.push(makeRow(rows.length, close - 0.25, high, low, close, 5000));
  }

  rows.push(makeRow(rows.length, 111.8, 114.8, 110.9, 114.2, 8300));
  return rows;
}

function fail(message, payload) {
  if (payload) console.error(JSON.stringify(payload, null, 2));
  throw new Error(message);
}

const result = scanStrategy4("9999", "TWSE", makeTriangleRows(), "synthetic-local");
if (!result) fail("Strategy4 synthetic triangle result was null");
if (!result.triangleBreakout?.detected) fail("Triangle breakout was not detected", result.triangleBreakout);
if (!result.signals?.some((signal) => signal.id === "triangle_breakout")) {
  fail("triangle_breakout signal missing", result.signals);
}

const lines = result.triangleBreakout.chartLines;
if (!Array.isArray(lines?.upperResistance?.points) || lines.upperResistance.points.length < 3) {
  fail("upper resistance chart line missing", lines);
}
if (!Array.isArray(lines?.lowerSupport?.points) || lines.lowerSupport.points.length < 3) {
  fail("lower support chart line missing", lines);
}
if (!lines?.breakoutMarker?.date || !Number.isFinite(Number(lines.breakoutMarker.price))) {
  fail("breakout marker missing", lines);
}
if (!Array.isArray(result.triangleBreakout.chartCandles) || result.triangleBreakout.chartCandles.length < 20) {
  fail("triangle chartCandles missing", result.triangleBreakout);
}
const malformedCandle = result.triangleBreakout.chartCandles.find((item) =>
  !item.date ||
  !Number.isFinite(Number(item.open)) ||
  !Number.isFinite(Number(item.high)) ||
  !Number.isFinite(Number(item.low)) ||
  !Number.isFinite(Number(item.close))
);
if (malformedCandle) fail("triangle chartCandles malformed", malformedCandle);

console.log(JSON.stringify({
  ok: true,
  code: result.code,
  score: result.score,
  signalIds: result.signals.map((signal) => signal.id),
  triangleBreakout: {
    detected: result.triangleBreakout.detected,
    status: result.triangleBreakout.status,
    resistance: result.triangleBreakout.resistance,
    support: result.triangleBreakout.support,
    breakoutPrice: result.triangleBreakout.breakoutPrice,
    compressionRatio: result.triangleBreakout.compressionRatio,
    volumeRatio20: result.triangleBreakout.volumeRatio20,
    chartCandles: result.triangleBreakout.chartCandles.length,
    chartLines: result.triangleBreakout.chartLines,
  },
}, null, 2));
