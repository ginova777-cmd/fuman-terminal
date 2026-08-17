"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = "C:/fuman-terminal";
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const LEGACY_ROOT_PATTERN = /strategy2-v2-production-release-20260814|Documents[\\/]+Codex[\\/]+strategy2-v2/i;
const CONTRACT_VERSION = "strategy3-v2-clean-chain-v1";
const STRATEGY = "strategy3_v2";
const RUN_ID_PREFIX = "strategy3v2";
const RESULTS_TABLE = process.env.STRATEGY3_V2_RESULTS_TABLE || "strategy3_v2_scan_results";
const RUNS_TABLE = process.env.STRATEGY3_V2_RUNS_TABLE || "strategy3_v2_scan_runs";
const LATEST_VIEW = process.env.STRATEGY3_V2_LATEST_VIEW || "v_strategy3_v2_latest_complete_run";
const MIN_READY_SYMBOLS = Math.max(1000, Number(process.env.STRATEGY3_V2_MIN_READY_SYMBOLS || 1000));
const MIN_CANDLES_PER_SYMBOL = Math.max(20, Number(process.env.STRATEGY3_V2_MIN_CANDLES_PER_SYMBOL || 20));
const ENTRY_WINDOW = "12:59-13:02";

function taipeiDate(date = new Date(), compact = false) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const v = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return compact ? `${v.year}${v.month}${v.day}` : `${v.year}-${v.month}-${v.day}`;
}

function nowTaipeiIso() {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Taipei", hour12: false }).replace(" ", "T") + "+08:00";
}

function newRunId(date = taipeiDate(new Date(), true)) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${RUN_ID_PREFIX}-${date}-${stamp}`;
}

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

function scanReceiptPath(date = taipeiDate(new Date(), true)) {
  return path.join(RUNTIME_DIR, "data", "scan-receipts", `strategy3-v2-complete-scan-${date}.json`);
}

function lineReceiptPath(date = taipeiDate(new Date(), true), suffix = "") {
  return path.join(RUNTIME_DIR, "data", "line-cards", `strategy3-v2-line-card-${date}${suffix}.json`);
}

function failClosed(reason, extra = {}) {
  return {
    ok: false,
    strategy: STRATEGY,
    contract: CONTRACT_VERSION,
    status: "FAIL_CLOSED",
    reason_code: reason,
    formal_allowed: false,
    publish_allowed: false,
    line_allowed: false,
    ...extra,
  };
}

module.exports = {
  ROOT,
  RUNTIME_DIR,
  LEGACY_ROOT_PATTERN,
  CONTRACT_VERSION,
  STRATEGY,
  RUN_ID_PREFIX,
  RESULTS_TABLE,
  RUNS_TABLE,
  LATEST_VIEW,
  MIN_READY_SYMBOLS,
  MIN_CANDLES_PER_SYMBOL,
  ENTRY_WINDOW,
  taipeiDate,
  nowTaipeiIso,
  newRunId,
  readJson,
  writeJson,
  scanReceiptPath,
  lineReceiptPath,
  failClosed,
};