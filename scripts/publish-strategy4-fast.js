const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MAIN_ROOT = process.env.FUMAN_MAIN_DEPLOY_REPO || "C:\\fuman-terminal";
const NODE = process.execPath;

const EXPECTED_SCHEMA = "strategy4-cache-v3-unit-contract";
const EXPECTED_UNIT = "lots";
const EXPECTED_SOURCE = "supabase:strategy4_daily_ohlcv_view";

function run(label, command, cwd = ROOT, env = {}) {
  console.log(`[strategy4-fast] ${label}`);
  const useCmd = process.platform === "win32" && ["npm", "vercel"].includes(command[0]);
  const executable = useCmd ? (process.env.ComSpec || "cmd.exe") : command[0];
  const args = useCmd ? ["/d", "/s", "/c", command.join(" ")] : command.slice(1);
  const result = spawnSync(executable, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit ${result.status}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function assertStrategy4Contract() {
  const latest = readJson("data/strategy4-latest.json");
  const slim = readJson("data/strategy4-slim.json");
  const zones = ["a", "b", "c"].map((zone) => readJson(`data/strategy4-zone-${zone}.json`));
  const zoneTotal = zones.reduce((sum, payload) => sum + Number(payload.count || 0), 0);

  const issues = [];
  if (latest.ok !== true) issues.push("strategy4-latest ok must be true");
  if (latest.complete !== true) issues.push("strategy4-latest complete must be true");
  if (latest.schemaVersion !== EXPECTED_SCHEMA) issues.push(`schemaVersion must be ${EXPECTED_SCHEMA}`);
  if (latest.volumeUnit !== EXPECTED_UNIT) issues.push(`volumeUnit must be ${EXPECTED_UNIT}`);
  if (latest.dataContractSource !== EXPECTED_SOURCE) issues.push(`dataContractSource must be ${EXPECTED_SOURCE}`);
  if (Number(latest.total || 0) < 1500) issues.push(`strategy4 total too small total=${latest.total}`);
  if (Number(latest.count || 0) !== Number(slim.count || 0)) issues.push(`slim count mismatch latest=${latest.count} slim=${slim.count}`);
  if (zoneTotal !== Number(slim.count || 0)) issues.push(`zone count mismatch zones=${zoneTotal} slim=${slim.count}`);

  if (issues.length) {
    for (const issue of issues) console.error(`[strategy4-fast] ${issue}`);
    throw new Error("strategy4 contract check failed");
  }

  console.log(`[strategy4-fast] contract ok count=${latest.count} total=${latest.total} zones=${zoneTotal}`);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function verifyLive() {
  const base = (process.env.FUMAN_LIVE_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
  const token = Date.now();
  const latest = await fetchJson(`${base}/data/strategy4-latest.json?t=${token}`);
  const slim = await fetchJson(`${base}/data/strategy4-slim.json?t=${token}`);
  const version = await fetchJson(`${base}/version.json?t=${token}`);
  const issues = [];
  if (Number(latest.count || 0) !== Number(slim.count || 0)) issues.push(`live count mismatch latest=${latest.count} slim=${slim.count}`);
  if (latest.schemaVersion !== EXPECTED_SCHEMA) issues.push(`live schemaVersion ${latest.schemaVersion}`);
  if (latest.volumeUnit !== EXPECTED_UNIT) issues.push(`live volumeUnit ${latest.volumeUnit}`);
  if (latest.dataContractSource !== EXPECTED_SOURCE) issues.push(`live dataContractSource ${latest.dataContractSource}`);
  if (issues.length) {
    for (const issue of issues) console.error(`[strategy4-fast] ${issue}`);
    throw new Error("live verification failed");
  }
  console.log(`[strategy4-fast] live ok ${base} count=${latest.count} version=${version.version}`);
}

async function main() {
  if (!fs.existsSync(MAIN_ROOT)) throw new Error(`main deploy repo missing: ${MAIN_ROOT}`);
  run("scan strategy4", [NODE, "scripts\\scan-strategy4-cache.js"], ROOT, {
    FULL_SCAN: "1",
    STRATEGY4_SUPABASE_RUN_ID: "1",
    STRATEGY4_FAIL_ON_INCOMPLETE: "1",
    STRATEGY4_ALLOW_PARTIAL_PUBLISH: "0",
    STRATEGY4_SYNC_PARTIAL: "0",
  });
  run("generate slim cache", [NODE, "scripts\\generate-slim-cache.js"]);
  assertStrategy4Contract();
  run("bump frontend/cache version", ["npm", "run", "bump:version"]);
  run("sync official deploy source", ["npm", "run", "sync:source"]);
  run("verify version", ["npm", "run", "verify:version"]);
  run("verify service worker", ["npm", "run", "verify:sw"]);
  run("deploy official terminal", ["vercel", "--prod"], MAIN_ROOT);
  await verifyLive();
}

main().catch((error) => {
  console.error(`[strategy4-fast] failed: ${error.message}`);
  process.exit(1);
});
