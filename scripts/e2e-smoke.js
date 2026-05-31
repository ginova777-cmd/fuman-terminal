const https = require("https");

const baseUrl = (process.env.FUMAN_SMOKE_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const version = process.env.FUMAN_SMOKE_VERSION || "speed-modules-20260531-32";

function fetchText(pathname, timeoutMs = 20000) {
  const url = `${baseUrl}${pathname}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ url, status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function assertOk(name, result, check = () => true) {
  if (result.status < 200 || result.status >= 300) throw new Error(`${name} HTTP ${result.status}`);
  if (!check(result)) throw new Error(`${name} content failed`);
  console.log(`[smoke] ${name} ok`);
}

async function main() {
  const checks = [
    ["home", "/", (r) => r.body.includes(`terminal-core.js?v=${version}`)],
    ["core-loader", `/terminal-core.js?v=${version}`, (r) => r.body.includes("terminal.js")],
    ["terminal-bootstrap", `/terminal.js?v=${version}`, (r) => r.body.includes("FUMAN_TERMINAL_LOAD_APP") && r.body.includes("terminal-app.js")],
    ["sector-map", `/terminal-sector-map.js?v=${version}`, (r) => r.body.includes("FUMAN_SECTOR_MAP") && r.body.includes("SECTOR_MAP")],
    ["strategy-config", `/terminal-strategy-config.js?v=${version}`, (r) => r.body.includes("FUMAN_STRATEGY_CONFIG") && r.body.includes("STRATEGY_DEFS")],
    ["market-config", `/terminal-market-config.js?v=${version}`, (r) => r.body.includes("FUMAN_MARKET_CONFIG") && r.body.includes("HEATMAP_FILTERS")],
    ["ui-config", `/terminal-ui-config.js?v=${version}`, (r) => r.body.includes("FUMAN_UI_CONFIG") && r.body.includes("technicalTimeframes")],
    ["runtime-config", `/terminal-runtime-config.js?v=${version}`, (r) => r.body.includes("FUMAN_RUNTIME_CONFIG") && r.body.includes("strategy2IntradayCache")],
    ["tuning-config", `/terminal-tuning-config.js?v=${version}`, (r) => r.body.includes("FUMAN_TUNING_CONFIG") && r.body.includes("realtimeRadarRefreshMs")],
    ["terminal-app", `/terminal-app.js?v=${version}`, (r) => r.body.includes("loadStrategyWeights") && r.body.includes("recordFrontendError")],
    ["chip-flow-module", `/terminal-chip-flow.js?v=${version}`, (r) => r.body.includes("FUMAN_CHIP_FLOW_MODULE") && r.body.includes("renderChipTradeTable")],
    ["warrant-flow-module", `/terminal-warrant-flow.js?v=${version}`, (r) => r.body.includes("FUMAN_WARRANT_FLOW_MODULE") && r.body.includes("renderWarrantFlow")],
    ["realtime-radar-css", `/terminal-realtime-radar.css?v=${version}`, (r) => r.body.includes("radar-signal-card")],
    ["intraday-radar-css", `/terminal-intraday-radar.css?v=${version}`, (r) => r.body.includes("intraday-signal-card")],
    ["utility-css", `/terminal-utility.css?v=${version}`, (r) => r.body.includes("fuman-skeleton") && r.body.includes("fuman-health-performance")],
    ["theme-css", `/terminal-theme.css?v=${version}`, (r) => r.body.includes("fuman-light-theme")],
    ["watchlist-css", `/terminal-watchlist.css?v=${version}`, (r) => r.body.includes("watch-analysis-panel")],
    ["modules", `/terminal-modules.js?v=${version}`, (r) => r.body.includes("FUMAN_TERMINAL_MODULES")],
    ["worker", `/terminal-worker.js?v=${version}`, (r) => r.body.includes("swingBuckets")],
    ["health", "/data/health-summary.json?v=smoke", (r) => typeof JSON.parse(r.body).ok === "boolean"],
    ["weights", "/data/strategy-weight-report.json?v=smoke", (r) => !!JSON.parse(r.body).weights],
  ];
  for (const [name, pathname, check] of checks) {
    assertOk(name, await fetchText(pathname), check);
  }
  console.log("[smoke] e2e smoke ok");
}

main().catch((error) => {
  console.error(`[smoke] failed: ${error.message}`);
  process.exit(1);
});
