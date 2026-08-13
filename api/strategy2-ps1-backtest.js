"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const REPORT_PATHS = [
  { path: path.join(RUNTIME_DIR, "data", "strategy2-ps1-backtest-latest.json"), origin: "runtime" },
  { path: path.join(ROOT, "data", "strategy2-ps1-backtest-latest.json"), origin: "bundled_production_snapshot" },
];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function taipeiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return [parts.year, parts.month, parts.day].join("-");
}

function expiresAtForTradeDate(tradeDate) {
  const date = String(tradeDate || "").slice(0, 10);
  const parsed = new Date(String(date) + "T16:00:00.000Z");
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function readReport() {
  for (const candidate of REPORT_PATHS) {
    try {
      if (!fs.existsSync(candidate.path)) continue;
      return { report: JSON.parse(fs.readFileSync(candidate.path, "utf8")), origin: candidate.origin };
    } catch {}
  }
  return null;
}

function responsePayload(report, origin) {
  const sourceChain = report?.sourceChain || {};
  const matches = Array.isArray(report?.matches) ? report.matches : [];
  const tradeDate = String(report?.tradeDate || "").slice(0, 10);
  return {
    ok: report?.ok === true,
    contract: "strategy2-ps1-validation-backtest-v1",
    kind: "validation_backtest",
    formalRun: false,
    publishAllowed: false,
    validationDisplayAllowed: true,
    reportOrigin: origin || "",
    sourceStatus: String(report?.sourceStatus || "historical_local_cache_readback"),
    tradeDate,
    expiresAt: expiresAtForTradeDate(tradeDate),
    generatedAt: report?.generatedAt || "",
    runId: report?.runId || "",
    sourceChain: {
      motherPool: {
        updatedAt: sourceChain?.motherPool?.updatedAt || "",
        count: number(sourceChain?.motherPool?.count),
        source: sourceChain?.motherPool?.source || "",
      },
      quotes: { updatedAt: sourceChain?.quotes?.updatedAt || "", count: number(sourceChain?.quotes?.count) },
      intraday1m: {
        updatedAt: sourceChain?.intraday1m?.updatedAt || "",
        count: number(sourceChain?.intraday1m?.count),
        source: sourceChain?.intraday1m?.source || "",
      },
    },
    scannedSymbols: number(report?.scannedSymbols),
    symbolsWithTodayCandles: number(report?.symbolsWithTodayCandles),
    matchedSymbols: number(report?.matchedSymbols),
    matchCount: number(report?.matchCount),
    dataGapCount: number(report?.dataGapCount),
    signalCounts: report?.signalCounts && typeof report.signalCounts === "object" ? report.signalCounts : {},
    matches: matches.slice(0, 900),
  };
}

module.exports = async (request, response) => {
  if (request.method && request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }
  const active = readReport();
  if (!active) {
    response.status(404).json({ ok: false, error: "strategy2_validation_backtest_not_ready" });
    return;
  }
  const payload = responsePayload(active.report, active.origin);
  const currentDate = taipeiDate();
  if (payload.tradeDate !== currentDate) {
    response.setHeader("Cache-Control", "no-store");
    response.status(410).json({
      ok: false,
      error: "strategy2_validation_backtest_expired",
      tradeDate: payload.tradeDate,
      currentDate,
      expiredAt: payload.expiresAt,
    });
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(payload);
};

module.exports.responsePayload = responsePayload;
module.exports.taipeiDate = taipeiDate;
module.exports.expiresAtForTradeDate = expiresAtForTradeDate;

