const { spawnSync } = require("child_process");
const versionPayload = require("../version.json");

function localGitSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  if (process.env.FUMAN_RELEASE_SHA) return process.env.FUMAN_RELEASE_SHA;
  if (process.env.FUMAN_DEPLOY_SHA) return process.env.FUMAN_DEPLOY_SHA;
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return String(result.stdout || "").trim();
  } catch {}
  return "";
}

module.exports = function handler(req, res) {
  const gitSha = localGitSha();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).json({
    ok: Boolean(gitSha),
    version: versionPayload.version,
    gitSha,
    branch: process.env.VERCEL_GIT_COMMIT_REF || process.env.FUMAN_RELEASE_BRANCH || "",
    repo: process.env.VERCEL_GIT_REPO_SLUG || "fuman-terminal",
    source: process.env.VERCEL_GIT_COMMIT_SHA ? "vercel-git-env" : (process.env.FUMAN_RELEASE_SHA || process.env.FUMAN_DEPLOY_SHA ? "fuman-release-env" : "local-git"),
    updatedAt: new Date().toISOString(),
  });
};
