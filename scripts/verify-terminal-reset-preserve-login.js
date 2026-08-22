const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT = "daytrade_mother_pool_skeleton_v1";
const BASELINE = "public-terminal-fast-20260714-22";
const BASELINE_COMMIT = "4d6ba88c19c5924093fcbe8afb0566df3c80a921";

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
}

function json(file) {
  return JSON.parse(read(file));
}

function required(file, marker, issues) {
  if (!read(file).includes(marker)) issues.push(`${file}: missing ${marker}`);
}

function forbidden(file, marker, issues) {
  if (read(file).includes(marker)) issues.push(`${file}: forbidden ${marker}`);
}

function main() {
  const issues = [];
  const version = json("version.json");
  const contract = json("data/contracts/daytrade_mother_pool_skeleton_v1.json");
  const index = read("index.html");
  const reset = read("reset.html");
  const vercel = read("vercel.json");

  if (contract.contract !== CONTRACT) issues.push("formal skeleton contract drift");
  if (contract.baseline !== BASELINE) issues.push("formal skeleton baseline drift");
  if (contract.baselineCommit !== BASELINE_COMMIT) issues.push("formal skeleton baseline commit drift");
  if (version.formalSkeletonContract !== CONTRACT) issues.push("version formal skeleton contract drift");
  if (version.formalSkeletonBaseline !== BASELINE) issues.push("version formal skeleton baseline drift");

  required("terminal-core.js", `const formalSkeletonContract = "${CONTRACT}"`, issues);
  required("terminal-core.js", `const formalSkeletonBaseline = "${BASELINE}"`, issues);
  required("terminal-desktop-fast-shell.js", "window.__fumanDesktopFastShell", issues);
  required("terminal-desktop-fast-shell.js", "installProtectedRouteSnapshotRetirement20260717();", issues);
  required("terminal-desktop-fast-shell.js", "const FIXED_ROUTE_KEYS", issues);
  required("terminal-desktop-fast-shell.js", "const API_ONLY_FIXED_ROUTE_KEYS", issues);
  required("index.html", "data-fuman-desktop-fast-shell=\"1\"", issues);
  required("index.html", `v=${version.version}`, issues);

  required("reset.html", "fuman-desktop-route-snapshots", issues);
  required("reset.html", "sessionStorage.clear()", issues);
  required("reset.html", "navigator.serviceWorker.getRegistrations", issues);
  required("reset.html", "new URL(\"/?desktop=1\", location.origin)", issues);
  forbidden("reset.html", "membership=logged-out", issues);
  forbidden("reset.html", "localStorage.clear()", issues);
  forbidden("reset.html", "fuman-terminal-auth-cache-v1", issues);
  required("vercel.json", "\"source\": \"/reset\"", issues);
  required("vercel.json", "\"destination\": \"/reset.html\"", issues);
  required("vercel.json", "\"source\": \"/reset.html\"", issues);
  required("vercel.json", "\"value\": \"no-store\"", issues);

  if (!/terminal-desktop-fast-shell\.js\?[^"']+v=/.test(index)) issues.push("index.html fast shell is not versioned");
  if (!/Cache-Control.{0,180}no-store/s.test(vercel)) issues.push("vercel reset/cache policy missing no-store");

  if (issues.length) {
    console.error("[terminal-reset-preserve-login] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }
  console.log("[terminal-reset-preserve-login] ok", JSON.stringify({
    version: version.version,
    formalSkeletonContract: CONTRACT,
    formalSkeletonBaseline: BASELINE,
    reset: "/reset -> /?desktop=1",
    auth: "preserved",
  }));
}

main();
