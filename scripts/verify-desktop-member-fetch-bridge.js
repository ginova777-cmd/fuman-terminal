const fs = require("fs");

const source = fs.readFileSync("terminal-desktop-fast-shell.js", "utf8");
const issues = [];

function assert(condition, message) {
  if (!condition) issues.push(message);
}

assert(source.includes("const protectedApiPattern ="), "desktop_shell_missing_self_contained_protected_api_pattern");
assert(source.includes("installMemberBearerFetchBridge20260714"), "desktop_shell_missing_member_bearer_bridge");
assert(source.includes("protectedApiPattern.test(url.pathname)"), "member_bearer_bridge_must_match_url_pathname");
assert(source.includes("protectedApiPattern: protectedApiPattern.source"), "member_bearer_bridge_must_expose_pattern_for_readback");

const patternMatch = source.match(/const protectedApiPattern = (\/\^[^\n]+\/);/);
assert(patternMatch, "protected_api_pattern_not_parseable");

if (patternMatch) {
  const pattern = eval(patternMatch[1]);
  const required = [
    "/api/terminal-fast-bundle",
    "/api/strategy2-latest",
    "/api/strategy3-latest",
    "/api/strategy4-latest",
    "/api/strategy5-latest",
    "/api/latest-strategy",
    "/api/institution-latest",
    "/api/institution-tdcc-breakout-latest",
  ];
  for (const endpoint of required) {
    assert(pattern.test(endpoint), `protected_api_pattern_missing_${endpoint}`);
  }
  assert(!pattern.test("/api/market-ai-live"), "public_market_ai_must_not_require_member_bearer");
  assert(!pattern.test("/api/version"), "public_version_must_not_require_member_bearer");
}

if (issues.length) {
  console.error("[desktop-member-fetch-bridge] FAIL");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[desktop-member-fetch-bridge] ok");
