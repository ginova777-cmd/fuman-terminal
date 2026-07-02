"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");
const { serviceRoleKey, terminalSupabaseUrl } = require("../lib/server-supabase-key");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime";
const STATUS_DIR = path.join(RUNTIME_DIR, "status");
const DEFAULT_SUPABASE_RETENTION_DAYS = Number(process.env.FUMAN_SUPABASE_HISTORY_RETENTION_DAYS || 45);
const DEFAULT_EVENT_RETENTION_DAYS = Number(process.env.FUMAN_SUPABASE_EVENT_RETENTION_DAYS || 14);
const DEFAULT_RUN_KEEP = Number(process.env.FUMAN_SUPABASE_HISTORY_KEEP_RUNS || 20);
const DEFAULT_BATCH_SIZE = Number(process.env.FUMAN_HISTORY_CLEANUP_BATCH_SIZE || 80);
const DEFAULT_VERCEL_RETENTION_DAYS = Number(process.env.FUMAN_VERCEL_DEPLOYMENT_RETENTION_DAYS || 30);
const DEFAULT_VERCEL_KEEP_PER_TARGET = Number(process.env.FUMAN_VERCEL_DEPLOYMENT_KEEP_PER_TARGET || 10);

const RUN_TABLES = [
  { key: "strategy1", runsTable: "strategy1_open_buy_runs", resultsTable: "strategy1_open_buy_results", strategy: "strategy1", dateColumn: "finished_at" },
  { key: "strategy2", runsTable: "strategy2_scan_runs", resultsTable: "strategy2_scan_results", strategy: "strategy2", dateColumn: "updated_at", retentionDays: 14, keepRuns: 60 },
  { key: "strategy3", runsTable: "strategy3_scan_runs", resultsTable: "strategy3_scan_results", strategy: "strategy3", dateColumn: "finished_at" },
  { key: "strategy4", runsTable: "strategy4_scan_runs", resultsTable: "strategy4_scan_results", strategy: "strategy4", dateColumn: "finished_at" },
  { key: "strategy5", runsTable: "strategy5_scan_runs", resultsTable: "strategy5_scan_results", strategy: "strategy5", dateColumn: "finished_at" },
  { key: "institution", runsTable: "institution_scan_runs", resultsTable: "institution_scan_results", strategy: "institution", dateColumn: "finished_at" },
  { key: "cb", runsTable: "cb_detect_scan_runs", resultsTable: "cb_detect_scan_results", strategy: "cb_detect", dateColumn: "finished_at" },
  { key: "warrant", runsTable: "warrant_flow_scan_runs", resultsTable: "warrant_flow_scan_results", strategy: "warrant_flow", dateColumn: "finished_at" },
];

const EVENT_TABLES = [
  { key: "mobile_update_events", table: "mobile_update_events", dateColumn: "created_at", retentionDays: DEFAULT_EVENT_RETENTION_DAYS },
];

const SNAPSHOT_TABLES = [
  {
    key: "market_snapshots_fuman_history",
    table: "market_snapshots",
    dateColumn: "updated_at",
    retentionDays: Number(process.env.FUMAN_SUPABASE_SNAPSHOT_RETENTION_DAYS || 60),
    filter: "symbol=like.__fuman_%25",
  },
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = {
    apply: false,
    json: false,
    skipSupabase: false,
    skipVercel: false,
    status: true,
    supabaseRetentionDays: DEFAULT_SUPABASE_RETENTION_DAYS,
    eventRetentionDays: DEFAULT_EVENT_RETENTION_DAYS,
    keepRuns: DEFAULT_RUN_KEEP,
    batchSize: DEFAULT_BATCH_SIZE,
    vercelRetentionDays: DEFAULT_VERCEL_RETENTION_DAYS,
    vercelKeepPerTarget: DEFAULT_VERCEL_KEEP_PER_TARGET,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--json") args.json = true;
    else if (arg === "--skip-supabase") args.skipSupabase = true;
    else if (arg === "--skip-vercel") args.skipVercel = true;
    else if (arg === "--no-status") args.status = false;
    else if (arg === "--supabase-retention-days") args.supabaseRetentionDays = Number(value());
    else if (arg.startsWith("--supabase-retention-days=")) args.supabaseRetentionDays = Number(arg.split("=")[1]);
    else if (arg === "--event-retention-days") args.eventRetentionDays = Number(value());
    else if (arg.startsWith("--event-retention-days=")) args.eventRetentionDays = Number(arg.split("=")[1]);
    else if (arg === "--keep-runs") args.keepRuns = Number(value());
    else if (arg.startsWith("--keep-runs=")) args.keepRuns = Number(arg.split("=")[1]);
    else if (arg === "--batch-size") args.batchSize = Number(value());
    else if (arg.startsWith("--batch-size=")) args.batchSize = Number(arg.split("=")[1]);
    else if (arg === "--vercel-retention-days") args.vercelRetentionDays = Number(value());
    else if (arg.startsWith("--vercel-retention-days=")) args.vercelRetentionDays = Number(arg.split("=")[1]);
    else if (arg === "--vercel-keep-per-target") args.vercelKeepPerTarget = Number(value());
    else if (arg.startsWith("--vercel-keep-per-target=")) args.vercelKeepPerTarget = Number(arg.split("=")[1]);
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/cleanup-supabase-vercel-history.js [--dry-run|--apply] [--skip-supabase] [--skip-vercel] [--json]");
      process.exit(0);
    }
  }
  for (const key of ["supabaseRetentionDays", "eventRetentionDays", "keepRuns", "batchSize", "vercelRetentionDays", "vercelKeepPerTarget"]) {
    if (!Number.isFinite(args[key]) || args[key] < 0) throw new Error(`invalid ${key}: ${args[key]}`);
  }
  if (args.batchSize < 1) args.batchSize = 1;
  return args;
}

function isoCutoff(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function supabaseCredentials() {
  return {
    url: terminalSupabaseUrl({ root: ROOT, runtimeDir: RUNTIME_DIR }),
    key: process.env.FUMAN_HISTORY_CLEANUP_SUPABASE_SERVICE_ROLE_KEY
      || process.env.FUMAN_TERMINAL_SUPABASE_SERVICE_ROLE_KEY
      || serviceRoleKey({ root: ROOT, runtimeDir: RUNTIME_DIR }),
  };
}

async function supabaseFetch(pathname, options = {}) {
  const { url, key } = supabaseCredentials();
  if (!url || !key) throw new Error("missing Supabase URL or service role key");
  const response = await fetch(`${url}/rest/v1/${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "count=exact",
      ...(options.headers || {}),
    },
    body: options.body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status} ${text.slice(0, 240)}`.trim());
  let rows = null;
  if (text) {
    try { rows = JSON.parse(text); } catch { rows = text; }
  }
  const countHeader = response.headers.get("content-range") || "";
  const exactCount = /\/(\d+|\*)$/.exec(countHeader)?.[1];
  return {
    ok: true,
    status: response.status,
    rows: Array.isArray(rows) ? rows : [],
    count: exactCount && exactCount !== "*" ? Number(exactCount) : (Array.isArray(rows) ? rows.length : 0),
    text,
  };
}

function encodeIn(values) {
  return `in.(${values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`).join(",")})`;
}

async function countRows(table, query) {
  const result = await supabaseFetch(`${table}?select=*&${query}&limit=1`);
  return result.count;
}

async function deleteRows(table, query, apply) {
  if (!apply) return { deleted: 0, dryRun: true };
  const result = await supabaseFetch(`${table}?${query}`, { method: "DELETE", prefer: "return=representation,count=exact" });
  return { deleted: result.count || result.rows.length || 0, dryRun: false };
}

async function cleanupEventTable(config, args) {
  const retentionDays = config.retentionDays ?? args.eventRetentionDays;
  const cutoff = isoCutoff(retentionDays);
  const query = `${config.dateColumn}=lt.${encodeURIComponent(cutoff)}`;
  const count = await countRows(config.table, query);
  const deletion = await deleteRows(config.table, query, args.apply);
  return { key: config.key, table: config.table, cutoff, retentionDays, candidates: count, ...deletion };
}

async function cleanupSnapshotTable(config, args) {
  const retentionDays = config.retentionDays ?? args.supabaseRetentionDays;
  const cutoff = isoCutoff(retentionDays);
  const query = [config.filter, `${config.dateColumn}=lt.${encodeURIComponent(cutoff)}`].filter(Boolean).join("&");
  const count = await countRows(config.table, query);
  const deletion = await deleteRows(config.table, query, args.apply);
  return { key: config.key, table: config.table, cutoff, retentionDays, candidates: count, ...deletion };
}

async function fetchRunRows(config, limit = 5000) {
  const select = `run_id,strategy,status,complete,${config.dateColumn},updated_at,finished_at,started_at`;
  const filters = [
    `select=${encodeURIComponent(select)}`,
    config.strategy ? `strategy=eq.${encodeURIComponent(config.strategy)}` : "",
    `order=${encodeURIComponent(`${config.dateColumn}.desc`)}`,
    `limit=${limit}`,
  ].filter(Boolean).join("&");
  const result = await supabaseFetch(`${config.runsTable}?${filters}`);
  return result.rows.filter((row) => row && row.run_id);
}

function rowTime(row, config) {
  return Date.parse(row?.[config.dateColumn] || row?.finished_at || row?.updated_at || row?.started_at || "");
}

async function cleanupRunPair(config, args) {
  const retentionDays = config.retentionDays ?? args.supabaseRetentionDays;
  const keepRuns = config.keepRuns ?? args.keepRuns;
  const cutoffMs = Date.now() - retentionDays * 86400000;
  const rows = await fetchRunRows(config);
  const keepIds = new Set(rows.slice(0, keepRuns).map((row) => row.run_id));
  const candidates = rows
    .filter((row) => !keepIds.has(row.run_id))
    .filter((row) => {
      const at = rowTime(row, config);
      return Number.isFinite(at) && at < cutoffMs;
    })
    .map((row) => row.run_id);

  let deletedResults = 0;
  let deletedRuns = 0;
  const batches = chunks(candidates, args.batchSize);
  for (const batch of batches) {
    const runQuery = `run_id=${encodeURIComponent(encodeIn(batch))}${config.strategy ? `&strategy=eq.${encodeURIComponent(config.strategy)}` : ""}`;
    const resultDelete = await deleteRows(config.resultsTable, runQuery, args.apply).catch((error) => ({ deleted: 0, error: error.message }));
    if (resultDelete.error) throw new Error(`${config.resultsTable} cleanup failed: ${resultDelete.error}`);
    deletedResults += resultDelete.deleted || 0;
    const runDelete = await deleteRows(config.runsTable, runQuery, args.apply).catch((error) => ({ deleted: 0, error: error.message }));
    if (runDelete.error) throw new Error(`${config.runsTable} cleanup failed: ${runDelete.error}`);
    deletedRuns += runDelete.deleted || 0;
  }
  return {
    key: config.key,
    runsTable: config.runsTable,
    resultsTable: config.resultsTable,
    retentionDays,
    keepRuns,
    scannedRuns: rows.length,
    candidateRuns: candidates.length,
    deletedRuns,
    deletedResults,
    dryRun: !args.apply,
  };
}

function vercelProject() {
  const project = readJson(path.join(ROOT, ".vercel", "project.json")) || {};
  return {
    projectId: process.env.VERCEL_PROJECT_ID || project.projectId || "",
    orgId: process.env.VERCEL_ORG_ID || project.orgId || "",
    projectName: project.projectName || "",
  };
}

function parseVercelJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error(`Vercel API did not return JSON: ${raw.slice(0, 240)}`);
  }
}

function quoteCmdArg(arg) {
  const text = String(arg);
  if (!/[&<>()@^|"\s]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function runVercelCli(args, timeout = 30000) {
  const command = process.platform === "win32" ? "cmd.exe" : "vercel";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", `vercel ${args.map(quoteCmdArg).join(" ")}`]
    : args;
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
  return result;
}

function vercelListDeployments(projectName) {
  const result = runVercelCli(["list", projectName, "--format=json"], 60000);
  if (result.error) throw new Error(`vercel list ${projectName} failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`vercel list ${projectName} failed: ${(result.stderr || result.stdout || "").trim().slice(0, 500)}`);
  }
  return parseVercelJson(`${result.stdout || ""}\n${result.stderr || ""}`);
}

function vercelRemoveDeployment(ref) {
  const result = runVercelCli(["remove", ref, "--safe", "--yes"], 60000);
  if (result.error) throw new Error(`vercel remove ${ref} failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`vercel remove ${ref} failed: ${(result.stderr || result.stdout || "").trim().slice(0, 500)}`);
  }
  return { ok: true, stdout: String(result.stdout || "").trim(), stderr: String(result.stderr || "").trim() };
}

function vercelRequest(pathname, token, method = "GET") {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(`https://api.vercel.com${pathname}`);
    const request = https.request({
      method,
      hostname: endpoint.hostname,
      path: `${endpoint.pathname}${endpoint.search}`,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "FumanHistoryCleanup/1.0",
      },
      timeout: 20000,
    }, (response) => {
      const chunksOut = [];
      response.on("data", (chunk) => chunksOut.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunksOut).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${method} ${pathname} HTTP ${response.statusCode} ${text.slice(0, 240)}`.trim()));
          return;
        }
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch {
          resolve({ text });
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
    request.end();
  });
}

async function cleanupVercelDeployments(args) {
  const token = process.env.VERCEL_TOKEN || process.env.FUMAN_VERCEL_TOKEN || "";
  const project = vercelProject();
  if (!project.projectId) {
    return { ok: true, skipped: true, reason: "missing_vercel_project_id" };
  }
  const authMode = token ? "token" : "vercel-cli";
  let deployments = [];
  if (token) {
    const query = new URLSearchParams({ projectId: project.projectId, limit: "100" });
    if (project.orgId) query.set("teamId", project.orgId);
    const payload = await vercelRequest(`/v6/deployments?${query.toString()}`, token);
    deployments = Array.isArray(payload.deployments) ? payload.deployments : [];
  } else {
    const payload = vercelListDeployments(project.projectName || "fuman-terminal");
    deployments = Array.isArray(payload.deployments) ? payload.deployments : [];
  }
  const cutoffMs = Date.now() - args.vercelRetentionDays * 86400000;
  const byTarget = new Map();
  for (const item of deployments) {
    const target = String(item.target || item.meta?.githubCommitRef || "unknown");
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push(item);
  }
  const keep = new Set();
  for (const items of byTarget.values()) {
    items
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, args.vercelKeepPerTarget)
      .forEach((item) => keep.add(item.uid || item.id));
  }
  const productionHost = "fuman-terminal.vercel.app";
  const candidates = deployments.filter((item) => {
    const id = item.uid || item.id || item.url;
    const aliases = Array.isArray(item.alias) ? item.alias : [];
    const createdAt = Number(item.createdAt || 0);
    return id
      && !keep.has(id)
      && createdAt > 0
      && createdAt < cutoffMs
      && item.state !== "BUILDING"
      && !aliases.includes(productionHost);
  });
  const deleted = [];
  for (const item of candidates) {
    const id = item.uid || item.id || item.url;
    if (args.apply) {
      if (token && (item.uid || item.id)) await vercelRequest(`/v13/deployments/${encodeURIComponent(item.uid || item.id)}`, token, "DELETE");
      else vercelRemoveDeployment(id);
    }
    deleted.push({ id, name: item.name || "", target: item.target || "", url: item.url || "", createdAt: item.createdAt || 0 });
  }
  return {
    ok: true,
    project,
    scannedDeployments: deployments.length,
    authMode,
    retentionDays: args.vercelRetentionDays,
    keepPerTarget: args.vercelKeepPerTarget,
    candidateDeployments: candidates.length,
    deletedDeployments: args.apply ? deleted.length : 0,
    candidates: deleted.slice(0, 20),
    dryRun: !args.apply,
  };
}

async function cleanupSupabase(args) {
  const sections = [];
  for (const config of EVENT_TABLES) {
    sections.push(await cleanupEventTable({ ...config, retentionDays: config.key === "mobile_update_events" ? args.eventRetentionDays : config.retentionDays }, args).catch((error) => ({ key: config.key, ok: false, error: error.message })));
  }
  for (const config of SNAPSHOT_TABLES) {
    sections.push(await cleanupSnapshotTable(config, args).catch((error) => ({ key: config.key, ok: false, error: error.message })));
  }
  for (const config of RUN_TABLES) {
    sections.push(await cleanupRunPair(config, args).catch((error) => ({ key: config.key, ok: false, error: error.message })));
  }
  return {
    ok: sections.every((item) => item.ok !== false),
    sections,
  };
}

function writeStatus(payload) {
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATUS_DIR, "supabase-vercel-history-cleanup-status.json"), JSON.stringify(payload, null, 2), "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = {
    ok: true,
    applied: args.apply,
    dryRun: !args.apply,
    checkedAt: new Date().toISOString(),
    source: "supabase-vercel-history-cleanup",
    supabase: args.skipSupabase ? { skipped: true } : await cleanupSupabase(args),
    vercel: args.skipVercel ? { skipped: true } : await cleanupVercelDeployments(args).catch((error) => ({ ok: false, error: error.message })),
  };
  payload.ok = payload.supabase?.ok !== false && payload.vercel?.ok !== false;
  if (args.status) {
    const statusWrite = writeStatus(payload);
    if (!statusWrite.ok) payload.statusWriteWarning = statusWrite.error;
  }
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`[history-cleanup] ${payload.ok ? "ok" : "failed"} dryRun=${payload.dryRun}`);
    for (const section of payload.supabase?.sections || []) {
      if (section.ok === false) console.log(`[history-cleanup] supabase ${section.key} failed ${section.error}`);
      else console.log(`[history-cleanup] supabase ${section.key} candidates=${section.candidates ?? section.candidateRuns ?? 0} deleted=${(section.deleted || 0) + (section.deletedRuns || 0) + (section.deletedResults || 0)}`);
    }
    if (payload.vercel?.skipped) console.log(`[history-cleanup] vercel skipped ${payload.vercel.reason}`);
    else console.log(`[history-cleanup] vercel candidates=${payload.vercel?.candidateDeployments || 0} deleted=${payload.vercel?.deletedDeployments || 0}`);
  }
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[history-cleanup] failed: ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
