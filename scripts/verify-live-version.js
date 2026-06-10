const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex").toUpperCase();
}

function fetchText(pathname, timeoutMs = 20000) {
  const url = `${BASE_URL}${pathname}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ url, status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function detectLocalVersion() {
  const match = read("terminal-core.js").match(/const\s+version\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error("Unable to detect local version");
  return match[1];
}

async function expectOk(name, pathname, check) {
  const result = await fetchText(pathname);
  if (result.status < 200 || result.status >= 300) throw new Error(`${name} HTTP ${result.status}`);
  if (!check(result.body)) throw new Error(`${name} check failed`);
  console.log(`[live-version] ${name} ok`);
  return result.body;
}

async function main() {
  const version = detectLocalVersion();
  const home = await expectOk("home", "/", (body) => body.includes(`terminal-core.js?v=${version}`) && body.includes(`styles.css?v=${version}`));
  await expectOk("core", `/terminal-core.js?v=${version}`, (body) => body.includes(`const version = "${version}"`) && body.includes("FUMAN_TERMINAL_VERSION"));
  await expectOk("bootstrap", `/terminal.js?v=${version}`, (body) => body.includes("terminal-app.js"));
  await expectOk("service-worker", `/fuman-sw.js?v=${version}`, (body) => body.includes(`fuman-terminal-sw-${version}`) && body.includes(`/terminal-app.js?v=${version}`) && body.includes("networkFirstStatic"));
  const app = await expectOk("terminal-app", `/terminal-app.js?v=${version}`, (body) => body.includes("FUMAN_SUPABASE_URL") && body.includes("renderWatchlist"));
  const localAppHash = sha256(read("terminal-app.js"));
  const liveAppHash = sha256(app);
  if (localAppHash !== liveAppHash) {
    throw new Error(`terminal-app hash mismatch local=${localAppHash} live=${liveAppHash}`);
  }
  console.log(`[live-version] ok version=${version} terminal-app=${liveAppHash}`);
}

main().catch((error) => {
  console.error(`[live-version] failed: ${error.message}`);
  process.exit(1);
});
