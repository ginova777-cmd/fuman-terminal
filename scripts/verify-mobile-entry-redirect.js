const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) issues.push(message);
}

function rejectText(text, needle, message) {
  if (text.includes(needle)) issues.push(message);
}

function requireRewrite(vercel, source, destination) {
  const rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [];
  if (!rewrites.some((route) => route?.source === source && route?.destination === destination)) {
    issues.push(`vercel.json must rewrite ${source} to ${destination}`);
  }
}

const index = read("index.html");
requireText(index, 'desktop")==="1"', "index.html must allow ?desktop=1 escape hatch");
requireText(index, 'fetch("/api/mobile-page"', "index.html must load /api/mobile-page for mobile visitors");
requireText(index, 'location.replace("/api/mobile-page")', "index.html fallback must go to /api/mobile-page");

const githubIndex = read("index.github.html");
requireText(githubIndex, 'location.replace("/mobile")', "index.github.html must redirect mobile visitors to /mobile");
requireText(githubIndex, 'desktop")==="1"', "index.github.html must allow ?desktop=1 escape hatch");
requireText(githubIndex, 'fuman_force_desktop', "index.github.html must persist desktop escape hatch for phone users");

const vercel = readJson("vercel.json");
requireRewrite(vercel, "/mobile", "/api/mobile-page");
requireRewrite(vercel, "/mobile.html", "/api/mobile-page");

const mobile = read("mobile.html");
requireText(mobile, 'data-display-switch', "mobile.html must expose the display switcher beside the moon button");
requireText(mobile, 'href="/api/mobile-page"', "mobile.html display switcher must link to mobile version");
requireText(mobile, 'href="/?desktop=1"', "mobile.html display switcher must link to desktop version");
requireText(mobile, ">手機版</a>", "mobile.html display switcher must label the mobile option");
requireText(mobile, ">電腦版</a>", "mobile.html display switcher must label the desktop option");
rejectText(mobile, ">終端</a>", "mobile.html must not show desktop terminal button");

if (issues.length) {
  console.error("[mobile-entry-redirect] failed");
  for (const issue of issues) console.error("- " + issue);
  process.exit(1);
}

console.log("[mobile-entry-redirect] ok");
