"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const EXPECTED_DESKTOP_SNAPSHOT_CRON = "40 0,4,6,12 * * 1-5";
const SKIP_LIVE = process.argv.includes("--skip-live");
const SKIP_TASKS = process.argv.includes("--skip-tasks");
const issues = [];
const warnings = [];

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function failWhen(condition, message) { if (condition) issues.push(message); }
function warnWhen(condition, message) { if (condition) warnings.push(message); }

function requestJson(pathname, timeoutMs = 30000) {
  const url = `${BASE_URL}${pathname}${pathname.includes("?") ? "&" : "?"}readonly=${Date.now()}`;
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache", accept: "application/json" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode || 0, body: JSON.parse(body || "{}"), url });
        } catch (error) {
          resolve({ ok: false, status: res.statusCode || 0, body: { error: `json_parse_failed:${error.message}` }, url });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", (error) => resolve({ ok: false, status: 0, body: { error: error.message }, url }));
  });
}
function taskCheck() {
  if (SKIP_TASKS || process.platform !== "win32") return { checked: false, reason: SKIP_TASKS ? "skipped" : "non_windows" };
  const probe = spawnSync("powershell.exe", ["-NoProfile", "-Command", "$names = 'Fuman Freshness Gate Fast 0845-1645','Fuman Freshness Gate Full 2010','FumanTerminalProductionHealthMonitor'; $active=@{}; foreach($name in $names){ $task=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue; $active[$name]=[bool]$task }; $info=Get-ScheduledTaskInfo -TaskName 'Fuman Freshness Gate Fast 0845-1645' -ErrorAction SilentlyContinue; [pscustomobject]@{ active=$active; retiredPresent=@(); fastGateLastResult=if($info){[string]$info.LastTaskResult}else{''}; fastGateTaskCount=if($active['Fuman Freshness Gate Fast 0845-1645']){1}else{0} } | ConvertTo-Json -Compress"], { encoding: "utf8", windowsHide: true });
  if (probe.status !== 0) return { checked: false, reason: String(probe.stderr || probe.stdout || "").trim() || `exit_${probe.status}` };
  try { return { checked: true, ...JSON.parse(String(probe.stdout || "{}").trim()) }; }
  catch (error) { return { checked: false, reason: `scheduled_task_json_parse_failed:${error.message}` }; }
}
async function main() {
  const api = read("api/watchlist-match-index.js");
  const builder = read("lib/desktop-route-snapshot-builder.js");
  const indexBuilder = read("lib/watchlist-match-index-builder.js");
  const standalone = read("scripts/generate-watchlist-match-index.js");
  const slim = read("scripts/generate-slim-cache.js");
  const pkg = read("package.json");
  const vercel = read("vercel.json");

  const writerHits = [
    ["lib/desktop-route-snapshot-builder.js", builder],
    ["scripts/generate-watchlist-match-index.js", standalone],
    ["scripts/generate-slim-cache.js", slim],
  ].filter(([, text]) => /upsertSnapshot\(\s*["']watchlist_match_index["']/.test(text)).map(([file]) => file);

  failWhen(!/readSnapshot\(\s*["']watchlist_match_index["']/.test(api), "api/watchlist-match-index.js must read watchlist_match_index snapshot");
  failWhen(/strategy-match-index\.json|readFileSync|fs\./.test(api), "api/watchlist-match-index.js must not read local/static JSON fallback");
  failWhen(!/status\(503\)/.test(api) || !/watchlist_match_index_unavailable/.test(api), "api/watchlist-match-index.js must hard-fail 503 when snapshot is unavailable");
  failWhen(writerHits.length !== 1 || writerHits[0] !== "lib/desktop-route-snapshot-builder.js", `official writer must be only desktop-route-snapshot-builder; actual=${writerHits.join(",") || "none"}`);
  failWhen(!/verify:watchlist-autonomy/.test(pkg), "package.json missing verify:watchlist-autonomy script");
  failWhen(!/key:\s*["']strategy2["']/.test(indexBuilder) || !/\/api\/latest-strategy\?key=strategy2/.test(indexBuilder), "watchlist builder must include strategy2 source");
  failWhen(!/sourceKeyFor/.test(indexBuilder) || !/策略2-/.test(indexBuilder), "watchlist builder must preserve strategy2 sub-signal labels");
  failWhen(
    !/\/api\/desktop-route-snapshot-refresh/.test(vercel) || !vercel.includes(EXPECTED_DESKTOP_SNAPSHOT_CRON),
    `vercel cron for desktop-route-snapshot-refresh must match cost-governed schedule ${EXPECTED_DESKTOP_SNAPSHOT_CRON}`
  );
  failWhen(/generate-watchlist-match-index\.js for watchlist_match_index snapshot/.test(slim), "generate-slim-cache.js still points at retired watchlist writer");
  warnWhen(fs.existsSync(path.join(ROOT, "data", "strategy-match-index.json")), "local data/strategy-match-index.json exists; production route must remain disabled");

  const tasks = taskCheck();
  if (tasks.checked) {
    for (const [name, present] of Object.entries(tasks.active)) failWhen(!present, `scheduled task missing: ${name}`);
    failWhen(tasks.retiredPresent.length > 0, `retired scheduled tasks present: ${tasks.retiredPresent.join(",")}`);
    failWhen(tasks.active?.["Fuman Freshness Gate Fast 0845-1645"] && !tasks.fastGateLastResult, "Fuman Freshness Gate Fast last result could not be read");
    failWhen(tasks.fastGateLastResult && !/^(0|267009)\b/.test(tasks.fastGateLastResult), `Fuman Freshness Gate Fast last result is ${tasks.fastGateLastResult}`);
  } else {
    warnings.push(`task check not authoritative: ${tasks.reason}`);
  }

  const live = { skipped: SKIP_LIVE };
  if (!SKIP_LIVE) {
    const [watch, staticJson, bundle, meta] = await Promise.all([
      requestJson("/api/watchlist-match-index", 30000),
      requestJson("/data/strategy-match-index.json", 20000),
      requestJson("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1", 35000),
      requestJson("/api/mobile-watch-meta?code=2330", 20000),
    ]);
    const bundleWatch = Object.entries(bundle.body?.endpoints || {}).find(([endpoint]) => endpoint.startsWith("/api/watchlist-match-index"))?.[1] || null;
    Object.assign(live, {
      watch: { status: watch.status, cacheSource: watch.body?.cacheSource || "", runId: watch.body?.runId || "", count: Number(watch.body?.count || 0) || 0, transportUpdatedAt: watch.body?.transport?.updatedAt || "" },
      staticJson: { status: staticJson.status, error: staticJson.body?.error || "" },
      bundleWatch: { present: Boolean(bundleWatch), runId: bundleWatch?.runId || "", hasStrategy2: Boolean(bundleWatch?.strategies?.strategy2) },
      mobileMeta: { status: meta.status, valid: Boolean(meta.body?.valid), stock: meta.body?.stock || null },
    });
    failWhen(!watch.ok || watch.body?.ok === false, `live /api/watchlist-match-index failed status=${watch.status}`);
    failWhen(watch.body?.cacheSource !== "supabase:market_snapshots", `live watchlist cacheSource=${watch.body?.cacheSource || "missing"}`);
    failWhen(!watch.body?.runId, "live watchlist runId missing");
    failWhen(staticJson.status !== 410, `production /data/strategy-match-index.json must be disabled with 410 actual=${staticJson.status}`);
    failWhen(!bundleWatch, "terminal-fast-bundle missing watchlist endpoint");
    failWhen(!bundleWatch?.strategies?.strategy2, "terminal-fast-bundle watchlist endpoint missing strategy2 source");
    failWhen(!meta.ok || meta.body?.valid !== true, "mobile-watch-meta?code=2330 must validate a live stock");
  }

  const payload = { ok: issues.length === 0, status: issues.length === 0 ? "YES" : "NO", mode: "read-only", checkedAt: new Date().toISOString(), baseUrl: BASE_URL, issues, warnings, details: { writers: writerHits, tasks, live } };
  console.log(JSON.stringify(payload, null, 2));
  if (issues.length) process.exit(1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, status: "NO", mode: "read-only", error: error?.message || String(error) }, null, 2));
  process.exit(1);
});
