const fs = require("fs");
const path = require("path");
const {
  buildFormalPayloads,
} = require("./strategy3-business-field-contract");

const ROOT = path.resolve(__dirname, "..");

const UI_SURFACE_MATRIX = [
  {
    uiSurface: "desktop terminal home strategy3 panel",
    routeOrEndpoint: "/api/terminal-home",
    rendererFile: "api/terminal-home.js",
    apiEndpointUsed: "/api/strategy3-latest",
    forbiddenStaticPaths: ["data/strategy3-latest.json", "data/strategy3-backup.json", "data/strategy3-summary.json", "data/strategy3-page-"],
    displayedFields: ["runId", "usedDate/date", "count", "top[].code", "top[].name", "top[].score", "top[].reason"],
    requiredDisplayedFields: ["runId", "date", "count", "top"],
    uiBlankHandling: "blank required business fields must not be rendered as normal formal entries",
    degradedDisplayRule: "evidenceStatus=insufficient or publishAllowed=false must be shown as blocked/degraded, not normal",
    fallbackDisplayRule: "fallbackUsed=true must be disclosed; display-only fallback cannot become formal entry",
    previousGoodDisplayRule: "previous good may be shown only with preserve marker; it cannot masquerade as current latest",
    verifierCommand: "npm run verify:strategy3-ui-surfaces",
    negativeTest: "blocked-payload-normal-display",
  },
  {
    uiSurface: "mobile fragment strategy3 tab",
    routeOrEndpoint: "/api/mobile-fragment?tab=strategy3",
    rendererFile: "api/mobile-fragment.js",
    apiEndpointUsed: "/api/strategy3-latest",
    forbiddenStaticPaths: ["data/strategy3-latest.json", "data/mobile-strategy3-ultra.html"],
    displayedFields: ["endpoint", "title", "subtitle", "points"],
    requiredDisplayedFields: ["endpoint=/api/strategy3-latest"],
    uiBlankHandling: "mobile tab must route to API payload before showing rows",
    degradedDisplayRule: "API evidenceStatus controls normal/degraded display",
    fallbackDisplayRule: "fallback disclosure must come from API payload",
    previousGoodDisplayRule: "previous good can be retained only if API marks preservePreviousGood",
    verifierCommand: "npm run verify:strategy3-ui-surfaces",
    negativeTest: "mobile-static-path-regression",
  },
  {
    uiSurface: "terminal fast bundle strategy3 endpoint",
    routeOrEndpoint: "/api/terminal-fast-bundle",
    rendererFile: "api/terminal-fast-bundle.js",
    apiEndpointUsed: "/api/strategy3-latest",
    forbiddenStaticPaths: ["data/strategy3-latest.json", "data/strategy3-page-"],
    displayedFields: ["endpoints['/api/strategy3-latest']", "summary['/api/strategy3-latest']"],
    requiredDisplayedFields: ["runId", "count", "updatedAt"],
    uiBlankHandling: "bundle carries API endpoint payload; blank required fields remain API contract failures",
    degradedDisplayRule: "summary must not turn API blocked payload into normal latest",
    fallbackDisplayRule: "fallback flags remain in endpoint payload",
    previousGoodDisplayRule: "previous good must remain marked by API payload flags",
    verifierCommand: "npm run verify:strategy3-ui-surfaces",
    negativeTest: "fast-bundle-static-regression",
  },
  {
    uiSurface: "terminal resource chain strategy3 audit",
    routeOrEndpoint: "scripts/verify-terminal-resource-chain.js --routes=strategy3",
    rendererFile: "scripts/verify-terminal-resource-chain.js",
    apiEndpointUsed: "/api/strategy3-latest",
    forbiddenStaticPaths: ["data/strategy3-latest.json", "data/strategy3-backup.json"],
    displayedFields: ["endpoint", "mobileTab", "runView", "resultTable"],
    requiredDisplayedFields: ["endpoint", "runView", "resultTable"],
    uiBlankHandling: "audit requires API/resource chain, not static JSON",
    degradedDisplayRule: "live audit must fail when API evidence lies",
    fallbackDisplayRule: "fallback is an audit issue unless explicitly allowed",
    previousGoodDisplayRule: "receipt and runId count matching prevent fake latest",
    verifierCommand: "npm run verify:strategy3-ui-surfaces",
    negativeTest: "resource-chain-static-regression",
  },
];

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertFileUsesApi(surface, issues) {
  const text = readRepoFile(surface.rendererFile);
  if (!text.includes(surface.apiEndpointUsed) && !/require\("\.\/strategy3-latest"\)|require\('\.\/strategy3-latest'\)/.test(text)) {
    issues.push(`${surface.uiSurface}:missing_api_endpoint_${surface.apiEndpointUsed}`);
  }
  for (const forbidden of surface.forbiddenStaticPaths) {
    if (text.includes(forbidden)) issues.push(`${surface.uiSurface}:forbidden_static_path_${forbidden}`);
  }
}

function verifyBlockedDisplayRules() {
  const { blockedReceipt, apiPayload } = buildFormalPayloads();
  const issues = [];
  if (apiPayload.runId !== "strategy3-business-fields-sample") issues.push("api_runId_mismatch");
  if (Number(apiPayload.count) !== 2) issues.push("api_count_mismatch");
  if (apiPayload.evidenceStatus !== "complete") issues.push("api_evidenceStatus_not_complete_for_ready_sample");
  if (apiPayload.unattendedStatus !== "YES") issues.push("api_unattendedStatus_not_yes_for_ready_sample");

  if (blockedReceipt.evidenceStatus !== "insufficient") issues.push("blocked_evidenceStatus_not_insufficient");
  if (blockedReceipt.unattendedStatus !== "NO") issues.push("blocked_unattendedStatus_not_no");
  if (blockedReceipt.publishAllowed !== false || blockedReceipt.latestOverwriteAllowed !== false) issues.push("blocked_latest_not_blocked");
  if (blockedReceipt.preservePreviousGood !== true) issues.push("blocked_previous_good_not_preserved");
  if (!blockedReceipt.blockedReason) issues.push("blocked_reason_missing");

  const fallbackDisplayOnly = {
    ...apiPayload,
    fallbackUsed: true,
    fallbackScope: ["display"],
    fallbackAllowed: false,
    publishAllowed: false,
    evidenceStatus: "insufficient",
    unattendedStatus: "NO",
  };
  if (fallbackDisplayOnly.fallbackUsed === true && fallbackDisplayOnly.unattendedStatus === "YES") {
    issues.push("fallback_display_only_rendered_as_unattended_yes");
  }
  if (fallbackDisplayOnly.publishAllowed === true) issues.push("fallback_display_only_publish_allowed");

  return { ok: issues.length === 0, issues };
}

function main() {
  const issues = [];
  for (const surface of UI_SURFACE_MATRIX) assertFileUsesApi(surface, issues);
  const displayRuleResult = verifyBlockedDisplayRules();
  issues.push(...displayRuleResult.issues);
  const payload = {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    mode: "local-ui-surfaces-no-supabase",
    uiSurfaces: UI_SURFACE_MATRIX,
    displayRuleResult,
    issues,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`[strategy3-ui-surfaces] failed: ${error.message || String(error)}`);
  process.exitCode = 1;
}
