const { spawnSync } = require("child_process");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
    ...options,
  });
  if (result.error) {
    console.error(`[deploy-release-env] ${command} failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
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
