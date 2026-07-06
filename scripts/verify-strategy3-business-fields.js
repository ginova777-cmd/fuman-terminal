const { verifyBusinessFieldMatrix, verifyFormalBusinessPayloads } = require("./strategy3-business-field-contract");

const matrixResult = verifyBusinessFieldMatrix();
const formalResult = verifyFormalBusinessPayloads();
const issues = [
  ...matrixResult.issues.map((issue) => `matrix:${issue}`),
  ...formalResult.issues.map((issue) => `formal:${issue}`),
];

const payload = {
  ok: issues.length === 0,
  checkedAt: new Date().toISOString(),
  mode: "local-business-fields-no-supabase",
  columns: [
    "fieldName",
    "payloadPath",
    "scannerPayloadPath",
    "apiPayloadPath",
    "writerPayloadPath",
    "sourceTableOrView",
    "businessPurpose",
    "required",
    "allowBlank",
    "blockLatestWhenBlank",
    "verifierRule",
    "blankCountsKey",
    "sampleMissingRowsKey",
  ],
  matrix: matrixResult.matrix,
  formalPayloadLabels: formalResult.formalPayloadLabels,
  usesBusinessFieldMatrixFile: formalResult.usesBusinessFieldMatrixFile,
  usesDecisionGateMatrixFile: formalResult.usesDecisionGateMatrixFile,
  usesSourceContractMatrix: formalResult.usesSourceContractMatrix,
  decisionGateIssues: formalResult.decisionGateResult.issues,
  sourceContractIssues: formalResult.sourceContractResult.issues,
  rowAudits: formalResult.rowAudits,
  issues,
};

console.log(JSON.stringify(payload, null, 2));
if (!payload.ok) process.exitCode = 1;
