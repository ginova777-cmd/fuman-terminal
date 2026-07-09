"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:/fuman-runtime";
const OUT_FILE = path.join(RUNTIME_DIR, "data", "scan-receipts", "star-preopen-closure.json");
const STAR_FILE = path.join(RUNTIME_DIR, "data", "star-preopen-latest.json");
const BASE_URL = String(process.env.FUMAN_PRODUCTION_URL || process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

function mkdirp(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeJson(file, payload) {
  mkdirp(file);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function stageCounts(payload = {}) {
  const counts = payload.stageCounts && typeof payload.stageCounts === "object" ? payload.stageCounts : {};
  return {
    futureInitial0846: cleanNumber(counts.futureInitial0846) || (Array.isArray(payload.futureInitialMatches) ? payload.futureInitialMatches.length : 0),
    preopenConfirm0855: cleanNumber(counts.preopenConfirm0855) || (Array.isArray(payload.preopenConfirmMatches) ? payload.preopenConfirmMatches.length : 0),
    finalJudgement0858: cleanNumber(counts.finalJudgement0858) || (Array.isArray(payload.finalMatches) ? payload.finalMatches.length : 0),
  };
}

function runStep(label, args, options = {}) {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 240000,
  });
  return {
    label,
    command: [process.execPath, ...args].join(" "),
    exitCode: child.status ?? (child.error ? 1 : 0),
    ok: !child.error && child.status === 0,
    elapsedMs: Date.now() - startedAt,
    stdout: String(child.stdout || "").slice(-4000),
    stderr: String(child.stderr || child.error?.message || "").slice(-4000),
  };
}

async function fetchJson(pathAndQuery) {
  const url = pathAndQuery.startsWith("http") ? pathAndQuery : `${BASE_URL}${pathAndQuery}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
    },
    cache: "no-store",
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return {
    url,
    status: response.status,
    ok: response.ok && json && json.ok !== false,
    json,
    text: json ? "" : text.slice(0, 500),
  };
}

function endpointPayload(bundle, prefix) {
  const endpoints = bundle?.endpoints && typeof bundle.endpoints === "object" ? bundle.endpoints : {};
  return Object.entries(endpoints).find(([endpoint]) => endpoint.startsWith(prefix))?.[1] || null;
}

function compareCounts(expected, actual) {
  return expected.futureInitial0846 === actual.futureInitial0846
    && expected.preopenConfirm0855 === actual.preopenConfirm0855
    && expected.finalJudgement0858 === actual.finalJudgement0858;
}

async function main() {
  const startedAt = new Date().toISOString();
  const steps = [];
  const issues = [];

  const scan = runStep("scan-star-preopen", ["--use-system-ca", "scripts/scan-star-preopen.js"], { timeoutMs: 180000 });
  steps.push(scan);
  if (!scan.ok) issues.push(`scan-star-preopen failed exit=${scan.exitCode}`);

  const snapshot = runStep("desktop-route-snapshot", [
    "--use-system-ca",
    "scripts/write-desktop-route-snapshot.js",
    "--source=strategy1-star-preopen-post-scan",
    "--min-endpoints=10",
  ], { timeoutMs: 240000 });
  steps.push(snapshot);
  if (!snapshot.ok) issues.push(`desktop-route-snapshot failed exit=${snapshot.exitCode}`);

  const localPayload = readJson(STAR_FILE, {});
  const localCounts = stageCounts(localPayload);

  const api = await fetchJson(`/api/open-buy-latest?canvas=1&compact=1&shell=1&limit=80&_cb=${Date.now()}`);
  const apiCounts = stageCounts(api.json || {});
  const bundle = await fetchJson(`/api/terminal-fast-bundle?canvas=1&compact=1&shell=1&_cb=${Date.now()}`);
  const openBuyBundle = endpointPayload(bundle.json || {}, "/api/open-buy-latest");
  const bundleCounts = stageCounts(openBuyBundle || {});

  if (!api.ok) issues.push(`production open-buy API failed status=${api.status}`);
  if (!bundle.ok) issues.push(`terminal fast bundle failed status=${bundle.status}`);
  if (!compareCounts(localCounts, apiCounts)) {
    issues.push(`open-buy stageCounts mismatch local=${JSON.stringify(localCounts)} api=${JSON.stringify(apiCounts)}`);
  }
  if (!openBuyBundle) {
    issues.push("terminal fast bundle missing open-buy endpoint");
  } else if (!compareCounts(localCounts, bundleCounts)) {
    issues.push(`terminal bundle stageCounts mismatch local=${JSON.stringify(localCounts)} bundle=${JSON.stringify(bundleCounts)}`);
  }
  if (localCounts.futureInitial0846 > 0 && apiCounts.futureInitial0846 === 0) {
    issues.push("regression guard: futures source has 08:46 rows but production API shows zero");
  }

  const payload = {
    ok: issues.length === 0,
    status: issues.length === 0 ? "ready" : "failed",
    contract: "strategy1_star_preopen_scan_to_display_closure",
    startedAt,
    finishedAt: new Date().toISOString(),
    local: {
      starFile: STAR_FILE,
      updatedAt: localPayload.updatedAt || "",
      futureSourceUsed: localPayload.source?.futureSourceUsed || "",
      stageCounts: localCounts,
    },
    productionApi: {
      url: api.url,
      status: api.status,
      ok: api.ok,
      cacheSource: api.json?.cacheSource || "",
      runtimeSource: api.json?.runtimePreopenEvidence?.runtimeSource || "",
      futureSourceUsed: api.json?.runtimePreopenEvidence?.futureSourceUsed || "",
      stageCounts: apiCounts,
    },
    terminalFastBundle: {
      url: bundle.url,
      status: bundle.status,
      ok: bundle.ok,
      cacheSource: bundle.json?.cacheSource || "",
      updatedAt: bundle.json?.updatedAt || "",
      openBuyFound: Boolean(openBuyBundle),
      openBuyCacheSource: openBuyBundle?.cacheSource || "",
      stageCounts: bundleCounts,
    },
    steps,
    issues,
  };

  writeJson(OUT_FILE, payload);
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

main().catch((error) => {
  const payload = {
    ok: false,
    status: "failed",
    contract: "strategy1_star_preopen_scan_to_display_closure",
    error: error?.message || String(error),
    finishedAt: new Date().toISOString(),
  };
  try { writeJson(OUT_FILE, payload); } catch {}
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
