const CACHE_MS = 10 * 60 * 1000;
let cache = null;

const ISSUERS = [
  "中國信託", "中信", "凱基", "元大", "元富", "統一", "群益", "富邦", "國泰", "永豐",
  "台新", "兆豐", "華南", "第一", "玉山", "新光", "康和", "元證", "聯邦", "上海",
  "合庫", "日盛", "大展", "宏遠", "福邦", "致和", "台中銀", "土銀", "臺銀", "台銀"
].sort((a, b) => b.length - a.length);

async function fetchText(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FumanTerminal/1.0)",
        Accept: "text/csv,text/plain,*/*",
        Referer: "https://data.gov.tw/",
      },
    });
    if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
  }

  const headerIndex = rows.findIndex((items) => items.some((item) => item.includes("權證代號")));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((item) => item.replace(/\s/g, ""));
  return rows.slice(headerIndex + 1).map((items) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = items[index] || "";
    });
    return record;
  });
}

function cleanNumber(value) {
  return Number(String(value ?? "").replace(/[,+]/g, "").trim()) || 0;
}

function getValue(row, keys) {
  for (const key of keys) {
    const found = Object.keys(row).find((item) => item === key || item.includes(key));
    if (found && row[found] !== undefined && row[found] !== "") return row[found];
  }
  return "";
}

function inferType(name) {
  if (/[售熊]/.test(name)) return "put";
  if (/[購牛]/.test(name)) return "call";
  return "unknown";
}

function inferUnderlyingName(name) {
  const text = String(name || "").replace(/\s/g, "");
  for (const issuer of ISSUERS) {
    const index = text.indexOf(issuer);
    if (index > 0) return text.slice(0, index);
  }
  const match = text.match(/^(.+?)(?:[0-9A-Z]{1,2}[0-9A-Z]?購|[0-9A-Z]{1,2}[0-9A-Z]?售|購|售|牛|熊)/);
  return match?.[1] || "";
}

function normalizeWarrant(row, market) {
  const code = String(getValue(row, ["權證代號", "Warrantcode", "WarrantCode"])).trim();
  const name = String(getValue(row, ["權證名稱", "WarrantName", "Warrantname"])).trim();
  const value = cleanNumber(getValue(row, ["成交金額", "Transactionamount", "TransactionAmount"]));
  const volume = cleanNumber(getValue(row, ["成交數量", "成交張數", "Transactionvolume", "TransactionVolume"]));
  const tradeDate = String(getValue(row, ["交易日期", "Transactiondate", "TransactionDate"])).trim();
  if (!code || !name || !value) return null;
  const type = inferType(name);
  const underlyingName = inferUnderlyingName(name);
  if (!underlyingName || type === "unknown") return null;
  return { code, name, market, type, value, volume, tradeDate, underlyingName };
}

async function fetchWarrants() {
  const sources = [
    { market: "上市", urls: ["https://mopsfin.twse.com.tw/opendata/t187ap42_L.csv"] },
    {
      market: "上櫃",
      urls: [
        "https://mopsfin.twse.com.tw/opendata/t187ap42_O.csv",
        "https://dts.twse.com.tw/opendata/t187ap42_O.csv",
      ],
    },
  ];
  const rows = [];
  const errors = [];
  for (const source of sources) {
    let loaded = false;
    const sourceErrors = [];
    for (const url of source.urls) {
      try {
        const text = await fetchText(url);
        const parsed = parseCsv(text).map((row) => normalizeWarrant(row, source.market)).filter(Boolean);
        if (parsed.length) {
          rows.push(...parsed);
          loaded = true;
          break;
        }
      } catch (error) {
        sourceErrors.push(`${source.market}: ${error.message}`);
      }
    }
    if (!loaded) errors.push(...sourceErrors, `${source.market}: no warrant rows`);
  }
  return { rows, errors };
}

function aggregate(rows) {
  const byName = new Map();
  for (const row of rows) {
    const key = row.underlyingName;
    const item = byName.get(key) || {
      underlyingName: key,
      callValue: 0,
      putValue: 0,
      callVolume: 0,
      putVolume: 0,
      callCount: 0,
      putCount: 0,
      marketSet: new Set(),
      tradeDate: row.tradeDate,
      topWarrants: [],
    };
    item.marketSet.add(row.market);
    item.tradeDate = row.tradeDate || item.tradeDate;
    if (row.type === "call") {
      item.callValue += row.value;
      item.callVolume += row.volume;
      item.callCount += 1;
    } else if (row.type === "put") {
      item.putValue += row.value;
      item.putVolume += row.volume;
      item.putCount += 1;
    }
    item.topWarrants.push(row);
    byName.set(key, item);
  }

  return [...byName.values()].map((item) => {
    item.topWarrants = item.topWarrants
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
      .map((warrant) => ({
        code: warrant.code,
        name: warrant.name,
        type: warrant.type,
        value: warrant.value,
        volume: warrant.volume,
      }));
    const totalValue = item.callValue + item.putValue;
    const ratio = item.putValue ? item.callValue / item.putValue : item.callValue ? 99 : 0;
    const breadth = item.callCount + item.putCount;
    const callBias = totalValue ? item.callValue / totalValue : 0;
    const score = Math.min(100, Math.round(
      30 +
      Math.min(item.callValue / 10000000, 28) +
      Math.min(item.callCount * 3.2, 22) +
      Math.min(ratio * 4, 14) +
      (callBias >= 0.78 ? 8 : callBias >= 0.65 ? 4 : 0)
    ));
    return {
      underlyingName: item.underlyingName,
      market: [...item.marketSet].join("/"),
      tradeDate: item.tradeDate,
      callValue: item.callValue,
      putValue: item.putValue,
      totalValue,
      callVolume: item.callVolume,
      putVolume: item.putVolume,
      callCount: item.callCount,
      putCount: item.putCount,
      breadth,
      callPutRatio: Number(ratio.toFixed(2)),
      score,
      topWarrants: item.topWarrants,
      reason: `認購 ${item.callCount} 檔、認購金額 ${(item.callValue / 100000000).toFixed(2)} 億，認購/認售比 ${ratio >= 99 ? "99+" : ratio.toFixed(2)}。`,
    };
  }).filter((item) => (
    item.callValue >= 8000000 &&
    item.callCount >= 2 &&
    item.callValue > item.putValue &&
    item.callPutRatio >= 1.5
  )).sort((a, b) => b.score - a.score || b.callValue - a.callValue);
}

module.exports = async function handler(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.status(204).end(); return; }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed", matches: [] });
    return;
  }

  if (cache && Date.now() - cache.ts < CACHE_MS) {
    response.status(200).json(cache.payload);
    return;
  }

  try {
    const { rows, errors } = await fetchWarrants();
    const matches = aggregate(rows).slice(0, 120);
    const payload = {
      ok: true,
      updatedAt: new Date().toISOString(),
      scanned: rows.length,
      count: matches.length,
      matches,
      errors,
      sources: [
        "mopsfin.twse.com.tw/opendata/t187ap42_L.csv",
        "dts.twse.com.tw/opendata/t187ap42_O.csv",
      ],
    };
    cache = { ts: Date.now(), payload };
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json(payload);
  } catch (error) {
    response.status(502).json({ ok: false, error: error.message, matches: [] });
  }
};
