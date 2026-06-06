const https = require("https");

const BASE_URL = process.env.FUMAN_TERMINAL_URL || "https://fuman-terminal.vercel.app";
const TARGETS = [
  "/terminal-app.js?v=deep-speed-20260606",
  "/data/strategy4-slim.json",
  "/data/strategy4-score-top.json",
  "/data/stocks-slim.json",
  "/data/terminal-home-bundle.json",
];

function request(pathname) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, BASE_URL);
    const req = https.request(url, {
      method: "GET",
      headers: {
        "Accept-Encoding": "br,gzip",
        "User-Agent": "FumanTerminalCompressionCheck/1.0",
      },
    }, (res) => {
      let bytes = 0;
      res.on("data", (chunk) => { bytes += chunk.length; });
      res.on("end", () => resolve({
        path: pathname,
        status: res.statusCode,
        encoding: String(res.headers["content-encoding"] || ""),
        contentType: String(res.headers["content-type"] || ""),
        cacheControl: String(res.headers["cache-control"] || ""),
        bytes,
      }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error(`timeout ${pathname}`));
    });
    req.end();
  });
}

async function main() {
  const results = await Promise.all(TARGETS.map(request));
  let ok = true;
  for (const item of results) {
    const compressed = item.encoding === "br" || item.encoding === "gzip";
    const pass = item.status >= 200 && item.status < 400 && compressed;
    if (!pass) ok = false;
    console.log(`${pass ? "OK" : "WARN"} ${item.path} status=${item.status} encoding=${item.encoding || "none"} bytes=${item.bytes}`);
  }
  if (!ok) {
    console.error("compression check found uncompressed or failed responses");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`compression check failed: ${error.message}`);
  process.exitCode = 1;
});
