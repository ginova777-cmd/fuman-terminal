const fs = require("fs");
const path = require("path");

const { chipTradeExclusion, loadChipTradeBlacklist } = require("../lib/chip-trade-exclusions");

function readSecretText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SOURCE_NAME = process.env.FUMAN_TDCC_SOURCE_NAME || "fuman_tdcc_shareholding_1000";
const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || "https://cpmpfhbzutkiecccekfr.supabase.co"
).replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecretText(path.join(RUNTIME_DIR, "secrets", "supabase-anon-key.txt"));

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function normalizeCode(value) {
  const code = String(value || "").trim();
  return /^\d{4}$/.test(code) ? code : "";
}

function institutionRows(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return Object.values(payload?.data || {});
}

function ratioRow(week, code) {
  const row = week?.byCode?.[code];
  if (!row) return null;
  const ratio = cleanNumber(row.ratio1000Up ?? row.ratio);
  return Number.isFinite(ratio) ? ratio : null;
}

function latestDates(history, count) {
  return Object.keys(history?.weeks || {}).sort().slice(-count);
}

function isIncreasing(values, strict) {
  for (let index = 1; index < values.length; index += 1) {
    if (strict ? values[index] <= values[index - 1] : values[index] < values[index - 1]) return false;
  }
  return true;
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function fallbackBreakoutFields(row, ratioIncrease) {
  const foreignStreak = cleanNumber(row.foreignStreak);
  const foreign = cleanNumber(row.foreign);
  const trust = cleanNumber(row.trust);
  const foreignTrust = foreign + trust;
  const percent = cleanNumber(row.percent ?? row.changePct);
  const fiveDayPctSum = cleanNumber(row.fiveDayPctSum);
  const tradeVolume = cleanNumber(row.tradeVolume);
  const fiveDayAvgVolume = cleanNumber(row.fiveDayAvgVolume);
  const volumeRatio5 = fiveDayAvgVolume > 0 ? tradeVolume / fiveDayAvgVolume : 0;
  const foreignTrustBuyVolumePct = fiveDayAvgVolume > 0 ? (foreignTrust / fiveDayAvgVolume) * 100 : 0;

  let chipScore = 0;
  if (foreignStreak >= 3) chipScore += 28;
  if (foreignStreak >= 5) chipScore += 10;
  if (ratioIncrease >= 1) chipScore += 22;
  else if (ratioIncrease >= 0.5) chipScore += 14;
  else if (ratioIncrease > 0) chipScore += 8;
  if (foreignTrustBuyVolumePct >= 8) chipScore += 18;
  else if (foreignTrustBuyVolumePct >= 3) chipScore += 10;
  if (foreign > 0 && trust > 0) chipScore += 12;
  chipScore = clamp(chipScore, 0, 100);

  let structureScore = 0;
  if (percent >= 0 && percent <= 6) structureScore += 32;
  else if (percent > 6 && percent < 9) structureScore += 18;
  else if (percent < 0) structureScore += 8;
  if (fiveDayPctSum >= 0 && fiveDayPctSum <= 20) structureScore += 28;
  else if (fiveDayPctSum > 20) structureScore -= 18;
  if (ratioIncrease > 0) structureScore += 20;
  structureScore = clamp(structureScore, 0, 100);

  let volumeScore = 0;
  if (volumeRatio5 >= 1.2 && volumeRatio5 <= 3.5) volumeScore += 35;
  else if (volumeRatio5 >= 0.8 && volumeRatio5 < 1.2) volumeScore += 20;
  else if (volumeRatio5 > 3.5 && volumeRatio5 <= 5) volumeScore += 14;
  else if (volumeRatio5 > 5) volumeScore -= 12;
  if (percent > 0 && volumeRatio5 >= 0.8) volumeScore += 20;
  if (tradeVolume > 0 && fiveDayAvgVolume > 0) volumeScore += 15;
  volumeScore = clamp(volumeScore, 0, 100);

  const heatWarnings = [];
  if (percent >= 9) heatWarnings.push("接近漲停");
  if (fiveDayPctSum > 20) heatWarnings.push("5日漲幅過熱");
  if (volumeRatio5 > 5) heatWarnings.push("爆量");
  if (percent < 0 && foreign > 0) heatWarnings.push("外資買超但收黑");
  const overheated = heatWarnings.some((text) => /漲停|過熱|爆量/.test(text));
  const heatScore = overheated ? 45 : heatWarnings.length ? 70 : 100;

  return {
    breakoutScore: Math.round(chipScore * 0.35 + structureScore * 0.30 + heatScore * 0.20 + volumeScore * 0.15),
    entryType: overheated ? "過熱觀察" : percent >= 0 && percent <= 6 && volumeRatio5 >= 0.8 ? "突破" : foreignStreak >= 3 && percent >= -2 && percent < 2 ? "拉回" : "觀察",
    heatWarning: heatWarnings.join("、") || "正常",
    volumeRatio5: round2(volumeRatio5),
    foreignTrustBuyVolumePct: round2(foreignTrustBuyVolumePct),
  };
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${url} HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  return response.json();
}

async function loadTdccHistory() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("supabase_not_configured");
  const url = `${SUPABASE_URL}/rest/v1/source_status?source_name=eq.${encodeURIComponent(SOURCE_NAME)}&select=payload,updated_at&limit=1`;
  const rows = await fetchJson(url, {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  });
  const payload = Array.isArray(rows) ? rows[0]?.payload : null;
  if (!payload?.weeks) throw new Error("tdcc_source_status_empty");
  return { ...payload, source: "supabase:source_status" };
}

function buildPayload({ institution, tdcc, top = 80 }) {
  const weeks = Number(process.env.FUMAN_TDCC_BREAKOUT_WEEKS || 3);
  const dates = latestDates(tdcc, weeks);
  const strict = process.env.FUMAN_TDCC_STRICT_INCREASE !== "0";
  if (dates.length < weeks) throw new Error(`TDCC weeks insufficient: need=${weeks} got=${dates.join(",") || "--"}`);

  const matches = [];
  const blacklistCodes = loadChipTradeBlacklist();
  const excludedCounts = {};
  for (const row of institutionRows(institution)) {
    const code = normalizeCode(row.code);
    if (!code) continue;
    const exclusion = chipTradeExclusion(row, blacklistCodes);
    if (exclusion.excluded) {
      for (const reason of exclusion.reasons) excludedCounts[reason] = (excludedCounts[reason] || 0) + 1;
      continue;
    }
    const foreignStreak = Number(row.foreignStreak || 0);
    const foreign = cleanNumber(row.foreign);
    if (foreignStreak < 3 || foreign <= 0) continue;
    const ratios = dates.map((date) => ratioRow(tdcc.weeks[date], code));
    if (ratios.some((value) => value == null)) continue;
    if (!isIncreasing(ratios, strict)) continue;
    const ratioIncrease = Number((ratios.at(-1) - ratios[0]).toFixed(2));
    const fallback = fallbackBreakoutFields(row, ratioIncrease);
    matches.push({
      code,
      name: row.name || code,
      foreignStreak,
      foreignLots: Math.round(foreign / 1000),
      ratioDate1: dates[0],
      ratio1: ratios[0],
      ratioDate2: dates[1],
      ratio2: ratios[1],
      ratioDate3: dates[2],
      ratio3: ratios[2],
      ratioIncrease,
      close: cleanNumber(row.close),
      changePct: cleanNumber(row.percent ?? row.changePct),
      breakoutScore: cleanNumber(row.breakoutScore) || fallback.breakoutScore,
      entryType: row.entryType || fallback.entryType,
      heatWarning: row.heatWarning || fallback.heatWarning,
      volumeRatio5: cleanNumber(row.volumeRatio5) || fallback.volumeRatio5,
      foreignTrustBuyVolumePct: fallback.foreignTrustBuyVolumePct,
      institutionBuyVolumePct: fallback.foreignTrustBuyVolumePct,
      fiveDayPctSum: cleanNumber(row.fiveDayPctSum),
      distanceMa20Pct: cleanNumber(row.distanceMa20Pct),
    });
  }

  matches.sort((a, b) => b.ratioIncrease - a.ratioIncrease || b.breakoutScore - a.breakoutScore || b.foreignLots - a.foreignLots);
  const topMatches = matches.slice(0, top);
  return {
    ok: true,
    source: "supabase:institution+tdcc-1000",
    cacheSource: "supabase-api",
    tdccSource: tdcc.source || "unknown",
    generatedAt: new Date().toISOString(),
    institutionDate: institution.usedDate || "",
    dates,
    criteria: {
      foreignStreakAtLeast: 3,
      latestForeignBuyPositive: true,
      tdccLevel: "15 / 1,000,001 shares and above",
      strictIncreasing: strict,
    },
    excludedCounts,
    count: topMatches.length,
    total: matches.length,
    matches: topMatches,
    rows: topMatches,
    transport: {
      source: "supabase",
      sourceStatus: SOURCE_NAME,
      via: "api/institution-tdcc-breakout-latest",
      gate: "computed-live",
      fetchedAt: new Date().toISOString(),
    },
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    const protocol = request.headers["x-forwarded-proto"] || "https";
    const host = request.headers.host || "fuman-terminal.vercel.app";
    const institution = await fetchJson(`${protocol}://${host}/api/institution-latest`);
    const tdcc = await loadTdccHistory();
    response.status(200).json(buildPayload({ institution, tdcc }));
  } catch (error) {
    response.status(503).json({
      ok: false,
      error: "institution_tdcc_breakout_unavailable",
      detail: error?.message || String(error),
      cacheSource: "none",
      count: 0,
      matches: [],
      rows: [],
      transport: {
        source: "supabase",
        sourceStatus: SOURCE_NAME,
        via: "api/institution-tdcc-breakout-latest",
        gate: "computed-live",
        fetchedAt: new Date().toISOString(),
      },
    });
  }
};
