const BASE_URL = (process.env.FUMAN_DEPLOY_URL || "https://fuman-terminal.vercel.app").replace(/\/$/, "");
const REQUIRED_TERMINAL_MARKERS = (process.env.DEPLOY_VERIFY_TERMINAL_MARKERS || "")
  .split(",")
  .map((text) => text.trim())
  .filter(Boolean);
const REQUIRED_STRATEGY2_MARKERS = (process.env.DEPLOY_VERIFY_STRATEGY2_MARKERS || "ma35Source")
  .split(",")
  .map((text) => text.trim())
  .filter(Boolean);

async function fetchText(path) {
  const response = await fetch(`${BASE_URL}${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.text();
}

function assertMarkers(label, text, markers) {
  const missing = markers.filter((marker) => !text.includes(marker));
  if (missing.length) throw new Error(`${label} missing markers: ${missing.join(", ")}`);
}

async function main() {
  const terminalJs = await fetchText("/terminal.js");
  assertMarkers("terminal.js", terminalJs, REQUIRED_TERMINAL_MARKERS);
  const strategy2Json = await fetchText("/data/strategy2-intraday-latest.json");
  assertMarkers("strategy2 latest", strategy2Json, REQUIRED_STRATEGY2_MARKERS);
  console.log(`deploy content verified: ${BASE_URL}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
