const fs = require("fs");
const path = require("path");

const { ROOT, dataPath } = require("./runtime-paths");
const { chipTradeExclusion, loadChipTradeBlacklist } = require("../lib/chip-trade-exclusions");

const SOURCE_NAME = process.env.FUMAN_TDCC_SOURCE_NAME || "fuman_tdcc_shareholding_1000";
const HISTORY_FILE = dataPath("tdcc-shareholding-1000-history.json");
const INSTITUTION_FILE = dataPath("institution-latest.json");
const OUT_FILE = dataPath("institution-tdcc-breakout.json");
const TOP_FILE = dataPath("institution-tdcc-breakout-top.json");
const CSV_FILE = dataPath("institution-tdcc-breakout.csv");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function readSecret(name) {
  return readText(path.join(ROOT, "secrets", name))
    || readText(path.join(process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime", "secrets", name));
}

const SUPABASE_URL = (
  process.env.SUPABASE_URL
  || process.env.FUMAN_SUPABASE_URL
  || readSecret("supabase-url.txt")
  || ""
).replace(/\/+$/, "");
const SUPABASE_READ_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.FUMAN_SUPABASE_ANON_KEY
  || readSecret("supabase-anon-key.txt")
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || readSecret("supabase-service-role-key.txt");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function normalizeCode(value) {
  const code = String(value || "").trim();
  return /^\d{4}$/.test(code) ? code : "";
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+%]/g, "").trim()) || 0;
}

function ratioRow(week, code) {
  const row = week?.byCode?.[code];
  if (!row) return null;
  const ratio = cleanNumber(row.ratio1000Up ?? row.ratio);
  return Number.isFinite(ratio) ? ratio : null;
}

function institutionRows(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  return Object.values(payload?.data || {});
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function writeCsv(file, rows) {
  const headers = [
    "code", "name", "foreignStreak", "foreignLots",
    "ratioDate1", "ratio1", "ratioDate2", "ratio2", "ratioDate3", "ratio3",
    "ratioIncrease", "close", "changePct", "foreignTrustBuyVolumePct", "breakoutScore", "entryType", "heatWarning",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => csvCell(row[key])).join(","));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
}

async function loadTdccFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_READ_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/source_status?source_name=eq.${encodeURIComponent(SOURCE_NAME)}&select=payload,updated_at&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_READ_KEY,
      Authorization: `Bearer ${SUPABASE_READ_KEY}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase TDCC readback HTTP ${response.status} ${text.slice(0, 180)}`.trim());
  }
  const rows = await response.json();
  const payload = Array.isArray(rows) ? rows[0]?.payload : null;
  return payload?.weeks ? { ...payload, source: "supabase:source_status" } : null;
}

async function loadTdccHistory() {
  if (process.env.FUMAN_TDCC_FORCE_LOCAL !== "1") {
    try {
      const remote = await loadTdccFromSupabase();
      if (remote) return remote;
    } catch (error) {
      console.warn(`TDCC Supabase read skipped: ${error.message}`);
    }
  }
  const local = readJson(HISTORY_FILE, null);
  if (local?.weeks) return { ...local, source: local.source || "local-json" };
  throw new Error(`missing TDCC cache: ${HISTORY_FILE}`);
}

function latestDates(history, count) {
  const explicit = arg("dates", "");
  if (explicit) {
    return explicit.split(",").map((item) => item.replace(/\D/g, "").slice(0, 8)).filter((item) => /^\d{8}$/.test(item));
  }
  return Object.keys(history.weeks || {}).sort().slice(-count);
}

function isIncreasing(values, strict) {
  for (let i = 1; i < values.length; i += 1) {
    if (strict ? values[i] <= values[i - 1] : values[i] < values[i - 1]) return false;
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

  let entryType = "觀察";
  if (overheated) {
    entryType = "過熱觀察";
  } else if (percent >= 0 && percent <= 6 && volumeRatio5 >= 0.8) {
    entryType = "突破";
  } else if (foreignStreak >= 3 && percent >= -2 && percent < 2) {
    entryType = "拉回";
  }

  const breakoutScore = Math.round(
    chipScore * 0.35
    + structureScore * 0.30
    + heatScore * 0.20
    + volumeScore * 0.15
  );

  return {
    breakoutScore,
    entryType,
    heatWarning: heatWarnings.join("、") || "正常",
    volumeRatio5: round2(volumeRatio5),
    foreignTrustBuyVolumePct: round2(foreignTrustBuyVolumePct),
    institutionBuyVolumePct: round2(foreignTrustBuyVolumePct),
  };
}

async function main() {
  const institution = readJson(INSTITUTION_FILE, {});
  const tdcc = await loadTdccHistory();
  const weeks = Number(arg("weeks", "3"));
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
    const trust = cleanNumber(row.trust);
    if (foreignStreak < 3 || foreign <= 0) continue;
    const ratios = dates.map((date) => ratioRow(tdcc.weeks[date], code));
    if (ratios.some((value) => value == null)) continue;
    if (!isIncreasing(ratios, strict)) continue;
    const foreignLots = Math.round(foreign / 1000);
    const ratioIncrease = Number((ratios.at(-1) - ratios[0]).toFixed(2));
    const fallback = fallbackBreakoutFields(row, ratioIncrease);
    matches.push({
      code,
      name: row.name || code,
      foreignStreak,
      foreignLots,
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

  matches.sort((a, b) => (
    b.ratioIncrease - a.ratioIncrease
    || b.breakoutScore - a.breakoutScore
    || b.foreignLots - a.foreignLots
  ));

  const payload = {
    ok: true,
    source: "institution+tdcc-1000-cache",
    tdccSource: tdcc.source || "unknown",
    generatedAt: new Date().toISOString(),
    institutionDate: institution.usedDate || "",
    dates,
    criteria: {
      foreignStreakAtLeast: 3,
      latestForeignBuyPositive: true,
      tdccLevel: "15 / 1,000,001 shares and above",
      strictIncreasing: strict,
      buyVolumePctBasis: "foreign + trust / fiveDayAvgVolume",
      exclusions: [
        "ETF / 00開頭 / 權證 / 可轉債 / 黑名單 / 水泥 / 軍工",
        "近5日均量 < 3000張",
        "內外盤累計 < 3000張；無內外盤欄位時以成交量 < 3000張保底",
      ],
    },
    excludedCounts,
    count: matches.length,
    matches,
  };
  writeJson(OUT_FILE, payload);
  writeJson(TOP_FILE, { ...payload, matches: matches.slice(0, Number(arg("top", "80"))) });
  writeCsv(CSV_FILE, matches);
  console.log(`institution TDCC breakout generated: matches=${matches.length} dates=${dates.join(",")} tdccSource=${payload.tdccSource}`);
  console.table(matches.slice(0, 20).map((item) => ({
    code: item.code,
    name: item.name,
    foreignStreak: item.foreignStreak,
    foreignLots: item.foreignLots,
    ratioIncrease: item.ratioIncrease,
    ratio1: item.ratio1,
    ratio2: item.ratio2,
    ratio3: item.ratio3,
    close: item.close,
    changePct: item.changePct,
  })));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
