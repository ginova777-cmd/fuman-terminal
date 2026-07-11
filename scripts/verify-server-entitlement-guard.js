const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function requireIncludes(file, needle) {
  if (!read(file).includes(needle)) issues.push(`${file}: missing ${needle}`);
}

const protectedApis = {
  "api/open-buy-latest.js": "strategy1",
  "api/strategy2-latest.js": "strategy2",
  "api/strategy3-latest.js": "strategy3",
  "api/strategy4-latest.js": "strategy4",
  "api/strategy5-latest.js": "strategy5",
  "api/institution-latest.js": "institution",
  "api/cb-detect-latest.js": "cb-detect",
  "api/warrant-flow-latest.js": "warrant-flow",
  "api/scorecard.js": "scorecard",
  "api/source-reports.js": "source-reports",
};

requireIncludes("lib/server-entitlement-guard.js", "verifyRequestEntitlement");
requireIncludes("lib/server-entitlement-guard.js", "withEntitlementRequired");
requireIncludes("lib/server-entitlement-guard.js", "fuman_user_access");
requireIncludes("lib/server-entitlement-guard.js", "missing_bearer_token");
requireIncludes("lib/server-entitlement-guard.js", "invalid_or_expired_token");
requireIncludes("lib/server-entitlement-guard.js", "membership_not_enabled");
requireIncludes("lib/server-entitlement-guard.js", "fumanInternalVerify");

for (const [file, scope] of Object.entries(protectedApis)) {
  requireIncludes(file, "server-entitlement-guard");
  requireIncludes(file, `withEntitlementRequired(handler, "${scope}")`);
}

requireIncludes("auth.html", "accessToken: session?.access_token");
requireIncludes("auth.html", "expiresAt: session?.expires_at");
requireIncludes("terminal-entitlement-guard.js", "readAccessToken");
requireIncludes("terminal-entitlement-guard.js", "installProtectedApiBearer");
requireIncludes("terminal-entitlement-guard.js", "authorization");
requireIncludes("terminal-entitlement-guard.js", "Bearer ${token}");
requireIncludes("terminal-entitlement-guard.js", "open-buy-latest|strategy2-latest|strategy3-latest|strategy4-latest|strategy5-latest|institution-latest|cb-detect-latest|warrant-flow-latest|scorecard|source-reports");
requireIncludes("package.json", "\"verify:server-entitlement-guard\": \"node scripts/verify-server-entitlement-guard.js\"");

if (issues.length) {
  console.error(JSON.stringify({ ok: false, issues }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  protectedApis: Object.keys(protectedApis),
  publicSurfaces: ["市場總覽", "AI 判讀", "學習方案"],
  contract: "server-side-membership-entitlement-v1",
  expectedUnauthedResponse: "401 membership_required",
  expectedInactiveResponse: "403 membership_not_enabled"
}, null, 2));
