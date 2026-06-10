const path = require("path");

const EXPECTED_ROOT = path.resolve("C:/fuman-terminal-sync").toLowerCase();
const actualRoot = path.resolve(__dirname, "..").toLowerCase();

if (actualRoot !== EXPECTED_ROOT) {
  console.error("[source] failed");
  console.error(`Expected source root: ${EXPECTED_ROOT}`);
  console.error(`Actual source root:   ${actualRoot}`);
  console.error("Use C:\\fuman-terminal-sync for official edits, commits, and deploys.");
  process.exit(1);
}

console.log("[source] ok C:\\fuman-terminal-sync");
