const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "outputs", "terminal-snapshot-freshness-contract");
const OUT_FILE = path.join(OUT_DIR, "terminal-snapshot-freshness-contract.json");

const {
  snapshotFreshness,
  cleanEndpoint,
  endpointPayloadFromSnapshot,
} = require("../lib/desktop-route-snapshot-cache");

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replace(/\D/g, "");
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function add(cases, issues, name, ok, details = {}) {
  const row = { name, ok: Boolean(ok), details };
  cases.push(row);
  if (!row.ok) issues.push({ name, ...details });
}

function main() {
  const cases = [];
  const issues = [];
  const date = todayKey();

  const freshSnapshot = { updatedAt: new Date().toISOString(), payload: { generatedAt: new Date().toISOString() } };
  const staleSnapshot = { updatedAt: "2026-01-01T00:00:00.000Z", payload: { generatedAt: "2026-01-01T00:00:00.000Z" } };
  add(cases, issues, "desktop_snapshot_freshness_accepts_fresh", snapshotFreshness(freshSnapshot, { maxAgeMs: 60_000 }).fresh === true, { date });
  add(cases, issues, "desktop_snapshot_freshness_rejects_stale", snapshotFreshness(staleSnapshot, { maxAgeMs: 60_000 }).stale === true, {});
  add(cases, issues, "desktop_snapshot_clean_endpoint_strips_volatile_params", cleanEndpoint("/api/strategy4-latest?canvas=1&t=123&cacheBust=x") === "/api/strategy4-latest?canvas=1", {});

  const endpointPayload = endpointPayloadFromSnapshot({
    endpoints: {
      "/api/strategy4-latest?canvas=1&compact=1": { runId: "strategy4-current", updatedAt: new Date().toISOString() },
      "/api/strategy4-latest?canvas=1&compact=1&live=1": { runId: "strategy4-live", updatedAt: "2026-01-01T00:00:00.000Z" },
    },
  }, "/api/strategy4-latest?canvas=1&compact=1");
  add(cases, issues, "desktop_snapshot_endpoint_picker_prefers_fresh_payload", endpointPayload?.runId === "strategy4-current", { pickedRunId: endpointPayload?.runId || "" });

  const cacheLib = read("lib/desktop-route-snapshot-cache.js");
  const desktopSnapshotApi = read("api/desktop-route-snapshot.js");
  const terminalFastBundle = read("api/terminal-fast-bundle.js");
  const strategy2Api = read("api/strategy2-latest.js");
  const mobileFragment = read("api/mobile-fragment.js");
  const desktopShell = read("terminal-desktop-fast-shell.js");

  add(cases, issues, "desktop_snapshot_has_max_age_gate", cacheLib.includes("DEFAULT_MAX_AGE_MS") && cacheLib.includes("snapshotFreshness"), {});
  add(cases, issues, "desktop_snapshot_has_live_force_bypass", cacheLib.includes("shouldBypassDesktopSnapshot") && cacheLib.includes("query.live === \"1\""), {});
  add(cases, issues, "desktop_snapshot_api_marks_market_closed_previous_good", desktopSnapshotApi.includes("market_closed_previous_good"), {});
  add(cases, issues, "terminal_fast_bundle_marks_snapshot_soft_fallback", terminalFastBundle.includes("snapshot-soft-fallback"), {});
  add(cases, issues, "strategy2_hides_previous_good_rows", strategy2Api.includes("previousGoodRowsHidden") && strategy2Api.includes("formal terminal hides previous-good rows"), {});
  add(cases, issues, "mobile_strategy2_stale_snapshot_disabled", !mobileFragment.includes("allowStale: tab === \"strategy2\""), {});
  add(cases, issues, "mobile_hides_previous_good_rows", mobileFragment.includes("hidePreviousGoodRows"), {});
  add(cases, issues, "desktop_shell_keeps_previous_good_label_explicit", desktopShell.includes("previous-good") && desktopShell.includes("已開通會員，優先讀取 fast bundle / previous-good"), {});

  const payload = {
    ok: issues.length === 0,
    contract: "terminal-formal-snapshot-freshness-v1",
    checkedAt: new Date().toISOString(),
    todayDate: date,
    formalRule: "formal terminal data must come from fresh API/manifest/snapshot contracts; stale/static/previous-good may only appear with explicit degraded or previous-good labeling",
    costPolicy: "contract-only verifier; no Supabase REST read; no production API read",
    cases,
    issues,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

main();
