const path = require("path");

const EXPECTED_ROOT = path.resolve("C:/fuman-terminal-sync").toLowerCase();
const DEPLOY_ROOT = path.resolve("C:/fuman-terminal").toLowerCase();
const actualRoot = path.resolve(__dirname, "..").toLowerCase();
const allowDeployRoot = process.env.FUMAN_ALLOW_DEPLOY_ROOT === "1";

if (actualRoot !== EXPECTED_ROOT) {
  if (allowDeployRoot && actualRoot === DEPLOY_ROOT) {
    console.log("[source] ok C:\\fuman-terminal deploy root");
    process.exit(0);
  }
  console.error("[source] failed");
  console.error(`Expected source root: ${EXPECTED_ROOT}`);
  console.error(`Actual source root:   ${actualRoot}`);
  console.error("Use C:\\fuman-terminal-sync for official edits, commits, and deploys.");
  process.exit(1);
}

console.log("[source] ok C:\\fuman-terminal-sync");
