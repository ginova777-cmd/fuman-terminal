"use strict";

const CONTRACT = "canonical-reader-v1";
const DEFAULT_SURFACES = ["desktop", "mobile", "route88", "line", "telegram"];
const SESSION = Object.freeze({ CLOSED: "closed", PREOPEN: "preopen", INTRADAY: "intraday", POSTMARKET: "postmarket" });

function compactDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const part = (name) => parts.find((row) => row.type === name)?.value || "";
    return `${part("year")}${part("month")}${part("day")}`;
  }
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function taipeiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (name) => Number(parts.find((row) => row.type === name)?.value || 0);
  return { date: `${get("year")}${String(get("month")).padStart(2, "0")}${String(get("day")).padStart(2, "0")}`, minute: get("hour") * 60 + get("minute"), second: get("second") };
}

function resolveMarketContext({ now = new Date(), calendar = {} } = {}) {
  const clock = taipeiClock(now);
  const tradeDate = compactDate(calendar.tradeDate || calendar.trade_date || clock.date);
  const explicitTradingDay = calendar.isTradingDay ?? calendar.is_trading_day;
  const weekday = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).formatToParts(now).find((p) => p.type === "weekday")?.value ? new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(now) !== "Sat" && new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(now) !== "Sun" : true);
  const isTradingDay = explicitTradingDay === undefined ? Boolean(weekday) : explicitTradingDay === true;
  let session = SESSION.CLOSED;
  if (isTradingDay) {
    if (clock.minute >= 8 * 60 && clock.minute < 9 * 60) session = SESSION.PREOPEN;
    else if (clock.minute >= 9 * 60 && clock.minute <= 13 * 60 + 30) session = SESSION.INTRADAY;
    else if (clock.minute > 13 * 60 + 30 && clock.minute < 24 * 60) session = SESSION.POSTMARKET;
  }
  return { timezone: "Asia/Taipei", trade_date: tradeDate, is_trading_day: isTradingDay, session, observed_at: now.toISOString() };
}

function first(object, paths, fallback = undefined) {
  for (const path of paths) {
    const value = path.split(".").reduce((row, key) => row?.[key], object);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
}

function finite(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function boolean(value, fallback = false) {
  if (value === true || String(value).toLowerCase() === "true" || value === 1) return true;
  if (value === false || String(value).toLowerCase() === "false" || value === 0) return false;
  return fallback;
}
function rowsOf(payload) {
  for (const key of ["rows", "results", "matches", "items", "data", "records", "signals"]) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function normalizeEnvelope(payload = {}, surface = "unknown") {
  const rows = rowsOf(payload);
  const status = String(first(payload, ["status", "quality.status"], "")).toLowerCase();
  const explicitlyComplete = boolean(first(payload, ["complete"], false));
  const expected = finite(first(payload, ["coverage.expected", "coverage.total", "expectedCount", "expected_count", "universeCount", "universe_count"]));
  const covered = finite(first(payload, ["coverage.covered", "coverage.ready", "coveredCount", "covered_count", "scannedCount", "scanned_count"]));
  const ratioValue = finite(first(payload, ["coverage.ratio", "coverage.coverage", "coverageRatio", "coverage_ratio", "fresh_quote_coverage_120s"]));
  const coverageRatio = ratioValue !== null ? ratioValue : expected !== null && expected > 0 && covered !== null ? covered / expected : null;
  return {
    surface,
    trade_date: compactDate(first(payload, ["trade_date", "tradeDate", "scan_date", "scanDate", "sourceDate", "marketDate", "payload.tradeDate"])),
    canonical_run_id: String(first(payload, ["canonical_run_id", "canonicalRunId", "run_id", "runId", "transport.runId", "payload.runId"], "")),
    verification_run_id: String(first(payload, ["verification_run_id", "verificationRunId", "verification.run_id", "verification.runId", "receipt.verification_run_id"], "")),
    batch_id: String(first(payload, ["batch_id", "batchId", "delivery_batch_id", "deliveryBatchId", "publication.batch_id"], "")),
    receipt_id: String(first(payload, ["receipt_id", "receiptId", "receipt.id"], "")),
    contract_version: String(first(payload, ["contract_version", "contractVersion", "schema_version", "schemaVersion", "receipt.contract_version"], "")),
    field_version: String(first(payload, ["field_version", "fieldVersion", "fields_version", "fieldsVersion", "receipt.field_version"], "")),
    result_count: finite(first(payload, ["result_count", "resultCount", "count", "readbackCount"], rows.length)),
    generated_at: String(first(payload, ["generated_at", "generatedAt", "updated_at", "updatedAt", "finished_at", "finishedAt"], "")),
    age_seconds: finite(first(payload, ["freshness.age_seconds", "freshness.ageSeconds", "age_seconds", "ageSeconds", "stale_seconds", "staleSeconds"])),
    coverage: { expected, covered, ratio: coverageRatio },
    fallback_used: boolean(first(payload, ["fallback_used", "fallbackUsed", "fallback.used", "quality.fallbackUsed"])),
    fallback_source: String(first(payload, ["fallback_source", "fallbackSource", "fallback.source"], "")),
    // `ok=true` is transport/process evidence, not canonical completion proof.
    complete: status === "complete" && explicitlyComplete,
    raw: payload,
  };
}

function strategyPolicy(policy = {}) {
  return {
    strategy: String(policy.strategy || "unknown"),
    enabled: policy.enabled !== false,
    sessions: Array.isArray(policy.sessions) && policy.sessions.length ? policy.sessions : [SESSION.PREOPEN, SESSION.INTRADAY, SESSION.POSTMARKET],
    requires_intraday_5m: policy.requires_intraday_5m === true || policy.requiresIntraday5m === true,
    required_surfaces: Array.isArray(policy.required_surfaces) ? policy.required_surfaces : DEFAULT_SURFACES,
    max_age_seconds: { preopen: 300, intraday: 180, postmarket: 21600, ...(policy.max_age_seconds || {}) },
    min_coverage: { preopen: 0.9, intraday: 0.95, postmarket: 1, ...(policy.min_coverage || {}) },
    allow_fallback: policy.allow_fallback === true,
    contract_version: String(policy.contract_version || ""),
    field_version: String(policy.field_version || ""),
  };
}

function buildPublicationEnvelope(receipt = {}, data = {}) {
  const canonical = normalizeEnvelope(receipt, "receipt");
  const missing = ["trade_date", "canonical_run_id", "verification_run_id", "batch_id", "receipt_id", "contract_version", "field_version"].filter((field) => !canonical[field]);
  if (missing.length) throw new Error(`canonical_publication_identity_missing:${missing.join(",")}`);
  if (!canonical.complete) throw new Error("canonical_publication_receipt_not_complete");
  return Object.freeze({
    trade_date: canonical.trade_date,
    canonical_run_id: canonical.canonical_run_id,
    verification_run_id: canonical.verification_run_id,
    batch_id: canonical.batch_id,
    receipt_id: canonical.receipt_id,
    contract_version: canonical.contract_version,
    field_version: canonical.field_version,
    result_count: canonical.result_count,
    generated_at: canonical.generated_at,
    data,
  });
}

function readCanonicalBatch({ now = new Date(), calendar = {}, policy: rawPolicy = {}, receipt = {}, surfaces = {}, resources = {} } = {}) {
  const market = resolveMarketContext({ now, calendar });
  const policy = strategyPolicy(rawPolicy);
  const due = policy.enabled && market.is_trading_day && policy.sessions.includes(market.session);
  const canonical = normalizeEnvelope(receipt, "receipt");
  const normalizedSurfaces = Object.fromEntries(Object.entries(surfaces).map(([name, value]) => [name, normalizeEnvelope(value, name)]));
  const reasonCodes = [];
  const add = (reason) => { if (!reasonCodes.includes(reason)) reasonCodes.push(reason); };
  if (!due) return { contract: CONTRACT, market, policy, due: false, status: policy.enabled ? "not_due" : "disabled", canonical, surfaces: normalizedSurfaces, reason_codes: [], first_blocker: "", publish_allowed: false };

  if (!canonical.complete) add("receipt_not_complete");
  for (const field of ["trade_date", "canonical_run_id", "verification_run_id", "receipt_id", "contract_version", "field_version", "batch_id"]) if (!canonical[field]) add(`receipt_${field}_missing`);
  if (canonical.trade_date && canonical.trade_date !== market.trade_date) add("receipt_trade_date_mismatch");
  if (policy.contract_version && canonical.contract_version !== policy.contract_version) add("receipt_contract_version_mismatch");
  if (policy.field_version && canonical.field_version !== policy.field_version) add("receipt_field_version_mismatch");

  const maxAge = finite(policy.max_age_seconds[market.session]);
  const minCoverage = finite(policy.min_coverage[market.session]);
  if (canonical.age_seconds === null && canonical.generated_at) {
    const generatedAt = Date.parse(canonical.generated_at);
    if (Number.isFinite(generatedAt)) canonical.age_seconds = Math.max(0, Math.floor((now.getTime() - generatedAt) / 1000));
  }
  if (canonical.age_seconds === null) add("freshness_age_missing");
  else if (maxAge !== null && canonical.age_seconds > maxAge) add("freshness_stale");
  if (canonical.coverage.ratio === null) add("coverage_missing");
  else if (minCoverage !== null && canonical.coverage.ratio < minCoverage) add("coverage_below_threshold");
  if (canonical.fallback_used && !policy.allow_fallback) add("fallback_not_allowed");
  if (canonical.fallback_used && !canonical.fallback_source) add("fallback_source_missing");

  if (policy.requires_intraday_5m) {
    const fiveMinute = resources.intraday_5m || resources.intraday5m;
    if (!fiveMinute) add("intraday_5m_required_missing");
    else {
      const normalized5m = normalizeEnvelope(fiveMinute, "intraday_5m");
      if (normalized5m.canonical_run_id !== canonical.canonical_run_id) add("intraday_5m_canonical_run_mismatch");
    }
  }

  for (const name of policy.required_surfaces) {
    const surface = normalizedSurfaces[name];
    if (!surface) { add(`surface_${name}_missing`); continue; }
    for (const field of ["trade_date", "canonical_run_id", "verification_run_id", "batch_id", "contract_version", "field_version", "result_count"]) {
      if (surface[field] === "" || surface[field] === null) add(`surface_${name}_${field}_missing`);
      else if (String(surface[field]) !== String(canonical[field])) add(`surface_${name}_${field}_mismatch`);
    }
  }
  const publishAllowed = reasonCodes.length === 0;
  return { contract: CONTRACT, market, policy, due: true, status: publishAllowed ? "complete" : "blocked", canonical, surfaces: normalizedSurfaces, reason_codes: reasonCodes, first_blocker: reasonCodes[0] || "", publish_allowed: publishAllowed };
}

module.exports = { CONTRACT, DEFAULT_SURFACES, SESSION, buildPublicationEnvelope, compactDate, normalizeEnvelope, readCanonicalBatch, resolveMarketContext, strategyPolicy };
