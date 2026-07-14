const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
}

function mustInclude(file, needle, label = needle) {
  if (!read(file).includes(needle)) issues.push(`${file}: missing ${label}`);
}

function mustNotInclude(file, needle, label = needle) {
  if (read(file).includes(needle)) issues.push(`${file}: rollback text still present: ${label}`);
}

function mustMatch(file, pattern, label) {
  if (!pattern.test(read(file))) issues.push(`${file}: missing ${label}`);
}

const runtimeFiles = ["terminal.js", "terminal-app.js"];
const visibleFiles = ["index.html", "index.github.html", ...runtimeFiles];

mustInclude("terminal-core.js", "script.src = `terminal.js?v=${version}`", "runtime loads terminal.js");
mustInclude("index.html", "FMN://strategy5.all", "direct main static badge");
mustInclude("index.html", "策略5主要結果", "direct main static title");
mustNotInclude("index.html", "strategy-list-title", "retired static strategy checklist");
mustInclude("index.github.html", "FMN://strategy5.all", "direct main github static badge");
mustInclude("index.github.html", "策略5主要結果", "direct main github static title");
mustNotInclude("index.github.html", "strategy-list-title", "retired static strategy checklist");

for (const file of runtimeFiles) {
  mustInclude(file, "installStrategyDirectMainEntry", "direct main entry guard");
  mustInclude(file, "installStrategyNoOverviewFallback", "no-overview fallback guard");
  mustInclude(file, "strategyMainIdForLink", "strategy link main-id mapper");
  for (const id of ["open_buy", "intraday_2m", "strategy3", "swing_radar", "strategy5_all"]) {
    mustInclude(file, id, `main entry id ${id}`);
  }
  mustInclude(file, "FMN://strategy5.all", "direct main fallback badge");
  mustInclude(file, "策略5主要結果", "direct main fallback title");
  mustInclude(file, "selectedStrategyIds=new Set([mainId])", "strategy entries select exactly one main id");
mustInclude(file, "strategyList.hidden=intraday||swing||strategy5||openBuy||strategy3", "strategy3 no-overview chrome");
  mustMatch(file, /return\s+STRATEGY5_ENTRY_ID\s*;/, "generic strategy entry defaults to Strategy5 main page");
}

for (const file of visibleFiles) {
  mustNotInclude(file, "綜合策略選股");
  mustNotInclude(file, "FMN://strategy.scan");
  mustNotInclude(file, "載入全台股股票池");
  mustNotInclude(file, "<h1>策略中心</h1>", "visible Strategy Center heading");
  mustNotInclude(file, "<h1>策略模組</h1>", "visible Strategy Module heading");
  mustNotInclude(file, "策略模組總覽");
  mustNotInclude(file, "FMN://strategy.api");
  mustNotInclude(file, "正在連線 Supabase API");
  mustNotInclude(file, "左側切換日線、籌碼與高波動策略");
}

const app = read("terminal-app.js");
const runtime = read("terminal.js");
for (const marker of [
  "installStrategyDirectMainEntry",
  "installStrategyNoOverviewFallback",
  "strategyMainIdForLink",
  "FMN://strategy5.all",
  "策略5主要結果",
]) {
  if (app.includes(marker) !== runtime.includes(marker)) {
    issues.push(`terminal.js / terminal-app.js sync mismatch for ${marker}`);
  }
}

const packageJson = JSON.parse(read("package.json"));
if (!String(packageJson.scripts?.["verify:strategy-direct-main"] || "").includes("verify-strategy-direct-main-entry.js")) {
  issues.push("package.json: missing verify:strategy-direct-main script");
}
if (!read("scripts/verify-all.js").includes("verify:strategy-direct-main")) {
  issues.push("scripts/verify-all.js: missing verify:strategy-direct-main step");
}

if (issues.length) {
  console.error("[strategy-direct-main] rollback guard failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[strategy-direct-main] ok");


