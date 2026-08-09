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
    ["natural_warmup_gate_not_a", "NATURAL_WARMUP_EVIDENCE_NOT_OK"],
    ["reason_code=natural_warmup_recovered_after_failed_checkpoint allowed_action=run_rewater_verification_then_roll_forward_without_counting_natural_unattended_yes", "NATURAL_WARMUP_RECOVERED_AFTER_FAILED_CHECKPOINT"],
    ["reason_code=natural_warmup_websocket_not_ready allowed_action=restart_fugle_websocket_source_then_run_rewater_verification", "NATURAL_WARMUP_WEBSOCKET_NOT_READY"],
    ["natural_warmup_daytrade_source_not_ready", "NATURAL_WARMUP_DAYTRADE_SOURCE_NOT_READY"],
    ["natural_warmup_canonical_gate_not_ready", "NATURAL_WARMUP_CANONICAL_GATE_NOT_READY"],
    ["natural_warmup_futopt_txf_not_ready", "NATURAL_WARMUP_FUTOPT_TXF_NOT_READY"],
    ["first_blocker=natural_evidence reason_code=natural_warmup_gate_not_a", "NATURAL_WARMUP_EVIDENCE_NOT_OK"],
    ["manifest_raw_fallback_true", "SCANNER_RAW_FALLBACK"],
    ["manifest_evidence_not_complete:insufficient", "SCANNER_EVIDENCE_INSUFFICIENT"],
    ["manifest_publish_not_allowed", "PUBLISH_NOT_ALLOWED"],
    ["manifest_preserve_previous_good_true", "PREVIOUS_GOOD_PRESERVED"],
    ["pending_not_due:21:00", "SCHEDULE_PENDING_NOT_DUE"],
    ["protected_readback_timeout", "PROTECTED_READBACK_TIMEOUT"],
    ["production_release_sha_mismatch", "PRODUCTION_RELEASE_SHA_MISMATCH"],
    ["local_worktree_not_production_release", "LOCAL_WIP_NOT_DEPLOYED"],
    ["reason:websocket", "WEBSOCKET_SOURCE_NOT_READY"],
    ["stock_universe_1m", "SOURCE_WARMUP_PENDING"],
    ["mother_pool", "SOURCE_WARMUP_PENDING"],
    ["reason:mother_pool | state:PENDING_NOT_DUE", "SOURCE_WARMUP_PENDING"],
    ["reason:stock_universe_1m | status:BLOCKED", "SOURCE_WARMUP_PENDING"],
    ["ROLL_FORWARD_QUEUE_ARMED", "AUTO_ROLL_FORWARD_QUEUE_ARMED"],
    ["scorecard_latestDate_mismatch:20260717!=20260721", "TRADE_DATE_MISMATCH"],
    ["Supabase latest date 20260724 != expected 20260726", "TRADE_DATE_MISMATCH"],
    ["refresh_failed:resource_chain_readback", "RESOURCE_CHAIN_NOT_OK"],
    ["refresh_failed:ops_status_snapshot", "OPS_STATUS_SNAPSHOT_NOT_READY"],
    ["refresh_failed:recovery_queue", "RECOVERY_QUEUE_NOT_OK"],
    ["live API 200", "READBACK_STATUS_OK"],
    ["terminal API 200", "READBACK_STATUS_OK"],
    ["scorecard:manifest_pending_publish_deferred", "PUBLISH_DEFERRED_MANIFEST_PENDING"],
  ];
  for (const [text, expected] of cases) {
    const classification = classifyReason(text);
    assert(hasCode(classification, expected), "self_test_expected_code_missing", { text, expected, codes: classification.codes.map((row) => row.code) }, issues);
    assert(!classification.unknown, "self_test_unknown", { text, expected, classification }, issues);
  }
}

function collectEntries(opsStatus, manifest, readiness) {
  const entries = [];

  if (opsStatus?.reasonCode || opsStatus?.reason_code || opsStatus?.firstBlocker || opsStatus?.first_blocker || opsStatus?.allowedAction || opsStatus?.allowed_action) {
    add(entries, "opsStatus", "root", {
      state: opsStatus.state,
      firstBlocker: opsStatus.firstBlocker || opsStatus.first_blocker,
      reasonCode: opsStatus.reasonCode || opsStatus.reason_code,
      allowedAction: opsStatus.allowedAction || opsStatus.allowed_action,
      reason: opsStatus.reason,
    });
  }
  for (const blocker of opsStatus?.blockers || []) add(entries, "opsStatus", "blocker", blocker);
  for (const [gateKey, gate] of Object.entries(opsStatus?.gates || {})) {
    if (gate?.ok === false || gate?.reason) add(entries, "opsStatus", `gate:${gateKey}`, gate);
  }
  addIssueRows(entries, "opsStatus", "module", opsStatus?.modules || []);
  const opsProtectedReadback = opsStatus?.protectedReadbackCredential || opsStatus?.gates?.protectedReadbackCredential;
  if (opsProtectedReadback && (opsProtectedReadback.ok !== true || opsProtectedReadback.armed === false || (Array.isArray(opsProtectedReadback.failures) && opsProtectedReadback.failures.length))) {
    add(entries, "opsStatus", "protectedReadbackCredential", opsProtectedReadback);
  }

  if (manifest?.waterRoot?.ok === false) add(entries, "manifest", "waterRoot", manifest.waterRoot);
  if (manifest?.ok === false || manifest?.unattendedStatus === "NO") add(entries, "manifest", "root", manifest);
  addIssueRows(entries, "manifest", "module", manifest?.modules || []);

  for (const blocker of readiness?.blockers || []) {
    const blockerKey = String(blocker?.blocker || blocker?.code || blocker?.issue || "row");
    // The readiness report refreshes this verifier as part of its own build.
    // Ignore self-diagnostic classifier blockers so a half-written report after
    // power loss cannot permanently poison the next final audit.
    if (/reason[_-]?code[_-]?classifier/i.test(blockerKey)) continue;
    if (/reasonCodeClassifier/i.test(blockerKey)) continue;
    add(entries, "readiness", `blocker:${blockerKey}`, blocker);
  }
  if (readiness?.waterRoot?.ok === false) add(entries, "readiness", "waterRoot", readiness.waterRoot);
  addIssueRows(entries, "readiness", "resourceChain", readiness?.resourceChain?.rows || []);
  addIssueRows(entries, "readiness", "dailyManifest", readiness?.dailyManifest?.modules || []);
  const membershipSummary = readiness?.resourceChain?.membershipProtectedSummary;
  if (membershipSummary && (membershipSummary.ok === false || membershipSummary.error || (membershipSummary.reason && String(membershipSummary.reason).toLowerCase() !== "ok") || membershipSummary.enabled === false)) {
    add(entries, "readiness", "membershipProtectedSummary", membershipSummary);
  }
  const readinessProtectedReadback = readiness?.protectedReadbackCredential;
  if (readinessProtectedReadback && (readinessProtectedReadback.ok !== true || readinessProtectedReadback.armed === false || (Array.isArray(readinessProtectedReadback.failures) && readinessProtectedReadback.failures.length))) {
    add(entries, "readiness", "protectedReadbackCredential", readinessProtectedReadback);
  }
  if (readiness?.releaseIdentity?.releaseSha && readiness.releaseIdentity.originMainSha && readiness.releaseIdentity.releaseSha !== readiness.releaseIdentity.originMainSha) {
    add(entries, "readiness", "releaseIdentity", "production_release_sha_mismatch");
  } else if (readiness?.releaseIdentity && (readiness.releaseIdentity.localHeadMatchesProduction === false || readiness.releaseIdentity.worktreeClean === false || (readiness.releaseIdentity.releaseSha && readiness.releaseIdentity.headSha && readiness.releaseIdentity.releaseSha !== readiness.releaseIdentity.headSha))) {
    add(entries, "readiness", "releaseIdentity", "local_worktree_not_production_release");
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
    if (row && /protected|membership|bearer|unauthorized|\btoken\b|\bauth(?:_|-|\s|$)/i.test(row.sourceText)) {
      assert(row.codes.includes("AUTH_PROTECTED_READBACK_NOT_ARMED") || row.codes.includes("AUTH_PROTECTED_READBACK_NOT_OK"), "expected_entry_code_missing", { source: "manifest", idIncludes: `module:${key}`, code: "AUTH_PROTECTED_READBACK_NOT_ARMED", row }, issues);
    }
  }
  const manifestWaterRootEntry = findEntry(entries, "manifest", "waterRoot");
  if (manifestWaterRootEntry) {
    assert(manifestWaterRootEntry.codes.includes("SOURCE_WATER_ROOT_NOT_READY"), "expected_entry_code_missing", { source: "manifest", idIncludes: "waterRoot", code: "SOURCE_WATER_ROOT_NOT_READY", row: manifestWaterRootEntry }, issues);
  }
  if (readiness) {
    const releaseEntry = findEntry(entries, "readiness", "releaseIdentity");
    if (releaseEntry) assert(releaseEntry.codes.includes("PRODUCTION_RELEASE_SHA_MISMATCH") || releaseEntry.codes.includes("LOCAL_WIP_NOT_DEPLOYED"), "expected_entry_code_missing", { source: "readiness", idIncludes: "releaseIdentity", code: "PRODUCTION_RELEASE_SHA_MISMATCH_OR_LOCAL_WIP_NOT_DEPLOYED", row: releaseEntry }, issues);
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





