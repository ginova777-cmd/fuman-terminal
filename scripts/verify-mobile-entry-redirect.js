const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) issues.push(message);
}

for (const file of ["index.html", "index.github.html"]) {
  const html = read(file);
  requireText(html, 'location.replace("/mobile")', `${file} must redirect mobile visitors to /mobile`);
  requireText(html, 'desktop")==="1"', `${file} must allow ?desktop=1 escape hatch`);
  requireText(html, 'fuman_force_desktop', `${file} must persist desktop escape hatch for phone users`);
}

const mobile = read("mobile.html");
requireText(mobile, 'href="/?desktop=1"', "mobile.html full terminal link must bypass mobile redirect");

if (issues.length) {
  console.error("[mobile-entry-redirect] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[mobile-entry-redirect] ok");
