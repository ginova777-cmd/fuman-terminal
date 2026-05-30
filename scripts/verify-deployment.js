const https = require("https");

const baseUrl = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const version = process.env.FUMAN_VERIFY_VERSION || "speed-modules-20260530-6";

function fetchText(pathname, timeoutMs = 20000) {
  const url = `${baseUrl}${pathname}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ url, status: res.statusCode, headers: res.headers, body }));
    });
    req.on("timeout", () => {
      req.destroy(new Error(`timeout ${url}`));
    });
    req.on("error", reject);
  });
}

function assertOk(name, result, check = () => true) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${name} HTTP ${result.status}`);
  }
  if (!check(result)) {
    throw new Error(`${name} content check failed`);
  }
  console.log(`[verify] ${name} ok ${result.status}`);
}

async function main() {
  const checks = [
    ["home", "/", (r) => r.body.includes(`terminal-core.js?v=${version}`)],
    ["core", `/terminal-core.js?v=${version}`, (r) => r.body.includes("terminal-modules.js")],
    ["modules", `/terminal-modules.js?v=${version}`, (r) => r.body.includes("FUMAN_TERMINAL_MODULES")],
    ["worker", `/terminal-worker.js?v=${version}`, (r) => r.body.includes("swingBuckets")],
    ["service-worker", `/fuman-sw.js?v=${version}`, (r) => r.body.includes("strategy2-intraday-latest") && r.body.includes("realtime-radar-latest")],
    ["terminal", `/terminal.js?v=${version}`, (r) => r.body.includes("FUMAN_LIVE_MEMORY_TTL_MS") && r.body.includes("healthRiskLevel")],
    ["health", "/data/health-summary.json?v=verify", (r) => {
      const payload = JSON.parse(r.body);
      return payload.ok === true && ["low", "medium", "high"].includes(payload.risk);
    }],
    ["strategy4-slim", "/data/strategy4-slim.json?v=verify", (r) => JSON.parse(r.body).count > 0],
    ["strategy4-zone-a", "/data/strategy4-zone-a.json?v=verify", (r) => JSON.parse(r.body).count >= 0],
    ["institution-joint-top", "/data/institution-joint-top.json?v=verify", (r) => JSON.parse(r.body).count > 0],
    ["warrant-priority-top", "/data/warrant-priority-top.json?v=verify", (r) => JSON.parse(r.body).count > 0],
    ["performance-report", "/data/performance-report.json?v=verify", (r) => JSON.parse(r.body).assets?.length > 0],
    ["signal-quality", "/data/signal-quality-report.json?v=verify", (r) => JSON.parse(r.body).ok === true],
    ["data-quality", "/data/data-quality-report.json?v=verify", (r) => typeof JSON.parse(r.body).ok === "boolean"],
    ["data-consistency", "/data/data-consistency-report.json?v=verify", (r) => JSON.parse(r.body).ok === true],
  ];
  for (const [name, path, check] of checks) {
    const result = await fetchText(path);
    assertOk(name, result, check);
  }
  console.log("[verify] deployment ok");
}

main().catch((error) => {
  console.error(`[verify] failed: ${error.message}`);
  process.exit(1);
});
