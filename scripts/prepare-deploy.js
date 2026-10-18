const { spawnSync } = require("child_process");
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { assess } = require('../lib/morning-publish-applicability.cjs');
let applicability = {};
let rehearsal = null;
const results = [];
const runId = require('node:crypto').randomUUID();
const startedAt = new Date().toISOString();
let complete = false;
let firstBlocker = null;
const expectedCount = 16 + (process.env.FUMAN_MORNING_WEB_ARTIFACT_ROOT ? 6 : 0);
function save() {
  const out = path.join(ROOT, 'outputs/morning-full-release-chain-20261018');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'real-predeploy.json'), JSON.stringify({
    scope: rehearsal ? 'isolated_real_predeploy' : 'formal_predeploy',
    runId, startedAt, checkedAt: new Date().toISOString(),
    head: applicability.head || process.env.FUMAN_RELEASE_SHA || null, results, expectedCount,
    complete, firstBlocker,
    status: firstBlocker || results.some(x => x.status === 'FAILED') ? 'FAILED' : complete ? 'COMPLETE' : 'RUNNING',
    ok: complete && !firstBlocker && results.length === expectedCount && results.every(x => x.status !== 'FAILED'), deploymentPerformed: false,
  }, null, 2));
}
save();
process.on('uncaughtException', error => {
  firstBlocker = error.message;
  complete = false;
  save();
  console.error(error.stack);
  process.exitCode = 1;
});
applicability = assess(ROOT);
rehearsal = require('../lib/morning-release-rehearsal.cjs').inspect(ROOT);

function run(label, command, cwd = ROOT) {
  if (label === 'Telegram code contract (natural acceptance remains post-deploy)' && applicability.status === 'SCOPED') {
    results.push({ label, status: 'NOT_APPLICABLE', executed: false, exitCode: null,
      reason: 'Exact morning tree and release governance only; Telegram detector/runner/delivery contracts unchanged; 88 edit only removes morning mount.' });
    save();
    return;
  }
  console.log(`[prepare-deploy] ${label}`);
  const result = spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32" && /^(npm|npm.cmd)$/i.test(command[0]),
    cwd,
  });
  results.push({ label, command, cwd, executed: true, exitCode: result.status, error: result.error?.message || '',
    status: !result.error && result.status === 0 ? 'PASS' : 'FAILED' });
  save();
  if (result.error) {
    console.error(`[prepare-deploy] ${label} failed: ${result.error.message}`);
    if (!rehearsal) process.exit(1);
    return;
  }
  if (result.status !== 0) {
    console.error(`[prepare-deploy] failed at ${label}`);
    if (!rehearsal) process.exit(result.status || 1);
  }
}

function runCheck(label, command) {
  console.log(`[prepare-deploy] ${label}`);
  return spawnSync(command[0], command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
  }).status || 0;
}

run("verify:sync-hard-gate", ["npm", "run", "verify:sync-hard-gate"]);
run("verify:vercel-cost", ["npm", "run", "verify:vercel-cost"]);
run("verify:vercel-projects", ["npm", "run", "verify:vercel-projects"]);
run("guard:source", ["npm", "run", "guard:source"]);
run("verify:retired-artifacts", ["npm", "run", "verify:retired-artifacts"]);
run("verify:terminal-verifier-authority", ["npm", "run", "verify:terminal-verifier-authority"]);
run("verify:master-control-contract", ["npm", "run", "verify:master-control-contract"]);
run("verify:after-hours-scan-guard", ["npm", "run", "verify:after-hours-scan-guard"]);
run("Telegram code contract (natural acceptance remains post-deploy)", ["npm", "run", "verify:daytrade-burst-telegram", "--", "--contract"]);
run("verify:unified-source-gate", ["npm", "run", "verify:unified-source-gate"]);
run("verify:publish-gate", ["npm", "run", "verify:publish-gate"]);
run("verify:bump", ["npm", "run", "verify:bump"]);
run("verify:terminal-modules", ["npm", "run", "verify:terminal-modules"]);
run("verify:version", ["npm", "run", "verify:version"]);
run("verify:sw", ["npm", "run", "verify:sw"]);
run("verify:mobile-layout", ["npm", "run", "verify:mobile-layout"]);

if (process.env.FUMAN_MORNING_WEB_ARTIFACT_ROOT) {
  const artifact = fs.realpathSync(process.env.FUMAN_MORNING_WEB_ARTIFACT_ROOT);
  const { execFileSync } = require('child_process');
  const sha = execFileSync('git', ['-C', artifact, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (sha !== require('../lib/morning-web-release-contract.cjs').CONTRACT.candidate ||
      execFileSync('git', ['-C', artifact, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw Error('ARTIFACT_DRIFT');
  for (const script of ['verify-vercel-cost-guard.js', 'verify-version-consistency.js', 'verify-service-worker-smoke.js',
    'verify-mobile-layout.js', 'verify-terminal-desktop-skeleton.js', 'verify-terminal-modules-contract.js']) {
    run('website-artifact:' + script, [process.execPath, path.join(artifact, 'scripts', script)], artifact);
  }
}

complete = results.length === expectedCount;
save();
if (!complete || results.some(x => x.status === 'FAILED')) process.exitCode = 1;
else console.log("[prepare-deploy] ok");
