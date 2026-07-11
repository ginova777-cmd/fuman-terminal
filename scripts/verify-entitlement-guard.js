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

function requireOrder(file, before, after) {
  const text = read(file);
  const beforeIndex = text.indexOf(before);
  const afterIndex = text.indexOf(after);
  if (beforeIndex < 0) issues.push(`${file}: missing ${before}`);
  if (afterIndex < 0) issues.push(`${file}: missing ${after}`);
  if (beforeIndex >= 0 && afterIndex >= 0 && beforeIndex > afterIndex) {
    issues.push(`${file}: ${before} must appear before ${after}`);
  }
}

requireIncludes("terminal-entitlement-guard.js", 'const PUBLIC_VIEWS = new Set(["market", "member"])');
requireIncludes("terminal-entitlement-guard.js", 'PROTECTED_VIEWS = new Set(["strategy", "chip-trade", "cb-detect", "warrant-flow", "realtime-radar"])');
requireIncludes("terminal-entitlement-guard.js", "membership_required");
requireIncludes("terminal-entitlement-guard.js", "scorecard|source-reports");
requireIncludes("terminal-entitlement-guard.js", "/auth.html?next=");
requireIncludes("auth.html", "Fuman");
requireIncludes("auth.html", "電子郵件 / 帳號");
requireIncludes("auth.html", "遊客登入");
requireIncludes("auth.html", "立即註冊帳號");
requireIncludes("auth.html", "fuman_user_access");

for (const label of ["策略1", "策略2", "策略3", "策略4", "策略5", "即時雷達", "買賣超", "CB可轉債", "權證走向", "回測研究"]) {
  requireIncludes("terminal-entitlement-guard.js", label);
}

for (const status of ["active", "approved", "admin", "paid", "pro", "premium"]) {
  requireIncludes("terminal-entitlement-guard.js", status);
}

requireIncludes("terminal-desktop-fast-shell.js", "const DEFAULT_DESKTOP_ROUTE_KEY = MARKET_ROUTE;");
requireIncludes("fuman-sw.js", "/terminal-entitlement-guard.js?v=public-terminal-fast-20260630-20");
requireIncludes("package.json", '"verify:entitlement-guard": "node scripts/verify-entitlement-guard.js"');
requireOrder("index.html", "terminal-entitlement-guard.js", "terminal-desktop-fast-shell.js");
requireOrder("index.html", "terminal-entitlement-guard.js", "terminal-core.js");
requireOrder("88.html", "terminal-entitlement-guard.js", "/api/scorecard");

if (issues.length) {
  console.error(JSON.stringify({ ok: false, issues }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  public: ["市場總覽", "AI判讀", "學習方案"],
  locked: ["Strategy1-5", "買賣超", "CB", "權證", "/88成績單"],
  evidence: [
    "terminal-entitlement-guard.js",
    "index.html guard before desktop/core",
    "88.html guard before scorecard fetch",
    "terminal-desktop-fast-shell.js default route = market",
    "fuman-sw.js cache/network asset includes guard"
  ]
}, null, 2));
