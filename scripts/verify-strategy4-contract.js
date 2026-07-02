const scanStrategy4 = require("../api/scan-strategy4");

const DEFAULT_CODES = ["2330", "2317", "2382", "2454", "3017", "3037", "5274", "6446"];
const MIN_MATCHES = Number(process.env.STRATEGY4_CONTRACT_MIN_MATCHES || 3);
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

(async () => {
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
    !hasTriangleChartLines(item)
  );
  if (malformed) fail(`Strategy4 malformed match payload for ${malformed.code || "unknown code"}`, payload);
  console.log(`Strategy4 contract OK: ${matches.length}/${codes.length} seed codes matched`);
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
