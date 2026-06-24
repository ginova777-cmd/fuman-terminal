const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LIVE_BASE_URL = "https://fuman-terminal.vercel.app";
const live = process.argv.includes("--live");
const baseUrl = (
  (process.argv.find((arg) => arg.startsWith("--base-url=")) || "").slice("--base-url=".length) ||
  process.env.FUMAN_LIVE_BASE_URL ||
  LIVE_BASE_URL
).replace(/\/+$/, "");

const issues = [];
const inventory = {
  mobileJson: [],
  mobileTop: [],
  fragments: [],
  manifests: [],
  backups: [],
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

function pushIssue(message) {
  issues.push(message);
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) pushIssue(message);
}

function rejectText(text, needle, message) {
  if (text.includes(needle)) pushIssue(message);
}

function headerFor(vercel, source) {
  return (vercel.headers || []).find((item) => item.source === source);
}

function headerValue(item, key) {
  return (item?.headers || []).find((header) => String(header.key).toLowerCase() === key.toLowerCase())?.value || "";
}

function hasNoStore(vercel, source) {
  const item = headerFor(vercel, source);
  return /no-store/i.test(headerValue(item, "Cache-Control")) ||
    /no-store/i.test(headerValue(item, "CDN-Cache-Control")) ||
    /no-store/i.test(headerValue(item, "Vercel-CDN-Cache-Control"));
}

function listDataFiles() {
  const dir = path.join(ROOT, "data");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function buildInventory() {
  for (const name of listDataFiles()) {
    if (/^mobile-.*\.json$/i.test(name)) inventory.mobileJson.push(name);
    if (/(?:mobile-top|-mobile-top|top)\.json$/i.test(name)) inventory.mobileTop.push(name);
    if (/^mobile-.*\.html$/i.test(name)) inventory.fragments.push(name);
    if (/manifest|status-index/i.test(name)) inventory.manifests.push(name);
    if (/backup/i.test(name)) inventory.backups.push(name);
  }
}

function checkMobileShell() {
  const mobile = read("mobile.html");

  requireText(mobile, 'bootUrl="/api/mobile-boot"', "mobile shell must use no-store /api/mobile-boot as the only boot/latest endpoint");
  requireText(mobile, 'fetch(fresh(url),{cache:"no-store"})', "mobile JSON fetches must be no-store");
  requireText(mobile, "boot_hash", "mobile Realtime must compare boot_hash before refetch");
  requireText(mobile, "setInterval(()=>{if(!document.hidden&&active!==\"watch\")load(false)},120000)", "mobile must keep 120s polling fallback only as backup");
  requireText(mobile, "cache.get(k)?.hash===h", "mobile fragments must render from hash contract instead of recalculating data");
  requireText(mobile, "location.reload", "mobile must have a hard reload path when the API-only contract reports a new incompatible run");
  requireText(mobile, 'html[data-sun="1"]', "mobile sunlight selector must quote attribute value so phones apply it");

  rejectText(mobile, 'bootUrl="/data/mobile-boot.json"', "mobile shell must not poll static /data/mobile-boot.json");
  rejectText(mobile, "/data/mobile-terminal-latest.json", "mobile shell must not use mobile-terminal-latest.json as runtime fallback");
  rejectText(mobile, "/data/mobile-digest.json", "mobile shell must not poll mobile-digest.json directly");
  rejectText(mobile, "backup.json", "mobile shell must not use backup JSON fallback");
  rejectText(mobile, "freshness:gate", "mobile shell must not invoke freshness gate as data repair");
  rejectText(mobile, "release:main", "mobile shell must not invoke release pipeline as data repair");
  rejectText(mobile, "vercel --prod", "mobile shell must not invoke deploy as data repair");
  rejectText(mobile, "serviceWorker.register", "mobile shell must not register SW or depend on SW cache for latest data");
}

function checkApiBoot() {
  const apiBoot = read("api/mobile-boot.js");
  const fragmentApi = read("api/mobile-fragment.js");
  requireText(apiBoot, 'Cache-Control", "no-store', "/api/mobile-boot must be browser no-store");
  requireText(apiBoot, 'CDN-Cache-Control", "no-store', "/api/mobile-boot must be CDN no-store");
  requireText(apiBoot, 'Vercel-CDN-Cache-Control", "no-store', "/api/mobile-boot must be Vercel CDN no-store");
  requireText(apiBoot, "/api/mobile-fragment?tab=", "/api/mobile-boot must point strategy tabs to API-rendered fragments");
  for (const endpoint of ["/api/open-buy-latest", "/api/latest-strategy?key=strategy2", "/api/strategy3-latest", "/api/strategy4-latest", "/api/strategy5-latest", "/api/institution-latest", "/api/warrant-flow-latest"]) {
    requireText(apiBoot, endpoint, `/api/mobile-boot must derive mobile fragments from ${endpoint}`);
    requireText(fragmentApi, endpoint, `/api/mobile-fragment must render rows from ${endpoint}`);
  }
  for (const staleFragment of ["mobile-strategy1-ultra.html", "mobile-strategy2-ultra.html", "mobile-strategy3-ultra.html", "mobile-strategy4-ultra.html", "mobile-strategy5-ultra.html", "mobile-chip-ultra.html", "mobile-warrant-ultra.html"]) {
    rejectText(apiBoot, staleFragment, `/api/mobile-boot must not point tabs to static ${staleFragment}`);
  }
  rejectText(apiBoot, "backup.json", "/api/mobile-boot must not fall back to backup JSON");
  rejectText(apiBoot, "freshness:gate", "/api/mobile-boot must not trigger freshness gate as repair");
  rejectText(apiBoot, "release:main", "/api/mobile-boot must not trigger release pipeline as repair");
  rejectText(apiBoot, "vercel --prod", "/api/mobile-boot must not trigger Vercel deploy as repair");
  requireText(fragmentApi, 'Cache-Control", "no-store', "/api/mobile-fragment must be browser no-store");
  requireText(fragmentApi, "data-run-id", "/api/mobile-fragment must expose API runId in the rendered fragment");
}

function checkGeneratorAndContracts() {
  const generator = read("scripts/generate-slim-cache.js");
  const packageJson = readJson("package.json");
  const eventScript = read("scripts/publish-mobile-update-event.js");
  const runGate = read("scripts/verify-run-id-complete-gates.js");

  requireText(generator, "mobileBootLatest", "scanner must generate one mobile boot contract");
  requireText(generator, "lowPower", "mobile boot must carry lowPower render policy");
  requireText(generator, "fragments", "mobile boot must carry versioned fragment manifest");
  requireText(eventScript, "mobile_update_events", "scanner/postdeploy must publish mobile update events");
  requireText(eventScript, "boot_hash", "mobile update events must include boot_hash");
  requireText(runGate, "status=eq.complete", "run gate must read only complete Supabase runs");
  requireText(runGate, "complete=eq.true", "run gate must require complete=true");

  if (!String(packageJson.scripts?.["verify:mobile-api-only"] || "").includes("verify-mobile-api-only.js")) {
    pushIssue("package.json must expose verify:mobile-api-only");
  }
  if (!String(packageJson.scripts?.["verify:run-gates"] || "").includes("verify-run-id-complete-gates.js")) {
    pushIssue("package.json must expose verify:run-gates for Supabase complete-run checks");
  }
}

function checkVercelHeaders() {
  const vercel = readJson("vercel.json");
  for (const source of ["/mobile", "/mobile.html"]) {
    if (!hasNoStore(vercel, source)) pushIssue(`${source} must be no-store so phones cannot pin an old shell`);
  }
  if (!hasNoStore(vercel, "/fuman-sw.js")) pushIssue("/fuman-sw.js must be no-store so an old SW cannot pin data");
  const mobileBoot = headerFor(vercel, "/data/mobile-boot.json");
  const bootCache = headerValue(mobileBoot, "Cache-Control");
  if (!/no-cache/i.test(bootCache) || !/max-age=0/i.test(bootCache)) {
    pushIssue(`/data/mobile-boot.json must not be cacheable as latest truth actual=${bootCache || "<missing>"}`);
  }
}

async function fetchLive(rel) {
  const clean = rel.replace(/^\/+/, "");
  const joiner = clean.includes("?") ? "&" : "?";
  const url = `${baseUrl}/${clean}${joiner}verify=${Date.now()}`;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const text = await response.text().catch(() => "");
      return { response, text };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`fetchLive failed ${clean}: ${lastError?.cause?.message || lastError?.message || lastError}`);
}

async function checkLive() {
  const mobile = await fetchLive("mobile");
  if (!mobile.response.ok) pushIssue(`live /mobile returned ${mobile.response.status}`);
  if (!/no-store/i.test(mobile.response.headers.get("cache-control") || "")) {
    pushIssue(`live /mobile must be no-store actual=${mobile.response.headers.get("cache-control") || "<missing>"}`);
  }
  if (mobile.text.includes("/data/mobile-boot.json")) {
    pushIssue("live mobile shell must not reference /data/mobile-boot.json");
  }
  const boot = await fetchLive("api/mobile-boot");
  if (!boot.response.ok) pushIssue(`live /api/mobile-boot returned ${boot.response.status}`);
  if (!/no-store/i.test(boot.response.headers.get("cache-control") || "")) {
    pushIssue(`live /api/mobile-boot must be no-store actual=${boot.response.headers.get("cache-control") || "<missing>"}`);
  }
  if (!/no-store/i.test(boot.response.headers.get("cdn-cache-control") || "")) {
    pushIssue(`live /api/mobile-boot CDN must be no-store actual=${boot.response.headers.get("cdn-cache-control") || "<missing>"}`);
  }
  let bootJson = null;
  try { bootJson = JSON.parse(boot.text); } catch {}
  for (const tab of ["strategy1", "strategy2", "strategy3", "strategy4", "strategy5", "chip", "warrant"]) {
    const fragment = bootJson?.fragments?.[tab];
    if (!String(fragment?.url || "").startsWith("/api/mobile-fragment?tab=")) {
      pushIssue(`live /api/mobile-boot fragment ${tab} must point to /api/mobile-fragment actual=${fragment?.url || "<missing>"}`);
      continue;
    }
    if (!fragment?.runId) pushIssue(`live /api/mobile-boot fragment ${tab} missing runId`);
  }
  const strategy2Fragment = await fetchLive("api/mobile-fragment?tab=strategy2");
  if (!strategy2Fragment.response.ok) pushIssue(`live /api/mobile-fragment?tab=strategy2 returned ${strategy2Fragment.response.status}`);
  if (!/no-store/i.test(strategy2Fragment.response.headers.get("cache-control") || "")) {
    pushIssue(`live /api/mobile-fragment must be no-store actual=${strategy2Fragment.response.headers.get("cache-control") || "<missing>"}`);
  }
  if (!strategy2Fragment.text.includes("data-run-id")) {
    pushIssue("live /api/mobile-fragment must render data-run-id");
  }
}

async function main() {
  buildInventory();
  checkMobileShell();
  checkApiBoot();
  checkGeneratorAndContracts();
  checkVercelHeaders();
  if (live) await checkLive();

  if (issues.length) {
    console.error(`[mobile-api-only${live ? ":live" : ""}] failed`);
    for (const issue of issues) console.error("- " + issue);
    console.error(`[mobile-api-only${live ? ":live" : ""}] inventory mobileJson=${inventory.mobileJson.length} mobileTop=${inventory.mobileTop.length} fragments=${inventory.fragments.length} manifests=${inventory.manifests.length} backups=${inventory.backups.length}`);
    process.exit(1);
  }

  console.log(`[mobile-api-only${live ? ":live" : ""}] ok mobileJson=${inventory.mobileJson.length} mobileTop=${inventory.mobileTop.length} fragments=${inventory.fragments.length} manifests=${inventory.manifests.length} backups=${inventory.backups.length}`);
}

main().catch((error) => {
  console.error(`[mobile-api-only${live ? ":live" : ""}] failed`);
  console.error(error?.stack || error);
  process.exit(1);
});

