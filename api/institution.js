async function fetchWithTimeout(url, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.twse.com.tw/",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function cleanNumber(value) {
  if (value === undefined || value === null || value === "" || value === "--") return 0;
  return parseInt(String(value).replace(/[,+%]/g, ""), 10) || 0;
}

function formatTwseDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatTpexDate(date) {
  const y = date.getFullYear() - 1911;
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${d}`;
}

function getRecentTradingDates(days = 7) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const dates = [];
  for (let i = 0; dates.length < days && i < 18; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const day = date.getDay();
    if (day !== 0 && day !== 6) dates.push(date);
  }
  return dates;
}

async function fetchTwseInstitution(date) {
  const dateStr = formatTwseDate(date);
  const url = `https://www.twse.com.tw/fund/T86?response=json&selectType=ALLBUT0999&date=${dateStr}`;
  const data = await fetchWithTimeout(url, {}, 10000);
  if (!data || !Array.isArray(data.data) || !data.data.length) throw new Error(`TWSE no data ${dateStr}`);

  const result = {};
  for (const row of data.data) {
    const code = String(row[0] || "").trim();
    if (!/^\d{4}$/.test(code)) continue;
    result[code] = {
      foreign: cleanNumber(row[4]),
      trust: cleanNumber(row[7]),
      dealer: cleanNumber(row[10] ?? row[8]),
      total: cleanNumber(row[12]),
      market: "TWSE",
    };
  }
  if (!Object.keys(result).length) throw new Error(`TWSE parsed empty ${dateStr}`);
  return { date: dateStr, rows: result };
}

async function fetchTpexInstitution(date) {
  const rocDate = formatTpexDate(date);
  const twseDate = formatTwseDate(date);
  const url = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${rocDate}`;
  const data = await fetchWithTimeout(url, { headers: { Referer: "https://www.tpex.org.tw/" } }, 10000);
  const table = Array.isArray(data?.tables) ? data.tables[0] : null;
  const rows = table?.data || data?.data || data?.aaData || [];
  if (!Array.isArray(rows) || !rows.length) throw new Error(`TPEX no data ${rocDate}`);

  const result = {};
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const code = String(row[0] || "").trim();
    if (!/^\d{4}$/.test(code)) continue;
    result[code] = {
      foreign: cleanNumber(row[10] ?? row[4]),
      trust: cleanNumber(row[13]),
      dealer: cleanNumber(row[22] ?? row[16]),
      total: cleanNumber(row[23]),
      market: "TPEX",
    };
  }
  if (!Object.keys(result).length) throw new Error(`TPEX parsed empty ${rocDate}`);
  return { date: twseDate, rows: result };
}

function mergeMarketRows(twseResult, tpexResult) {
  const rows = {};
  if (twseResult?.rows) Object.assign(rows, twseResult.rows);
  if (tpexResult?.rows) Object.assign(rows, tpexResult.rows);
  return rows;
}

function countStreak(history, field) {
  let count = 0;
  for (const day of history) {
    if ((day?.[field] || 0) > 0) count++;
    else break;
  }
  return count;
}

function buildInstitutionSummary(dailyRows) {
  const byCode = {};

  dailyRows.forEach((day) => {
    Object.entries(day.rows).forEach(([code, row]) => {
      if (!byCode[code]) byCode[code] = [];
      byCode[code].push({ date: day.date, ...row });
    });
  });

  const summary = {};
  Object.entries(byCode).forEach(([code, history]) => {
    history.sort((a, b) => b.date.localeCompare(a.date));
    const latest = history[0];
    const jointStreak = history.reduce((count, day, index) => {
      if (index === count && day.foreign > 0 && day.trust > 0) return count + 1;
      return count;
    }, 0);

    summary[code] = {
      foreign: latest.foreign,
      trust: latest.trust,
      dealer: latest.dealer,
      total: latest.total,
      market: latest.market,
      date: latest.date,
      foreignStreak: countStreak(history, "foreign"),
      trustStreak: countStreak(history, "trust"),
      jointStreak,
      history: history.slice(0, 5).map((item) => ({
        date: item.date,
        foreign: item.foreign,
        trust: item.trust,
        total: item.total,
      })),
    };
  });

  return summary;
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }

  try {
    const dates = getRecentTradingDates(5);
    const settled = await Promise.allSettled(dates.map(async (date) => {
      const [twse, tpex] = await Promise.allSettled([
        fetchTwseInstitution(date),
        fetchTpexInstitution(date),
      ]);
      const rows = mergeMarketRows(
        twse.status === "fulfilled" ? twse.value : null,
        tpex.status === "fulfilled" ? tpex.value : null,
      );
      if (!Object.keys(rows).length) throw new Error(`No institution data ${formatTwseDate(date)}`);
      return {
        date: formatTwseDate(date),
        rows,
        errors: {
          twse: twse.status === "rejected" ? twse.reason.message : null,
          tpex: tpex.status === "rejected" ? tpex.reason.message : null,
        },
      };
    }));

    const dailyRows = settled
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (!dailyRows.length) throw new Error("No institution data");

    const data = buildInstitutionSummary(dailyRows);
    response.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=600");
    response.status(200).json({
      ok: true,
      source: "TWSE T86 + TPEx 3itrade_hedge_result",
      usedDate: dailyRows[0].date,
      dates: dailyRows.map((item) => item.date),
      updatedAt: new Date().toISOString(),
      count: Object.keys(data).length,
      data,
      errors: dailyRows.map((item) => ({ date: item.date, ...item.errors })),
    });
  } catch (error) {
    response.status(200).json({ ok: false, error: error.message, data: {} });
  }
};
