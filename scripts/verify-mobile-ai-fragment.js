const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const LIVE_BASE_URL = "https://fuman-terminal.vercel.app";
const FRAGMENT_VERSION = "mobile-ai-v1";
const FULL_HTML_BUDGET_BYTES = 30000;
const LITE_HTML_BUDGET_BYTES = 16000;
const ULTRA_HTML_BUDGET_BYTES = 9000;
const ULTRA_DOM_NODE_BUDGET = 90;
const MOBILE_SHELL_BUDGET_BYTES = 18000;
const MOBILE_TERMINAL_FRAGMENT_BUDGET_BYTES = 12000;
const MOBILE_TERMINAL_KEYS = ["strategy1", "strategy2", "strategy3", "strategy4", "strategy5", "chip", "warrant"];
const FRESHNESS_VALUES = new Set(["fresh", "stale", "expired"]);
const issues = [];

function argValue(name) {
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

const live = process.argv.includes("--live");
const baseUrl = (argValue("--base-url") || process.env.FUMAN_LIVE_BASE_URL || LIVE_BASE_URL).replace(/\/+$/, "");

function sha1(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function bytes(text) {
  return Buffer.byteLength(text);
}

function requireText(text, needle, message) {
  if (!text.includes(needle)) issues.push(message);
}

function countHtmlNodes(text) {
  return (String(text || "").match(/<([a-z][\w:-]*)(\s|>|\/)/gi) || []).length;
}

function readLocal(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

async function readLive(rel) {
  const url = `${baseUrl}/${rel.replace(/^\/+/, "")}?verify=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function readText(rel) {
  return live ? readLive(rel) : readLocal(rel);
}

async function readJson(rel) {
  return JSON.parse(await readText(rel));
}

async function maybeReadText(rel) {
  try {
    return await readText(rel);
  } catch (error) {
    return "";
  }
}

function checkDigestHash(digest, html, lite, ultra) {
  const htmlHash = sha1(html);
  if (digest.htmlHash !== htmlHash || digest.aiHash !== htmlHash) {
    issues.push(`mobile digest htmlHash/aiHash mismatch digest=${digest.htmlHash}/${digest.aiHash} actual=${htmlHash}`);
  }
  const htmlBytes = bytes(html);
  if (Number(digest.htmlBytes) !== htmlBytes) {
    issues.push(`mobile digest htmlBytes mismatch digest=${digest.htmlBytes} actual=${htmlBytes}`);
  }
  if (htmlBytes > FULL_HTML_BUDGET_BYTES) {
    issues.push(`mobile-ai-latest.html exceeds ${FULL_HTML_BUDGET_BYTES} bytes actual=${htmlBytes}`);
  }
  if (!lite) return { htmlHash, htmlBytes, liteBytes: 0, ultraBytes: 0 };
  const liteHash = sha1(lite);
  const liteBytes = bytes(lite);
  if (digest.liteHash !== liteHash) {
    issues.push(`mobile digest liteHash mismatch digest=${digest.liteHash} actual=${liteHash}`);
  }
  if (Number(digest.liteBytes) !== liteBytes) {
    issues.push(`mobile digest liteBytes mismatch digest=${digest.liteBytes} actual=${liteBytes}`);
  }
  if (liteBytes > LITE_HTML_BUDGET_BYTES) {
    issues.push(`mobile-ai-lite.html exceeds ${LITE_HTML_BUDGET_BYTES} bytes actual=${liteBytes}`);
  }
  if (liteBytes > htmlBytes) {
    issues.push("mobile-ai-lite.html must not be larger than mobile-ai-latest.html");
  }
  if (!ultra) return { htmlHash, htmlBytes, liteBytes, ultraBytes: 0 };
  const ultraHash = sha1(ultra);
  const ultraBytes = bytes(ultra);
  if (digest.ultraHash !== ultraHash) {
    issues.push(`mobile digest ultraHash mismatch digest=${digest.ultraHash} actual=${ultraHash}`);
  }
  if (Number(digest.ultraBytes) !== ultraBytes) {
    issues.push(`mobile digest ultraBytes mismatch digest=${digest.ultraBytes} actual=${ultraBytes}`);
  }
  if (ultraBytes > ULTRA_HTML_BUDGET_BYTES) {
    issues.push(`mobile-ai-ultra.html exceeds ${ULTRA_HTML_BUDGET_BYTES} bytes actual=${ultraBytes}`);
  }
  if (ultraBytes > liteBytes) {
    issues.push("mobile-ai-ultra.html must not be larger than mobile-ai-lite.html");
  }
  return { htmlHash, htmlBytes, liteBytes, ultraBytes };
}

async function main() {
  const html = await readText("data/mobile-ai-latest.html");
  const lite = await maybeReadText("data/mobile-ai-lite.html");
  const ultra = await maybeReadText("data/mobile-ai-ultra.html");
  const digest = await readJson("data/mobile-digest.json");
  const boot = await readJson("data/mobile-boot.json");
  const runtimeConfig = await readJson("data/mobile-runtime-config.json");
  const stockAnalysis = await readJson("data/mobile-stock-analysis-latest.json");
  const mobileShell = await readText("mobile.html");
  const packageJson = JSON.parse(readLocal("package.json"));
  const mobileEventScript = readLocal("scripts/publish-mobile-update-event.js");
  const terminalFragments = Object.fromEntries(await Promise.all(MOBILE_TERMINAL_KEYS.map(async (key) => [key, await readText(`data/mobile-${key}-ultra.html`)])));
  const app = await readText("terminal-app.js");
  const sw = await readText("fuman-sw.js");
  const css = await readText("styles.css");

  requireText(html, 'data-mobile-ai-fragment="1"', "mobile AI HTML must expose data-mobile-ai-fragment");
  requireText(html, 'data-mobile-ai-contract="root"', "mobile AI HTML must expose root contract");
  requireText(html, `data-mobile-ai-version="${FRAGMENT_VERSION}"`, "mobile AI HTML must expose fragment version");
  requireText(html, "market-ai-card", "mobile AI HTML must contain market-ai-card");
  requireText(html, "market-ai-stock-row", "mobile AI HTML must contain stock rows");
  requireText(html, "data-ai-stock-code", "mobile AI HTML must include analyze button selector");
  requireText(html, "data-ai-watch-code", "mobile AI HTML must include watch button selector");
  requireText(html, 'data-mobile-ai-contract="analyze"', "mobile AI HTML must include analyze contract");
  requireText(html, 'data-mobile-ai-contract="watch"', "mobile AI HTML must include watch contract");
  requireText(html, "data-mobile-ai-full-load", "mobile AI HTML must keep manual full-load escape hatch");
  requireText(html, "data-mobile-ai-stale-note", "mobile AI HTML must keep stale scan note");

  requireText(ultra, 'data-mobile-ai-variant="ultra"', "mobile AI ultra HTML must expose ultra variant");
  requireText(ultra, "data-ai-stock-code", "mobile AI ultra HTML must include analyze selector");
  requireText(ultra, "data-ai-watch-code", "mobile AI ultra HTML must include watch selector");
  const ultraNodes = countHtmlNodes(ultra);
  if (ultraNodes > ULTRA_DOM_NODE_BUDGET) {
    issues.push(`mobile-ai-ultra.html exceeds ${ULTRA_DOM_NODE_BUDGET} DOM nodes actual=${ultraNodes}`);
  }

  const { htmlHash, htmlBytes, liteBytes, ultraBytes } = checkDigestHash(digest, html, lite, ultra);

  if (digest.fragmentVersion !== FRAGMENT_VERSION) {
    issues.push(`mobile digest fragmentVersion mismatch digest=${digest.fragmentVersion} expected=${FRAGMENT_VERSION}`);
  }
  if (!FRESHNESS_VALUES.has(digest.freshness)) {
    issues.push(`mobile digest freshness must be fresh/stale/expired actual=${digest.freshness}`);
  }
  if (!digest.aiUpdatedAt) issues.push("mobile digest must include aiUpdatedAt");
  if (!digest.bias) issues.push("mobile digest must include bias");
  if (boot?.source !== "mobile-boot") issues.push("mobile boot must expose source=mobile-boot");
  if (runtimeConfig?.source !== "mobile-runtime-config") issues.push("mobile runtime config must expose source=mobile-runtime-config");
  if (!runtimeConfig?.supabaseAnonKey) issues.push("mobile runtime config must include supabase anon key");
  if (!runtimeConfig?.realtimeUrl || !runtimeConfig?.realtimeTable) issues.push("mobile runtime config must include realtime URL and table");
  if (stockAnalysis?.source !== "mobile-stock-analysis-latest") issues.push("mobile stock analysis must expose source=mobile-stock-analysis-latest");
  if (Number(stockAnalysis?.count || 0) < 3) issues.push("mobile stock analysis must include at least 3 stocks");
  if (!stockAnalysis?.analyses || typeof stockAnalysis.analyses !== "object") issues.push("mobile stock analysis must expose analyses map");
  const stockAnalysisRows = Object.values(stockAnalysis?.analyses || {});
  if (!stockAnalysisRows.some((row) => Array.isArray(row?.strategies) && row.strategies.length)) {
    issues.push("mobile stock analysis must include precomputed terminal strategy matches");
  }
  if (!stockAnalysisRows.some((row) => String(row?.signalsText || "").includes("策略"))) {
    issues.push("mobile stock analysis signalsText must include terminal strategy labels");
  }
  if (boot?.digest?.ultraHash !== digest.ultraHash) issues.push("mobile boot digest ultraHash must match mobile digest");
  if (boot?.lowPower?.lowEndVariant !== "ultra") issues.push("mobile boot lowPower.lowEndVariant must be ultra");
  for (const key of MOBILE_TERMINAL_KEYS) {
    const fragment = terminalFragments[key] || "";
    const fragmentBytes = bytes(fragment);
    requireText(fragment, 'data-mobile-terminal-fragment="1"', `mobile ${key} fragment must expose data-mobile-terminal-fragment`);
    requireText(fragment, `data-mobile-fragment-key="${key}"`, `mobile ${key} fragment must expose fragment key`);
    if (fragmentBytes > MOBILE_TERMINAL_FRAGMENT_BUDGET_BYTES) {
      issues.push(`mobile-${key}-ultra.html exceeds ${MOBILE_TERMINAL_FRAGMENT_BUDGET_BYTES} bytes actual=${fragmentBytes}`);
    }
    if (boot?.fragments?.[key]?.hash !== sha1(fragment)) {
      issues.push(`mobile boot fragment hash mismatch key=${key}`);
    }
    if (Number(boot?.fragments?.[key]?.bytes) !== fragmentBytes) {
      issues.push(`mobile boot fragment bytes mismatch key=${key}`);
    }
  }

  requireText(app, "installMobileAiExtremeMode", "terminal-app.js must install mobile AI extreme mode");
  requireText(app, "loadMobileBoot", "terminal-app.js must load mobile boot bundle");
  requireText(app, "isFumanLowPowerMode", "terminal-app.js must support global low power mode");
  requireText(app, "mobileDigest", "terminal-app.js must define mobileDigest endpoint");
  requireText(app, "mobileAiLite", "terminal-app.js must define mobileAiLite endpoint");
  requireText(app, "mobileAiUltra", "terminal-app.js must define mobileAiUltra endpoint");
  requireText(app, "forceMobileAiUltra", "terminal-app.js must support forceMobileAiUltra");
  requireText(app, "selectMobileAiVariant", "terminal-app.js must select mobile AI full/lite/ultra variants");
  requireText(app, "!force&&mobileAiDigestPayload?mobileAiDigestPayload", "terminal-app.js must reuse mobile boot digest before fetching digest");
  requireText(app, '"ultra"!==marketAiPanel.dataset.mobileAiVariant', "terminal-app.js must skip extra DOM binding for ultra fragment");
  requireText(app, "forceMobileAiLite", "terminal-app.js must support forceMobileAiLite");
  requireText(app, "mobile-ai-latest.html", "terminal-app.js must fetch mobile AI HTML");
  requireText(app, "data-mobile-ai-full-load", "terminal-app.js must handle manual full-load escape hatch");
  requireText(app, "data-mobile-ai-stale-note", "terminal-app.js must update stale scan note");
  requireText(app, "freshness", "terminal-app.js must use digest freshness");
  requireText(app, "lowPower", "terminal-app.js must report low power telemetry");
  requireText(app, "variant", "terminal-app.js must report mobile AI variant telemetry");

  requireText(sw, "/data/mobile-digest.json", "service worker must prefetch/cache mobile digest");
  requireText(sw, "/data/mobile-boot.json", "service worker must prefetch/cache mobile boot");
  requireText(sw, "/data/mobile-ai-latest.html", "service worker must prefetch/cache mobile AI HTML");
  requireText(sw, "/data/mobile-ai-lite.html", "service worker must prefetch/cache mobile AI lite HTML");
  requireText(sw, "/data/mobile-ai-ultra.html", "service worker must prefetch/cache mobile AI ultra HTML");
  requireText(sw, "PREFETCH_DATA_LOW_POWER", "service worker must support low-power prefetch");
  requireText(sw, "/\\/data\\/mobile-digest\\.json/i", "service worker must network-first mobile digest");

  requireText(css, "mobile-ai-fragment", "styles.css must include mobile AI fragment rules");
  requireText(css, "fuman-low-power", "styles.css must include global low-power rules");
  requireText(css, "fuman-no-images", "styles.css must include low-power no-images rules");
  requireText(css, "content-visibility: auto", "styles.css must keep mobile AI content-visibility");
  const runtime = await readText("terminal-runtime-config.js");
  requireText(runtime, "forceMobileAiUltra: true", "runtime config must force all mobile AI to ultra for lowest heat");
  const mobileShellBytes = bytes(mobileShell);
  if (mobileShellBytes > MOBILE_SHELL_BUDGET_BYTES) {
    issues.push(`mobile.html exceeds ${MOBILE_SHELL_BUDGET_BYTES} bytes actual=${mobileShellBytes}`);
  }
  requireText(mobileShell, "/data/mobile-boot.json", "mobile shell must fetch mobile boot");
  requireText(mobileShell, "/data/mobile-runtime-config.json", "mobile shell must fetch mobile runtime config");
  requireText(mobileShell, "/data/mobile-ai-ultra.html", "mobile shell must fetch ultra fragment");
  requireText(mobileShell, "data-fragment=\"strategy5\"", "mobile shell must expose strategy tabs");
  requireText(mobileShell, "data-fragment=\"watch\"", "mobile shell must expose watchlist tab");
  requireText(mobileShell, "fuman_mobile_watchlist_v1", "mobile shell must persist watchlist locally");
  requireText(mobileShell, "data-ai-stock-code", "mobile shell must handle analyze buttons");
  requireText(mobileShell, "data-ai-watch-code", "mobile shell must handle watch buttons");
  requireText(mobileShell, "/data/mobile-stock-analysis-latest.json", "mobile shell must fetch stock analysis JSON");
  requireText(mobileShell, "analysisFor", "mobile shell must use precomputed stock analysis");
  requireText(mobileShell, "data-watch-remove", "mobile shell must support removing watchlist rows");
  requireText(mobileShell, "mobile-modal", "mobile shell must show lightweight analysis modal");
  requireText(mobileShell, "boot?.fragments?.[k]?.url", "mobile shell must fetch strategy fragments from boot");
  requireText(mobileShell, "mobile_update_events", "mobile shell must subscribe to mobile update events");
  requireText(mobileShell, "WebSocket", "mobile shell must use realtime push updates");
  requireText(mobileShell, "postgres_changes", "mobile shell must handle Supabase realtime postgres changes");
  requireText(mobileShell, "realtimeUpdate", "mobile shell must retry after realtime update if boot hash is unchanged");
  requireText(mobileShell, "setInterval(()=>{if(!document.hidden&&active!==\"watch\")load(false)},120000)", "mobile shell must keep 120s polling fallback");
  if (mobileShell.includes(String(runtimeConfig?.supabaseAnonKey || "__missing__"))) {
    issues.push("mobile shell must not hardcode supabase anon key");
  }
  if (!String(packageJson?.scripts?.["mobile:update-event"] || "").includes("publish-mobile-update-event.js")) {
    issues.push("package.json must expose mobile:update-event script");
  }
  if (!String(packageJson?.scripts?.["verify:mobile-realtime"] || "").includes("verify-mobile-realtime.js")) {
    issues.push("package.json must expose verify:mobile-realtime script");
  }
  if (!String(packageJson?.scripts?.postdeploy || "").includes("verify-mobile-realtime.js")) {
    issues.push("postdeploy must verify mobile realtime before publishing event");
  }
  if (!String(packageJson?.scripts?.postdeploy || "").includes("publish-mobile-update-event.js --source=postdeploy")) {
    issues.push("postdeploy must publish mobile update event after live verification");
  }
  requireText(mobileEventScript, "mobile_update_events", "mobile update event publisher must write mobile_update_events");
  requireText(mobileEventScript, "SUPABASE_SERVICE_ROLE_KEY", "mobile update event publisher must use service role key");
  requireText(mobileEventScript, "data/mobile-boot.json", "mobile update event publisher must read mobile boot");
  requireText(mobileEventScript, "MOBILE_UPDATE_EVENT_RETENTION_DAYS", "mobile update event publisher must support cleanup retention");
  if (mobileShell.includes("terminal-app.js") || mobileShell.includes("styles.css") || mobileShell.includes("serviceWorker.register")) {
    issues.push("mobile shell must not load full terminal app/css/service worker");
  }
  if (css.includes("#market-view #market-ai-panel,")) {
    issues.push("mobile AI containment must not wrap the entire #market-ai-panel");
  }

  if (issues.length) {
    console.error(`[mobile-ai-fragment${live ? ":live" : ""}] failed`);
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }

  console.log(`[mobile-ai-fragment${live ? ":live" : ""}] ok htmlBytes=${htmlBytes} htmlHash=${htmlHash} liteBytes=${liteBytes} ultraBytes=${ultraBytes} ultraNodes=${ultraNodes} freshness=${digest.freshness} version=${digest.fragmentVersion}`);
}

main().catch((error) => {
  console.error(`[mobile-ai-fragment${live ? ":live" : ""}] failed`);
  console.error(error?.stack || error);
  process.exit(1);
});
