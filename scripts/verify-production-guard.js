const fs = require("fs");
const https = require("https");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { verifyScorecardStrategyRules } = require("../lib/scorecard-rule-locks");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const CHECK_LIVE = !process.argv.includes("--pre-deploy");
const ALLOW_DIRTY = process.argv.includes("--allow-dirty");
const ALLOW_AHEAD = process.argv.includes("--allow-ahead");
const RELEASE_SHA = normalizeSha(process.env.FUMAN_RELEASE_SHA || process.env.FUMAN_DEPLOY_SHA);
const EXPECTED_GIT_REMOTE_RE = /^(https:\/\/github\.com\/ginova777-cmd\/fuman-terminal\.git|git@github\.com:ginova777-cmd\/fuman-terminal\.git)$/i;
const LEGACY_SYNC_TREE_RE = new RegExp("fuman-terminal" + "-sync", "i");
const RESERVED_PRODUCTION_ROUTES = [
  "/88",
];
const EXPECTED_SCORECARD_STRATEGIES = [
  "策略2成績單",
  "策略3隔日沖成績單",
  "策略4成績單",
  "策略5成績單",
  "買賣超成績單",
  "權證成績單",
  "CB成績單",
];
const REQUIRED_SCORECARD_PAGE_MARKERS = [
  "scorecard-history-date",
  "scorecard-theme-toggle",
  "scorecard-rule-group",
  "scorecard-rule-tags",
  "scorecard-followup",
  "PNL_MULTIPLIER = 1000",
  "損益(元)",
  "cleanReason",
];
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
const warnings = [];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || "").replace(/\r\n/g, "\n"), "utf8").digest("hex").toUpperCase();
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeSha(value) {
  return cleanText(value).toLowerCase();
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
  if (LEGACY_SYNC_TREE_RE.test(originUrl.stdout || "") || /^[A-Za-z]:[\\/]/i.test(originUrl.stdout || "")) {
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
  let originHead = "";
  if (!localHead.ok) issues.push(`git rev-parse failed: ${localHead.stderr}`);
  if (RELEASE_SHA) {
    const localOrigin = git(["rev-parse", "--verify", "origin/main"]);
    originHead = localOrigin.ok ? localOrigin.stdout : "";
    const localSha = normalizeSha(localHead.stdout);
    if (localHead.ok && localSha !== RELEASE_SHA) {
      issues.push(`local HEAD must equal release SHA before guarded deploy: local=${localSha.slice(0, 8)} release=${RELEASE_SHA.slice(0, 8)}`);
    }
  } else {
    const origin = git(["ls-remote", "origin", "refs/heads/main"]);
    originHead = origin.stdout.split(/\s+/)[0] || "";
    if (!origin.ok) issues.push(`git ls-remote origin main failed: ${origin.stderr}`);
    if (localHead.ok && origin.ok && originHead && normalizeSha(localHead.stdout) !== normalizeSha(originHead) && !ALLOW_AHEAD) {
      issues.push(`local HEAD must equal origin/main before guarded deploy: local=${localHead.stdout.slice(0, 8)} origin=${originHead.slice(0, 8)}`);
    }
  }
  return { localHead: localHead.stdout || "", originHead };
}

function assertReservedProductionRoutes() {
  if (!RESERVED_PRODUCTION_ROUTES.includes("/88")) {
    issues.push("reserved production routes must include /88 for the future scorecard path");
  }
}

async function assertLiveState(version) {
  if (RELEASE_SHA) {
    const manifest = await fetchText("/api/release-manifest", 25000);
    if (manifest.status < 200 || manifest.status >= 300) {
      issues.push(`release manifest HTTP ${manifest.status}`);
    } else {
      try {
        const payload = JSON.parse(manifest.body);
        if (payload.version !== version) {
          issues.push(`release manifest version mismatch: live=${payload.version || "(missing)"} local=${version}`);
        }
        if (normalizeSha(payload.gitSha) !== RELEASE_SHA) {
          issues.push(`release manifest SHA mismatch: live=${String(payload.gitSha || "").slice(0, 8) || "(missing)"} release=${RELEASE_SHA.slice(0, 8)}`);
        }
      } catch (error) {
        issues.push(`release manifest invalid JSON: ${error.message}`);
      }
    }
  }

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

  const scorecardPage = await fetchText("/88", 25000);
  if (scorecardPage.status < 200 || scorecardPage.status >= 300) {
    issues.push(`reserved scorecard route /88 HTTP ${scorecardPage.status}`);
  } else if (!/FUMAN SCORECARD|\/api\/scorecard/.test(scorecardPage.body)) {
    issues.push("reserved scorecard route /88 must render the public scorecard shell and call /api/scorecard");
  } else {
    const missingScorecardMarkers = REQUIRED_SCORECARD_PAGE_MARKERS.filter((marker) => !scorecardPage.body.includes(marker));
    if (missingScorecardMarkers.length) {
      issues.push(`reserved scorecard route /88 missing no-rollback markers: ${missingScorecardMarkers.join(", ")}`);
    }
    if (/scorecard-basis/.test(scorecardPage.body)) {
      issues.push("reserved scorecard route /88 must not restore scorecard-basis panel");
    }
  }

  const scorecardApi = await fetchText("/api/scorecard", 35000);
  if (scorecardApi.status === 401) {
    try {
      const protectedPayload = JSON.parse(scorecardApi.body || "{}");
      if (protectedPayload.error !== "membership_required" || protectedPayload.protected !== true) {
        issues.push(`scorecard API protected response invalid: error=${protectedPayload.error || "(missing)"}`);
      } else {
        warnings.push("scorecard API is protected by membership entitlement; unauthenticated production guard accepts 401 membership_required");
      }
    } catch (error) {
      issues.push(`scorecard API protected response invalid JSON: ${error.message}`);
    }
  } else if (scorecardApi.status < 200 || scorecardApi.status >= 300) {
    issues.push(`scorecard API HTTP ${scorecardApi.status}`);
  } else {
    try {
      const payload = JSON.parse(scorecardApi.body);
      const records = Array.isArray(payload.records) ? payload.records : [];
      const rows = records.length || Number(payload.summary?.rows || 0);
      const latestDate = cleanText(payload.latestDate || payload.summary?.latestDate);
      const latestRows = latestDate ? records.filter((row) => cleanText(row.record_date) === latestDate) : records;
      const byStrategy = latestRows.reduce((map, row) => {
        const strategy = cleanText(row.strategy || "未分類");
        map[strategy] = (map[strategy] || 0) + 1;
        return map;
      }, {});
      const missingStrategies = EXPECTED_SCORECARD_STRATEGIES.filter((strategy) => !byStrategy[strategy]);
      if (payload.ok === false) issues.push("scorecard API ok=false");
      if (rows <= 0) issues.push(`scorecard API row count invalid: ${rows}`);
      if (payload.cacheSource !== "supabase-snapshot") {
        issues.push(`scorecard API cacheSource must be supabase-snapshot; current=${payload.cacheSource || "(missing)"}`);
      }
      if (!Array.isArray(payload.historyDates) || payload.historyDates.length <= 0) {
        issues.push("scorecard API must keep historyDates for /88 historical selector");
      }
      if (missingStrategies.length) {
        warnings.push(`scorecard API missing strategy groups on latestDate=${latestDate || "(missing)"}: ${missingStrategies.join(", ")}; not blocking production guard because per-strategy closure is verified separately`);
      }
      const ruleReport = verifyScorecardStrategyRules(payload, {
        source: "production-guard-live",
        requireContract: true,
      });
      for (const check of ruleReport.checks || []) {
        if (!check.ok) issues.push(`scorecard rule rollback: ${check.id}: ${check.message}`);
      }
    } catch (error) {
      issues.push(`scorecard API invalid JSON: ${error.message}`);
    }
  }

  const bundle = await fetchText("/api/terminal-fast-bundle?canvas=1&compact=1&shell=1", 35000);
  if (bundle.status < 200 || bundle.status >= 300) {
    issues.push(`terminal-fast-bundle HTTP ${bundle.status}`);
  } else {
    try {
      const payload = JSON.parse(bundle.body);
      const endpointKeys = Object.keys(payload.endpoints || {});
      const marketClosed = payload.marketOpen === false && payload.marketStatus === "closed" && payload.formalScanSkipped === true;
      const membershipRedacted = payload.protected === true && payload.membershipRequired === true;
      if (payload.ok === false) issues.push("terminal-fast-bundle ok=false");
      if (membershipRedacted) {
        if (payload.snapshotHit !== true) issues.push("terminal-fast-bundle protected payload snapshotHit must be true");
        if (payload.snapshotFresh !== true) issues.push("terminal-fast-bundle protected payload snapshotFresh must be true");
        if (payload.partial !== false) issues.push("terminal-fast-bundle protected payload partial must be false");
        if (endpointKeys.length < 2) issues.push(`terminal-fast-bundle protected public endpoint count too low: ${endpointKeys.length}`);
        const protectedLeaks = endpointKeys.filter((endpoint) => /strategy[1-5]|open-buy|institution|cb-detect|warrant-flow|latest-strategy|latest-signals/i.test(endpoint));
        if (protectedLeaks.length) issues.push(`terminal-fast-bundle protected payload leaks protected endpoints: ${protectedLeaks.join(", ")}`);
      } else if (marketClosed) {
        if (payload.sourceFreshnessRequired !== false) issues.push("terminal-fast-bundle market closed must not require source freshness");
        if (payload.preservePreviousGood !== true) issues.push("terminal-fast-bundle market closed must preserve previous good");
        if (payload.latestPointerUpdated !== false) issues.push("terminal-fast-bundle market closed must not update latest pointer");
        if (payload.emptyResultWritten !== false) issues.push("terminal-fast-bundle market closed must not write empty result");
        if (!payload.closedReason) issues.push("terminal-fast-bundle market closed must disclose closedReason");
        if (!payload.displayTradeDate) issues.push("terminal-fast-bundle market closed must disclose displayTradeDate");
      } else {
        if (payload.snapshotHit !== true) issues.push("terminal-fast-bundle snapshotHit must be true");
        if (payload.snapshotFresh !== true) issues.push("terminal-fast-bundle snapshotFresh must be true");
        if (payload.partial !== false) issues.push("terminal-fast-bundle partial must be false");
        if (endpointKeys.length < 10) issues.push(`terminal-fast-bundle endpoint count too low: ${endpointKeys.length}`);
      }
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
  assertReservedProductionRoutes();
  const gitState = assertGitState();
  if (CHECK_LIVE) await assertLiveState(version);
  if (issues.length) {
    console.error("[production-guard] failed");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }
  for (const warning of warnings) console.warn(`[production-guard] warning: ${warning}`);
  console.log(`[production-guard] ok version=${version} head=${gitState.localHead.slice(0, 8)} origin=${gitState.originHead.slice(0, 8)} release=${RELEASE_SHA ? RELEASE_SHA.slice(0, 8) : "none"} live=${CHECK_LIVE ? "checked" : "skipped"}`);
}

main().catch((error) => {
  console.error(`[production-guard] failed: ${error.stack || error.message}`);
  process.exit(1);
});


