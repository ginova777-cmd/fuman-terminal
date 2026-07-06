const { verifyFormalBusinessPayloads } = require("./strategy3-business-field-contract");

const result = verifyFormalBusinessPayloads();
const payload = {
  ok: result.ok,
  checkedAt: new Date().toISOString(),
  mode: "local-formal-payloads-no-supabase",
  formalPayloadLabels: result.formalPayloadLabels,
  usesBusinessFieldMatrixFile: result.usesBusinessFieldMatrixFile,
  usesDecisionGateMatrixFile: result.usesDecisionGateMatrixFile,
  usesSourceContractMatrix: result.usesSourceContractMatrix,
  decisionGateResult: {
    ok: result.decisionGateResult.ok,
    rows: result.decisionGateResult.matrix.length,
    issues: result.decisionGateResult.issues,
  },
  sourceContractResult: {
    ok: result.sourceContractResult.ok,
    rows: result.sourceContractResult.matrix.length,
    issues: result.sourceContractResult.issues,
  },
  rowAudits: result.rowAudits,
  prewaterResults: result.prewaterResults,
  negativeMutationsCovered: result.negativeMutationsCovered,
  mutationResults: result.mutationResults,
  fallbackSplitResults: result.fallbackSplitResults,
  blockedReceipt: {
    publishAllowed: result.blockedReceipt.publishAllowed,
    latestOverwriteAllowed: result.blockedReceipt.latestOverwriteAllowed,
    preservePreviousGood: result.blockedReceipt.preservePreviousGood,
    evidenceStatus: result.blockedReceipt.evidenceStatus,
    unattendedStatus: result.blockedReceipt.unattendedStatus,
    writeBudget: result.blockedReceipt.writeBudget,
  },
  issues: result.issues,
};

console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exitCode = 1;
