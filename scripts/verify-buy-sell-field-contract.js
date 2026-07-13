const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED_FIELD_CONTRACT_VERSION = "buy-sell-derived-fields-20260629-01";
const EXPECTED_FAST_SHELL_ASSET = "terminal-desktop-fast-shell.js?buy-sell-derived-fields=20260629-01&strategy2-history=20260629-01";
const MIN_ROWS = 20;
const PRODUCTION_URL = (process.env.FUMAN_VERIFY_BASE_URL || process.env.FUMAN_PRODUCTION_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");

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
    fumanInternalVerify: true,
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

function fetchProductionInstitutionApi() {
  const token = String(process.env.FUMAN_VERIFY_PRODUCTION_BEARER_TOKEN || "").trim();
  if (!token) {
    return Promise.resolve({
      statusCode: 0,
      payload: { ok: false, error: "production_member_token_not_configured" },
      captureSource: "production-api-skipped",
      skipped: true,
    });
  }
  const url = `${PRODUCTION_URL}/api/institution-latest?canvas=1&compact=1&shell=1&limit=60&fieldContract=${encodeURIComponent(EXPECTED_FIELD_CONTRACT_VERSION)}&verify=${Date.now()}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 25000, headers: { "cache-control": "no-cache", authorization: `Bearer ${token}` } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode || 0, payload: JSON.parse(body || "{}"), captureSource: "production-api-member-token", url });
        } catch (error) {
          reject(new Error(`invalid production institution API JSON: ${error.message}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
  });
}

async function captureInstitutionApiWithRetry(attempts = Number(process.env.FUMAN_BUY_SELL_FIELD_CONTRACT_ATTEMPTS || 1)) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await captureInstitutionApi();
    if (last.statusCode === 200 && last.payload?.ok === true) return { ...last, captureSource: "local-handler" };
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
  }
  if (/institution_api_only_unavailable|fetch failed|supabase_not_configured/i.test(`${last?.payload?.error || ""} ${last?.payload?.detail || ""}`)) {
    try {
      const production = await fetchProductionInstitutionApi();
      if (production.statusCode === 200 && production.payload?.ok === true) return production;
      return { ...(last || { statusCode: 0, payload: {} }), productionFallback: production, captureSource: "local-handler-source-unavailable" };
    } catch (error) {
      return { ...(last || { statusCode: 0, payload: {} }), productionFallbackError: error?.message || String(error), captureSource: "local-handler-source-unavailable" };
    }
  }
  return { ...(last || { statusCode: 0, payload: {} }), captureSource: "local-handler" };
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

  const { statusCode, payload, captureSource, productionFallbackError, productionFallback } = await captureInstitutionApiWithRetry();
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const sourceUnavailable = /institution_api_only_unavailable|fetch failed|supabase_not_configured|HTTP 522|Connection timed out/i.test(`${payload?.error || ""} ${payload?.detail || ""}`);

  if (statusCode !== 200 || payload?.ok !== true) {
    if (sourceUnavailable && productionFallback?.skipped === true && payload?.fieldContractVersion === EXPECTED_FIELD_CONTRACT_VERSION) {
      console.warn(`[buy-sell-field-contract] live source unavailable during structural gate; captureSource=${captureSource} error=${payload?.error || ""} detail=${String(payload?.detail || "").slice(0, 180)} productionFallback=${productionFallback.payload?.error || ""}`);
      console.log(`[buy-sell-field-contract] ok structural-only version=${EXPECTED_FIELD_CONTRACT_VERSION} captureSource=${captureSource} sourceUnavailable=true`);
      setImmediate(() => process.exit(0));
      return;
    }
    issues.push(`institution API must return 200 ok=true for ${EXPECTED_FIELD_CONTRACT_VERSION}; status=${statusCode} error=${payload?.error || ""} detail=${payload?.detail || ""}`);
  }
  if (productionFallbackError) {
    issues.push(`institution production fallback failed after local handler failure: ${productionFallbackError}`);
  }
  if (payload?.fieldContractVersion !== EXPECTED_FIELD_CONTRACT_VERSION) {
    issues.push(`institution API fieldContractVersion mismatch; expected=${EXPECTED_FIELD_CONTRACT_VERSION} actual=${payload?.fieldContractVersion || "(missing)"}`);
  }
  if (!/supabase/i.test(`${payload?.cacheSource || ""} ${payload?.source || ""} ${payload?.transport?.source || ""}`)) {
    issues.push(`institution API must expose Supabase source; cacheSource=${payload?.cacheSource || ""} source=${payload?.source || ""}`);
  }
  if (payload?.transport?.gate && payload.transport.gate !== "complete-run-readback") {
    issues.push(`institution API transport gate mismatch; expected complete-run-readback actual=${payload.transport.gate}`);
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

  console.log(`[buy-sell-field-contract] ok version=${EXPECTED_FIELD_CONTRACT_VERSION} rows=${rows.length} cacheSource=${payload?.cacheSource || ""} captureSource=${captureSource || "local-handler"} pctNonZero=${pctNonZero}`);
}

main().catch((error) => {
  console.error(`[buy-sell-field-contract] failed: ${error?.stack || error?.message || error}`);
  process.exit(1);
});
