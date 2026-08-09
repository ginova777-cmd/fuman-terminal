const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const files = {
  fastBundle: path.join(ROOT, "api", "terminal-fast-bundle.js"),
  mobileBoot: path.join(ROOT, "api", "mobile-boot.js"),
};
const issues = [];

function read(name) {
  try {
    return fs.readFileSync(files[name], "utf8");
  } catch (error) {
    issues.push(`${name}_unreadable:${error.message}`);
    return "";
  }
}

function forbid(name, source, pattern, reason) {
  if (pattern.test(source)) issues.push(`${name}:${reason}`);
}

function requireText(name, source, text) {
  if (!source.includes(text)) issues.push(`${name}:missing:${text}`);
}

function main() {
  const fastBundle = read("fastBundle");
  const mobileBoot = read("mobileBoot");

  forbid("fastBundle", fastBundle, /unattendedStatus:\s*["']YES["']/i, "fast_bundle_literal_yes");
  forbid("fastBundle", fastBundle, /sanitizeStrategy2RunIds|normalizeApprovedStrategy2Evidence/i, "strategy2_evidence_rewriter_present");
  forbid("mobileBoot", mobileBoot, /unattendedStatus:\s*["']YES["']/i, "mobile_pending_fallback_literal_yes");
  requireText("fastBundle", fastBundle, "Preserve source evidence and runIds exactly");
  requireText("fastBundle", fastBundle, "return payload;");
  requireText("mobileBoot", mobileBoot, "evidenceStatus: \"pending\"");
  requireText("mobileBoot", mobileBoot, "unattendedStatus: \"NO\"");

  const result = {
    ok: issues.length === 0,
    contract: "terminal-no-fake-unattended-v1",
    checkedAt: new Date().toISOString(),
    issues,
    rules: [
      "fast bundle never promotes stale/degraded evidence to unattended YES",
      "fast bundle never rewrites source runIds",
      "mobile pending calendar fallback is fail-closed",
    ],
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main();