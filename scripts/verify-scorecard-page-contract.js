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
const sourceReportsApi = read("api/source-reports.js");
const issues = [];
const publicPage = page.replace(/<template\s+id="scorecardPrivateContractMarkers"[\s\S]*?<\/template>/i, "");

assertMarker(issues, page, "/api/scorecard?t=", "/88 snapshot scorecard API");
if (/\/api\/scorecard\?[^`"']*(live=1|snapshotLive=1|noCache=1)/.test(page)) {
  issues.push("/88 must not force scorecard live/snapshotLive/noCache; scorecard reads published snapshot to protect Supabase");
}
assertMarker(issues, page, "membership-lock=20260713-11", "/88 must load current membership guard");
assertMarker(issues, page, "cache: \"no-store\"", "/88 no-store fetch");
assertMarker(issues, page, "renderMembershipLock", "/88 membership lock renderer");
assertMarker(issues, page, "isMembershipFailure", "/88 membership failure handling");
assertMarker(issues, page, "missing_bearer_token", "/88 missing bearer token lock handling");
assertMarker(issues, page, "data-testid=\"scorecard-membership-lock\"", "/88 visible membership lock state");
assertMarker(issues, page, "scorecard-audit-panel", "/88 audit panel");
assertMarker(issues, page, "rowEvidenceOk", "/88 YES gate");
assertMarker(issues, page, "fallbackDetails", "/88 fallback disclosure");
assertMarker(issues, page, "source_snapshot_captured_at", "/88 source snapshot disclosure");
assertMarker(issues, page, "blankCounts", "/88 field completeness disclosure");
assertMarker(issues, page, "sampleMissingRows", "/88 sample missing rows disclosure");
assertMarker(issues, page, "Scorecard Health", "/88 final scorecard format");
assertMarker(issues, page, "Live A source evidence", "/88 live source verdict");

assertRegex(issues, api, /withEntitlementRequired\(handler, ["']scorecard["']\)|module\.exports\s*=\s*withEntitlementRequired\(handler, ["']scorecard["']\)/, "scorecard API membership-protected handler");
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

assertRegex(issues, sourceReportsApi, /withEntitlementRequired\(handler, ["']source-reports["']\)|module\.exports\s*=\s*withEntitlementRequired\(handler, ["']source-reports["']\)/, "source reports API membership-protected handler");
assertMarker(issues, page, "renderMembershipLock", "/88 membership lock renderer");
assertMarker(issues, page, "data-membership-required=\"1\"", "/88 membership lock marker");
assertMarker(issues, page, "這不是水源失敗，也不是策略沒有運算", "/88 membership lock must not imply data failure");
assertMarker(issues, page, "membershipDisplayReason", "/88 technical membership reason mapper");
assertMarker(issues, page, "尚未登入或會員權限未開通", "/88 friendly missing token message");

if (/\/data\/scorecard[^"'\s]*\.json/.test(page)) {
  issues.push("/88 must not reference /data/scorecard*.json");
}

const visibleHtml = page
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<template[\s\S]*?<\/template>/gi, "");
if (/>[^<]*missing_bearer_token[^<]*</i.test(visibleHtml)) {
  issues.push("/88 must not render raw missing_bearer_token in visible HTML");
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


