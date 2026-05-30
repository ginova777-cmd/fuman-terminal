const fs = require("fs");
const path = require("path");
const { ROOT, dataPath } = require("./runtime-paths");

function read(file) {
  const candidates = [dataPath(file), path.join(ROOT, "data", file)];
  const target = candidates.find((item) => fs.existsSync(item));
  if (!target) return null;
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function count(payload) {
  return Number(payload?.count || payload?.matches?.length || payload?.rows?.length || 0);
}

function issue(level, message, meta = {}) {
  return { level, message, ...meta };
}

function main() {
  const issues = [];
  const s4Full = read("strategy4-latest.json");
  const s4Summary = read("strategy4-summary.json");
  const s4Slim = read("strategy4-slim.json");
  const zoneA = read("strategy4-zone-a.json");
  const zoneB = read("strategy4-zone-b.json");
  const zoneC = read("strategy4-zone-c.json");
  const zoneSum = count(zoneA) + count(zoneB) + count(zoneC);
  if (s4Full && s4Slim && count(s4Full) !== count(s4Slim)) issues.push(issue("high", "strategy4 full/slim count mismatch", { full: count(s4Full), slim: count(s4Slim) }));
  if (s4Summary && s4Slim && count(s4Summary) !== count(s4Slim)) issues.push(issue("medium", "strategy4 summary/slim count mismatch", { summary: count(s4Summary), slim: count(s4Slim) }));
  if (s4Slim && zoneSum !== count(s4Slim)) issues.push(issue("high", "strategy4 zone sum mismatch", { zoneSum, slim: count(s4Slim) }));
  const inst = read("institution-slim.json");
  const instJoint = read("institution-joint-top.json");
  if (inst && instJoint && count(instJoint) > count(inst)) issues.push(issue("high", "institution top larger than slim", { top: count(instJoint), slim: count(inst) }));
  const warrant = read("warrant-flow-slim.json");
  const warrantTop = read("warrant-priority-top.json");
  if (warrant && warrantTop && count(warrantTop) > count(warrant)) issues.push(issue("high", "warrant top larger than slim", { top: count(warrantTop), slim: count(warrant) }));
  const report = {
    ok: !issues.some((item) => item.level === "high"),
    updatedAt: new Date().toISOString(),
    issues,
    counts: {
      strategy4Full: count(s4Full),
      strategy4Summary: count(s4Summary),
      strategy4Slim: count(s4Slim),
      strategy4ZoneSum: zoneSum,
      institutionSlim: count(inst),
      institutionJointTop: count(instJoint),
      warrantSlim: count(warrant),
      warrantTop: count(warrantTop),
    },
  };
  for (const root of [ROOT, process.env.FUMAN_RUNTIME_ROOT || "C:\\fuman-runtime"]) {
    const out = path.join(root, "data", "data-consistency-report.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(`consistency report wrote ok=${report.ok} issues=${issues.length}`);
}

main();
