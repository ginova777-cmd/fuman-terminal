"use strict";

const fs = require("fs");
const path = require("path");
const { classifyReason, hasCode } = require("../lib/terminal-reason-code-classifier");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-reason-code-classifier");
const OUT_FILE = path.join(OUT_DIR, "terminal-reason-code-classifier.json");

const FILES = {
  opsStatus: path.join(ROOT, "data", "terminal-ops-status-latest.json"),
  manifest: path.join(ROOT, "outputs", "daily-terminal-run", "daily-terminal-run-latest.json"),
  readiness: path.join(ROOT, "outputs", "production-unattended-readiness", "production-unattended-readiness-report.json"),
};

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function assert(condition, issue, details, issues) {
  if (!condition) issues.push({ issue, details });
}

function entry(source, id, payload, context = {}) {
  const classification = classifyReason(payload, context);
  return {
    source,
    id,
    codes: classification.codes.map((row) => row.code),
    primaryCode: classification.primaryCode,
    actions: [...new Set(classification.codes.map((row) => row.action))],
    layers: [...new Set(classification.codes.map((row) => row.layer))],
    severity: classification.codes.some((row) => row.severity === "critical") ? "critical" : classification.codes[0]?.severity || "warning",
    unknown: classification.unknown === true,
    sourceText: classification.sourceText,
  };
}

function add(entries, source, id, payload, context = {}) {
  if (!payload) return;
  entries.push(entry(source, id, payload, context));
}

function addIssueRows(entries, source, prefix, rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const issues = Array.isArray(row.issues) ? row.issues : [];
    if (row.ok === true && issues.length === 0 && row.pendingNotDue !== true && row.runIdClosureOk !== false && row.rawFallback !== true) continue;
    add(entries, source, `${prefix}:${row.key || row.label || row.name || row.id || "row"}`, row);
    for (const issue of issues) add(entries, source, `${prefix}:${row.key || "row"}:issue`, issue);
  }
}

function selfTest(issues) {
  const cases = [
    ["protected_readback_credential_not_armed", "AUTH_PROTECTED_READBACK_NOT_ARMED"],
    ["protected_surface_needs_authenticated_readback_token", "AUTH_PROTECTED_READBACK_NOT_ARMED"],
    ["unattended: /88 authenticated readback required (token not armed)", "AUTH_PROTECTED_READBACK_NOT_ARMED"],
    ["canonical_gate_not_A:D", "SOURCE_WATER_ROOT_NOT_READY"],
    ["manifest_raw_fallback_true", "SCANNER_RAW_FALLBACK"],
    ["manifest_evidence_not_complete:insufficient", "SCANNER_EVIDENCE_INSUFFICIENT"],
    ["manifest_publish_not_allowed", "PUBLISH_NOT_ALLOWED"],
    ["manifest_preserve_previous_good_true", "PREVIOUS_GOOD_PRESERVED"],
    ["pending_not_due:21:00", "SCHEDULE_PENDING_NOT_DUE"],
    ["production_release_sha_mismatch", "PRODUCTION_RELEASE_SHA_MISMATCH"],
    ["ROLL_FORWARD_QUEUE_ARMED", "AUTO_ROLL_FORWARD_QUEUE_ARMED"],
    ["scorecard_latestDate_mismatch:20260717!=20260721", "TRADE_DATE_MISMATCH"],
  ];
  for (const [text, expected] of cases) {
    const classification = classifyReason(text);
    assert(hasCode(classification, expected), "self_test_expected_code_missing", { text, expected, codes: classification.codes.map((row) => row.code) }, issues);
    assert(!classification.unknown, "self_test_unknown", { text, expected, classification }, issues);
  }
}

function collectEntries(opsStatus, manifest, readiness) {
  const entries = [];

  for (const blocker of opsStatus?.blockers || []) add(entries, "opsStatus", "blocker", blocker);
  for (const [gateKey, gate] of Object.entries(opsStatus?.gates || {})) {
    if (gate?.ok === false || gate?.reason) add(entries, "opsStatus", `gate:${gateKey}`, gate);
  }
  addIssueRows(entries, "opsStatus", "module", opsStatus?.modules || []);
  add(entries, "opsStatus", "protectedReadbackCredential", opsStatus?.protectedReadbackCredential || opsStatus?.gates?.protectedReadbackCredential);

  if (manifest?.waterRoot?.ok === false) add(entries, "manifest", "waterRoot", manifest.waterRoot);
  if (manifest?.ok === false || manifest?.unattendedStatus === "NO") add(entries, "manifest", "root", manifest);
  addIssueRows(entries, "manifest", "module", manifest?.modules || []);

  for (const blocker of readiness?.blockers || []) add(entries, "readiness", `blocker:${blocker.blocker || blocker.code || "row"}`, blocker);
  if (readiness?.waterRoot?.ok === false) add(entries, "readiness", "waterRoot", readiness.waterRoot);
  addIssueRows(entries, "readiness", "resourceChain", readiness?.resourceChain?.rows || []);
  addIssueRows(entries, "readiness", "dailyManifest", readiness?.dailyManifest?.modules || []);
  const membershipSummary = readiness?.resourceChain?.membershipProtectedSummary;
  if (membershipSummary && (membershipSummary.ok === false || membershipSummary.error || (membershipSummary.reason && String(membershipSummary.reason).toLowerCase() !== "ok") || membershipSummary.enabled === false)) {
    add(entries, "readiness", "membershipProtectedSummary", membershipSummary);
  }
  add(entries, "readiness", "protectedReadbackCredential", readiness?.protectedReadbackCredential);
  if (readiness?.releaseIdentity?.releaseSha && readiness.releaseIdentity.headSha && readiness.releaseIdentity.releaseSha !== readiness.releaseIdentity.headSha) {
    add(entries, "readiness", "releaseIdentity", "production_release_sha_mismatch");
  }

  return entries;
}

function findEntry(entries, source, idIncludes) {
  return entries.find((row) => row.source === source && row.id.includes(idIncludes));
}

function expectEntryCode(entries, source, idIncludes, code, issues) {
  const row = findEntry(entries, source, idIncludes);
  assert(Boolean(row), "expected_entry_missing", { source, idIncludes, code }, issues);
  if (row) assert(row.codes.includes(code), "expected_entry_code_missing", { source, idIncludes, code, row }, issues);
}

function main() {
  const issues = [];
  selfTest(issues);

  const opsStatus = readJson(FILES.opsStatus, null);
  const manifest = readJson(FILES.manifest, null);
  const readiness = readJson(FILES.readiness, null);
  assert(Boolean(opsStatus), "ops_status_artifact_missing", { file: FILES.opsStatus }, issues);
  assert(Boolean(manifest), "daily_manifest_artifact_missing", { file: FILES.manifest }, issues);

  if (opsStatus?.reasonCodeSummary) {
    assert(opsStatus.reasonCodeSummary.contract === "terminal-reason-code-summary-v1", "ops_status_reason_code_summary_contract_mismatch", { reasonCodeSummary: opsStatus.reasonCodeSummary }, issues);
    assert(opsStatus.reasonCodeSummary.ok === true && opsStatus.reasonCodeSummary.unknownEntries === 0, "ops_status_reason_code_summary_not_ok", { reasonCodeSummary: opsStatus.reasonCodeSummary }, issues);
  }
  const entries = collectEntries(opsStatus || {}, manifest || {}, readiness || {});
  for (const row of entries) {
    assert(row.unknown !== true, "reason_code_unknown", { source: row.source, id: row.id, sourceText: row.sourceText, codes: row.codes }, issues);
  }

  for (const key of ["strategy2", "strategy3", "strategy4"]) {
    const row = findEntry(entries, "manifest", `module:${key}`);
    if (row && /protected|auth|membership|bearer/i.test(row.sourceText)) {
      assert(row.codes.includes("AUTH_PROTECTED_READBACK_NOT_ARMED") || row.codes.includes("AUTH_PROTECTED_READBACK_NOT_OK"), "expected_entry_code_missing", { source: "manifest", idIncludes: `module:${key}`, code: "AUTH_PROTECTED_READBACK_NOT_ARMED", row }, issues);
    }
  }
  const manifestWaterRootEntry = findEntry(entries, "manifest", "waterRoot");
  if (manifestWaterRootEntry) {
    assert(manifestWaterRootEntry.codes.includes("SOURCE_WATER_ROOT_NOT_READY"), "expected_entry_code_missing", { source: "manifest", idIncludes: "waterRoot", code: "SOURCE_WATER_ROOT_NOT_READY", row: manifestWaterRootEntry }, issues);
  }
  if (readiness) {
    const releaseEntry = findEntry(entries, "readiness", "releaseIdentity");
    if (releaseEntry) assert(releaseEntry.codes.includes("PRODUCTION_RELEASE_SHA_MISMATCH"), "expected_entry_code_missing", { source: "readiness", idIncludes: "releaseIdentity", code: "PRODUCTION_RELEASE_SHA_MISMATCH", row: releaseEntry }, issues);
    const membershipEntry = findEntry(entries, "readiness", "membershipProtectedSummary");
    if (membershipEntry) assert(membershipEntry.codes.includes("AUTH_PROTECTED_READBACK_NOT_ARMED") || membershipEntry.codes.includes("AUTH_PROTECTED_READBACK_NOT_OK"), "expected_entry_code_missing", { source: "readiness", idIncludes: "membershipProtectedSummary", code: "AUTH_PROTECTED_READBACK_NOT_ARMED", row: membershipEntry }, issues);
  }

  const output = {
    ok: issues.length === 0,
    contract: "terminal-reason-code-classifier-verifier-v1",
    checkedAt: new Date().toISOString(),
    sources: Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, { file, exists: fs.existsSync(file) }])),
    summary: {
      entries: entries.length,
      criticalEntries: entries.filter((row) => row.severity === "critical").length,
      unknownEntries: entries.filter((row) => row.unknown).length,
      codes: [...new Set(entries.flatMap((row) => row.codes))].sort(),
    },
    entries,
    issues,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exit(1);
}

main();

