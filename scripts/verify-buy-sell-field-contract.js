const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_FIELD_CONTRACT_VERSION = "buy-sell-derived-fields-20260629-01";
const EXPECTED_FAST_SHELL_ASSET = "terminal-desktop-fast-shell.js?buy-sell-derived-fields=20260629-01&strategy2-history=20260629-01";
const MIN_ROWS = 20;

const issues = [];

function read(file) {
  const target = path.join(ROOT, file);
  try {
    return fs.readFileSync(target, "utf8");
  } catch (error) {
    issues.push(`${file} missing or unreadable: ${error.message}`);
    return "";
  }
}

function requireIncludes(file, markers) {
  const text = read(file);
  for (const marker of markers) {
    if (!text.includes(marker)) issues.push(`${file} missing marker: ${marker}`);
  }
  return text;
}

function hasValue(row, key) {
  return row && row[key] !== undefined && row[key] !== null && row[key] !== "";
}

function nonZeroCount(rows, key) {
  return rows.filter((row) => hasValue(row, key) && Number(row[key]) !== 0).length;
}

async function captureInstitutionApi() {
  const handler = require("../api/institution-latest");
  const request = {
    method: "GET",
    url: `https://verify.local/api/institution-latest?canvas=1&compact=1&shell=1&limit=60&fieldContract=${encodeURIComponent(EXPECTED_FIELD_CONTRACT_VERSION)}`,
    headers: { host: "verify.local" },
  };
  return new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ statusCode: this.statusCode, payload });
      },
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

async function captureInstitutionApiWithRetry(attempts = 3) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await captureInstitutionApi();
    if (last.statusCode === 200 && last.payload?.ok === true) return last;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
  }
  return last;
}

async function main() {
  requireIncludes("api/institution-latest.js", [
    `const INSTITUTION_FIELD_CONTRACT_VERSION = "${EXPECTED_FIELD_CONTRACT_VERSION}"`,
    "fieldContractVersion: INSTITUTION_FIELD_CONTRACT_VERSION",
    "payloadMatchesFieldContract",
    "options.fieldContract",
  ]);

  requireIncludes("terminal-desktop-fast-shell.js", [
    `const CHIP_TRADE_FIELD_CONTRACT_VERSION = "${EXPECTED_FIELD_CONTRACT_VERSION}"`,
    'query.set("fieldContract", CHIP_TRADE_FIELD_CONTRACT_VERSION)',
    "foreign_trust_buy_volume_pct",
    "five_day_avg_volume",
    "avg_volume_5d",
    "pickFirstValue(row?.foreignTrustBuyVolumePct",
  ]);

  requireIncludes("index.html", [
    EXPECTED_FAST_SHELL_ASSET,
    'data-fuman-desktop-fast-shell="1"',
  ]);

  const { statusCode, payload } = await captureInstitutionApiWithRetry();
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  if (statusCode !== 200 || payload?.ok !== true) {
    issues.push(`institution API must return 200 ok=true for ${EXPECTED_FIELD_CONTRACT_VERSION}; status=${statusCode} error=${payload?.error || ""} detail=${payload?.detail || ""}`);
  }
  if (payload?.fieldContractVersion !== EXPECTED_FIELD_CONTRACT_VERSION) {
    issues.push(`institution API fieldContractVersion mismatch; expected=${EXPECTED_FIELD_CONTRACT_VERSION} actual=${payload?.fieldContractVersion || "(missing)"}`);
  }
  if (rows.length < MIN_ROWS) {
    issues.push(`institution API must return at least ${MIN_ROWS} rows for field contract verification; rows=${rows.length}`);
  }

  const requiredRowFields = [
    "foreignStreak",
    "trustStreak",
    "jointStreak",
    "fiveDayAvgVolume",
    "five_day_avg_volume",
    "foreignTrustBuyVolumePct",
    "foreignTrustVolumePct",
    "institutionBuyVolumePct",
  ];
  for (const field of requiredRowFields) {
    const count = rows.filter((row) => hasValue(row, field)).length;
    if (rows.length && count !== rows.length) {
      issues.push(`institution API field ${field} must exist on every row; found=${count}/${rows.length}`);
    }
  }

  const avgVolumeCount = rows.filter((row) => Number(row.fiveDayAvgVolume) > 0).length;
  if (rows.length && avgVolumeCount !== rows.length) {
    issues.push(`institution API fiveDayAvgVolume must be positive on every row; found=${avgVolumeCount}/${rows.length}`);
  }

  const pctNonZero = nonZeroCount(rows, "foreignTrustVolumePct");
  if (rows.length && pctNonZero < Math.min(10, rows.length)) {
    issues.push(`institution API foreignTrustVolumePct looks uncomputed; nonZero=${pctNonZero}/${rows.length}`);
  }

  if (issues.length) {
    console.error("[buy-sell-field-contract] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }

  console.log(`[buy-sell-field-contract] ok version=${EXPECTED_FIELD_CONTRACT_VERSION} rows=${rows.length} cacheSource=${payload?.cacheSource || ""} pctNonZero=${pctNonZero}`);
}

main().catch((error) => {
  console.error(`[buy-sell-field-contract] failed: ${error?.stack || error?.message || error}`);
  process.exit(1);
});
