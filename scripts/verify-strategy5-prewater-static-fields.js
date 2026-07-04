"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const REQUIRED_FIELDS = [
  "source_snapshot_captured_at",
  "source_status_at_run",
  "quote_coverage_at_run",
  "intraday_1m_readiness_at_run",
  "ma_readiness_at_run",
  "preopen_futopt_daily_readiness_at_run",
  "run_quality_at_publish",
  "fallbackUsed",
  "fallbackScope",
  "fallbackAllowed",
  "fallbackDetails",
  "fallbackContract",
  "degradedBlocksLatest",
  "preservePreviousGood",
  "writeBudget",
  "retentionOk",
  "evidenceStatus",
  "unattendedStatus",
  "requiredFields",
  "blankCounts",
  "sampleMissingRows",
  "blockedReason",
  "scanner_block_reason",
];

const FILES = {
  api: path.join(REPO, "api", "strategy5-latest.js"),
  scanner: path.join(REPO, "scripts", "scan-strategy5-cache.js"),
  contract: path.join(REPO, "lib", "run-time-source-snapshot-contract.js"),
  adapter: path.join(REPO, "scripts", "strategy5-prewater-payload-adapter.js"),
  fixtureVerifier: path.join(__dirname, "verify-strategy5-prewater-fixtures.js"),
  formalPayloadVerifier: path.join(__dirname, "verify-strategy5-prewater-formal-payloads.js"),
  businessFieldVerifier: path.join(__dirname, "verify-strategy5-business-fields.js"),
  postRestoreReadonlyVerifier: path.join(__dirname, "verify-strategy5-post-restore-readonly.js"),
  fixtureFile: path.join(REPO, "fixtures", "strategy5-prewater-fixtures.json"),
  receiptMock: path.join(REPO, "fixtures", "strategy5-prewater-blocked-receipt.json"),
  businessFieldMatrix: path.join(REPO, "fixtures", "strategy5-business-field-matrix.json"),
};

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function has(text, field) {
  return text.includes(field);
}

function main() {
  const texts = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, read(file)]));
  const checks = [];

  for (const field of REQUIRED_FIELDS) {
    checks.push({
      id: `api_has_${field}`,
      ok: has(texts.api, field),
      file: FILES.api,
      field,
    });
    checks.push({
      id: `scanner_has_${field}`,
      ok: has(texts.scanner, field),
      file: FILES.scanner,
      field,
    });
  }

  for (const field of ["fallbackContract", "blockedReason", "scanner_block_reason"]) {
    checks.push({
      id: `contract_has_${field}`,
      ok: has(texts.contract, field),
      file: FILES.contract,
      field,
    });
  }

  for (const marker of ["adaptStrategy5Payload", "sourceReady", "readbackCount", "fallbackUsed", "latestOverwriteAllowed"]) {
    checks.push({
      id: `adapter_has_${marker}`,
      ok: has(texts.adapter, marker),
      file: FILES.adapter,
      field: marker,
    });
  }

  for (const fixture of ["ready", "quote-low", "stale-1m", "fallback-used", "empty-result", "supabase-timeout"]) {
    checks.push({
      id: `fixture_mode_${fixture}`,
      ok: has(texts.fixtureVerifier, "--fixture") && has(texts.fixtureFile, `"${fixture}"`),
      file: FILES.fixtureVerifier,
      field: fixture,
    });
  }

  for (const marker of ["gateDecision", "previousGood", "latestPointerUnchanged", "emptyResultNotWritten"]) {
    checks.push({
      id: `receipt_mock_has_${marker}`,
      ok: has(texts.receiptMock, marker),
      file: FILES.receiptMock,
      field: marker,
    });
  }

  for (const marker of ["fieldName", "payloadPath", "scannerPayloadPath", "writerPayloadPath", "sourceTableOrView", "blankCountsKey", "sampleMissingRowsKey"]) {
    checks.push({
      id: `business_field_matrix_has_${marker}`,
      ok: has(texts.businessFieldMatrix, marker),
      file: FILES.businessFieldMatrix,
      field: marker,
    });
  }

  for (const marker of ["buildStrategy5RunRow", "buildStrategy5ResultRows", "strategy5Api._test.buildPayload", "verifyCanonical", "sampleOutput"]) {
    checks.push({
      id: `business_field_verifier_has_${marker}`,
      ok: has(texts.businessFieldVerifier, marker),
      file: FILES.businessFieldVerifier,
      field: marker,
    });
  }

  for (const marker of ["sampleOutput", "sampleApiPayload", "formal-source-fallback", "previous-good-not-preserved", "module.exports"]) {
    checks.push({
      id: `formal_payload_verifier_exports_${marker}`,
      ok: has(texts.formalPayloadVerifier, marker),
      file: FILES.formalPayloadVerifier,
      field: marker,
    });
  }

  for (const marker of ["confirm-readonly-supabase", "v_institution_source_health", "v_strategy5_latest_complete_run", "strategy5_scan_results", "verifyCanonical"]) {
    checks.push({
      id: `post_restore_readonly_has_${marker}`,
      ok: has(texts.postRestoreReadonlyVerifier, marker),
      file: FILES.postRestoreReadonlyVerifier,
      field: marker,
    });
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    checkedAt: new Date().toISOString(),
    checkedFiles: FILES,
    failed,
    totalChecks: checks.length,
  }, null, 2));
  if (failed.length) process.exit(1);
}

main();
