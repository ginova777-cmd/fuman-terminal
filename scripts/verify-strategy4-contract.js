const scanStrategy4 = require("../api/scan-strategy4");
const fs = require("fs");
const path = require("path");

const DEFAULT_CODES = ["2330", "2317", "2382", "2454", "3017", "3037", "5274", "6446"];
const MIN_MATCHES = Number(process.env.STRATEGY4_CONTRACT_MIN_MATCHES || 0);
const codes = String(process.env.STRATEGY4_CONTRACT_CODES || DEFAULT_CODES.join(","))
  .split(",")
  .map((code) => code.replace(/\D/g, "").slice(0, 4))
  .filter((code) => /^\d{4}$/.test(code));

function callHandler() {
  return new Promise((resolve, reject) => {
    const req = { method: "GET", query: { codes: codes.join(",") } };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) {
        if (this.statusCode >= 400) reject(new Error(payload?.error || `HTTP ${this.statusCode}`));
        else resolve(payload);
      },
      end() { resolve({ ok: false, matches: [] }); },
    };
    Promise.resolve(scanStrategy4(req, res)).catch(reject);
  });
}

function fail(message, payload) {
  if (payload) {
    console.error(JSON.stringify({
      count: payload.count,
      matches: (payload.matches || []).slice(0, 5).map((item) => ({
        code: item.code,
        score: item.score,
        swingZone: item.swingZone,
        priceSource: item.priceSource,
        signalCount: Array.isArray(item.signals) ? item.signals.length : 0,
      })),
      sourceCounts: payload.sourceCounts || {},
      noDataCodes: payload.noDataCodes || [],
      errors: payload.errors || [],
    }, null, 2));
  }
  throw new Error(message);
}

function hasTriangleChartLines(item) {
  const triangle = item?.triangleBreakout;
  const lines = triangle?.chartLines;
  const upper = lines?.upperResistance?.points;
  const lower = lines?.lowerSupport?.points;
  const marker = lines?.breakoutMarker;
  return triangle && typeof triangle === "object" &&
    lines && typeof lines === "object" &&
    Array.isArray(upper) &&
    upper.length >= 3 &&
    Array.isArray(lower) &&
    lower.length >= 3 &&
    marker &&
    marker.date &&
    Number.isFinite(Number(marker.price));
}

function hasDailyTechnicalGate(item = {}) {
  const gate = item.dailyTechnicalGate && typeof item.dailyTechnicalGate === "object" ? item.dailyTechnicalGate : {};
  const mutaki = item.mutakiV17 && typeof item.mutakiV17 === "object" ? item.mutakiV17 : {};
  return gate.contract === "strategy4_daily_kd_rsi_trend_gate_v1"
    && gate.ok === true
    && gate.kdTrendUp === true
    && gate.rsiTrendUp === true
    && mutaki.dailyTechnicalGateOk === true
    && mutaki.kdTrendUp === true
    && mutaki.rsiTrendUp === true
    && Number.isFinite(Number(mutaki.kdK))
    && Number.isFinite(Number(mutaki.kdD))
    && Number.isFinite(Number(mutaki.rsi14))
    && Number.isFinite(Number(mutaki.rsi14Prev));
}

function verifyStaticContracts() {
  const root = path.resolve(__dirname, "..");
  const cacheSource = fs.readFileSync(path.join(root, "scripts", "scan-strategy4-cache.js"), "utf8");
  const apiSource = fs.readFileSync(path.join(root, "api", "scan-strategy4.js"), "utf8");
  if (!cacheSource.includes("strategy4_actionable_patterns_avg5_3000_daily_kd_rsi_trend_gate_v3")) {
    fail("Strategy4 cache runner is not using daily KD/RSI v3 result contract");
  }
  if (!apiSource.includes("strategy4_daily_kd_rsi_trend_gate_v1") || !apiSource.includes("dailyTechnicalGate")) {
    fail("Strategy4 API missing daily KD/RSI technical gate");
  }
}

(async () => {
  verifyStaticContracts();
  if (codes.length < 3) fail("Strategy4 contract needs at least 3 seed codes");
  const payload = await callHandler();
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  if (payload?.ok !== true) fail("Strategy4 handler did not return ok=true", payload);
  if (Number(payload?.count || 0) !== matches.length) fail("Strategy4 count does not match matches.length", payload);
  if (!payload?.sourceCounts || !Object.keys(payload.sourceCounts).length) fail("Strategy4 sourceCounts missing from handler payload", payload);
  if (matches.length < MIN_MATCHES) {
    fail(`Strategy4 contract returned too few matches: ${matches.length}/${codes.length}, minimum ${MIN_MATCHES}`, payload);
  }
  const malformed = matches.find((item) =>
    !/^\d{4}$/.test(String(item?.code || "")) ||
    !Number.isFinite(Number(item?.score)) ||
    !Array.isArray(item?.signals) ||
    !item.signals.length ||
    !item.priceSource ||
    !item.reason ||
    !hasDailyTechnicalGate(item) ||
    (item.patternTags?.includes?.("triangle_breakout") && !hasTriangleChartLines(item))
  );
  if (malformed) fail(`Strategy4 malformed match payload for ${malformed.code || "unknown code"}`, payload);
  console.log(`Strategy4 contract OK: seed smoke test ${matches.length}/${codes.length}; daily KD/RSI gate enforced`);
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
