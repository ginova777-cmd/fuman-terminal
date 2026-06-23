const https = require("https");
const zlib = require("zlib");

const BASE_URL = (process.env.FUMAN_TERMINAL_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const FIRST_SCREEN_BUDGET_BYTES = 170000;
const FIRST_SCREEN_JSON_BUDGET_BYTES = 30000;
const FIRST_SCREEN_TARGETS = [
  "/",
  "/terminal-app.js",
  "/terminal-watchlist-module.js",
  "/terminal-mobile-diagnostics.js",
  "/api/mobile-boot",
  "/api/terminal-home",
  "/api/strategy2-latest?top=1&compact=1&limit=50",
];
const FIRST_SCREEN_FORBIDDEN = [
  "/data/mobile-home-summary.json",
  "/data/terminal-home-bundle.json",
  "/data/terminal-home-mobile-slim.json",
  "/data/mobile-digest.json",
  "/data/mobile-ai-ultra.html",
  "/data/market-ai-panel-latest.json",
  "/data/stocks-index.json",
  "/data/stocks-quotes-slim.json",
  "/data/strategy4-zone-a.json",
  "/data/strategy4-zone-b-page-1.json",
  "/data/strategy4-zone-c-page-1.json",
];
const MAX_BYTES = {
  "/terminal-app.js": 122000,
  "/terminal-watchlist-module.js": 18000,
  "/terminal-mobile-diagnostics.js": 4000,
  "/api/mobile-boot": 30000,
  "/api/terminal-home": 45000,
  "/api/strategy2-latest?top=1&compact=1&limit=50": 30000,
};

const TARGETS = [
  { path: "/", kind: "html", maxBytes: 50000, cache: /no-store/i },
  { path: "/terminal-app.js", kind: "script", versioned: true, maxBytes: MAX_BYTES["/terminal-app.js"], cache: /immutable/i },
  { path: "/terminal-watchlist-module.js", kind: "script", versioned: true, maxBytes: MAX_BYTES["/terminal-watchlist-module.js"], cache: /immutable/i },
  { path: "/terminal-mobile-diagnostics.js", kind: "script", versioned: true, maxBytes: MAX_BYTES["/terminal-mobile-diagnostics.js"], cache: /immutable/i },
  { path: "/api/mobile-boot", kind: "json", maxBytes: MAX_BYTES["/api/mobile-boot"], cache: /no-store/i },
  { path: "/api/terminal-home", kind: "json", maxBytes: MAX_BYTES["/api/terminal-home"], cache: /no-store/i },
  { path: "/api/strategy2-latest?top=1&compact=1&limit=50", kind: "json", maxBytes: MAX_BYTES["/api/strategy2-latest?top=1&compact=1&limit=50"], cache: /no-store/i },
];

function fetchBuffer(pathname, version = "") {
  const url = new URL(pathname, BASE_URL);
  if (version && pathname.endsWith(".js")) url.searchParams.set("v", version);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      timeout: 20000,
      headers: {
        "Accept-Encoding": "br,gzip",
        "User-Agent": "FumanMobileHealth/1.0",
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        path: pathname,
        url: url.toString(),
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${pathname}`)));
    req.on("error", reject);
    req.end();
  });
}

function countPayload(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload.matches)) return payload.matches.length;
  if (Array.isArray(payload.rows)) return payload.rows.length;
  if (Array.isArray(payload.events)) return payload.events.length;
  if (Array.isArray(payload.records)) return payload.records.length;
  if (Array.isArray(payload.stocks)) return payload.stocks.length;
  if (Array.isArray(payload.quotes)) return payload.quotes.length;
  return Number(payload.count || 0);
}

function decodeBody(buffer, encoding) {
  if (encoding === "br") return zlib.brotliDecompressSync(buffer).toString("utf8");
  if (encoding === "gzip") return zlib.gunzipSync(buffer).toString("utf8");
  return buffer.toString("utf8");
}

function detectVersion(homeText) {
  const match = homeText.match(/terminal-core\.js\?v=([^"'&<>]+)/);
  return match ? match[1] : "";
}

async function main() {
  const issues = [];
  const home = await fetchBuffer("/");
  const fetched = new Map([["/", home]]);
  const homeText = decodeBody(home.body, String(home.headers["content-encoding"] || ""));
  const version = detectVersion(homeText);
  if (!version) issues.push("home cannot detect frontend version");

  for (const target of TARGETS) {
    const result = target.path === "/" ? home : await fetchBuffer(target.path, target.versioned ? version : "");
    fetched.set(target.path, result);
    const encoding = String(result.headers["content-encoding"] || "");
    const cache = String(result.headers["cache-control"] || "");
    const bytes = result.body.length;
    let count = 0;
    let ok = result.status >= 200 && result.status < 400;
    if (target.kind === "json" && ok) {
      try {
        const payload = JSON.parse(decodeBody(result.body, encoding));
        count = countPayload(payload);
        ok = payload.ok !== false;
      } catch (error) {
        ok = false;
        issues.push(`${target.path} invalid json`);
      }
    }
    if (target.kind !== "html" && bytes > 1024 && !["br", "gzip"].includes(encoding)) issues.push(`${target.path} not compressed`);
    if (target.maxBytes && bytes > target.maxBytes) issues.push(`${target.path} too large bytes=${bytes} max=${target.maxBytes}`);
    if (target.cache && !target.cache.test(cache)) issues.push(`${target.path} cache unexpected cache=${cache}`);
    if (!ok) issues.push(`${target.path} unhealthy status=${result.status}`);
    console.log(`[mobile] ${ok ? "ok" : "warn"} ${target.path} bytes=${bytes} encoding=${encoding || "none"} count=${count} cache=${cache}`);
  }

  let firstScreenBytes = 0;
  let firstScreenJsonBytes = 0;
  for (const pathname of FIRST_SCREEN_TARGETS) {
    const target = TARGETS.find((item) => item.path === pathname) || { path: pathname, kind: pathname.endsWith(".json") ? "json" : "asset" };
    const result = fetched.get(pathname) || await fetchBuffer(pathname, target.versioned ? version : "");
    firstScreenBytes += result.body.length;
    if (pathname.endsWith(".json")) firstScreenJsonBytes += result.body.length;
    if (result.status < 200 || result.status >= 400) issues.push(`first-screen target unhealthy ${pathname} status=${result.status}`);
  }
  for (const pathname of FIRST_SCREEN_FORBIDDEN) {
    if (FIRST_SCREEN_TARGETS.includes(pathname)) issues.push(`first-screen forbidden target included ${pathname}`);
  }
  if (firstScreenBytes > FIRST_SCREEN_BUDGET_BYTES) issues.push(`first-screen too large bytes=${firstScreenBytes} max=${FIRST_SCREEN_BUDGET_BYTES}`);
  if (firstScreenJsonBytes > FIRST_SCREEN_JSON_BUDGET_BYTES) issues.push(`first-screen json too large bytes=${firstScreenJsonBytes} max=${FIRST_SCREEN_JSON_BUDGET_BYTES}`);
  console.log(`[mobile] first-screen bytes=${firstScreenBytes}/${FIRST_SCREEN_BUDGET_BYTES} json=${firstScreenJsonBytes}/${FIRST_SCREEN_JSON_BUDGET_BYTES}`);

  if (issues.length) {
    console.error("[mobile] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log(`[mobile] health ok version=${version}`);
}

main().catch((error) => {
  console.error(`[mobile] failed: ${error.message}`);
  process.exit(1);
});

