const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
}

function pushIssue(message) {
  issues.push(message);
}

const forbidden = [
  "16:00 候選",
  "16:00後先出明日候選",
  "16:00後產生明日候選",
  "16:00 後產生明日候選",
  "14:30 後產生明日候選",
  "有賺就走",
  "快跑",
  "開盤價進場\", \"有賺就走\", \"09:10 強制出場",
];

const uiFiles = [
  "terminal-app.js",
  "terminal-live-check.js",
  "api/mobile-fragment.js",
  "scripts/generate-slim-cache.js",
];

for (const file of uiFiles) {
  const content = read(file);
  for (const marker of forbidden) {
    if (content.includes(marker)) {
      pushIssue(`${file}: forbidden Strategy1 rollback marker found: ${marker}`);
    }
  }
}

function openBuyBlock(file) {
  const content = read(file);
  const startMarkers = ["function renderOpenBuyRadar", "function renderOpenBuyDashboard"];
  const start = startMarkers
    .map((marker) => content.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  if (start < 0) {
    pushIssue(`${file}: missing Strategy1 open-buy render function`);
    return "";
  }
  const end = content.indexOf("function renderStrategy5Dashboard", start);
  if (end < 0) {
    pushIssue(`${file}: missing renderStrategy5Dashboard after renderOpenBuyDashboard`);
    return content.slice(start);
  }
  return content.slice(start, end);
}

for (const file of ["terminal-app.js", "terminal-live-check.js"]) {
  const block = openBuyBlock(file);
  if (!block) continue;
  const cardCount = (block.match(/class="swing-card active/g) || []).length;
  if (cardCount !== 2) pushIssue(`${file}: Strategy1 open-buy must render exactly 2 cards, found ${cardCount}`);
  for (const required of ["21:30 初篩 + 08:45 個股期貨", "08:55 搓合確認", "搓合完美符合才列 BUY"]) {
    if (!block.includes(required)) pushIssue(`${file}: Strategy1 open-buy block missing ${required}`);
  }
}

const mobileFragment = read("api/mobile-fragment.js");
if (!mobileFragment.includes('points: ["21:30 初篩符合 + 08:45 個股期貨確認", "08:55 搓合完美符合"]')) {
  pushIssue("api/mobile-fragment.js: Strategy1 mobile points must be 21:30+08:45 / 08:55 two-stage contract");
}

const slimGenerator = read("scripts/generate-slim-cache.js");
if (!slimGenerator.includes('"21:30 初篩 + 08:45 個股期貨 / 08:55 搓合"') || !slimGenerator.includes('["21:30 初篩符合 + 08:45 個股期貨確認", "08:55 搓合完美符合"]')) {
  pushIssue("scripts/generate-slim-cache.js: Strategy1 slim fragment must keep the 21:30+08:45 / 08:55 two-stage contract");
}

const packageJson = JSON.parse(read("package.json"));
if (!String(packageJson.scripts?.["verify:strategy1-open-buy-ui"] || "").includes("verify-strategy1-open-buy-ui-contract.js")) {
  pushIssue("package.json: missing verify:strategy1-open-buy-ui rollback guard");
}

const prepareDeploy = read("scripts/prepare-deploy.js");
if (!prepareDeploy.includes("verify:strategy1-open-buy-ui")) {
  pushIssue("scripts/prepare-deploy.js: deploy preflight must run verify:strategy1-open-buy-ui");
}

const indexHtml = read("index.html");
const terminalHotfix = read("terminal-hotfix.js");
if (!indexHtml.includes('terminal-hotfix.js" data-fuman-terminal-hotfix="1"')) {
  pushIssue("index.html: terminal-hotfix.js must load before terminal-core.js");
}
if (!terminalHotfix.includes("installStrategy1OpenBuyRollbackGuard")) {
  pushIssue("terminal-hotfix.js: missing Strategy1 open-buy rollback runtime guard");
}

const coreVersion = (read("terminal-core.js").match(/const\s+version\s*=\s*"([^"]+)"/) || [])[1];
const moduleVersion = (read("terminal-modules.js").match(/const\s+VERSION\s*=\s*"([^"]+)"/) || [])[1];
const versionJson = JSON.parse(read("version.json")).version;
if (!coreVersion) pushIssue("terminal-core.js: missing version literal");
if (!moduleVersion) pushIssue("terminal-modules.js: missing VERSION literal");
if (coreVersion && moduleVersion && coreVersion !== moduleVersion) {
  pushIssue(`version mismatch: terminal-core.js=${coreVersion}, terminal-modules.js=${moduleVersion}`);
}
if (coreVersion && versionJson !== coreVersion) {
  pushIssue(`version mismatch: version.json=${versionJson}, terminal-core.js=${coreVersion}`);
}
if (coreVersion) {
  for (const [file, expected] of [
    ["index.html", `terminal-core.js?v=${coreVersion}`],
    ["fuman-sw.js", `/terminal-app.js?v=${coreVersion}`],
    ["refresh.html", `/?v=${coreVersion}`],
  ]) {
    if (!read(file).includes(expected)) pushIssue(`${file}: missing ${expected}`);
  }
}

if (issues.length) {
  console.error("[strategy1-open-buy-ui] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[strategy1-open-buy-ui] ok");
