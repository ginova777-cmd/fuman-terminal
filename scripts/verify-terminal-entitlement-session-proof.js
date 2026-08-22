const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const guard = fs.readFileSync(path.join(root, "terminal-entitlement-guard.js"), "utf8");
const issues = [];

if (!guard.includes("auth-ready/logout UI state is only a paint hint")) issues.push("auth_ui_hint_comment_missing");
if (!guard.includes("const sessionReady = bodyToken || contentVerified;")) issues.push("session_proof_missing");
if (guard.includes("const sessionReady = bodyToken || authReady || logoutReady;")) issues.push("auth_cache_only_session_proof_still_enabled");
if (!guard.includes("const token = directToken || supabaseToken.token;")) issues.push("bearer_token_reader_missing");
if (!guard.includes('headers.set("x-fuman-member-session", "1")')) issues.push("member_session_header_missing");

if (issues.length) {
  console.error("[terminal-entitlement-session-proof] failed", JSON.stringify(issues));
  process.exit(1);
}
console.log("[terminal-entitlement-session-proof] ok", JSON.stringify({
  rule: "auth_cache_is_not_a_protected_api_session",
  bearer: "required_when_protected_data_is_requested",
}));
