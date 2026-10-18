const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require('node:path');
if (process.env.FUMAN_RELEASE_REHEARSAL === '1') throw new Error('REHEARSAL_UPLOAD_FORBIDDEN');

function run(command, args, options = {}) {
  const receipt = process.env.FUMAN_DEPLOY_RESULT_FILE;
  const attempt = receipt ? receipt + '.' + require('node:crypto').randomUUID() : null;
  if (receipt) {
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    if (fs.existsSync(receipt)) fs.renameSync(receipt, attempt + '.previous.json');
  }
  const result = spawnSync(command, args, {
    stdio: receipt ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
    ...options,
  });
  if (receipt) {
    fs.writeFileSync(attempt + '.stdout.txt', String(result.stdout || ''));
    fs.writeFileSync(attempt + '.stderr.txt', String(result.stderr || ''));
    fs.writeFileSync(attempt + '.process.json', JSON.stringify({ status: result.status, signal: result.signal,
      error: result.error?.message || null, releaseSha: process.env.FUMAN_RELEASE_SHA, at: new Date().toISOString() }, null, 2));
    process.stdout.write(String(result.stdout || ''));
    process.stderr.write(String(result.stderr || ''));
  }
  if (result.error) {
    console.error(`[deploy-release-env] ${command} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
  if (process.env.FUMAN_DEPLOY_RESULT_FILE) {
    const { identify } = require('../lib/deployment-result.cjs');
    const { inspectDeployment } = require('../lib/morning-web-release-runtime.cjs');
    const { CONTRACT } = require('../lib/morning-web-release-contract.cjs');
    const identified = identify(result.stdout, result.stderr,
      url => inspectDeployment(url, path.resolve(__dirname, '..')), CONTRACT);
    fs.writeFileSync(attempt + '.inspect.json', JSON.stringify(identified.deployment, null, 2));
    fs.writeFileSync(process.env.FUMAN_DEPLOY_RESULT_FILE, JSON.stringify({
      deploymentUrl: identified.deploymentUrl, deploymentId: identified.deploymentId, evidencePrefix: attempt,
      releaseSha: process.env.FUMAN_RELEASE_SHA, uploadedAt: new Date().toISOString(),
    }, null, 2));
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return String(result.stdout || "").trim();
}

const releaseSha = (process.env.FUMAN_RELEASE_SHA || process.env.FUMAN_DEPLOY_SHA || capture("git", ["rev-parse", "HEAD"])).trim();
const releaseBranch = (process.env.FUMAN_RELEASE_BRANCH || capture("git", ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
const releaseId = process.env.FUMAN_DEPLOY_ID || `release-${releaseSha.slice(0, 12)}`;

if (!/^[0-9a-f]{40}$/i.test(releaseSha)) {
  console.error(`[deploy-release-env] invalid release sha: ${releaseSha || "(missing)"}`);
  process.exit(1);
}

console.log(`[deploy-release-env] vercel --prod releaseSha=${releaseSha} releaseId=${releaseId} branch=${releaseBranch}`);
run("vercel", [
  "--prod",
  "--env", `FUMAN_RELEASE_SHA=${releaseSha}`,
  "--env", `FUMAN_DEPLOY_SHA=${releaseSha}`,
  "--env", `FUMAN_DEPLOY_ID=${releaseId}`,
  "--env", `FUMAN_RELEASE_BRANCH=${releaseBranch}`,
]);
