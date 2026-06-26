const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const INTERVAL_MS = Math.max(1000, Number(process.env.MARKET_OVERVIEW_PATROL_INTERVAL_MS || 10000));
const TARGET_TIMEOUT_MS = Math.max(1000, Number(process.env.MARKET_OVERVIEW_TARGET_TIMEOUT_MS || 25000));
const MARKET_START_MINUTES = 9 * 60;
const MARKET_END_MINUTES = 13 * 60 + 30;

const TARGETS = [
  { label: "market", path: "/api/market" },
  { label: "stocks", path: "/api/stocks" },
  { label: "heatmap", path: "/api/heatmap", validate: validateHeatmap },
  { label: "frontend-heatmap-contract", path: "/terminal-app.js", text: true, validate: validateHeatmapFrontendContract },
];

const REQUIRED_HEATMAP_CODES = ["3037", "2492", "2327", "2059"];

function taipeiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function minuteOfDay(parts = taipeiParts()) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isBeforeMarket(parts = taipeiParts()) {
  return minuteOfDay(parts) < MARKET_START_MINUTES;
}

function isMarketTime(parts = taipeiParts()) {
  const minutes = minuteOfDay(parts);
  return minutes >= MARKET_START_MINUTES && minutes <= MARKET_END_MINUTES;
}

function msUntilMarketOpen(parts = taipeiParts()) {
  const minutes = minuteOfDay(parts);
  const seconds = Number(parts.second || 0);
  return Math.max(0, (MARKET_START_MINUTES - minutes) * 60 * 1000 - seconds * 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function taipeiTimeLabel(date = new Date()) {
  const parts = taipeiParts(date);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

function flattenHeatmapStocks(payload) {
  const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
  return sectors.flatMap((sector) => Array.isArray(sector.stocks) ? sector.stocks : []);
}

function validateHeatmap(payload) {
  const rows = flattenHeatmapStocks(payload);
  const health = payload?.health || {};
  if (!isMarketTime()) {
    const problems = [];
    if (payload?.ok !== true) problems.push("payload ok is not true");
    if (!rows.length) problems.push("after-hours heatmap rows empty");
    if (problems.length) throw new Error(problems.join("; "));
    return `after-hours snapshot rows=${rows.length} quoteTime=${health.quoteTime || ""}`;
  }
  const required = REQUIRED_HEATMAP_CODES.map((code) => rows.find((stock) => String(stock.code) === code)).filter(Boolean);
  const problems = [];

  if (payload?.ok !== true) problems.push("payload ok is not true");
  if (health.isHealthy !== true) problems.push("health is not healthy");
  if (rows.length < 500) problems.push(`stock rows too low: ${rows.length}`);
  if (Number(health.badDate || 0) > 0) problems.push(`badDate=${health.badDate}`);
  if (Number(health.notRealtime || 0) > 0) problems.push(`notRealtime=${health.notRealtime}`);
  if (Number(health.noPrice || 0) > 0) problems.push(`noPrice=${health.noPrice}`);
  if (required.length !== REQUIRED_HEATMAP_CODES.length) problems.push(`missing required codes: ${REQUIRED_HEATMAP_CODES.filter((code) => !required.some((stock) => String(stock.code) === code)).join(",")}`);

  for (const stock of required) {
    if (stock.isRealtime !== true) problems.push(`${stock.code} isRealtime=false`);
    if (!Number(stock.close)) problems.push(`${stock.code} close is empty`);
  }

  if (problems.length) throw new Error(problems.join("; "));
  return `stocks=${rows.length} realtime=${health.realtimeStockCount || payload?.realtimeStockCount || ""} quoteTime=${health.quoteTime || ""}`;
}

function validateHeatmapFrontendContract(source) {
  const required = ["heatmap-health-bar", "isHeatmapPollingWindow", "renderHeatmapClosedState", "heatmapClosedSnapshotDate", "熱力圖今日收盤", "loadHeatmap"];
  const forbidden = [];
  const missing = required.filter((text) => !source.includes(text));
  const leaked = forbidden.filter((text) => source.includes(text));
  if (missing.length || leaked.length) {
    throw new Error(`missing=${missing.join(",") || "none"} leaked=${leaked.join(",") || "none"}`);
  }
  return "api-only frontend contract ok";
}

async function fetchTarget(target) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TARGET_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${target.path}`, {
      headers: { "User-Agent": "fuman-terminal-market-overview-patrol" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const detail = target.text ? target.validate?.(text) : target.validate?.(JSON.parse(text));
    if (!target.text && !target.validate) JSON.parse(text);
    console.log(`${target.label} ok ${Date.now() - started}ms${detail ? ` ${detail}` : ""}`);
    return true;
  } catch (error) {
    const reason = error?.name === "AbortError" ? `timeout ${TARGET_TIMEOUT_MS}ms` : error.message;
    console.error(`${target.label} failed: ${reason}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function runOnce(round) {
  const started = Date.now();
  console.log(`[${taipeiTimeLabel()}] market overview round ${round} start`);
  const results = await Promise.allSettled(TARGETS.map(fetchTarget));
  const okCount = results.filter((result) => result.status === "fulfilled" && result.value === true).length;
  const failCount = TARGETS.length - okCount;
  console.log(
    `[${taipeiTimeLabel()}] market overview round ${round} done: ok ${okCount}, fail ${failCount}, elapsed ${Date.now() - started}ms`
  );
  return failCount === 0;
}

async function main() {
  let successCount = 0;
  let failureCount = 0;
  let round = 0;

  console.log(
    `market overview patrol config: base=${BASE_URL}, interval=${INTERVAL_MS}ms, targetTimeout=${TARGET_TIMEOUT_MS}ms`
  );

  if (isBeforeMarket()) {
    console.log("market overview patrol waiting for 09:00 market open");
    await sleep(msUntilMarketOpen() + 1000);
  }

  if (!isMarketTime()) {
    round += 1;
    if (await runOnce(round)) successCount += 1;
    else failureCount += 1;
    console.log(`market overview patrol single run: success ${successCount}, failure ${failureCount}`);
    if (!successCount) process.exit(1);
    return;
  }

  while (isMarketTime()) {
    const roundStarted = Date.now();
    round += 1;
    if (await runOnce(round)) successCount += 1;
    else failureCount += 1;
    const remainingMs = Math.max(0, INTERVAL_MS - (Date.now() - roundStarted));
    if (remainingMs > 0) await sleep(remainingMs);
  }

  console.log(`market overview 10s patrol finished: success ${successCount}, failure ${failureCount}`);
  if (!successCount) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

