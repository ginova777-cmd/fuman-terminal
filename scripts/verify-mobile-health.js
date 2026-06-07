const https = require("https");
const zlib = require("zlib");

const BASE_URL = (process.env.FUMAN_TERMINAL_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const MAX_BYTES = {
  "/terminal-app.js": 140000,
  "/data/mobile-home-summary.json": 12000,
  "/data/terminal-home-bundle.json": 20000,
  "/data/strategy2-intraday-live-top.json": 12000,
  "/data/strategy2-intraday-top.json": 18000,
  "/data/institution-mobile-top.json": 16000,
  "/data/warrant-flow-mobile-top.json": 8000,
  "/data/strategy4-score-top.json": 12000,
  "/data/strategy4-zone-a.json": 14000,
  "/data/strategy4-zone-b-page-1.json": 18000,
  "/data/stocks-index.json": 26000,
  "/data/stocks-quotes-mobile-top.json": 18000,
  "/data/stocks-quotes-slim.json": 52000,
};

const TARGETS = [
  { path: "/", kind: "html", maxBytes: 50000, cache: /no-store/i },
  { path: "/terminal-app.js", kind: "script", versioned: true, maxBytes: MAX_BYTES["/terminal-app.js"], cache: /immutable/i },
  { path: "/data/mobile-home-summary.json", kind: "json", maxBytes: MAX_BYTES["/data/mobile-home-summary.json"], cache: /stale-while-revalidate/i },
  { path: "/data/terminal-home-bundle.json", kind: "json", maxBytes: MAX_BYTES["/data/terminal-home-bundle.json"], cache: /stale-while-revalidate/i },
  { path: "/data/strategy2-intraday-live-top.json", kind: "json", maxBytes: MAX_BYTES["/data/strategy2-intraday-live-top.json"], cache: /stale-while-revalidate|no-store/i },
  { path: "/data/strategy2-intraday-top.json", kind: "json", maxBytes: MAX_BYTES["/data/strategy2-intraday-top.json"], cache: /stale-while-revalidate/i },
  { path: "/data/institution-mobile-top.json", kind: "json", maxBytes: MAX_BYTES["/data/institution-mobile-top.json"], cache: /stale-while-revalidate/i },
  { path: "/data/warrant-flow-mobile-top.json", kind: "json", maxBytes: MAX_BYTES["/data/warrant-flow-mobile-top.json"], cache: /stale-while-revalidate/i },
  { path: "/data/strategy4-score-top.json", kind: "json", maxBytes: MAX_BYTES["/data/strategy4-score-top.json"], cache: /stale-while-revalidate/i },
  { path: "/data/strategy4-zone-a.json", kind: "json", maxBytes: MAX_BYTES["/data/strategy4-zone-a.json"], cache: /stale-while-revalidate/i },
  { path: "/data/strategy4-zone-b-page-1.json", kind: "json", maxBytes: MAX_BYTES["/data/strategy4-zone-b-page-1.json"], cache: /stale-while-revalidate/i },
  { path: "/data/stocks-index.json", kind: "json", maxBytes: MAX_BYTES["/data/stocks-index.json"], cache: /stale-while-revalidate/i },
  { path: "/data/stocks-quotes-mobile-top.json", kind: "json", maxBytes: MAX_BYTES["/data/stocks-quotes-mobile-top.json"], cache: /stale-while-revalidate/i },
  { path: "/data/stocks-quotes-slim.json", kind: "json", maxBytes: MAX_BYTES["/data/stocks-quotes-slim.json"], cache: /stale-while-revalidate/i },
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
  const homeText = decodeBody(home.body, String(home.headers["content-encoding"] || ""));
  const version = detectVersion(homeText);
  if (!version) issues.push("home cannot detect frontend version");

  for (const target of TARGETS) {
    const result = target.path === "/" ? home : await fetchBuffer(target.path, target.versioned ? version : "");
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
