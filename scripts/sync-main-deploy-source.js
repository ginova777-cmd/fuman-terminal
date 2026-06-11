const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.FUMAN_DEPLOY_SOURCE_DIR || "C:\\fuman-terminal";

const FILES = [
  "index.html",
  "index.github.html",
  "refresh.html",
  "version.json",
  "vercel.json",
  "styles.css",
  "terminal.js",
  "terminal-app.js",
  "terminal-core.js",
  "terminal-modules.js",
  "terminal-warrant-flow.js",
  "terminal-watchlist.css",
  "fuman-sw.js",
  "api/version.js",
  "scripts/bump-version.js",
  "scripts/prepare-deploy.js",
  "scripts/sync-afterhours-supabase-status.js",
  "scripts/sync-main-deploy-source.js",
  "scripts/verify-source-sync.js",
  "scripts/verify-supabase-json.js",
  "scripts/verify-version-consistency.js",
  "run-cache-sync.ps1",
  "run-cb-detect.ps1",
  "run-flow.ps1",
  "flow-health.ps1",
  "data/afterhours-supabase-status.json",
];

if (!fs.existsSync(DEPLOY_ROOT)) {
  console.warn(`[sync-source] deploy root missing, skipped: ${DEPLOY_ROOT}`);
  process.exit(0);
}

let copied = 0;
for (const file of FILES) {
  const source = path.join(SOURCE_ROOT, file);
  const target = path.join(DEPLOY_ROOT, file);
  if (!fs.existsSync(source)) continue;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied += 1;
}

console.log(`[sync-source] ok copied=${copied} deploy=${DEPLOY_ROOT}`);
