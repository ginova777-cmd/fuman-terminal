const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LIVE_BASE_URL = "https://fuman-terminal.vercel.app";
const issues = [];

const live = process.argv.includes("--live");
const baseUrl = (
  (process.argv.find((arg) => arg.startsWith("--base-url=")) || "").slice("--base-url=".length) ||
  process.env.FUMAN_LIVE_BASE_URL ||
  LIVE_BASE_URL
).replace(/\/+$/, "");

function readLocal(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function readJson(rel) {
  return JSON.parse(readLocal(rel));
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) issues.push(message);
}

function rejectText(text, needle, message) {
  if (text.includes(needle)) issues.push(message);
}

function headerFor(vercel, source) {
  return (vercel.headers || []).find((item) => item.source === source);
}

function headerValue(item, key) {
  return (item?.headers || []).find((header) => String(header.key).toLowerCase() === key.toLowerCase())?.value || "";
}

function requireHeader(vercel, source, key, pattern, message) {
  const item = headerFor(vercel, source);
  if (!item) {
    issues.push(`vercel header missing for ${source}`);
    return;
  }
  const value = headerValue(item, key);
  if (!pattern.test(value)) issues.push(`${message} actual=${value || "<missing>"}`);
}

async function liveHeaders(rel) {
  const url = `${baseUrl}/${rel.replace(/^\/+/, "")}?verify=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.headers;
}

async function checkLiveHeaders() {
  const mobile = await liveHeaders("mobile");
  if (!/no-store/i.test(mobile.get("cache-control") || "")) {
    issues.push(`live /mobile must be no-store actual=${mobile.get("cache-control") || "<missing>"}`);
  }

  const apiBoot = await liveHeaders("api/mobile-boot");
  if (!/no-store/i.test(apiBoot.get("cache-control") || "")) {
    issues.push(`live /api/mobile-boot must be no-store actual=${apiBoot.get("cache-control") || "<missing>"}`);
  }
  if (!/no-store/i.test(apiBoot.get("cdn-cache-control") || "")) {
    issues.push(`live /api/mobile-boot CDN cache must be no-store actual=${apiBoot.get("cdn-cache-control") || "<missing>"}`);
  }

  const staticBoot = await liveHeaders("data/mobile-boot.json");
  if (!/no-cache/i.test(staticBoot.get("cache-control") || "") || !/max-age=0/i.test(staticBoot.get("cache-control") || "")) {
    issues.push(`live /data/mobile-boot.json browser cache must be no-cache max-age=0 actual=${staticBoot.get("cache-control") || "<missing>"}`);
  }
  if (!/max-age=3/i.test(staticBoot.get("cdn-cache-control") || "")) {
    issues.push(`live /data/mobile-boot.json CDN cache must stay very short actual=${staticBoot.get("cdn-cache-control") || "<missing>"}`);
  }
}

function checkLocal() {
  const mobile = readLocal("mobile.html");
  const sw = readLocal("fuman-sw.js");
  const apiBoot = readLocal("api/mobile-boot.js");
  const vercel = readJson("vercel.json");
  const packageJson = readJson("package.json");

  requireText(mobile, 'bootUrl="/api/mobile-boot"', "mobile shell must use /api/mobile-boot as primary boot endpoint");
  requireText(mobile, 'fetch(fresh(url),{cache:"no-store"})', "mobile JSON fetches must use no-store plus cache-busting query");
  requireText(mobile, 'url.includes("?v=")?url:fresh(url)', "mobile fragment fetch must preserve versioned ?v=hash URLs");
  requireText(mobile, 'v="+encodeURIComponent', "mobile fragments and analysis must be versioned by hash/updatedAt");
  requireText(mobile, "boot_hash", "mobile realtime must compare boot_hash before fetching");
  if (!mobile.includes("if(next&&before&&next===before)return") && !mobile.includes("if(n&&b&&n===b)return")) {
    issues.push("mobile realtime must skip unchanged boot_hash events");
  }
  requireText(mobile, "if(boot)loadFragment(active,false)", "mobile tab switching must reuse boot and cached fragments");
  requireText(mobile, "cache.get(k)?.hash===h", "mobile fragments must be cached by hash");
  requireText(mobile, "disablePrefetchOnLowEnd", "mobile shell must disable prefetch on low-end phones");
  requireText(mobile, "deviceMemory", "mobile shell must detect low-end memory before prefetching");
  requireText(mobile, "hardwareConcurrency", "mobile shell must detect low-end CPU before prefetching");
  requireText(mobile, "clearTimeout(rt);rt=setTimeout", "mobile realtime updates must be debounced");
  requireText(mobile, "data-sun", "mobile sunlight mode must be local CSS state only");
  requireText(mobile, 'html[data-sun="1"]', "mobile sunlight mode CSS selector must quote the attribute value for mobile browsers");
  requireText(mobile, "fuman_mobile_sun", "mobile sunlight mode must persist in localStorage only");
  requireText(mobile, "/data/mobile-analysis/", "mobile analysis must be lazy-loaded per stock");
  rejectText(mobile, 'bootUrl="/data/mobile-boot.json"', "mobile shell must not use static mobile-boot.json as primary boot endpoint");
  rejectText(mobile, "serviceWorker.register", "mobile shell must not register the full service worker");
  rejectText(mobile, 'href="/data/mobile-ai-ultra.html" as="fetch"', "mobile shell must not preload AI fragment before boot hash is known");
  rejectText(mobile, "/data/mobile-stock-analysis-latest.json</", "mobile shell must not preload stock-analysis fallback in HTML");

  requireText(apiBoot, 'Cache-Control", "no-store', "/api/mobile-boot must set browser no-store");
  requireText(apiBoot, 'CDN-Cache-Control", "no-store', "/api/mobile-boot must set CDN no-store");
  requireText(apiBoot, 'Vercel-CDN-Cache-Control", "no-store', "/api/mobile-boot must set Vercel CDN no-store");

  requireText(sw, "const DATA_CACHE", "service worker must isolate data cache");
  requireText(sw, "/\\/data\\/mobile-boot\\.json/i", "service worker must know mobile boot data pattern");
  requireText(sw, "/\\/data\\/mobile-analysis\\/[^/]+\\.json/i", "service worker must know per-stock analysis data pattern");
  requireText(sw, "if (isDataRequest(url))", "service worker must route data requests explicitly");
  requireText(sw, "event.respondWith(networkFirst(request));", "service worker data requests must be network-first");
  requireText(sw, 'fetch(request, { cache: "no-store" })', "service worker network-first data fetch must use no-store");
  requireText(sw, 'cache.match(request, { ignoreSearch: false })', "service worker network-first fallback must respect version query strings");
  rejectText(sw, "event.respondWith(dataStaleWhileRevalidate(request))", "service worker must not stale-while-revalidate mobile/data requests");
  rejectText(sw, "event.respondWith(dataStaleWhileRevalidate", "service worker must not route data requests through stale cache first");

  requireHeader(vercel, "/mobile", "Cache-Control", /no-store/i, "/mobile must be no-store");
  requireHeader(vercel, "/mobile.html", "Cache-Control", /no-store/i, "/mobile.html must be no-store");
  requireHeader(vercel, "/fuman-sw.js", "Cache-Control", /no-store/i, "/fuman-sw.js must be no-store");
  requireHeader(vercel, "/data/mobile-boot.json", "Cache-Control", /no-cache.*max-age=0|max-age=0.*no-cache/i, "static mobile boot browser cache must be no-cache max-age=0");
  requireHeader(vercel, "/data/mobile-boot.json", "Vercel-CDN-Cache-Control", /max-age=3.*stale-while-revalidate=6|stale-while-revalidate=6.*max-age=3/i, "static mobile boot edge cache must be very short");
  requireHeader(vercel, "/data/mobile-ai-ultra.html", "Vercel-CDN-Cache-Control", /max-age=5/i, "mobile AI ultra edge cache must stay short");
  requireHeader(vercel, "/data/mobile-(strategy1|strategy2|strategy3|strategy4|strategy5|chip|cb|warrant)-ultra.html", "Vercel-CDN-Cache-Control", /max-age=5/i, "mobile strategy fragment edge cache must stay short");
  requireHeader(vercel, "/data/mobile-analysis/(.*).json", "Vercel-CDN-Cache-Control", /max-age=5/i, "mobile analysis edge cache must stay short");

  const script = String(packageJson.scripts?.["verify:mobile-cache-contract"] || "");
  if (!script.includes("verify-mobile-cache-contract.js")) {
    issues.push("package.json must expose verify:mobile-cache-contract");
  }
}

async function main() {
  checkLocal();
  if (live) await checkLiveHeaders();

  if (issues.length) {
    console.error(`[mobile-cache-contract${live ? ":live" : ""}] failed`);
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log(`[mobile-cache-contract${live ? ":live" : ""}] ok boot=/api/mobile-boot sw=network-first fragments=versioned`);
}

main().catch((error) => {
  console.error(`[mobile-cache-contract${live ? ":live" : ""}] failed`);
  console.error(error?.stack || error);
  process.exit(1);
});
