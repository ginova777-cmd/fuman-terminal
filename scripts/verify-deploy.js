const { execFileSync } = require("child_process");

const BASE_URL = (process.env.FUMAN_DEPLOY_URL || "https://fuman-terminal.vercel.app").replace(/\/$/, "");
const EXPECTED_SHA = process.env.EXPECTED_SHA || process.argv[2] || gitMainSha();
const TIMEOUT_MS = Math.max(1000, Number(process.env.DEPLOY_VERIFY_TIMEOUT_MS || 6 * 60 * 1000));
const INTERVAL_MS = Math.max(1000, Number(process.env.DEPLOY_VERIFY_INTERVAL_MS || 15000));

function gitMainSha() {
  try {
    const output = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], { encoding: "utf8" }).trim();
    return output.split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

async function readDeployHealth() {
  const url = `${BASE_URL}/api/deploy-health?t=${Date.now()}`;
  const response = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) throw new Error(`deploy-health HTTP ${response.status}`);
  return response.json();
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!EXPECTED_SHA) throw new Error("Missing expected SHA. Pass it as argv[2] or set EXPECTED_SHA.");
  const expectedShort = EXPECTED_SHA.slice(0, 7);
  const startedAt = Date.now();
  let lastPayload = null;
  let lastError = null;
  while (Date.now() - startedAt <= TIMEOUT_MS) {
    try {
      const payload = await readDeployHealth();
      lastPayload = payload;
      const deployedSha = String(payload.commitSha || "");
      const deployedShort = deployedSha.slice(0, 7) || "--";
      console.log(`deploy check: expected ${expectedShort}, deployed ${deployedShort}`);
      if (deployedSha && (deployedSha === EXPECTED_SHA || deployedSha.startsWith(EXPECTED_SHA) || EXPECTED_SHA.startsWith(deployedSha))) {
        console.log(`deploy verified: ${deployedShort}`);
        return;
      }
    } catch (error) {
      lastError = error;
      console.log(`deploy check pending: ${error.message}`);
    }
    await sleep(INTERVAL_MS);
  }
  const detail = lastPayload ? JSON.stringify(lastPayload) : lastError?.message || "no response";
  throw new Error(`Deploy verification timeout for ${expectedShort}: ${detail}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
