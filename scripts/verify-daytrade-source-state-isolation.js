"use strict";

const fs = require("fs");
const path = require("path");

const runtime = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const formalFile = process.env.STRATEGY2_SUPABASE_COVERAGE_FILE || path.join(runtime, "state", "strategy2-supabase-coverage.json");
const diagnosticFile = process.env.STRATEGY2_SHARED_SOURCE_DIAGNOSTIC_FILE || path.join(runtime, "state", "strategy2-shared-source-diagnostic.json");
function read(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
const formal = read(formalFile);
const diagnostic = read(diagnosticFile);
const issues = [];
if (!formal || formal.sourceRole !== "formal_authority_dedicated_daytrade") issues.push("formal_state_role_invalid");
if (!diagnostic || diagnostic.sourceRole !== "diagnostic_only_shared_source") issues.push("diagnostic_state_role_invalid");
if (formalFile === diagnosticFile) issues.push("formal_and_diagnostic_state_paths_equal");
if (diagnostic?.formalEntryAuthority !== false || diagnostic?.canonicalGateAuthority !== false || diagnostic?.latestPointerAuthority !== false || diagnostic?.unattendedAuthority !== false) {
  issues.push("diagnostic_authority_flags_not_false");
}
const result = {
  ok: issues.length === 0,
  contract: "daytrade-source-state-isolation-v1",
  checkedAt: new Date().toISOString(),
  formalFile,
  diagnosticFile,
  formalDecision: formal?.decision || "missing",
  diagnosticDecision: diagnostic?.decision || "missing",
  issues,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
