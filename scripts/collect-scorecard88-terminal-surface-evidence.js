"use strict";

const fs = require("fs");
const path = require("path");
const {
  resolveProtectedReadbackCredential,
  protectedReadbackHeaders,
  publicCredentialSummary,
} = require("../lib/protected-readback-credential");

const runtimeRoot = process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const receiptDir = path.join(runtimeRoot, "data", "scan-receipts");
const baseUrl = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const slot = String(process.argv.find((arg) => arg.startsWith("--slot=")) || "").split("=")[1] || "";
const slots = {
  "12:40": ["strategy2"],
  "13:15": ["strategy3"],
  "17:00": ["strategy4"],
  "21:40": ["strategy5", "institution"],
};
const endpointByKey = {
  strategy2: "/api/strategy2-latest",
  strategy3: "/api/strategy3-latest",
  strategy4: "/api/strategy4-latest",
  strategy5: "/api/strategy5-latest",
  institution: "/api/institution-latest",
};

function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function compact(value) { return String(value || "").replace(/\D/g, "").slice(0, 8); }
function runDate(runId) { return String(runId || "").match(/20\d{6}/)?.[0] || ""; }
function attr(html, name) { return String(html || "").match(new RegExp(`data-${name}="([^"]*)"`))?.[1] || ""; }
function number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function atomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}
function endpoint(bundle, key) {
  const entries = Object.entries(bundle?.endpoints || {});
  return entries.find(([name]) => name.startsWith(endpointByKey[key]))?.[1] || null;
}
async function fetchResult(pathname, headers, json = false) {
  const url = new URL(pathname, baseUrl);
  url.searchParams.set("scorecard88Surface", String(Date.now()));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, { cache: "no-store", headers: { ...headers, "Cache-Control": "no-cache" }, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    if (json) {
      try { payload = JSON.parse(text); } catch { payload = null; }
    }
    return { ok: response.ok, status: response.status, text, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (!slots[slot]) throw new Error("invalid_surface_evidence_slot");
  const credential = await resolveProtectedReadbackCredential({ timeoutMs: 20000 });
  const headers = protectedReadbackHeaders(credential);
  const bundle = await fetchResult("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&limit=70", headers, true);
  const rows = [];
  for (const key of slots[slot]) {
    const desktop = endpoint(bundle.payload, key);
    const mobile = await fetchResult(`/api/mobile-fragment?tab=${key}`, headers, false);
    const desktopRunId = String(desktop?.runId || desktop?.payload?.runId || desktop?.transport?.runId || "");
    const mobileRunId = attr(mobile.text, "run-id");
    const desktopCount = number(desktop?.resultCount ?? desktop?.count ?? desktop?.payload?.resultCount ?? desktop?.payload?.count);
    const mobileCount = number(attr(mobile.text, "result-count"));
    const expectedDate = compact(taipeiDate());
    const desktopDate = compact(desktop?.tradeDate || desktop?.dataDate || desktop?.date || "") || runDate(desktopRunId);
    const mobileDate = compact(attr(mobile.text, "trade-date") || attr(mobile.text, "data-date") || "") || runDate(mobileRunId);
    const sameRunId = Boolean(desktopRunId) && desktopRunId === mobileRunId;
    const sameCount = desktopCount === mobileCount;
    const currentDate = desktopDate === expectedDate && mobileDate === expectedDate;
    const ok = bundle.status === 200 && mobile.status === 200 && sameRunId && sameCount && currentDate;
    rows.push({
      key,
      ok,
      status: ok ? "PASS" : "BLOCKED",
      tradeDate: taipeiDate(),
      desktopStatus: bundle.status === 200 && desktopRunId ? "PASS" : "BLOCKED",
      mobileStatus: mobile.status === 200 && mobileRunId ? "PASS" : "BLOCKED",
      desktopRunId,
      mobileRunId,
      desktopCount,
      mobileCount,
      desktopDate,
      mobileDate,
      firstBlocker: ok ? "" : !credential.ok ? credential.reason : !desktopRunId ? "desktop_run_id_missing" : !mobileRunId ? "authenticated_mobile_run_id_missing" : !sameRunId ? "desktop_mobile_run_id_mismatch" : !sameCount ? "desktop_mobile_result_count_mismatch" : "desktop_mobile_trade_date_not_today",
    });
  }
  const todayKey = compact(taipeiDate());
  const output = path.join(receiptDir, `scorecard88-surface-evidence-${todayKey}-${slot.replace(":", "")}.json`);
  const report = {
    ok: rows.every((row) => row.ok),
    status: rows.every((row) => row.ok) ? "PASS" : "BLOCKED",
    contract: "scorecard88-terminal-surface-evidence-v1",
    slot,
    tradeDate: taipeiDate(),
    checkedAt: new Date().toISOString(),
    readOnly: true,
    querySupabase: false,
    scanAllowed: false,
    recalculated: false,
    generatedRunId: false,
    credential: publicCredentialSummary(credential),
    rows,
  };
  atomic(output, report);
  console.log(JSON.stringify({ ...report, output }, null, 2));
  process.exitCode = report.ok ? 0 : 3;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, status: "FAIL_CLOSED", reason: error?.message || String(error), querySupabase: false, scanAllowed: false, recalculated: false, generatedRunId: false }));
  process.exitCode = 4;
});
