const BASE_URL = process.env.FUMAN_BASE_URL || "https://fuman-terminal.vercel.app";
const INTERVAL_MS = Math.max(1000, Number(process.env.MARKET_OVERVIEW_PATROL_INTERVAL_MS || 10000));
const TARGET_TIMEOUT_MS = Math.max(1000, Number(process.env.MARKET_OVERVIEW_TARGET_TIMEOUT_MS || 8000));
const MARKET_START_MINUTES = 9 * 60;
const MARKET_END_MINUTES = 13 * 60 + 30;

const TARGETS = [
  { label: "market", path: "/api/market" },
  { label: "stocks", path: "/api/stocks" },
  { label: "heatmap", path: "/api/heatmap" },
];

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
    JSON.parse(text);
    console.log(`${target.label} ok ${Date.now() - started}ms`);
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
  return okCount > 0;
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

