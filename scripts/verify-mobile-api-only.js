const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

function responseFromPowerShell(payload) {
  const headers = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
  return {
    ok: payload?.status >= 200 && payload?.status < 300,
    status: Number(payload?.status || 0),
    headers: {
      get(key) {
        const found = Object.keys(headers).find((item) => item.toLowerCase() === String(key).toLowerCase());
        return found ? String(headers[found] || "") : "";
      },
    },
  };
}

function fetchLiveWithPowerShell(url) {
  const safeUrl = String(url).replace(/'/g, "''");
  const command = [
    "$ProgressPreference='SilentlyContinue'",
    "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12",
    `$u='${safeUrl}'`,
    "try {",
    "  $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 45 -Headers @{'Cache-Control'='no-cache';'Accept'='*/*'} $u",
    "  $h=@{}; foreach($k in $r.Headers.Keys){ $h[$k]=[string]$r.Headers[$k] }",
    "  [pscustomobject]@{ok=$true;status=[int]$r.StatusCode;headers=$h;text=[string]$r.Content} | ConvertTo-Json -Depth 8",
    "} catch {",
    "  [pscustomobject]@{ok=$false;status=0;headers=@{};text='';error=$_.Exception.Message} | ConvertTo-Json -Depth 4",
    "  exit 2",
    "}",
  ].join("; ");
  const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const result = spawnSync(powershell, ["-NoProfile", "-Command", command], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  });
  const stdout = String(result.stdout || "").trim();
  let payload = null;
  try { payload = JSON.parse(stdout); } catch {}
  if (result.status !== 0 || !payload?.ok) {
    throw new Error(payload?.error || result.stderr || `PowerShell fetch failed status=${result.status}`);
  }
  return {
    response: responseFromPowerShell(payload),
    text: String(payload.text || ""),
  };
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
  requireText(mobile, 'fetch(fresh(url),{cache:"no-store",headers:authHeaders()})', "mobile JSON fetches must be no-store");
  requireText(mobile, "mobile-auth-actions", "mobile shell must expose login/signup/logout actions");
  requireText(mobile, "mobile-logout-button", "mobile shell must expose logout action");
  requireText(mobile, "data-mobile-auth-lock", "mobile shell must lock content before membership is confirmed");
  requireText(mobile, "function renderAuthGate", "mobile shell must render a membership gate before protected data");
  requireText(mobile, 'if(active==="ai"){renderAi();loadFragment(active,force).then', "mobile shell must paint AI summary before waiting for fragment HTML");
  requireText(mobile, "boot_hash", "mobile Realtime must compare boot_hash before refetch");
  requireText(mobile, "setInterval(()=>{if(!document.hidden&&active!==\"watch\")load(false)},120000)", "mobile must keep 120s polling fallback only as backup");
  requireText(mobile, "cache.get(k)?.hash===h", "mobile fragments must render from hash contract instead of recalculating data");
  requireText(mobile, "location.reload", "mobile must have a hard reload path when the API-only contract reports a new incompatible run");
  requireText(mobile, 'html[data-sun="1"]', "mobile sunlight selector must quote attribute value so phones apply it");
  requireText(mobile, "FUMAN_MOBILE_ADD_WATCH", "mobile watchlist must expose a shared add-watch pipeline");
  requireText(mobile, "FUMAN_MOBILE_MANUAL_WATCH_ADD", "mobile watchlist must expose a timeout-safe manual add pipeline");
  requireText(mobile, "FUMAN_MOBILE_MANUAL_WATCH_ADD_V2", "mobile watchlist must expose the direct-render V2 manual add pipeline");
  requireText(mobile, "mobile-watch-v2-direct-render-20260628-04", "mobile watchlist must carry the direct-render hotfix marker");
  requireText(mobile, "mobile-watch-v2-early-bridge-20260628-01", "mobile watchlist V2 must intercept clicks before legacy document-capture handlers");
  requireText(mobile, "mobile-watch-v2-rescue-render-20260628-01", "mobile watchlist V2 must rescue visible success states that old handlers leave without cards");
  requireText(mobile, "mobile-watch-success-status-render-20260628-01", "mobile watchlist V2 must render a card when a legacy success status is visible without rows");
  requireText(mobile, "mobile-watch-merge-storage-20260629-01", "mobile watchlist V2 must merge primary and mobile storage keys before rendering rows");
  requireText(mobile, "parseStoredRows(KEY)", "mobile watchlist V2 must read the primary watchlist storage key");
  requireText(mobile, "parseStoredRows(MOBILE_KEY)", "mobile watchlist V2 must read the mobile watchlist storage key");
  requireText(mobile, "parseRows(KEY)", "mobile watchlist rescue renderer must read the primary watchlist storage key");
  requireText(mobile, "parseRows(MOBILE_KEY)", "mobile watchlist rescue renderer must read the mobile watchlist storage key");
  requireText(mobile, "mobile-watch-v2-add-recovery-20260628-01", "mobile watchlist V2 must recover valid adds that get stuck at confirming without rendering cards");
  requireText(mobile, "mobile-watch-v2-stuck-status-recovery-20260628-01", "mobile watchlist V2 must recover manual adds stuck on the confirming status text");
  requireText(mobile, "event.composedPath", "mobile watchlist V2 click bridge must detect button clicks through composedPath");
  requireText(mobile, "mobile-tab-request-lock-20260628-01", "mobile tabs must keep the request-lock loader so old fragment loads cannot overwrite the newest tab");
  requireText(mobile, "/api/mobile-watch-meta?code=", "mobile watchlist must validate one stock code through the small meta API before static fallback");
  requireText(mobile, "MutationObserver", "mobile watchlist V2 must guard against the legacy watch renderer overwriting cards");
  requireText(mobile, "callback=", "mobile watchlist V2 must keep JSONP fallback when fetch is unavailable");
  requireText(mobile, "memoryRows", "mobile watchlist V2 must render cards even when localStorage setItem is unavailable");
  requireText(mobile, "storageFallback", "mobile watchlist memory fallback must only take over after storage read/write failures");
  requireText(mobile, "localStorage.getItem(KEY) === value", "mobile watchlist storage writes must be read back before disabling the memory fallback");
  requireText(mobile, "mobile-watch-input", "mobile watchlist tab must render a stock-code input");
  requireText(mobile, "data-mobile-watch-add", "mobile watchlist tab must render an add button");
  requireText(mobile, "不是有效上市/上櫃台股代號", "mobile watchlist must reject invalid Taiwan stock codes");

  rejectText(mobile, 'bootUrl="/data/mobile-boot.json"', "mobile shell must not poll static /data/mobile-boot.json");
  rejectText(mobile, "/data/mobile-terminal-latest.json", "mobile shell must not use mobile-terminal-latest.json as runtime fallback");
  rejectText(mobile, "/data/mobile-digest.json", "mobile shell must not poll mobile-digest.json directly");
  rejectText(mobile, "backup.json", "mobile shell must not use backup JSON fallback");
  rejectText(mobile, "freshness:gate", "mobile shell must not invoke freshness gate as data repair");
  rejectText(mobile, "release:main", "mobile shell must not invoke release pipeline as data repair");
  rejectText(mobile, "vercel --prod", "mobile shell must not invoke deploy as data repair");
  rejectText(mobile, "serviceWorker.register", "mobile shell must not register SW or depend on SW cache for latest data");
  rejectText(mobile, "localStorage.getItem(KEY) || localStorage.getItem(MOBILE_KEY)", "mobile watchlist must merge both storage keys instead of reading the first non-empty key");
  rejectText(mobile, "localStorage.getItem(w)||localStorage.getItem(l)", "legacy mobile shell fallback must merge both storage keys instead of reading the first non-empty key");
}

function checkApiBoot() {
  const apiBoot = read("api/mobile-boot.js");
  const fragmentApi = read("api/mobile-fragment.js");
  const mobileWatchMeta = read("api/mobile-watch-meta.js");
  requireText(apiBoot, 'Cache-Control", "no-store', "/api/mobile-boot must be browser no-store");
  requireText(apiBoot, 'CDN-Cache-Control", "no-store', "/api/mobile-boot must be CDN no-store");
  requireText(apiBoot, 'Vercel-CDN-Cache-Control", "no-store', "/api/mobile-boot must be Vercel CDN no-store");
  requireText(apiBoot, "/api/mobile-fragment?tab=", "/api/mobile-boot must point strategy tabs to API-rendered fragments");
  requireText(apiBoot, "function fastWaitingPayload", "mobile boot must not wait for every strategy endpoint before painting");
  for (const endpoint of ["/api/strategy2-latest", "/api/strategy3-latest", "/api/strategy4-latest", "/api/strategy5-latest", "/api/institution-latest", "/api/cb-detect-latest", "/api/warrant-flow-latest"]) {
    requireText(apiBoot, endpoint, `/api/mobile-boot must derive mobile fragments from ${endpoint}`);
    requireText(fragmentApi, endpoint, `/api/mobile-fragment must render rows from ${endpoint}`);
  }
  for (const staleFragment of ["mobile-strategy1-ultra.html", "mobile-strategy2-ultra.html", "mobile-strategy3-ultra.html", "mobile-strategy4-ultra.html", "mobile-strategy5-ultra.html", "mobile-chip-ultra.html", "mobile-cb-ultra.html", "mobile-warrant-ultra.html"]) {
    rejectText(apiBoot, staleFragment, `/api/mobile-boot must not point tabs to static ${staleFragment}`);
  }
  rejectText(apiBoot, "backup.json", "/api/mobile-boot must not fall back to backup JSON");
  rejectText(apiBoot, "freshness:gate", "/api/mobile-boot must not trigger freshness gate as repair");
  rejectText(apiBoot, "release:main", "/api/mobile-boot must not trigger release pipeline as repair");
  rejectText(apiBoot, "vercel --prod", "/api/mobile-boot must not trigger Vercel deploy as repair");
  requireText(fragmentApi, 'Cache-Control", "no-store', "/api/mobile-fragment must be browser no-store");
  requireText(fragmentApi, "data-run-id", "/api/mobile-fragment must expose API runId in the rendered fragment");
  requireText(mobileWatchMeta, "stocks-index.json", "/api/mobile-watch-meta must read the compact stock index");
  requireText(mobileWatchMeta, "stocks-slim.json", "/api/mobile-watch-meta must fall back to the full stock universe");
  requireText(mobileWatchMeta, "valid", "/api/mobile-watch-meta must return a valid boolean");
  requireText(mobileWatchMeta, "callback", "/api/mobile-watch-meta must support JSONP callback fallback");
  requireText(mobileWatchMeta, 'Cache-Control", "no-store', "/api/mobile-watch-meta must be no-store");
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
  requireText(eventScript, "/api/mobile-boot", "mobile update events must read API-only mobile boot");
  requireText(eventScript, "MOBILE_UPDATE_EVENT_BOOT_SOURCE", "mobile update events must require explicit legacy mode before reading static boot");
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
  try {
    return fetchLiveWithPowerShell(url);
  } catch (fallbackError) {
    throw new Error(`fetchLive failed ${clean}: ${lastError?.cause?.message || lastError?.message || lastError}; powershell fallback failed: ${fallbackError?.message || fallbackError}`);
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isMembershipLockedJson(payload) {
  return Boolean(payload && (
    payload.membershipRequired === true ||
    payload.protected === true ||
    payload.error === "membership_required" ||
    payload.code === "membership_required"
  ));
}

function isMembershipLockedHtml(text) {
  return /membership-required|data-membership-required|會員權限|開通權限|請登入已開通帳號/.test(String(text || ""));
}

function assertNoProtectedMobileLeak(payload, label) {
  const fragments = payload?.fragments && typeof payload.fragments === "object" ? payload.fragments : {};
  const protectedTabs = ["strategy2", "strategy3", "strategy4", "strategy5", "chip", "cb", "warrant"];
  for (const tab of protectedTabs) {
    if (fragments[tab]) pushIssue(`${label} leaked protected fragment ${tab} while membershipRequired=true`);
  }
  const runs = payload?.runs && typeof payload.runs === "object" ? payload.runs : {};
  for (const tab of protectedTabs) {
    if (runs[tab]) pushIssue(`${label} leaked protected run ${tab} while membershipRequired=true`);
  }
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
  if (!mobile.text.includes("FUMAN_MOBILE_MANUAL_WATCH_ADD_V2") || !mobile.text.includes("mobile-watch-v2-direct-render-20260628-04")) {
    pushIssue("live /mobile must include the direct-render mobile watchlist V2 hotfix");
  }
  const mobilePage = await fetchLive("api/mobile-page");
  if (!mobilePage.response.ok) pushIssue(`live /api/mobile-page returned ${mobilePage.response.status}`);
  if (!mobilePage.text.includes("FUMAN_MOBILE_MANUAL_WATCH_ADD_V2") || !mobilePage.text.includes("mobile-watch-v2-direct-render-20260628-04")) {
    pushIssue("live /api/mobile-page must include the direct-render mobile watchlist V2 hotfix");
  }
  const validMeta = await fetchLive("api/mobile-watch-meta?code=2327");
  if (!validMeta.response.ok) pushIssue(`live /api/mobile-watch-meta?code=2327 returned ${validMeta.response.status}`);
  let validMetaJson = null;
  try { validMetaJson = JSON.parse(validMeta.text); } catch {}
  if (!validMetaJson?.valid || validMetaJson?.stock?.code !== "2327" || !validMetaJson?.stock?.name) {
    pushIssue("live /api/mobile-watch-meta must validate 2327 with stock meta");
  }
  const invalidMeta = await fetchLive("api/mobile-watch-meta?code=2334");
  if (!invalidMeta.response.ok) pushIssue(`live /api/mobile-watch-meta?code=2334 returned ${invalidMeta.response.status}`);
  let invalidMetaJson = null;
  try { invalidMetaJson = JSON.parse(invalidMeta.text); } catch {}
  if (invalidMetaJson?.valid !== false || invalidMetaJson?.stock) {
    pushIssue("live /api/mobile-watch-meta must reject invalid 2334");
  }
  const boot = await fetchLive("api/mobile-boot");
  if (!boot.response.ok) pushIssue(`live /api/mobile-boot returned ${boot.response.status}`);
  if (!/no-store/i.test(boot.response.headers.get("cache-control") || "")) {
    pushIssue(`live /api/mobile-boot must be no-store actual=${boot.response.headers.get("cache-control") || "<missing>"}`);
  }
  if (!/no-store/i.test(boot.response.headers.get("cdn-cache-control") || "")) {
    pushIssue(`live /api/mobile-boot CDN must be no-store actual=${boot.response.headers.get("cdn-cache-control") || "<missing>"}`);
  }
  const bootJson = parseJson(boot.text);
  const bootMembershipLocked = isMembershipLockedJson(bootJson);
  if (bootMembershipLocked) {
    assertNoProtectedMobileLeak(bootJson, "live /api/mobile-boot");
    const publicSurfaces = Array.isArray(bootJson?.publicSurfaces) ? bootJson.publicSurfaces : [];
    for (const publicSurface of ["market-overview", "market-ai", "learning-plan"]) {
      if (!publicSurfaces.includes(publicSurface)) {
        pushIssue(`live /api/mobile-boot membership lock must list public surface ${publicSurface}`);
      }
    }
  } else {
    for (const tab of ["strategy2", "strategy3", "strategy4", "strategy5", "chip", "cb", "warrant"]) {
      const fragment = bootJson?.fragments?.[tab];
      if (!String(fragment?.url || "").startsWith("/api/mobile-fragment?tab=")) {
        pushIssue(`live /api/mobile-boot fragment ${tab} must point to /api/mobile-fragment actual=${fragment?.url || "<missing>"}`);
        continue;
      }
      if (!fragment?.runId) pushIssue(`live /api/mobile-boot fragment ${tab} missing runId`);
    }
  }
  const strategy2Fragment = await fetchLive("api/mobile-fragment?tab=strategy2");
  const strategy2FragmentJson = parseJson(strategy2Fragment.text);
  const strategy2MembershipLocked = strategy2Fragment.response.status === 401 &&
    (isMembershipLockedJson(strategy2FragmentJson) || isMembershipLockedHtml(strategy2Fragment.text));
  if (!strategy2Fragment.response.ok && !strategy2MembershipLocked) pushIssue(`live /api/mobile-fragment?tab=strategy2 returned ${strategy2Fragment.response.status}`);
  if (!/no-store/i.test(strategy2Fragment.response.headers.get("cache-control") || "")) {
    pushIssue(`live /api/mobile-fragment must be no-store actual=${strategy2Fragment.response.headers.get("cache-control") || "<missing>"}`);
  }
  if (strategy2MembershipLocked) {
    if (!isMembershipLockedHtml(strategy2Fragment.text)) {
      pushIssue("live /api/mobile-fragment?tab=strategy2 membership lock must render locked HTML");
    }
    if (/data-run-id|mobile-terminal-row/.test(strategy2Fragment.text)) {
      pushIssue("live /api/mobile-fragment?tab=strategy2 leaked protected rows while membership locked");
    }
  } else {
    if (!strategy2Fragment.text.includes("data-run-id")) {
      pushIssue("live /api/mobile-fragment must render data-run-id");
    }
    if (/empty-state/.test(strategy2Fragment.text) || !/mobile-terminal-row/.test(strategy2Fragment.text)) {
      pushIssue("live /api/mobile-fragment?tab=strategy2 must render Strategy2 cards instead of empty-state");
    }
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

