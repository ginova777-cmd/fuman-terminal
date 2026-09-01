#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_REQUIRED_SLOTS = ["0845", "0850"];

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function compactDate(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function valueOf(payload, names) {
  for (const name of names) {
    if (payload && payload[name] !== undefined && payload[name] !== null && payload[name] !== "") return payload[name];
  }
  return undefined;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFalse(value) {
  return value === false || value === "false" || value === 0 || value === "0";
}

function parseTaipeiMinute(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function slotWindow(slot) {
  if (slot === "0845") return { start: 8 * 60 + 45, end: 8 * 60 + 49 };
  if (slot === "0850") return { start: 8 * 60 + 50, end: 8 * 60 + 54 };
  return null;
}

function validateSlotReceipt({ slot, file, payload, tradeDate }) {
  const failures = [];
  if (!payload) return { ok: false, failures: [`missing_${slot}_futopt_natural_receipt:${file}`] };
  if (payload.ok !== true) {
    const blocker = String(payload.first_blocker || payload.reason_code || "source_receipt_not_ok");
    failures.push(`${slot}_source_receipt_not_ok:${blocker}`);
  }
  if (payload.reason_code === "producer_or_node_missing") failures.push(`${slot}_producer_or_node_missing`);

  const receiptDate = String(valueOf(payload, ["trade_date", "tradeDate", "date"]) || "");
  if (receiptDate !== tradeDate) failures.push(`${slot}_trade_date_mismatch:${receiptDate || "(empty)"}`);

  const captureSlot = String(valueOf(payload, ["capture_slot", "captureSlot", "slot"]) || slot);
  if (captureSlot && captureSlot !== slot) failures.push(`${slot}_capture_slot_mismatch:${captureSlot}`);

  const natural = valueOf(payload, ["natural_schedule_evidence", "naturalScheduleEvidence"]);
  if (natural !== true) failures.push(`${slot}_natural_schedule_evidence_not_true`);

  const uses0900 = valueOf(payload, ["uses_0900_data", "uses0900Data"]);
  if (!isFalse(uses0900)) failures.push(`${slot}_must_not_use_0900_data`);

  const formalCount = number(valueOf(payload, ["formal_candidate_count", "formalCandidateCount"])) ?? 0;
  if (formalCount !== 0) failures.push(`${slot}_formal_candidate_count_must_be_0`);

  const publishAllowed = valueOf(payload, ["publish_allowed", "publishAllowed"]);
  if (!isFalse(publishAllowed)) failures.push(`${slot}_publish_allowed_must_be_false`);

  const checkedAt = valueOf(payload, ["checked_at", "checkedAt", "captured_at", "capturedAt"]);
  const minute = parseTaipeiMinute(checkedAt);
  const window = slotWindow(slot);
  if (window && minute !== null && (minute < window.start || minute > window.end)) {
    failures.push(`${slot}_checked_at_outside_natural_window`);
  }

  const nearRows = number(valueOf(payload.near_one || payload.nearOne || payload, ["ready_symbols", "readySymbols", "rows", "row_count", "rowCount"]));
  const positiveRows = number(valueOf(payload.positive_basis || payload.positiveBasis || payload, ["symbol_count", "symbolCount"]));
  return {
    ok: failures.length === 0,
    failures,
    readback: {
      path: file,
      ok: payload.ok ?? null,
      trade_date: receiptDate || null,
      capture_slot: captureSlot || null,
      checked_at: checkedAt || null,
      natural_schedule_evidence: natural ?? null,
      uses_0900_data: uses0900 ?? null,
      near_one_ready_symbols: nearRows,
      positive_basis_symbol_count: positiveRows,
      reason_code: payload.reason_code || null,
      first_blocker: payload.first_blocker || null,
    },
  };
}

function main() {
  const tradeDate = arg("trade-date", taipeiDate());
  const runtimeDir = arg("runtime-dir", process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime");
  const requestedSlots = arg("slots", "").split(",").map((value) => value.trim()).filter(Boolean);
  const requiredSlots = requestedSlots.length ? requestedSlots : DEFAULT_REQUIRED_SLOTS;
  if (requiredSlots.some((slot) => !DEFAULT_REQUIRED_SLOTS.includes(slot))) throw new Error("unsupported_futopt_slot");
  const compact = compactDate(tradeDate);
  const receiptDir = path.join(runtimeDir, "data", "scan-receipts");
  const outputDir = path.join(runtimeDir, "data", "opening-limit-order");
  const paths = Object.fromEntries(requiredSlots.map((slot) => [
    slot,
    path.join(receiptDir, `daytrade-futopt-preopen-evidence-${slot}-${compact}.json`),
  ]));

  const failures = [];
  const slotReadback = {};
  for (const slot of requiredSlots) {
    const file = paths[slot];
    const payload = readJson(file);
    const result = validateSlotReceipt({ slot, file, payload, tradeDate });
    slotReadback[slot] = result.readback || { path: file, ok: false };
    failures.push(...result.failures);
  }

  const payload = {
    ok: failures.length === 0,
    contract: "opening_limit_order_futopt_natural_evidence_verifier_v1",
    trade_date: tradeDate,
    checked_at: new Date().toISOString(),
    required_slots: requiredSlots,
    evidence_window: "08:45:00-08:50:59 Asia/Taipei, natural scheduled receipt only",
    source_paths: paths,
    readback: slotReadback,
    action_guard: {
      creates_order: false,
      creates_formal_candidate: false,
      publish_allowed: false,
      requires_second_confirm_before_action: true,
    },
    formal_candidate_count: 0,
    formal_candidate_allowed: false,
    publish_allowed: false,
    failures,
    first_blocker: failures[0] || null,
    reason_code: failures.length === 0
      ? "futopt_preopen_natural_evidence_verified"
      : "futopt_preopen_natural_evidence_missing_or_invalid",
    allowed_action: failures.length === 0
      ? "apply_futopt_trial_weight"
      : "rank_without_futopt_trial_weight",
  };

  writeJson(path.join(outputDir, `opening-limit-order-futopt-natural-evidence-verifier-${compact}.json`), payload);
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

main();
