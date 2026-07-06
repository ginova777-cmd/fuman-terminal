const {
  buildStrategy3BlockedReceipt,
  buildStrategy3RunRowPayload,
  buildStrategy3RunTimeSourceSnapshotFields,
  strategy3PublishAllowed,
  strategy3PublishBlockReasons,
} = require("./scan-strategy3-cache");
const { normalizeStrategy3ApiContract } = require("../api/strategy3-latest");
const { sampleStrategy3Output } = require("./strategy3-business-field-contract");
const {
  mutateStrategy3PrewaterPayload,
  verifyStrategy3PrewaterPayload,
} = require("./strategy3-prewater-payload-verifier");

function baseOutput() {
  return sampleStrategy3Output();
}

function buildSamplePayload(output = baseOutput()) {
  const runId = "strategy3-prewater-sample";
  const fields = buildStrategy3RunTimeSourceSnapshotFields(output, runId, "complete");
  return {
    ...output,
    runId,
    ...fields,
  };
}

function main() {
  const output = baseOutput();
  const scannerPayload = buildSamplePayload(output);
  const writerPayload = buildStrategy3RunRowPayload(output, "strategy3-prewater-sample", "complete");
  const apiPayload = normalizeStrategy3ApiContract({
    ...writerPayload,
    runId: "strategy3-prewater-sample",
    count: output.count,
    matches: output.matches,
    sourceCoverage: output.sourceCoverage,
    sourceDriftHealth: output.sourceDriftHealth,
  }, {});
  const issues = [];
  if (!strategy3PublishAllowed(scannerPayload, "complete")) {
    issues.push(`sample_not_publish_allowed:${strategy3PublishBlockReasons(scannerPayload, "complete").join(";")}`);
  }
  const formalPayloadResults = [
    verifyStrategy3PrewaterPayload(scannerPayload, { label: "scanner-sample" }),
    verifyStrategy3PrewaterPayload(writerPayload, { label: "writer-run-row-payload" }),
    verifyStrategy3PrewaterPayload(apiPayload, { label: "api-normalized-payload" }),
  ];
  for (const result of formalPayloadResults) {
    if (!result.ok) issues.push(...result.issues.map((issue) => `${result.label}:${issue}`));
  }

  const blockedOutput = {
    ...baseOutput(),
    count: 0,
    sourceCoverage: { status: "failed" },
    sourceDriftHealth: { status: "failed", reason: "local mutation" },
    prePublishSelfTest: { ok: false, issues: ["empty result"] },
  };
  const receipt = buildStrategy3BlockedReceipt(blockedOutput, "local blocked sample", "mutation");
  if (receipt.latestOverwriteAllowed !== false) issues.push("blocked_receipt_allows_latest");
  if (receipt.preservePreviousGood !== true) issues.push("blocked_receipt_preserve_false");
  if (receipt.unattendedStatus === "YES") issues.push("blocked_receipt_fake_yes");

  const mutationNames = [
    "delete-source-snapshot",
    "missing-evidenceStatus",
    "fake-yes",
    "blocked-latest-allowed",
    "preserve-false",
    "fallback-hidden",
    "empty-result",
    "display-only-fallback",
  ];
  const mutationResults = mutationNames.map((name) => {
    const result = verifyStrategy3PrewaterPayload(mutateStrategy3PrewaterPayload(scannerPayload, name), {
      label: `mutation-${name}`,
      expectBlocked: true,
    });
    const mutationIssues = result.issues;
    return { name, failedAsExpected: mutationIssues.length > 0, issues: mutationIssues };
  });
  for (const result of mutationResults) {
    if (!result.failedAsExpected) issues.push(`mutation_${result.name}_did_not_fail`);
  }

  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    mode: "local-sample-no-supabase",
    formalPayloadResults,
    sample: {
      runId: scannerPayload.runId,
      evidenceStatus: scannerPayload.evidenceStatus,
      unattendedStatus: scannerPayload.unattendedStatus,
      publishAllowed: scannerPayload.run_quality_at_publish?.publishAllowed,
      requiredFields: scannerPayload.requiredFields,
    },
    blockedReceipt: receipt,
    mutationResults,
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[strategy3-prewater-sample] failed: ${error.message || String(error)}`);
  process.exitCode = 1;
}
