const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

const ROUNDS = Math.max(1, Math.min(288, Number(readArg("rounds", process.env.FUMAN_COLD_MONITOR_ROUNDS || "6")) || 6));
const INTERVAL_MS = Math.max(0, Number(readArg("interval-ms", process.env.FUMAN_COLD_MONITOR_INTERVAL_MS || "0")) || 0);
const ROUTES = readArg("routes", process.env.FUMAN_COLD_MONITOR_ROUTES || "market,heatmap,market-ai,watchlist");
const BUDGET_MULTIPLIER = readArg("budget-multiplier", process.env.FUMAN_COLD_MONITOR_BUDGET_MULTIPLIER || "0.85");
const BASE_URL = readArg("base-url", process.env.FUMAN_COLD_START_BASE_URL || "https://fuman-terminal.vercel.app");
const OUT_FILE = path.resolve(ROOT, readArg("out", process.env.FUMAN_COLD_MONITOR_OUTPUT || "outputs/terminal-cold-start-stability.json"));
const LOG_DIR = path.join(path.dirname(OUT_FILE), "cold-start-monitor");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runNode(args) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = childProcess.spawn(process.execPath, ["--use-system-ca", ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        FUMAN_TERMINAL_WARM_PROFILE: process.env.FUMAN_TERMINAL_WARM_PROFILE || "core",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stdout, stderr, ms: Date.now() - startedAt }));
  });
}

function percentile(values, p) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * p) - 1));
  return clean[index];
}

function summarize(rounds) {
  const byRoute = new Map();
  for (const round of rounds) {
    for (const item of round.results || []) {
      if (!byRoute.has(item.route)) byRoute.set(item.route, []);
      byRoute.get(item.route).push(item);
    }
  }
  return [...byRoute.entries()].map(([route, items]) => {
    const times = items.map((item) => Number(item.ms)).filter((value) => Number.isFinite(value));
    const failures = items.filter((item) => !item.ok);
    return {
      route,
      samples: items.length,
      ok: failures.length === 0,
      failures: failures.length,
      minMs: times.length ? Math.min(...times) : null,
      maxMs: times.length ? Math.max(...times) : null,
      p50Ms: percentile(times, 0.5),
      p95Ms: percentile(times, 0.95),
      budgetMs: items.find((item) => item.budgetMs)?.budgetMs || null,
    };
  });
}

(async () => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const rounds = [];
  for (let index = 1; index <= ROUNDS; index += 1) {
    const roundOut = path.join(LOG_DIR, `round-${String(index).padStart(3, "0")}.json`);
    console.log(`[cold-monitor] round ${index}/${ROUNDS}`);
    const result = await runNode([
      "scripts/warm-terminal-cold-start-cache.js",
      "--profile=core",
    ]);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    const verify = await runNode([
      "scripts/verify-terminal-cold-start-performance.js",
      `--base-url=${BASE_URL}`,
      `--routes=${ROUTES}`,
      "--route-retries=0",
      `--budget-multiplier=${BUDGET_MULTIPLIER}`,
      `--out=${path.relative(ROOT, roundOut)}`,
    ]);
    process.stdout.write(verify.stdout);
    process.stderr.write(verify.stderr);
    let report = null;
    try {
      report = JSON.parse(fs.readFileSync(roundOut, "utf8"));
    } catch (error) {
      report = { ok: false, error: `round report missing: ${error.message}`, results: [] };
    }
    rounds.push({ index, ok: verify.code === 0 && report.ok === true, commandMs: result.ms + verify.ms, ...report });
    if (INTERVAL_MS > 0 && index < ROUNDS) await sleep(INTERVAL_MS);
  }
  const summary = summarize(rounds);
  const failures = rounds.filter((round) => !round.ok);
  const routeFailures = summary.filter((route) => !route.ok || (route.p95Ms && route.budgetMs && route.p95Ms > route.budgetMs));
  const output = {
    ok: failures.length === 0 && routeFailures.length === 0,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    routes: ROUTES,
    rounds: ROUNDS,
    intervalMs: INTERVAL_MS,
    budgetMultiplier: Number(BUDGET_MULTIPLIER),
    summary,
    failures: failures.map((round) => ({ index: round.index, failures: round.failures || [], error: round.error || "" })),
    outputDir: path.relative(ROOT, LOG_DIR),
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exit(1);
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
