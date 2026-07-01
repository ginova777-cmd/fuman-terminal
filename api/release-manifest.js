const { spawnSync } = require("child_process");
const versionPayload = require("../version.json");

function localGitSha() {
  if (process.env.FUMAN_RELEASE_SHA) return process.env.FUMAN_RELEASE_SHA;
  if (process.env.FUMAN_DEPLOY_SHA) return process.env.FUMAN_DEPLOY_SHA;
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return String(result.stdout || "").trim();
  } catch {}
  return "";
}

function deploymentId(req) {
  return process.env.VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_DEPLOY_ID
    || process.env.FUMAN_DEPLOY_ID
    || process.env.FUMAN_VERCEL_DEPLOYMENT_ID
    || process.env.VERCEL_URL
    || req.headers?.["x-vercel-id"]
    || "";
}

module.exports = function handler(req, res) {
  const gitSha = localGitSha();
  const deployId = deploymentId(req);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).json({
    ok: Boolean(gitSha && deployId),
    version: versionPayload.version,
    gitSha,
    deployId,
    deploymentId: deployId,
    deploymentUrl: process.env.VERCEL_URL || "",
    branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.FUMAN_RELEASE_BRANCH || "",
    repo: process.env.VERCEL_GIT_REPO_SLUG || "fuman-terminal",
    source: process.env.FUMAN_RELEASE_SHA || process.env.FUMAN_DEPLOY_SHA ? "fuman-release-env" : (process.env.VERCEL_GIT_COMMIT_SHA ? "vercel-git-env" : "local-git"),
    updatedAt: new Date().toISOString(),
  });
};
