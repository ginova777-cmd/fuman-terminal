"use strict";

const fs = require("fs");
const path = require("path");
const { buildMarketCalendarContract } = require("../lib/market-calendar-contract");

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((item) => item === name || item.startsWith(prefix));
  if (!found) return fallback;
  if (found === name) return "1";
  return found.slice(prefix.length);
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function isoDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const digits = compactDate(text);
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return taipeiDate(date);
  return "";
}

function taipeiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDate(value) {
  const iso = isoDate(value);
  if (!iso) return new Date();
  return new Date(`${iso}T12:00:00+08:00`);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getByPath(source, dottedPath) {
  if (!source || !dottedPath) return undefined;
  return String(dottedPath).split(".").reduce((current, key) => {
    if (current == null) return undefined;
    return current[key];
  }, source);
}

function collectCandidateDates(payload, paths) {
  const candidates = [];
  for (const candidatePath of paths) {
    const value = getByPath(payload, candidatePath);
    const normalized = isoDate(value);
    if (normalized) candidates.push({ path: candidatePath, value, normalized });
  }
  return candidates;
}

function failPayload(base, reason, extra = {}) {
  return {
    ...base,
    ...extra,
    ok: false,
    status: "failed",
    action: "fail_closed",
    reason,
    publishAllowed: false,
    formalScanSkipped: true,
    preservePreviousGood: true,
    latestPointerUpdated: false,
    emptyResultWritten: false,
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
  };
}

async function buildPreflight(options = {}) {
  const runtimeDir = options.runtimeDir || process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
  const stateDir = options.stateDir || process.env.FUMAN_STATE_DIR || path.join(runtimeDir, "state");
  const label = options.label || argValue("--label", process.env.FUMAN_RUNNER_LABEL || "full-scan");
  const now = options.now || parseDate(options.date || argValue("--date", process.env.FUMAN_MARKET_CALENDAR_DATE || ""));
  const today = options.taipeiToday || taipeiDate(now);
  const contract = await buildMarketCalendarContract({ now, stateDir });
  const requestedTarget = isoDate(options.targetDate || argValue("--target-date", process.env.FUMAN_SCANNER_TARGET_DATE || process.env.FUMAN_SCANNER_TARGET_TRADE_DATE || ""));
  const scannerTargetDate = requestedTarget || contract.marketDate || today;
  const scannerTargetTradeDate = scannerTargetDate;
  const sourceDate = isoDate(options.sourceDate || argValue("--source-date", process.env.FUMAN_SOURCE_TRADE_DATE || process.env.FUMAN_SOURCE_TARGET_DATE || ""));
  const candidateFile = options.candidateFile || argValue("--candidate-file", process.env.FUMAN_DATE_CANDIDATE_FILE || "");
  const candidatePaths = String(options.candidatePaths || argValue("--candidate-paths", process.env.FUMAN_DATE_CANDIDATE_PATHS || "tradeDate,sourceTradeDate,marketDate,usedDate,latestDate,source.tradeDate,sourceSnapshot.tradeDate,run_quality_at_publish.tradeDate"))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const candidatePayload = readJson(candidateFile);
  const candidates = collectCandidateDates(candidatePayload, candidatePaths);
  const matchingCandidate = candidates.find((item) => item.normalized === scannerTargetDate) || null;
  const base = {
    ok: true,
    contract: "full-scan-date-preflight-v1",
    runner: label,
    label,
    checkedAt: new Date().toISOString(),
    taipeiToday: today,
    marketOpen: contract.marketOpen,
    marketStatus: contract.marketStatus,
    marketDate: contract.marketDate,
    requestedDate: contract.requestedDate,
    displayTradeDate: contract.displayTradeDate,
    closedReason: contract.closedReason,
    closedReasonText: contract.closedReasonText,
    scannerAction: contract.scannerAction,
    scannerTargetDate,
    scannerTargetTradeDate,
    sourceDate: sourceDate || null,
    sourceDateRequired: Boolean(sourceDate),
    candidateFile: candidateFile || null,
    candidateDatePaths: candidatePaths,
    candidateDates: candidates,
    selectedCandidateDate: matchingCandidate,
    env: {
      FUMAN_SCANNER_TARGET_DATE: scannerTargetDate,
      FUMAN_SCANNER_TARGET_TRADE_DATE: scannerTargetTradeDate,
      FUMAN_TERMINAL_TARGET_TRADE_DATE: scannerTargetDate,
      FUMAN_REQUIRE_SOURCE_DATE_MATCH: "1"
    },
    marketCalendar: contract
  };

  const allowClosedTargetRepair = process.env.FUMAN_ALLOW_CLOSED_TARGET_REPAIR === "1" && requestedTarget && scannerTargetDate === contract.displayTradeDate;
  if (!contract.marketOpen && allowClosedTargetRepair) {
    return {
      ...base,
      action: "allow_closed_target_repair",
      status: "ready",
      complete: true,
      formalScanSkipped: false,
      closedTargetRepair: true,
      sourceFreshnessRequired: false,
      preservePreviousGood: false,
      latestPointerUpdated: false,
      emptyResultWritten: false,
      publishAllowed: true,
      evidenceStatus: "complete",
      unattendedStatus: "REPAIR_ALLOWED",
      reason: "closed_day_target_repair_allowed",
      exitCode: 0
    };
  }

  if (!contract.marketOpen) {
    return {
      ...base,
      action: "skip_formal_scan",
      status: "market_closed",
      complete: true,
      formalScanSkipped: true,
      sourceFreshnessRequired: false,
      preservePreviousGood: true,
      latestPointerUpdated: false,
      emptyResultWritten: false,
      evidenceStatus: "market_closed",
      unattendedStatus: "SKIPPED_MARKET_CLOSED",
      reason: contract.closedReason || "market_closed",
      exitCode: 10
    };
  }

  if (scannerTargetDate !== today) {
    return failPayload(base, "scanner_target_date_not_taipei_today", {
      expectedDate: today,
      actualDate: scannerTargetDate,
      exitCode: 20
    });
  }

  if (contract.marketDate && contract.marketDate !== scannerTargetDate) {
    return failPayload(base, "market_calendar_date_not_scanner_target_date", {
      expectedDate: scannerTargetDate,
      actualDate: contract.marketDate,
      exitCode: 21
    });
  }

  if (sourceDate && sourceDate !== scannerTargetDate) {
    return failPayload(base, "source_trade_date_not_scanner_target_date", {
      expectedDate: scannerTargetDate,
      actualDate: sourceDate,
      exitCode: 22
    });
  }

  if (candidatePayload && candidates.length > 0 && !matchingCandidate) {
    return failPayload(base, "no_candidate_date_matches_scanner_target_date", {
      expectedDate: scannerTargetDate,
      exitCode: 23
    });
  }

  return {
    ...base,
    action: "allow_formal_scan",
    status: "ready",
    complete: true,
    formalScanSkipped: false,
    sourceFreshnessRequired: true,
    preservePreviousGood: false,
    latestPointerUpdated: false,
    emptyResultWritten: false,
    publishAllowed: true,
    evidenceStatus: "complete",
    unattendedStatus: "YES",
    reason: "date_preflight_ready",
    exitCode: 0
  };
}

async function main() {
  const runtimeDir = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
  const dataDir = process.env.FUMAN_DATA_DIR || path.join(runtimeDir, "data");
  const receipt = argValue("--receipt", "") === "1";
  const payload = await buildPreflight({ runtimeDir });
  if (receipt) {
    writeJson(path.join(dataDir, "scan-receipts", "full-scan-date-preflight.json"), payload);
  }
  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = payload.exitCode || 0;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify(failPayload({ checkedAt: new Date().toISOString() }, error?.message || String(error), { exitCode: 1 }), null, 2));
    process.exit(1);
  });
}

module.exports = {
  buildPreflight,
  normalizeDate: isoDate,
  taipeiDate
};



