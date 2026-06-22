const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = (process.env.FUMAN_VERIFY_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const LIVE = process.argv.includes("--live") || process.env.FUMAN_WARRANT_FRESHNESS_LIVE === "1";
const LOCAL_DATA_DIR = process.env.FUMAN_VERIFY_DATA_DIR || path.join(ROOT, "data");

const FILES = {
  latest: "data/warrant-flow-latest.json",
  slim: "data/warrant-flow-slim.json",
  priority: "data/warrant-priority-top.json",
  mobile: "data/warrant-flow-mobile-top.json",
};

function fetchText(pathname, timeoutMs = 20000) {
  const cleanPath = String(pathname || "").replace(/^\/+/, "");
  const separator = cleanPath.includes("?") ? "&" : "?";
  const url = `${BASE_URL}/${cleanPath}${separator}v=warrant-freshness-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${pathname} HTTP ${res.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("timeout", () => req.destroy(new Error(`${pathname} timeout`)));
    req.on("error", reject);
  });
}

function compactDateKey(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (/^\d{8}$/.test(digits)) return digits;
  if (/^\d{7}$/.test(digits)) {
    const rocYear = Number(digits.slice(0, 3));
    const month = Number(digits.slice(3, 5));
    const day = Number(digits.slice(5, 7));
    if (rocYear > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${rocYear + 1911}${digits.slice(3, 5)}${digits.slice(5, 7)}`;
    }
  }
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(parsed)).replace(/\D/g, "");
  }
  return digits.slice(0, 8);
}

async function readJson(rel) {
  if (LIVE) return JSON.parse(await fetchText(rel));
  return JSON.parse(fs.readFileSync(path.join(LOCAL_DATA_DIR, rel.replace(/^data[\\/]/, "")), "utf8"));
}

function rows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.matches)) return payload.matches;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (payload.data && typeof payload.data === "object") return Object.values(payload.data);
  return [];
}

function volumeRows(payload) {
  return Array.isArray(payload?.volumeMatches) ? payload.volumeMatches : [];
}

function singleRows(payload) {
  return Array.isArray(payload?.singleSignals) ? payload.singleSignals : [];
}

function count(payload) {
  if (!payload) return 0;
  if (Number.isFinite(Number(payload.count))) return Number(payload.count);
  return rows(payload).length;
}

function volumeCount(payload) {
  if (!payload) return 0;
  if (Number.isFinite(Number(payload.volumeCount))) return Number(payload.volumeCount);
  return volumeRows(payload).length;
}

function assertOk(condition, message, issues) {
  if (!condition) issues.push(message);
}

function schemaVersionAtLeast(actual, required) {
  const actualText = String(actual || "").trim();
  const requiredText = String(required || "").trim();
  if (!actualText || !requiredText) return false;
  if (actualText === requiredText) return true;
  const actualBase = actualText.replace(/-v\d+$/i, "");
  const requiredBase = requiredText.replace(/-v\d+$/i, "");
  const actualVersion = Number(actualText.match(/-v(\d+)$/i)?.[1] || 0);
  const requiredVersion = Number(requiredText.match(/-v(\d+)$/i)?.[1] || 0);
  return actualBase === requiredBase && actualVersion >= requiredVersion;
}

function isSingleWarrantVolumeRow(row) {
  const warrantCode = String(row?.warrantCode || "").trim();
  const underlyingCode = String(row?.underlyingCode || row?.code || "").trim();
  return /^\d{5,6}$/.test(warrantCode)
    && /^\d{4}$/.test(underlyingCode)
    && warrantCode !== underlyingCode
    && Boolean(String(row?.warrantName || "").trim())
    && Number(row?.thirtyMinuteVolume || 0) > 0
    && Number(row?.floatingUnits || 0) > 0
    && Number(row?.volumeMultiple || 0) > 0;
}

async function verifyWatchlistWarrantCoverage(apiPayload, issues) {
  const watchlist = JSON.parse(await fetchText("api/watchlist-match-index"));
  const byCode = watchlist?.byCode && typeof watchlist.byCode === "object" ? watchlist.byCode : {};
  assertOk(watchlist?.ok === true, "watchlist-match-index ok not true", issues);
  assertOk(watchlist?.cacheSource === "supabase:market_snapshots", `watchlist cacheSource=${watchlist?.cacheSource || "missing"}`, issues);

  const warrantCodes = new Set(
    Object.entries(byCode)
      .filter(([, entries]) => Array.isArray(entries) && entries.some((entry) => String(entry?.key || "").startsWith("warrant")))
      .map(([code]) => String(code))
  );
  const volumeUnderlyingCodes = volumeRows(apiPayload).map((row) => String(row?.underlyingCode || row?.code || "").trim()).filter(Boolean);
  const singleUnderlyingCodes = singleRows(apiPayload).map((row) => String(row?.underlyingCode || row?.code || "").trim()).filter(Boolean);
  const missingVolume = volumeUnderlyingCodes.filter((code) => !warrantCodes.has(code));
  const missingSingle = singleUnderlyingCodes.filter((code) => !warrantCodes.has(code));
  assertOk(missingVolume.length === 0, `watchlist missing warrant volume underlyings=${missingVolume.slice(0, 8).join(",")}`, issues);
  assertOk(missingSingle.length === 0, `watchlist missing warrant single underlyings=${missingSingle.slice(0, 8).join(",")}`, issues);
  return {
    runId: watchlist.runId || "",
    cacheSource: watchlist.cacheSource || "",
    warrantCodes: warrantCodes.size,
    checkedVolume: volumeUnderlyingCodes.length,
    checkedSingle: singleUnderlyingCodes.length,
  };
}

async function verifySupabaseApi(issues) {
  if (!LIVE) return null;
  const apiPayload = JSON.parse(await fetchText("api/warrant-flow-latest?top=1&compact=1&limit=5"));
  const coveragePayload = JSON.parse(await fetchText("api/warrant-flow-latest?top=1&compact=1&limit=500"));
  const apiRows = rows(apiPayload);
  const firstVolume = volumeRows(apiPayload)[0];
  const usedDate = compactDateKey(apiPayload.usedDate);
  const sourceDate = compactDateKey(apiPayload.sourceDate);
  const marketDataDate = compactDateKey(apiPayload.marketSession?.marketDataDate);

  assertOk(apiPayload?.ok === true, "warrant-flow api ok not true", issues);
  assertOk(apiPayload?.cacheSource === "supabase-api", `warrant-flow api cacheSource=${apiPayload?.cacheSource || "missing"}`, issues);
  assertOk(Boolean(apiPayload?.runId), "warrant-flow api runId missing", issues);
  assertOk(schemaVersionAtLeast(apiPayload?.schemaVersion, "warrant-flow-run-id-complete-v1"), `warrant-flow api schemaVersion invalid ${apiPayload?.schemaVersion || "missing"}`, issues);
  assertOk(apiPayload?.dataContract?.ok === true, `warrant-flow api dataContract not ok ${JSON.stringify(apiPayload?.dataContract?.issues || [])}`, issues);
  assertOk(/^\d{8}$/.test(usedDate), `warrant-flow api usedDate invalid ${apiPayload?.usedDate || "missing"}`, issues);
  assertOk(/^\d{8}$/.test(sourceDate), `warrant-flow api sourceDate invalid ${apiPayload?.sourceDate || "missing"}`, issues);
  assertOk(/^\d{8}$/.test(marketDataDate), `warrant-flow api marketDataDate invalid ${apiPayload?.marketSession?.marketDataDate || "missing"}`, issues);
  assertOk(apiRows.length <= 5, `warrant-flow api top limit not applied rows=${apiRows.length}`, issues);
  assertOk(Number(apiPayload?.matchesTotal || apiPayload?.count || 0) >= apiRows.length, "warrant-flow api matches total missing", issues);
  assertOk(Boolean(firstVolume?.warrantCode), "warrant-flow api first volume warrantCode missing", issues);
  assertOk(isSingleWarrantVolumeRow(firstVolume), "warrant-flow api first volume is not single warrant row", issues);
  assertOk(Number(firstVolume?.thirtyMinuteVolume || 0) > 0, "warrant-flow api first volume thirtyMinuteVolume missing", issues);
  assertOk(Number(firstVolume?.floatingUnits || 0) > 0, "warrant-flow api first volume floatingUnits missing", issues);
  assertOk(Number(firstVolume?.volumeMultiple || 0) > 0, "warrant-flow api first volume volumeMultiple missing", issues);

  const watchlistSummary = await verifyWatchlistWarrantCoverage(coveragePayload, issues);

  return {
    runId: apiPayload.runId,
    usedDate,
    count: apiPayload.count,
    rows: apiRows.length,
    matchesTotal: apiPayload.matchesTotal,
    volumeRows: volumeRows(apiPayload).length,
    volumeMatchesTotal: apiPayload.volumeMatchesTotal,
    singleSignalsTotal: apiPayload.singleSignalsTotal,
    schemaVersion: apiPayload.schemaVersion || "",
    coverageVolumeRows: volumeRows(coveragePayload).length,
    coverageSingleRows: singleRows(coveragePayload).length,
    watchlistSummary,
  };
}

async function main() {
  const issues = [];
  if (LIVE) {
    const apiSummary = await verifySupabaseApi(issues);
    if (issues.length) {
      console.error("[warrant-freshness] failed live api-only");
      for (const issue of issues) console.error(`- ${issue}`);
      process.exit(1);
    }
    console.log(`[warrant-freshness] ok live api-only apiRun=${apiSummary.runId} apiRows=${apiSummary.rows}/${apiSummary.matchesTotal || apiSummary.count} apiVolume=${apiSummary.volumeRows}/${apiSummary.volumeMatchesTotal || "--"} usedDate=${apiSummary.usedDate} schema=${apiSummary.schemaVersion} watchlistWarrant=${apiSummary.watchlistSummary.warrantCodes}`);
    return;
  }

  const payloads = {};
  for (const [key, file] of Object.entries(FILES)) payloads[key] = await readJson(file);

  const apiSummary = await verifySupabaseApi(issues);
  const latestRows = rows(payloads.latest);
  const slimRows = rows(payloads.slim);
  const priorityRows = rows(payloads.priority);
  const mobileRows = rows(payloads.mobile);
  const latestVolumeRows = volumeRows(payloads.latest);
  const slimVolumeRows = volumeRows(payloads.slim);

  assertOk(payloads.latest?.ok !== false, "warrant-flow-latest ok=false", issues);
  assertOk(payloads.slim?.ok !== false, "warrant-flow-slim ok=false", issues);
  assertOk(count(payloads.latest) >= 50, `warrant-flow-latest matches too small count=${count(payloads.latest)}`, issues);
  assertOk(count(payloads.slim) >= 50, `warrant-flow-slim matches too small count=${count(payloads.slim)}`, issues);
  assertOk(priorityRows.length >= 50, `warrant-priority-top too small rows=${priorityRows.length}`, issues);
  assertOk(mobileRows.length >= 20, `warrant-flow-mobile-top too small rows=${mobileRows.length}`, issues);
  assertOk(volumeCount(payloads.latest) >= 50, `warrant-flow-latest volumeMatches too small count=${volumeCount(payloads.latest)}`, issues);
  assertOk(volumeCount(payloads.slim) === volumeCount(payloads.latest), `warrant-flow-slim volumeCount mismatch slim=${volumeCount(payloads.slim)} latest=${volumeCount(payloads.latest)}`, issues);
  assertOk(slimVolumeRows.length === volumeCount(payloads.slim), `warrant-flow-slim volumeMatches length mismatch rows=${slimVolumeRows.length} count=${volumeCount(payloads.slim)}`, issues);

  const latestFirst = latestRows[0];
  const slimFirst = slimRows[0];
  const priorityFirst = priorityRows[0];
  if (latestFirst && slimFirst) {
    assertOk(String(latestFirst.code || latestFirst.underlyingCode || "") === String(slimFirst.code || slimFirst.underlyingCode || ""), "warrant-flow latest/slim first code mismatch", issues);
  }
  if (latestFirst && priorityFirst) {
    assertOk(String(latestFirst.code || latestFirst.underlyingCode || "") === String(priorityFirst.code || priorityFirst.underlyingCode || ""), "warrant priority first code mismatch", issues);
  }

  for (const row of slimVolumeRows.slice(0, 20)) {
    const code = String(row.code || row.underlyingCode || "").trim();
    assertOk(Boolean(code), "warrant volume row missing code", issues);
    assertOk(Number(row.thirtyMinuteVolume || 0) > 0, `warrant volume ${code} thirtyMinuteVolume missing`, issues);
    assertOk(Number(row.floatingUnits || 0) > 0, `warrant volume ${code} floatingUnits missing`, issues);
    assertOk(Number(row.volumeMultiple || 0) > 0, `warrant volume ${code} volumeMultiple missing`, issues);
  }

  if (issues.length) {
    console.error(`[warrant-freshness] failed ${LIVE ? "live" : "local"}`);
    for (const issue of issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  const apiText = apiSummary ? ` apiRun=${apiSummary.runId} apiRows=${apiSummary.rows}/${apiSummary.matchesTotal || apiSummary.count} apiVolume=${apiSummary.volumeRows}/${apiSummary.volumeMatchesTotal || "--"}` : "";
  console.log(`[warrant-freshness] ok ${LIVE ? "live" : "local"} matches=${count(payloads.slim)} volume=${volumeCount(payloads.slim)} updatedAt=${payloads.slim?.updatedAt || "--"}${apiText}`);
}

main().catch((error) => {
  console.error(`[warrant-freshness] error ${error.message}`);
  process.exit(1);
});
