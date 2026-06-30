const { spawnSync } = require("child_process");

const EXPECTED_PRIMARY = new Set(String(process.env.FUMAN_VERCEL_PRIMARY_PROJECTS || "fuman-terminal").split(",").map((item) => item.trim()).filter(Boolean));
const TRANSITIONAL = new Set(String(process.env.FUMAN_VERCEL_TRANSITIONAL_PROJECTS || "fuman-terminal-strategy3,fuman-terminal-strategy4,fuman-terminal-strategy5-unattended,fuman-strategy1-clean,fuman-watchlist-limit").split(",").map((item) => item.trim()).filter(Boolean));
const STRICT = process.env.FUMAN_VERCEL_PROJECT_STRICT === "1";
const TIMEOUT_MS = Number(process.env.FUMAN_VERCEL_PROJECT_LIST_TIMEOUT_MS || 30000);

function runVercelProjectList() {
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", "vercel project ls --format=json"], {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
  }
  return spawnSync("vercel", ["project", "ls", "--format=json"], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });
}

function parseJsonOutput(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Vercel CLI did not return JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

function listProjects(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.projects)) return payload.projects;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.result)) return payload.result;
  return [];
}

function projectName(project) {
  return project?.name || project?.projectName || project?.slug || "";
}

const issues = [];
const warnings = [];
const result = runVercelProjectList();
if (result.error) {
  issues.push(`vercel project ls --format=json failed: ${result.error.message}`);
} else if (result.status !== 0) {
  issues.push(`vercel project ls --format=json failed: ${(result.stderr || result.stdout || "").trim()}`);
}

let names = [];
if (issues.length === 0) {
  try {
    const payload = parseJsonOutput(`${result.stdout || ""}\n${result.stderr || ""}`);
    names = listProjects(payload).map(projectName).filter(Boolean).sort();
  } catch (error) {
    issues.push(error.message);
  }
}

for (const expected of EXPECTED_PRIMARY) {
  if (!names.includes(expected)) issues.push(`missing primary Fuman Vercel project ${expected}`);
}

const fumanProjects = names.filter((name) => /^fuman/i.test(name));
const primary = fumanProjects.filter((name) => EXPECTED_PRIMARY.has(name));
const transitional = fumanProjects.filter((name) => TRANSITIONAL.has(name));
const unexpected = fumanProjects.filter((name) => !EXPECTED_PRIMARY.has(name) && !TRANSITIONAL.has(name));

if (unexpected.length) {
  issues.push(`unexpected Fuman Vercel project(s): ${unexpected.join(", ")}`);
}
if (STRICT && transitional.length) {
  issues.push(`transitional Fuman Vercel project(s) must be removed before strict mode: ${transitional.join(", ")}`);
} else if (transitional.length) {
  warnings.push(`transitional Fuman Vercel project(s) still exist: ${transitional.join(", ")}`);
}

const output = {
  ok: issues.length === 0,
  strict: STRICT,
  projects: names.length,
  primary,
  transitional,
  unexpected,
  issues,
  warnings,
};

if (!output.ok) {
  console.error("[vercel-project-inventory] failed");
  console.error(JSON.stringify(output, null, 2));
  process.exit(1);
}

console.log(`[vercel-project-inventory] ok projects=${names.length} primary=${primary.join(",") || "(none)"} transitional=${transitional.length} unexpected=${unexpected.length}`);
console.log(JSON.stringify(output, null, 2));
