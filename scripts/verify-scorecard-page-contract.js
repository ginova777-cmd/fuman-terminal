"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertMarker(issues, text, marker, label) {
  if (!text.includes(marker)) issues.push(`${label}: missing ${marker}`);
}

function assertRegex(issues, text, regex, label) {
  if (!regex.test(text)) issues.push(`${label}: missing ${regex}`);
}

const page = read("88.html");
const api = read("api/scorecard.js");
const issues = [];
const publicPage = page.replace(/<template\s+id="scorecardPrivateContractMarkers"[\s\S]*?<\/template>/i, "");

assertMarker(issues, page, "/api/scorecard?live=1", "/88 live scorecard API");
assertMarker(issues, page, "membership-lock=20260713-10", "/88 must load current membership guard");
assertMarker(issues, page, "cache: \"no-store\"", "/88 no-store fetch");
assertMarker(issues, page, "scorecard-audit-panel", "/88 audit panel");
assertMarker(issues, page, "rowEvidenceOk", "/88 YES gate");
assertMarker(issues, page, "fallbackDetails", "/88 fallback disclosure");
assertMarker(issues, page, "source_snapshot_captured_at", "/88 source snapshot disclosure");
assertMarker(issues, page, "blankCounts", "/88 field completeness disclosure");
assertMarker(issues, page, "sampleMissingRows", "/88 sample missing rows disclosure");
assertMarker(issues, page, "Scorecard Health", "/88 final scorecard format");
assertMarker(issues, page, "Live A source evidence", "/88 live source verdict");

assertMarker(issues, api, "module.exports = handler;", "scorecard API public handler");
assertMarker(issues, api, "module.exports.__test", "scorecard API runtime test export");
assertMarker(issues, api, "buildPayloadFromSnapshotPayload", "scorecard API runtime builder");
assertMarker(issues, api, "validateScorecardPayload", "scorecard API runtime validator");
assertMarker(issues, api, "SCORECARD_REQUIRED_FIELDS", "scorecard API required fields");
assertMarker(issues, api, "decorateRecords", "scorecard API row decoration");
assertMarker(issues, api, "buildAuditSurfaces", "scorecard API audit surfaces");
assertMarker(issues, api, "summarizeAudit", "scorecard API audit summary");
assertMarker(issues, api, "unattendedStatus", "scorecard API unattended status");
assertMarker(issues, api, "evidenceStatus", "scorecard API evidence status");
assertMarker(issues, api, "needsHumanWatch", "scorecard API human watch flag");
assertMarker(issues, api, "fallbackUsed", "scorecard API fallback flag");
assertMarker(issues, api, "publishAllowed", "scorecard API publish gate");
assertMarker(issues, api, "source_snapshot_captured_at", "scorecard API source snapshot");
assertMarker(issues, api, "requiredFields", "scorecard API requiredFields");
assertMarker(issues, api, "blankCounts", "scorecard API blankCounts");
assertMarker(issues, api, "sampleMissingRows", "scorecard API sampleMissingRows");
assertMarker(issues, api, "sources", "scorecard API top-level sources");
assertMarker(issues, api, "issues", "scorecard API top-level issues");
assertMarker(issues, api, "warnings", "scorecard API top-level warnings");
assertRegex(issues, api, /qualityStatus[\s\S]*complete/, "scorecard API complete quality path");
assertRegex(issues, api, /cacheSource[\s\S]*supabase-snapshot/, "scorecard API supabase snapshot path");

if (api.includes('withEntitlementRequired(handler, "scorecard")')) {
  issues.push("/api/scorecard must remain public for /88; do not wrap it in membership bearer gate");
}

if (/\/data\/scorecard[^"'\s]*\.json/.test(page)) {
  issues.push("/88 must not reference /data/scorecard*.json");
}

if (page.includes("scorecard-evidence") || page.includes(">實戰證據<") || page.includes('class="evidence"')) {
  issues.push("/88 public table must not render strategy evidence column");
}

if (publicPage.includes("scorecard-rule-group") || publicPage.includes("scorecard-rule-tags") || publicPage.includes(">策略項目<") || publicPage.includes(">策略細項<") || publicPage.includes(">原因<") || publicPage.includes('class="rule-group"') || publicPage.includes('class="rule-tags"') || publicPage.includes('class="reason"')) {
  issues.push("/88 public table must not render private strategy rule/reason columns");
}

if (issues.length) {
  console.error("[scorecard-page-contract] failed");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("[scorecard-page-contract] PASS static markers include /88 live fetch, private evidence gate, hidden public evidence/rule/reason columns, runtime builder, and validator");
