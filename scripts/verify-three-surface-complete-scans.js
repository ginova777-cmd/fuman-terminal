"use strict";

const { resolveProtectedReadbackCredential, protectedReadbackHeaders } = require("../lib/protected-readback-credential");

const BASE_URL = (process.env.FUMAN_TERMINAL_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const CONTRACT = "daytrade_mother_pool_skeleton_v1";
const BASELINE = "public-terminal-fast-20260714-22";
const BASELINE_COMMIT = "4d6ba88c19c5924093fcbe8afb0566df3c80a921";
const TABS = [
  { key: "strategy3", route: "strategy3", api: "/api/strategy3-latest", fragment: "strategy3" },
  { key: "strategy4", route: "strategy4", api: "/api/strategy4-latest", fragment: "strategy4" },
  { key: "strategy5", route: "strategy5", api: "/api/strategy5-latest", fragment: "strategy5" },
  { key: "institution", route: "institution", api: "/api/institution-latest", fragment: "chip" },
];

const issues = [];
function fail(code, details = {}) { issues.push({ code, ...details }); }
function query(path, params = {}) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  url.searchParams.set("verify", Date.now());
  return url;
}
function rowsOf(payload) {
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["rows", "data", "items", "results", "matches", "signals", "records"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}
function countOf(payload) {
  return rowsOf(payload).length || Number(payload?.count || payload?.resultCount || payload?.totalCount || 0);
}
function payloadRunId(payload) {
  return String(payload?.runId || payload?.run_id || payload?.transport?.runId || payload?.payload?.runId || "").trim();
}
function htmlAttr(html, name) {
  return (String(html).match(new RegExp(`${name}="([^"]*)"`, "i")) || [])[1] || "";
}
async function read(path, headers) {
  const response = await fetch(query(path), { headers, cache: "no-store" });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  return { response, text, payload };
}
function isExplicitWaiting(payload) {
  const text = [payload?.status, payload?.reason, payload?.error, payload?.detail, payload?.qualityStatus].filter(Boolean).join(" ").toLowerCase();
  return /waiting|not_due|not_trading_day|snapshot_date_mismatch|without_scan_evidence|membership_required/.test(text);
}
async function main() {
  const credential = await resolveProtectedReadbackCredential({ timeoutMs: 20000 });
  if (!credential.ok) fail("protected_readback_credential_unavailable", { reason: credential.reason, source: credential.source });
  const headers = protectedReadbackHeaders(credential);
  const versionRead = await read("/api/version", headers);
  const version = versionRead.payload || {};
  if (version.formalSkeletonContract !== CONTRACT) fail("formal_contract_drift", { actual: version.formalSkeletonContract });
  if (version.formalSkeletonBaseline !== BASELINE) fail("formal_baseline_drift", { actual: version.formalSkeletonBaseline });
  if (version.formalSkeletonBaselineCommit !== BASELINE_COMMIT) fail("formal_baseline_commit_drift", { actual: version.formalSkeletonBaselineCommit });

  const summary = { version: version.version || "", tabs: {}, mobileBoot: {}, strategy2: {} };
  for (const tab of TABS) {
    const direct = await read(`${tab.api}?canvas=1&compact=1&shell=1&limit=1200&live=1`, headers);
    const directRunId = payloadRunId(direct.payload);
    const directCount = countOf(direct.payload);
    if (!direct.response.ok || direct.payload?.ok === false) fail(`${tab.key}_api_not_ok`, { status: direct.response.status, error: direct.payload?.error });
    if (!directRunId) fail(`${tab.key}_api_missing_run_id`);
    if (directCount <= 0) fail(`${tab.key}_api_empty`, { status: direct.payload?.status, reason: direct.payload?.reason });

    const bundle = await read(`/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&route=${encodeURIComponent(tab.route)}`, headers);
    const endpointPayload = Object.entries(bundle.payload?.endpoints || {}).find(([endpoint]) => endpoint.startsWith(tab.api))?.[1] || null;
    const bundleRunId = payloadRunId(endpointPayload);
    const bundleCount = countOf(endpointPayload);
    if (!bundle.response.ok || !endpointPayload) fail(`${tab.key}_terminal_bundle_missing`);
    if (bundleRunId !== directRunId) fail(`${tab.key}_terminal_api_run_id_mismatch`, { direct: directRunId, terminal: bundleRunId });
    if (bundleCount <= 0) fail(`${tab.key}_terminal_empty`);

    const fragment = await read(`/api/mobile-fragment?tab=${tab.fragment}&live=1&noSnapshot=1`, headers);
    const fragmentRunId = htmlAttr(fragment.text, "data-run-id");
    const fragmentCount = Number(htmlAttr(fragment.text, "data-result-count") || 0);
    if (!fragment.response.ok) fail(`${tab.key}_mobile_fragment_not_ok`, { status: fragment.response.status });
    if (!fragmentRunId) fail(`${tab.key}_mobile_fragment_missing_run_id`);
    if (fragmentRunId !== directRunId) fail(`${tab.key}_mobile_api_run_id_mismatch`, { direct: directRunId, mobile: fragmentRunId });
    if (fragmentCount <= 0) fail(`${tab.key}_mobile_fragment_empty`);

    summary.tabs[tab.key] = { api: { runId: directRunId, count: directCount }, terminal: { runId: bundleRunId, count: bundleCount }, mobileFragment: { runId: fragmentRunId, count: fragmentCount } };
  }

  const boot = await read("/api/mobile-boot", headers);
  summary.mobileBoot = { status: boot.response.status, ok: boot.payload?.ok === true, fragments: boot.payload?.fragments || {} };
  if (!boot.response.ok || boot.payload?.ok !== true) fail("mobile_boot_not_ok", { status: boot.response.status, error: boot.payload?.error });
  for (const tab of TABS) {
    const fragment = boot.payload?.fragments?.[tab.key === "institution" ? "chip" : tab.key];
    if (!fragment?.runId) fail(`mobile_boot_${tab.key}_missing_run_id`);
  }

  const strategy2 = await read("/api/strategy2-latest?canvas=1&compact=1&shell=1&limit=1200&live=1", headers);
  const strategy2Count = countOf(strategy2.payload);
  summary.strategy2 = { status: strategy2.payload?.status || "", reason: strategy2.payload?.reason || strategy2.payload?.error || "", count: strategy2Count, runId: payloadRunId(strategy2.payload) };
  if (strategy2Count <= 0 && !isExplicitWaiting(strategy2.payload)) fail("strategy2_zero_without_explicit_waiting_state", { status: strategy2.payload?.status, reason: strategy2.payload?.reason });

  const result = { ok: issues.length === 0, checkedAt: new Date().toISOString(), contract: CONTRACT, baseline: BASELINE, baselineCommit: BASELINE_COMMIT, summary, issues };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
