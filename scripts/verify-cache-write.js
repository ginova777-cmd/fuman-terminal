const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MAX_AGE_MINUTES = Number(process.env.MAX_CACHE_WRITE_AGE_MINUTES || 240);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function verify(file) {
  const fullPath = path.resolve(ROOT, file);
  const payload = readJson(fullPath);
  const updatedAt = Date.parse(payload.updatedAt || "");
  if (!Number.isFinite(updatedAt)) {
    throw new Error(`${file} missing valid updatedAt`);
  }

  const ageMinutes = (Date.now() - updatedAt) / 60000;
  if (ageMinutes < -10 || ageMinutes > MAX_AGE_MINUTES) {
    throw new Error(`${file} is not freshly written, updatedAt=${payload.updatedAt}`);
  }

  if (Number(payload.total || 0) <= 0) {
    throw new Error(`${file} has invalid total=${payload.total}`);
  }

  if (payload.fullScan === true && "scannedThisRun" in payload && Number(payload.scannedThisRun || 0) <= 0) {
    throw new Error(`${file} full scan did not scan any code`);
  }

  if (Array.isArray(payload.scannedCodes) && payload.scannedCodes.length === 0 && payload.fullScan === true) {
    throw new Error(`${file} full scan has empty scannedCodes`);
  }

  console.log(`${file} verified: updatedAt=${payload.updatedAt}, total=${payload.total}, count=${payload.count ?? "n/a"}`);
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error("Usage: node scripts/verify-cache-write.js data/file.json [...]");
  files.forEach(verify);
}

main();
