"use strict";

const fs = require("fs");
const path = require("path");
const { taipeiDateParts, dateKey } = require("./twse-trading-day");

const DGPA_DAILY_URL = process.env.DGPA_STOP_WORK_DAILY_URL || "https://www.dgpa.gov.tw/typh/daily/nds.html";
const DEFAULT_MARKET_CORE_AREAS = ["臺北市"];

function argValue(name, fallback = "") {
  const prefix = `${name}=`;
  const found = process.argv.find((item) => item === name || item.startsWith(prefix));
  if (!found) return fallback;
  if (found === name) return "1";
  return found.slice(prefix.length);
}

function todayKey(now = new Date()) {
  return dateKey(taipeiDateParts(now));
}

function tomorrowKey(now = new Date()) {
  const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return dateKey(taipeiDateParts(next));
}

function htmlDecode(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function normalizeText(text) {
  return htmlDecode(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}

function targetAreas() {
  const raw = process.env.FUMAN_MARKET_CORE_AREAS || argValue("--areas", "");
  if (!raw) return DEFAULT_MARKET_CORE_AREAS;
  return raw.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function parseDgpaDailyHtml(html) {
  const text = normalizeText(html);
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const updateLine = lines.find((line) => /更新時間/.test(line)) || "";
  const titleLine = lines.find((line) => /天然災害停止上班及上課情形/.test(line)) || "";
  const counties = [
    "基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "臺中市", "彰化縣", "雲林縣", "南投縣",
    "嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "連江縣", "金門縣"
  ];
  const statuses = [];
  const regionNames = new Set(["北部地區", "中部地區", "南部地區", "東部地區", "外島地區"]);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const county = counties.find((name) => line === name || line.startsWith(name));
    if (!county) continue;
    let statusText = line.slice(county.length).trim();
    let nextLine = "";
    if (!statusText) {
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
        const candidate = lines[j];
        if (!candidate || regionNames.has(candidate)) continue;
        if (counties.some((name) => candidate === name || candidate.startsWith(name))) break;
        statusText = candidate.trim();
        nextLine = candidate.trim();
        break;
      }
    }
    const next = lines[i + 1] || "";
    if (/^明天/.test(next)) statusText = `${statusText} ${next}`.trim();
    statuses.push({ county, statusText, rawLine: line, nextLine: /^明天/.test(next) ? next : nextLine });
  }
  return { titleLine, updateLine, statuses, rawText: text };
}

function todayFullStop(statusText) {
  const text = String(statusText || "");
  if (!/今天/.test(text)) return false;
  if (/照常上班|照常辦公/.test(text)) return false;
  if (/下午|晚上|\d{1,2}:\d{2}起/.test(text) && !/今天停止上班/.test(text)) return false;
  return /停止上班|停止辦公/.test(text);
}

function tomorrowFullStop(statusText) {
  const text = String(statusText || "");
  if (!/明天/.test(text)) return false;
  if (/明天照常上班|明天照常辦公/.test(text)) return false;
  return /明天.*(停止上班|停止辦公|已達停止上班)/.test(text);
}

function buildOverride({ date, source, matchedAreas, updateLine, titleLine, generatedBy = "dgpa_auto_update" }) {
  return {
    date,
    marketOpen: false,
    closedReason: "typhoon_holiday",
    name: "災防假休市",
    description: `人事行政總處公告核心交易區停止上班；自動啟用休市保護。matched=${matchedAreas.map((row) => row.county).join(",")}`,
    source: generatedBy,
    lockedBy: "auto-dgpa",
    evidence: {
      source,
      titleLine,
      updateLine,
      matchedAreas,
    },
  };
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function upsertOverride(file, override) {
  const payload = readJson(file, { contract: "market-calendar-overrides-v1", overrides: [] });
  const rows = Array.isArray(payload.overrides) ? payload.overrides : [];
  const nextRows = rows.filter((row) => row.date !== override.date);
  nextRows.push(override);
  nextRows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const nextPayload = {
    contract: payload.contract || "market-calendar-overrides-v1",
    updatedAt: new Date().toISOString(),
    overrides: nextRows,
  };
  writeJson(file, nextPayload);
  return nextPayload;
}

async function loadSource() {
  const fixture = argValue("--fixture", "");
  if (fixture) return { source: fixture, html: fs.readFileSync(fixture, "utf8") };
  const url = argValue("--url", DGPA_DAILY_URL);
  const response = await fetch(url, { headers: { "User-Agent": "FumanMarketCalendarAutoUpdate/1.0" } });
  if (!response.ok) throw new Error(`DGPA HTTP ${response.status}`);
  return { source: url, html: await response.text() };
}

async function main() {
  const runtimeDir = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
  const dataDir = process.env.FUMAN_DATA_DIR || path.join(runtimeDir, "data");
  const receiptDir = path.join(dataDir, "scan-receipts");
  const overrideFile = argValue("--override-file", process.env.FUMAN_MARKET_CALENDAR_AUTO_OVERRIDE_FILE || path.join(dataDir, "market-calendar-overrides.json"));
  const apply = argValue("--apply", "") === "1" || process.argv.includes("--apply");
  const now = new Date(argValue("--now", "") || Date.now());
  const today = argValue("--date", todayKey(now));
  const tomorrow = tomorrowKey(now);
  const areas = targetAreas();
  const { source, html } = await loadSource();
  const parsed = parseDgpaDailyHtml(html);
  const targetRows = parsed.statuses.filter((row) => areas.includes(row.county));
  const todayStopped = targetRows.filter((row) => todayFullStop(row.statusText));
  const tomorrowStopped = targetRows.filter((row) => tomorrowFullStop(row.statusText));
  const targetDate = tomorrowStopped.length ? tomorrow : today;
  const matchedAreas = tomorrowStopped.length ? tomorrowStopped : todayStopped;
  const shouldClose = matchedAreas.length > 0;
  const override = shouldClose ? buildOverride({ date: targetDate, source, matchedAreas, updateLine: parsed.updateLine, titleLine: parsed.titleLine }) : null;
  let wroteOverride = false;
  if (apply && override) {
    upsertOverride(overrideFile, override);
    wroteOverride = true;
  }
  const receipt = {
    ok: true,
    contract: "market-calendar-auto-update-v1",
    checkedAt: new Date().toISOString(),
    source,
    targetAreas: areas,
    today,
    tomorrow,
    targetDate: override?.date || today,
    shouldCloseMarket: shouldClose,
    action: shouldClose ? (apply ? "write_runtime_override" : "would_write_runtime_override") : "no_override_needed",
    wroteOverride,
    overrideFile: wroteOverride ? overrideFile : "",
    titleLine: parsed.titleLine,
    updateLine: parsed.updateLine,
    targetRows,
    matchedAreas,
    override,
  };
  fs.mkdirSync(receiptDir, { recursive: true });
  writeJson(path.join(receiptDir, `market-calendar-auto-update-${today.replace(/-/g, "")}.json`), receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, contract: "market-calendar-auto-update-v1", error: error?.message || String(error), checkedAt: new Date().toISOString() }, null, 2));
    process.exit(1);
  });
}

module.exports = { parseDgpaDailyHtml, todayFullStop, tomorrowFullStop, buildOverride };
