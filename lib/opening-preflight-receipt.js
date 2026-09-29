"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function preserveVerifiedPreflight(previous, attempt) {
  return previous?.contract === "opening-report-0830-preflight-v2"
    && previous.ok === true && previous.frozen_market_snapshot_ok === true
    && previous.night_futures_ok === true && previous.overseas_detector_ok === true
    && previous.within_0830_preflight_window === true
    && attempt?.ok === false && attempt.within_0830_preflight_window === false
    && Boolean(previous.run_id) && previous.run_id === attempt.run_id
    && Boolean(previous.date) && previous.date === attempt.date
    && Boolean(previous.stage) && previous.stage === attempt.stage;
}

function writePreflightReceipt(file, attempt) {
  let previous;
  try { previous = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch {}
  const preserve = preserveVerifiedPreflight(previous, attempt);
  const output = preserve
    ? path.join(path.dirname(file), "attempts", `${path.basename(file, ".json")}-${Date.now()}-${crypto.randomUUID()}.json`)
    : file;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ...attempt, receipt_path: output,
    ...(preserve ? { preserved_verified_receipt: file } : {}) }, null, 2) + "\n", "utf8");
  return output;
}
module.exports = { preserveVerifiedPreflight, writePreflightReceipt };
