const { resolveProtectedReadbackCredential, protectedReadbackHeaders } = require("../lib/protected-readback-credential");

const BASE_URL = process.env.FUMAN_TERMINAL_URL || "https://fuman-terminal.vercel.app";
const EXPECTED_CONTRACT = "daytrade_mother_pool_skeleton_v1";
const EXPECTED_BASELINE = "public-terminal-fast-20260714-22";
const EXPECTED_BASELINE_COMMIT = "4d6ba88c19c5924093fcbe8afb0566df3c80a921";

const requiredLiveTabs = [
  {
    name: "strategy3",
    path: "/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    bundlePath: "/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
  },
  {
    name: "strategy4",
    path: "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    bundlePath: "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1",
  },
  {
    name: "strategy5",
    path: "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    bundlePath: "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=140&live=1",
  },
  {
    name: "institution",
    path: "/api/institution-latest?canvas=1&compact=1&shell=1&limit=1200&live=1",
    bundlePath: "/api/institution-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
  },
];

function fail(message, extra) {
  console.error("[live-desktop-member-tabs] FAIL " + message);
  if (extra) console.error(JSON.stringify(extra, null, 2));
  process.exit(1);
}

function rowsOf(payload) {
  if (!payload || typeof payload !== "object") return [];
  return payload.rows || payload.data || payload.items || payload.results || payload.matches || payload.signals || [];
}

function countOf(payload) {
  return rowsOf(payload).length || Number(payload?.count || payload?.totalCount || payload?.resultCount || 0);
}

async function readJson(path, headers = {}) {
  const separator = path.includes("?") ? "&" : "?";
  const url = BASE_URL + path + separator + "verify=" + Date.now();
  const response = await fetch(url, { headers, cache: "no-store" });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    fail("non_json_response", { path, status: response.status, sample: text.slice(0, 300) });
  }
  if (!response.ok) fail("http_error", { path, status: response.status, payload });
  return payload;
}

async function readText(path) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(BASE_URL + path + separator + "verify=" + Date.now(), { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) fail("http_error", { path, status: response.status, sample: text.slice(0, 300) });
  return text;
}

function assertLiveTabPayload(tab, payload) {
  const count = countOf(payload);
  if (payload?.ok === false) fail(tab.name + "_api_not_ok", payload);
  if (count <= 0) fail(tab.name + "_api_empty", payload);
  if (!payload?.runId && !payload?.run_id && !payload?.transport?.runId) fail(tab.name + "_missing_run_id", payload);
  if (!payload?.source && !payload?.cacheSource) fail(tab.name + "_missing_source", payload);
  return {
    count,
    runId: payload.runId || payload.run_id || payload.transport?.runId,
    source: payload.source || payload.cacheSource,
  };
}

function assertStrategy2State(payload) {
  const count = countOf(payload);
  const status = String(payload?.status || "");
  const reason = String(payload?.reason || payload?.error || "");
  if (payload?.ok === false) fail("strategy2_api_not_ok", payload);
  if (count > 0) {
    return { status, reason, count };
  }
  const explicitWaiting = status === "waiting_for_v3_live_scan" || reason.includes("snapshot_date_mismatch") || reason.includes("without_scan_evidence");
  if (!explicitWaiting) fail("strategy2_zero_without_explicit_waiting_or_error_state", payload);
  return { status, reason, count };
}

(async () => {
  const version = await readJson("/api/version");
  if (version.formalSkeletonContract !== EXPECTED_CONTRACT) fail("formal_skeleton_contract_drift", version);
  if (version.formalSkeletonBaseline !== EXPECTED_BASELINE) fail("formal_skeleton_baseline_drift", version);
  if (version.formalSkeletonBaselineCommit !== EXPECTED_BASELINE_COMMIT) fail("formal_skeleton_commit_drift", version);
  if (!String(version.version || "").startsWith("public-terminal-fast-20260714-")) fail("unexpected_terminal_version", version);

  const shell = await readText("/terminal-desktop-fast-shell.js?v=" + encodeURIComponent(version.version));
  if (!shell.includes("const protectedApiPattern =")) fail("desktop_shell_missing_protected_api_pattern");
  if (!shell.includes("installMemberBearerFetchBridge20260714")) fail("desktop_shell_missing_member_bridge");
  if (!/function activateStrategyRoute[\s\S]*const panel = document\.querySelector\("#strategy-view"\);[\s\S]*renderMemberStrategyPendingShell\(key, strategyMeta\(link \|\| key\), panel\)/.test(shell)) {
    fail("strategy_member_fast_hydrate_missing_panel_binding");
  }

  const credential = await resolveProtectedReadbackCredential({ timeoutMs: 20000 });
  if (!credential.ok) fail("protected_readback_credential_unavailable", credential);
  const headers = protectedReadbackHeaders(credential);

  const bundle = await readJson("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=120", headers);
  if (bundle?.ok === false || !bundle?.endpoints) fail("terminal_fast_bundle_unavailable", bundle);

  const bundleSummary = {};
  for (const tab of requiredLiveTabs) {
    const endpointPayload = bundle.endpoints[tab.bundlePath];
    if (!endpointPayload) fail(tab.name + "_missing_from_terminal_fast_bundle", Object.keys(bundle.endpoints || {}));
    const count = countOf(endpointPayload);
    if (count <= 0) fail(tab.name + "_bundle_empty", endpointPayload);
    bundleSummary[tab.name] = {
      count,
      runId: endpointPayload.runId || endpointPayload.run_id || endpointPayload.transport?.runId,
      source: endpointPayload.source || endpointPayload.cacheSource,
    };
  }

  const liveSummary = {};
  for (const tab of requiredLiveTabs) {
    liveSummary[tab.name] = assertLiveTabPayload(tab, await readJson(tab.path, headers));
  }

  const strategy2 = assertStrategy2State(await readJson("/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=1200&live=1", headers));

  console.log("[live-desktop-member-tabs] ok " + JSON.stringify({
    version: version.version,
    formalSkeletonContract: version.formalSkeletonContract,
    formalSkeletonBaseline: version.formalSkeletonBaseline,
    bundle: bundleSummary,
    live: liveSummary,
    strategy2,
  }));
})().catch((error) => {
  fail("unexpected_error", { message: error.message, stack: error.stack });
});

