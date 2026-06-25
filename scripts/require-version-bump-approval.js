const action = process.argv.slice(2).join(" ") || "version/deploy action";

if (process.env.ALLOW_VERSION_BUMP !== "1") {
  console.error("[version-approval] failed");
  console.error(`${action} requires ALLOW_VERSION_BUMP=1.`);
  console.error("This prevents accidental version bumps, release pipelines, and production alias changes.");
  process.exit(1);
}

console.log(`[version-approval] ok ${action}`);
