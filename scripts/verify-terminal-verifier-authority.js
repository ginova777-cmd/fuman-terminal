"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_PATH = path.join(ROOT, "data", "contracts", "terminal_verifier_authority_v1.json");
const PACKAGE_PATH = path.join(ROOT, "package.json");

function fail(reason, detail = null) {
  console.error(JSON.stringify({
    ok: false,
    status: "blocked",
    contract: "terminal_verifier_authority_v1",
    reason,
    detail,
  }, null, 2));
  process.exit(1);
}

const authority = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
const scripts = pkg.scripts || {};

if (authority.contract !== "terminal_verifier_authority_v1" || authority.status !== "active") {
  fail("terminal_verifier_authority_contract_invalid");
}

const canonical = authority.canonicalTotalVerifier;
if (canonical !== "verify:terminal-perfect" || !scripts[canonical]) {
  fail("canonical_total_verifier_missing", { canonical });
}

for (const retired of authority.retiredTotalVerifierAliases || []) {
  if (Object.prototype.hasOwnProperty.call(scripts, retired)) {
    fail("retired_total_verifier_alias_returned", { retired });
  }
}

for (const component of authority.requiredComponentVerifiers || []) {
  if (!scripts[component]) fail("required_component_verifier_missing", { component });
  if (!String(scripts[canonical]).includes(`npm run ${component}`)) {
    fail("canonical_total_verifier_component_unwired", { component });
  }
}

if (!String(scripts[canonical]).startsWith("npm run verify:terminal-verifier-authority && ")) {
  fail("canonical_total_verifier_authority_gate_not_first");
}

const forbiddenFilePatterns = [
  /(^|[\\/])verify-terminal-(?:complete|full|final|operation|operations|perfect-old|perfect-v1)\.(?:js|ps1)$/i,
  /(^|[\\/])(?:run-)?fuman-terminal-(?:complete|perfect)-verif(?:ier|er)\.(?:js|ps1)$/i,
  /verify-terminal[^\\/]*\.(?:bak|old|legacy)$/i,
];
const returnedFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", ".vercel"].includes(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else {
      const relative = path.relative(ROOT, absolute).replace(/\\/g, "/");
      if (forbiddenFilePatterns.some((pattern) => pattern.test(relative))) returnedFiles.push(relative);
    }
  }
}
walk(ROOT);
if (returnedFiles.length) fail("retired_terminal_verifier_file_returned", { files: returnedFiles });

const result = {
  ok: true,
  status: "complete",
  contract: authority.contract,
  canonicalTotalVerifier: canonical,
  componentVerifierCount: authority.requiredComponentVerifiers.length,
  retiredAliasCount: authority.retiredTotalVerifierAliases.length,
  retiredAliasesAbsent: true,
  retiredFilesAbsent: true,
  totalCompletionAuthorityCount: 1,
};
console.log(JSON.stringify(result, null, 2));
