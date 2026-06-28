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

const BASE_URL = readArg("base-url", process.env.FUMAN_STRESS_BASE_URL || "https://fuman-terminal.vercel.app");
const LOOPS = Math.max(1, Math.min(80, Number(readArg("loops", process.env.FUMAN_STRESS_LOOPS || "20")) || 20));
const ROUTES = readArg("routes", process.env.FUMAN_STRESS_ROUTES || "heatmap,market-ai,watchlist,realtime-radar");
const BUDGET_MULTIPLIER = readArg("budget-multiplier", process.env.FUMAN_STRESS_BUDGET_MULTIPLIER || "1.5");
const OUT_FILE = path.resolve(ROOT, readArg("out", process.env.FUMAN_STRESS_OUTPUT || "outputs/terminal-route-switch-stress.json"));
const OUT_DIR = path.join(path.dirname(OUT_FILE), "route-switch-stress");

function runRound(index) {
  return new Promise((resolve) => {
    const out = path.join(OUT_DIR, `round-${String(index).padStart(3, "0")}.json`);
    const startedAt = Date.now();
    const child = childProcess.spawn(process.execPath, [
      "--use-system-ca",
      "scripts/verify-terminal-cold-start-performance.js",
      `--base-url=${BASE_URL}`,
      `--routes=${ROUTES}`,
      "--route-retries=0",
      `--budget-multiplier=${BUDGET_MULTIPLIER}`,
      `--out=${path.relative(ROOT, out)}`,
    ], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => {
      let report = null;
      try {
        report = JSON.parse(fs.readFileSync(out, "utf8"));
      } catch (error) {
        report = { ok: false, failures: [{ route: "report", error: error.message }], results: [] };
      }
      const results = Array.isArray(report.results) ? report.results : [];
      resolve({
        index,
        ok: code === 0 && report.ok !== false,
        code,
        ms: Date.now() - startedAt,
        routes: results.map((item) => ({
          route: item.route,
          rows: item.rows || 0,
          ms: item.ms || null,
          ok: item.ok !== false && !item.error,
        })),
        failures: Array.isArray(report.failures) ? report.failures : [],
        stdoutTail: stdout.split(/\r?\n/).filter(Boolean).slice(-8),
        stderrTail: stderr.split(/\r?\n/).filter(Boolean).slice(-8),
      });
    });
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const rounds = [];
  for (let index = 1; index <= LOOPS; index += 1) {
    console.log(`[route-stress] round ${index}/${LOOPS}`);
    const round = await runRound(index);
    rounds.push(round);
    const routeText = round.routes.map((item) => `${item.route}:${item.rows}/${item.ms || "--"}ms`).join(" ");
    console.log(`[route-stress] ${round.ok ? "ok" : "fail"} round=${index} ${round.ms}ms ${routeText}`);
    if (!round.ok) break;
  }
  const failures = rounds.filter((round) => !round.ok);
  const times = rounds.map((round) => round.ms).sort((a, b) => a - b);
  const report = {
    ok: failures.length === 0 && rounds.length === LOOPS,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    loops: LOOPS,
    routes: ROUTES,
    samples: rounds.length,
    maxMs: times[times.length - 1] || null,
    p95Ms: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] || null,
    failures,
    rounds,
    outputDir: path.relative(ROOT, OUT_DIR),
    contract: {
      repeatedTabSwitching: true,
      modeTabs: "modeTabs <= 1",
      aiPanels: "aiPanels <= 1",
      routeSet: ["market-ai", "realtime-radar", "heatmap", "watchlist"],
      harness: "stable cold-start route loop; full UI E2E remains a separate gate",
    },
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ok: report.ok, samples: report.samples, maxMs: report.maxMs, p95Ms: report.p95Ms, failures: failures.length, out: path.relative(ROOT, OUT_FILE) }, null, 2));
  if (!report.ok) process.exit(1);
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
