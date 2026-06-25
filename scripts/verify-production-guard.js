const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const CHECK_LIVE = !process.argv.includes("--pre-deploy");
const ALLOW_DIRTY = process.argv.includes("--allow-dirty");
const ALLOW_AHEAD = process.argv.includes("--allow-ahead");
const EXPECTED_GIT_REMOTE_RE = /^(https:\/\/github\.com\/ginova777-cmd\/fuman-terminal\.git|git@github\.com:ginova777-cmd\/fuman-terminal\.git)$/i;
const KEY_FILES = [
  "version.json",
  "terminal-core.js",
  "terminal.js",
  "terminal-desktop-fast-shell.js",
  "terminal-hotfix.js",
  "terminal-member-module.js",
  "terminal-market-snapshot-module.js",
  "terminal-watchlist-shell.js",
  "terminal-chip-snapshot-module.js",
  "terminal-strategy-module.js",
  "fuman-sw.js",
];

const issues = [];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || "").replace(/\r\n/g, "\n"), "utf8").digest("hex").toUpperCase();
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function detectVersion() {
  const match = read("terminal-core.js").match(/const\s+version\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error("Unable to detect local version");
  return match[1];
}

function fetchText(pathname, timeoutMs = 25000) {
  const fresh = pathname.includes("?") ? `&guard=${Date.now()}` : `?guard=${Date.now()}`;
  const url = `${BASE_URL}${pathname}${fresh}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { "cache-control": "no-cache" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ url, status: res.statusCode, headers: res.headers, body }));
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

function assertGitState() {
  const originUrl = git(["remote", "get-url", "origin"]);
  if (!originUrl.ok) {
    issues.push(`git origin remote must be configured: ${originUrl.stderr}`);
  } else if (!EXPECTED_GIT_REMOTE_RE.test(originUrl.stdout)) {
    issues.push(`git origin must point to GitHub fuman-terminal before deploy; current=${originUrl.stdout || "(missing)"}`);
  }
  if (/fuman-terminal-sync|^[A-Za-z]:[\\/]/i.test(originUrl.stdout || "")) {
    issues.push(`git origin must not be a local path or legacy sync tree; current=${originUrl.stdout}`);
  }
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream.ok) {
    issues.push(`current branch must track origin/main before deploy: ${upstream.stderr}`);
  } else if (upstream.stdout !== "origin/main") {
    issues.push(`current branch upstream must be origin/main; current=${upstream.stdout || "(missing)"}`);
  }
  const status = git(["status", "--porcelain"]);
  if (!status.ok) {
    issues.push(`git status failed: ${status.stderr}`);
  } else if (status.stdout && !ALLOW_DIRTY) {
    issues.push(`working tree is dirty; commit or stash before deploy:\n${status.stdout.split(/\r?\n/).slice(0, 20).join("\n")}`);
  }
  const localHead = git(["rev-parse", "HEAD"]);
  const origin = git(["ls-remote", "origin", "refs/heads/main"]);
  const originHead = origin.stdout.split(/\s+/)[0] || "";
  if (!localHead.ok) issues.push(`git rev-parse failed: ${localHead.stderr}`);
  if (!origin.ok) issues.push(`git ls-remote origin main failed: ${origin.stderr}`);
  if (localHead.ok && origin.ok && originHead && localHead.stdout !== originHead && !ALLOW_AHEAD) {
    issues.push(`local HEAD must equal origin/main before guarded deploy: local=${localHead.stdout.slice(0, 8)} origin=${originHead.slice(0, 8)}`);
  }
  return { localHead: localHead.stdout || "", originHead };
}

async function assertLiveState(version) {
  const versionJson = await fetchText("/version.json");
  if (versionJson.status < 200 || versionJson.status >= 300) {
    issues.push(`live version.json HTTP ${versionJson.status}`);
  } else {
    try {
      const payload = JSON.parse(versionJson.body);
      if (payload.version !== version) issues.push(`live version mismatch: live=${payload.version || "(missing)"} local=${version}`);
    } catch (error) {
      issues.push(`live version.json invalid JSON: ${error.message}`);
    }
  }

  for (const file of KEY_FILES) {
    const local = read(file);
    const localHash = sha256(local);
    const livePath = file === "version.json" ? "/version.json" : `/${file}?v=${encodeURIComponent(version)}`;
    const live = await fetchText(livePath);
    if (live.status < 200 || live.status >= 300) {
      issues.push(`${file} live HTTP ${live.status}`);
      continue;
    }
    const liveHash = sha256(live.body);
    if (localHash !== liveHash) {
      issues.push(`${file} hash mismatch local=${localHash.slice(0, 12)} live=${liveHash.slice(0, 12)}`);
    }
  }

  const bundle = await fetchText("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1", 35000);
  if (bundle.status < 200 || bundle.status >= 300) {
    issues.push(`terminal-fast-bundle HTTP ${bundle.status}`);
  } else {
    try {
      const payload = JSON.parse(bundle.body);
      const endpointKeys = Object.keys(payload.endpoints || {});
      if (payload.ok === false) issues.push("terminal-fast-bundle ok=false");
      if (payload.snapshotHit !== true) issues.push("terminal-fast-bundle snapshotHit must be true");
      if (payload.snapshotFresh !== true) issues.push("terminal-fast-bundle snapshotFresh must be true");
      if (payload.partial !== false) issues.push("terminal-fast-bundle partial must be false");
      if (endpointKeys.length < 10) issues.push(`terminal-fast-bundle endpoint count too low: ${endpointKeys.length}`);
      if (endpointKeys.some((endpoint) => /strategy2-latest/i.test(endpoint))) {
        issues.push("terminal-fast-bundle must not include strategy2-latest cold endpoint");
      }
    } catch (error) {
      issues.push(`terminal-fast-bundle invalid JSON: ${error.message}`);
    }
  }
}

async function main() {
  const version = detectVersion();
  const gitState = assertGitState();
  if (CHECK_LIVE) await assertLiveState(version);
  if (issues.length) {
    console.error("[production-guard] failed");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  console.log(`[production-guard] ok version=${version} head=${gitState.localHead.slice(0, 8)} origin=${gitState.originHead.slice(0, 8)} live=${CHECK_LIVE ? "checked" : "skipped"}`);
}

main().catch((error) => {
  console.error(`[production-guard] failed: ${error.stack || error.message}`);
  process.exit(1);
});
