const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CRON_DAILY_BUDGET = Number(process.env.FUMAN_VERCEL_CRON_DAILY_BUDGET || 30);
const MAX_CRONS = Number(process.env.FUMAN_VERCEL_MAX_CRONS || 2);
const EXPECTED_SCHEDULES = new Map([
  ["/api/desktop-route-snapshot-refresh", "40 0,4,6,12 * * 1-5"],
  ["/api/production-health", "0,30 1-6 * * 1-5"],
]);

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function readJson(file) {
  return JSON.parse(read(file));
}

function splitField(field, min, max) {
  if (field === "*") return max - min + 1;
  const values = new Set();
  for (const part of String(field).split(",")) {
    if (!part) continue;
    const stepMatch = part.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = Number(stepMatch[1]);
      for (let value = min; value <= max; value += step) values.add(value);
      continue;
    }
    const rangeStepMatch = part.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (rangeStepMatch) {
      const start = Number(rangeStepMatch[1]);
      const end = Number(rangeStepMatch[2]);
      const step = Number(rangeStepMatch[3]);
      for (let value = start; value <= end; value += step) values.add(value);
      continue;
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let value = start; value <= end; value += 1) values.add(value);
      continue;
    }
    const value = Number(part);
    if (Number.isFinite(value)) values.add(value);
  }
  return values.size;
}

function activeDayCount(dayOfWeekField) {
  if (!dayOfWeekField || dayOfWeekField === "*") return 7;
  return splitField(dayOfWeekField, 0, 6);
}

function estimateInvocationsPerActiveDay(schedule) {
  const parts = String(schedule || "").trim().split(/\s+/);
  if (parts.length !== 5) return Number.POSITIVE_INFINITY;
  const [minutes, hours, , , dayOfWeek] = parts;
  const days = Math.max(activeDayCount(dayOfWeek), 1);
  return splitField(minutes, 0, 59) * splitField(hours, 0, 23) / days * days;
}

function checkNoDependency(packageJson, packageName, issues) {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (packageJson[field] && packageJson[field][packageName]) {
      issues.push(`package.json must not include ${packageName}; avoid paid/extra Vercel telemetry add-ons`);
    }
  }
}

const issues = [];
const warnings = [];

const packageJson = readJson("package.json");
const vercelJson = readJson("vercel.json");
const vercelProject = readJson(".vercel/project.json");
const vercelIgnore = fs.existsSync(path.join(ROOT, ".vercelignore")) ? read(".vercelignore") : "";

if (packageJson.engines?.node !== "24.x") {
  issues.push(`package.json engines.node must be 24.x; current=${packageJson.engines?.node || "(missing)"}`);
}
checkNoDependency(packageJson, "@vercel/analytics", issues);
checkNoDependency(packageJson, "@vercel/speed-insights", issues);

if (vercelProject.projectName !== "fuman-terminal") {
  issues.push(`.vercel/project.json projectName must be fuman-terminal; current=${vercelProject.projectName || "(missing)"}`);
}

const crons = Array.isArray(vercelJson.crons) ? vercelJson.crons : [];
if (crons.length > MAX_CRONS) {
  issues.push(`vercel.json has ${crons.length} cron entries; budget allows ${MAX_CRONS}`);
}

let cronInvocationsPerActiveDay = 0;
for (const [pathName, expectedSchedule] of EXPECTED_SCHEDULES) {
  const cron = crons.find((entry) => entry?.path === pathName);
  if (!cron) {
    issues.push(`vercel.json missing cron ${pathName}`);
    continue;
  }
  if (cron.schedule !== expectedSchedule) {
    issues.push(`vercel.json cron ${pathName} must be ${expectedSchedule}; current=${cron.schedule || "(missing)"}`);
  }
}

for (const cron of crons) {
  const count = estimateInvocationsPerActiveDay(cron.schedule);
  cronInvocationsPerActiveDay += count;
  if (!EXPECTED_SCHEDULES.has(cron.path)) {
    warnings.push(`unexpected Vercel cron ${cron.path || "(missing)"} ${cron.schedule || "(missing)"}`);
  }
}

if (cronInvocationsPerActiveDay > CRON_DAILY_BUDGET) {
  issues.push(`cronInvocationsPerActiveDay ${cronInvocationsPerActiveDay} exceeds budget ${CRON_DAILY_BUDGET}`);
}

for (const marker of [
  "outputs/",
  "logs/",
  "locks/",
  "archive/",
  ".intraday-report-cache/",
  ".trade-manager-cache/",
  "ops/public-slot/runtime/",
  "data/market-ai-live.json",
  "login-bg-fuman.png",
]) {
  if (!vercelIgnore.includes(marker)) issues.push(`.vercelignore missing ${marker}`);
}

const result = {
  ok: issues.length === 0,
  cronInvocationsPerActiveDay,
  budget: CRON_DAILY_BUDGET,
  cronCount: crons.length,
  projectName: vercelProject.projectName,
  issues,
  warnings,
};

if (!result.ok) {
  console.error("[vercel-cost-guard] failed");
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(`[vercel-cost-guard] ok cronInvocationsPerActiveDay=${cronInvocationsPerActiveDay} budget=${CRON_DAILY_BUDGET}`);
console.log(JSON.stringify(result, null, 2));
