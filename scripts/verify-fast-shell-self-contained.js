const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
const target = fileArg ? path.resolve(fileArg.slice("--file=".length)) : path.join(ROOT, "terminal-desktop-fast-shell.js");
const issues = [];

function read(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch (error) {
    issues.push(`${path.relative(ROOT, file)} is missing or unreadable: ${error.message}`);
    return "";
  }
}

const source = read(target);
const label = path.relative(ROOT, target) || path.basename(target);

const requiredHelpers = [
  "normalizeArray",
  "cleanNumber",
  "pickFirstValue",
  "escapeHtml",
  "fetchMarketJson",
  "renderMarketApiAi",
  "hydrateMarketDesktopAiDirect",
];

for (const helper of requiredHelpers) {
  const declarationPattern = new RegExp(`\\b(?:async\\s+)?function\\s+${helper}\\s*\\(|\\b(?:const|let|var)\\s+${helper}\\s*=`);
  if (!declarationPattern.test(source)) {
    issues.push(`${label} must declare ${helper}; desktop fast shell must not depend on legacy runtime helpers`);
  }
}

for (const forbidden of [
  "window.normalizeArray",
  "window.cleanNumber",
  "window.pickFirstValue",
  "window.escapeHtml",
  "window.fetchMarketJson",
  "globalThis.normalizeArray",
  "globalThis.cleanNumber",
]) {
  if (source.includes(forbidden)) {
    issues.push(`${label} must not read legacy/global helper ${forbidden}`);
  }
}

if (issues.length) {
  console.error("[fast-shell-self-contained] failed");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`[fast-shell-self-contained] ok ${label}`);
