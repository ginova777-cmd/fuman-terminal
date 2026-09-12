"use strict";

const CONTRACT = "opening-report-0830-mother-pool-evidence-v2";
const SOURCE = "opening_report_0830";
const MODE = "priority_bias_only";
const REASON_CODE = "opening_report_0830_industry_bias";
const TAIWAN_MARKETS = new Set(["TW", "TWSE", "TPEX"]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeIndustry(value) {
  return String(value || "").trim();
}

function normalizeRank(value) {
  const rank = Number(value);
  return Number.isInteger(rank) && rank >= 1 && rank <= 3 ? rank : null;
}

function reportRunIdFromPayload(payload) {
  const row = asObject(payload);
  const explicit = String(row.report_run_id || "").trim();
  if (explicit) return explicit;
  const runId = String(row.run_id || "").trim();
  const industry = normalizeIndustry(row.industry);
  const suffix = industry ? `-${industry}` : "";
  return suffix && runId.endsWith(suffix) ? runId.slice(0, -suffix.length) : runId;
}

function observationFromPayload(payload) {
  const row = asObject(payload);
  const industry = normalizeIndustry(row.industry);
  const rank = normalizeRank(row.priority_observation_rank ?? row.positive_return_rank);
  if (!industry || !rank) return null;
  return {
    industry,
    display_name: String(row.display_name || "").trim(),
    run_id: String(row.run_id || "").trim(),
    source: String(row.source || SOURCE).trim(),
    mode: String(row.mode || MODE).trim(),
    priority_observation_basis: String(row.priority_observation_basis || "").trim(),
    priority_observation_rank: rank,
    priority_overseas_leaders: Array.isArray(row.priority_overseas_leaders) ? row.priority_overseas_leaders : [],
    bias: String(row.bias || "").trim(),
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
    evidence_summary: String(row.evidence_summary || "").trim(),
    bridge_receipt_path: String(row.bridge_receipt_path || row.bridgeReceiptPath || "").trim(),
  };
}

function observationsFromEvidence(evidence) {
  const row = asObject(evidence);
  if (Array.isArray(row.industry_observations) || Array.isArray(row.observations)) {
    return (row.industry_observations || row.observations).map(observationFromPayload).filter(Boolean);
  }
  const legacy = observationFromPayload(row);
  return legacy ? [legacy] : [];
}

function mergeOpeningReportEvidence(previousEvidence, payloads) {
  const inputs = (Array.isArray(payloads) ? payloads : [payloads]).map(asObject).filter((row) => Object.keys(row).length > 0);
  if (!inputs.length) return null;
  const first = inputs[0];
  const date = String(first.date || "").slice(0, 10);
  const reportRunId = reportRunIdFromPayload(first);
  const previous = asObject(previousEvidence);
  const previousReportRunId = String(previous.report_run_id || reportRunIdFromPayload(previous) || "").trim();
  const canReusePrevious = previous.date === date && previousReportRunId === reportRunId;
  const byIndustry = new Map();
  if (canReusePrevious) {
    for (const observation of observationsFromEvidence(previous)) byIndustry.set(observation.industry, observation);
  }
  for (const input of inputs) {
    if (String(input.date || "").slice(0, 10) !== date || reportRunIdFromPayload(input) !== reportRunId) continue;
    const observation = observationFromPayload(input);
    if (observation) byIndustry.set(observation.industry, observation);
  }
  const observations = [...byIndustry.values()].sort((a, b) => a.priority_observation_rank - b.priority_observation_rank || a.industry.localeCompare(b.industry));
  if (!observations.length) return null;
  const primary = observations[0];
  return {
    contract: CONTRACT,
    date,
    report_time: "08:30",
    report_run_id: reportRunId,
    run_id: reportRunId,
    source: SOURCE,
    mode: MODE,
    industry: primary.industry,
    display_name: primary.display_name,
    linked_industries: observations.map((row) => row.industry),
    industry_observations: observations,
    observations,
    highest_industry_rank: primary.priority_observation_rank,
    priority_observation_basis: primary.priority_observation_basis,
    priority_observation_rank: primary.priority_observation_rank,
    priority_overseas_leaders: primary.priority_overseas_leaders,
    bias: primary.bias,
    confidence: primary.confidence,
    evidence_summary: primary.evidence_summary,
    boost_once: true,
    reason_code: REASON_CODE,
    status: "watchlist_boosted",
    formal_candidate: false,
    formal_candidate_allowed: false,
    forbidden_publish_guard: true,
  };
}

function isTaiwanMarket(value) {
  return TAIWAN_MARKETS.has(String(value || "").trim().toUpperCase());
}

function validateEvidenceForPayload(evidence, expectedPayload, expectedReportRunId = "") {
  const issues = [];
  const row = asObject(evidence);
  const expected = asObject(expectedPayload);
  if (!Object.keys(row).length) return ["opening_report_evidence_missing"];
  if (row.contract !== CONTRACT) issues.push("evidence_contract_mismatch");
  if (row.date !== expected.date) issues.push("evidence_date_mismatch");
  if (row.report_time !== "08:30") issues.push("evidence_report_time_mismatch");
  if (row.source !== SOURCE) issues.push("evidence_source_mismatch");
  if (row.mode !== MODE) issues.push("evidence_mode_mismatch");
  if (row.reason_code !== REASON_CODE) issues.push("evidence_reason_code_mismatch");
  if (expectedReportRunId && row.report_run_id !== expectedReportRunId) issues.push("evidence_report_run_id_mismatch");
  if (row.boost_once !== true) issues.push("evidence_boost_once_mismatch");
  if (row.status !== "watchlist_boosted") issues.push("evidence_status_mismatch");
  if (row.formal_candidate !== false) issues.push("evidence_formal_candidate_mismatch");
  if (row.formal_candidate_allowed !== false) issues.push("evidence_formal_candidate_allowed_mismatch");
  if (row.forbidden_publish_guard !== true) issues.push("evidence_forbidden_publish_guard_mismatch");
  const observations = observationsFromEvidence(row);
  const match = observations.find((observation) => observation.industry === expected.industry);
  if (!match) return [...issues, "payload_industry_observation_missing"];
  if (match.run_id !== expected.run_id) issues.push("payload_run_id_mismatch");
  if (match.source !== SOURCE) issues.push("payload_source_mismatch");
  if (match.mode !== MODE) issues.push("payload_mode_mismatch");
  if (match.display_name !== String(expected.display_name || "").trim()) issues.push("payload_display_name_mismatch");
  if (match.priority_observation_basis !== expected.priority_observation_basis) issues.push("payload_priority_observation_basis_mismatch");
  if (match.priority_observation_rank !== Number(expected.priority_observation_rank)) issues.push("payload_priority_observation_rank_mismatch");
  if (match.bias !== String(expected.bias || "").trim()) issues.push("payload_bias_mismatch");
  if (match.confidence !== Number(expected.confidence)) issues.push("payload_confidence_mismatch");
  if (match.evidence_summary !== String(expected.evidence_summary || "").trim()) issues.push("payload_evidence_summary_mismatch");
  if (JSON.stringify(match.priority_overseas_leaders) !== JSON.stringify(Array.isArray(expected.priority_overseas_leaders) ? expected.priority_overseas_leaders : [])) issues.push("payload_priority_overseas_leaders_mismatch");
  if (!Array.isArray(row.linked_industries) || !row.linked_industries.includes(expected.industry)) issues.push("payload_linked_industries_mismatch");
  return [...new Set(issues)];
}

module.exports = {
  CONTRACT,
  MODE,
  REASON_CODE,
  SOURCE,
  TAIWAN_MARKETS,
  isTaiwanMarket,
  mergeOpeningReportEvidence,
  observationFromPayload,
  observationsFromEvidence,
  reportRunIdFromPayload,
  validateEvidenceForPayload,
};
