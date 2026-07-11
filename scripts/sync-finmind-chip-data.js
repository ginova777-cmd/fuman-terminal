const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = process.env.FUMAN_RUNTIME_DIR || "C:/fuman-runtime";
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.FUMAN_SUPABASE_URL || "https://cpmpfhbzutkiecccekfr.supabase.co").replace(/\/+$/, "");

function readSecret(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

const FINMIND_TOKEN = process.env.FINMIND_API_TOKEN
  || process.env.FINMIND_TOKEN
  || readSecret(path.join(RUNTIME_DIR, "secrets", "finmind-api-token.txt"));
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.FUMAN_SUPABASE_SERVICE_ROLE_KEY
  || readSecret(path.join(RUNTIME_DIR, "secrets", "supabase-service-role-key.txt"));
const SUPABASE_BATCH_SIZE = Math.max(1, Number(process.env.FINMIND_SUPABASE_BATCH_SIZE || 200));
const SUPABASE_UPSERT_ATTEMPTS = Math.max(1, Number(process.env.FINMIND_SUPABASE_UPSERT_ATTEMPTS || 4));
const SUPABASE_UPSERT_TIMEOUT_MS = Math.max(5000, Number(process.env.FINMIND_SUPABASE_UPSERT_TIMEOUT_MS || 45000));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutSignal(ms) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function defaultStart(days = 8) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

function argValue(name, fallback) {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : fallback;
}

function number(value) {
  const n = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function text(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function value(row, keys) {
  for (const key of keys) {
    if (row?.[key] != null && row?.[key] !== "") return number(row[key]);
  }
  return 0;
}

function normalizeDate(value) {
  const textValue = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(textValue) ? textValue : "";
}

function normalizeSymbol(value) {
  const symbol = String(value || "").trim();
  return /^\d{4}$/.test(symbol) ? symbol : "";
}

async function fetchFinMindData(dataset, startDate, endDate, dataId = "") {
  if (!FINMIND_TOKEN) throw new Error("missing FinMind token");
  const url = new URL("https://api.finmindtrade.com/api/v4/data");
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  if (dataId) url.searchParams.set("data_id", dataId);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${FINMIND_TOKEN}`, "User-Agent": "FumanFinMindChip/1.0" },
    signal: timeoutSignal(120000),
  });
  if (!response.ok) throw new Error(`FinMind ${dataset} HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.status && Number(payload.status) >= 400) throw new Error(`FinMind ${dataset} status ${payload.status}: ${payload.msg || ""}`);
  return Array.isArray(payload?.data) ? payload.data : [];
}

function addInstitutionBucket(out, symbol, tradeDate, name, actor, buy, sell, row) {
  const current = out.get(symbol) || {
    symbol,
    trade_date: tradeDate,
    name,
    foreign_buy: 0,
    foreign_sell: 0,
    foreign_net: 0,
    investment_trust_buy: 0,
    investment_trust_sell: 0,
    investment_trust_net: 0,
    dealer_buy: 0,
    dealer_sell: 0,
    dealer_net: 0,
    total_net: 0,
    source: "finmind:TaiwanStockInstitutionalInvestorsBuySell",
    payload: [],
    updated_at: new Date().toISOString(),
  };
  const key = /trust|投信/i.test(actor)
    ? "investment_trust"
    : /dealer|自營/i.test(actor)
      ? "dealer"
      : /foreign|外資|陸資/i.test(actor)
        ? "foreign"
        : "";
  if (key) {
    current[`${key}_buy`] += buy;
    current[`${key}_sell`] += sell;
    current[`${key}_net`] += buy - sell;
  }
  current.total_net = current.foreign_net + current.investment_trust_net + current.dealer_net;
  current.payload.push(row);
  out.set(symbol, current);
}

function normalizeInstitutionRows(rows, dataset) {
  const bySymbolDate = new Map();
  for (const row of rows) {
    const symbol = normalizeSymbol(row.stock_id || row.code || row.symbol);
    const tradeDate = normalizeDate(row.date || row.trade_date);
    if (!symbol || !tradeDate) continue;
    const mapKey = `${symbol}:${tradeDate}`;
    const out = bySymbolDate.get(mapKey) || new Map();
    const name = text(row, ["stock_name", "name"]);
    const actor = text(row, ["name", "institutional_investors", "institutionalinvestors", "type"]);
    const explicitWide = [
      "Foreign_Investor_buy", "Foreign_Investor_sell",
      "foreign_investor_buy", "foreign_investor_sell",
      "Investment_Trust_buy", "Investment_Trust_sell",
      "investment_trust_buy", "investment_trust_sell",
      "Dealer_buy", "Dealer_sell",
      "dealer_buy", "dealer_sell",
    ].some((key) => row[key] != null);
    if (explicitWide) {
      addInstitutionBucket(out, symbol, tradeDate, name, "foreign", value(row, ["Foreign_Investor_buy", "foreign_investor_buy", "foreign_buy"]), value(row, ["Foreign_Investor_sell", "foreign_investor_sell", "foreign_sell"]), row);
      addInstitutionBucket(out, symbol, tradeDate, name, "investment_trust", value(row, ["Investment_Trust_buy", "investment_trust_buy"]), value(row, ["Investment_Trust_sell", "investment_trust_sell"]), row);
      addInstitutionBucket(out, symbol, tradeDate, name, "dealer", value(row, ["Dealer_buy", "dealer_buy"]), value(row, ["Dealer_sell", "dealer_sell"]), row);
    } else {
      const buy = value(row, ["buy", "Buy", "buy_volume", "buy_amount"]);
      const sell = value(row, ["sell", "Sell", "sell_volume", "sell_amount"]);
      addInstitutionBucket(out, symbol, tradeDate, name, actor, buy, sell, row);
    }
    bySymbolDate.set(mapKey, out);
  }
  return [...bySymbolDate.values()].flatMap((map) => [...map.values()]).map((row) => ({
    ...row,
    source: `finmind:${dataset}`,
    payload: { rows: row.payload },
  }));
}

function normalizeMarginRows(rows, dataset) {
  return rows.map((row) => {
    const symbol = normalizeSymbol(row.stock_id || row.code || row.symbol);
    const tradeDate = normalizeDate(row.date || row.trade_date);
    if (!symbol || !tradeDate) return null;
    return {
      symbol,
      trade_date: tradeDate,
      name: text(row, ["stock_name", "name"]),
      margin_buy: value(row, ["MarginPurchaseBuy", "margin_purchase_buy", "margin_buy", "融資買進"]),
      margin_sell: value(row, ["MarginPurchaseSell", "margin_purchase_sell", "margin_sell", "融資賣出"]),
      margin_cash_repayment: value(row, ["MarginPurchaseCashRepayment", "margin_purchase_cash_repayment", "融資現金償還"]),
      margin_balance: value(row, ["MarginPurchaseTodayBalance", "margin_purchase_today_balance", "margin_balance", "融資餘額"]),
      short_sell: value(row, ["ShortSaleSell", "short_sale_sell", "short_sell", "融券賣出"]),
      short_buy: value(row, ["ShortSaleBuy", "short_sale_buy", "short_buy", "融券買進"]),
      short_cash_repayment: value(row, ["ShortSaleCashRepayment", "short_sale_cash_repayment", "融券現券償還"]),
      short_balance: value(row, ["ShortSaleTodayBalance", "short_sale_today_balance", "short_balance", "融券餘額"]),
      source: `finmind:${dataset}`,
      payload: row,
      updated_at: new Date().toISOString(),
    };
  }).filter(Boolean);
}

function mergeDuplicateRawRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = [row.dataset, row.symbol, row.trade_date, row.actor].join(":");
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...row, payload: { rows: [row.payload] } });
      continue;
    }
    current.buy += row.buy;
    current.sell += row.sell;
    current.net += row.net;
    current.payload.rows.push(row.payload);
    current.updated_at = row.updated_at;
  }
  return [...byKey.values()];
}

function normalizeRawRows(rows, dataset) {
  const normalized = rows.map((row) => {
    const symbol = normalizeSymbol(row.stock_id || row.code || row.symbol);
    const tradeDate = normalizeDate(row.date || row.trade_date);
    if (!symbol || !tradeDate) return null;
    const actor = text(row, ["securities_trader_id", "broker_id", "name", "securities_trader", "branch_name", "institutional_investors", "type"]);
    const buy = value(row, ["buy", "Buy", "buy_volume", "buy_amount"]);
    const sell = value(row, ["sell", "Sell", "sell_volume", "sell_amount"]);
    return {
      dataset,
      symbol,
      trade_date: tradeDate,
      actor,
      name: text(row, ["stock_name", "name"]),
      buy,
      sell,
      net: value(row, ["net", "buy_sell", "difference"]) || buy - sell,
      source: `finmind:${dataset}`,
      payload: row,
      updated_at: new Date().toISOString(),
    };
  }).filter(Boolean);
  return mergeDuplicateRawRows(normalized);
}

async function fetchBranchRawRows(dataset, startDate, endDate, symbols) {
  const codes = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  if (!codes.length) return [];
  const rows = [];
  const delayMs = Math.max(0, Number(process.env.FINMIND_BRANCH_REQUEST_DELAY_MS || 220));
  for (const code of codes) {
    const rawRows = await fetchFinMindData(dataset, startDate, endDate, code).catch((error) => {
      console.warn(`FinMind ${dataset} ${code} skipped: ${error.message}`);
      return [];
    });
    rows.push(...normalizeRawRows(rawRows, dataset));
    if (delayMs) await sleep(delayMs);
  }
  return rows;
}

async function upsertTable(table, rows, onConflict) {
  if (!rows.length) return 0;
  if (!SUPABASE_SERVICE_KEY) throw new Error("missing Supabase service role key");
  let written = 0;
  for (let i = 0; i < rows.length; i += SUPABASE_BATCH_SIZE) {
    const chunk = rows.slice(i, i + SUPABASE_BATCH_SIZE);
    let lastError = "";
    for (let attempt = 1; attempt <= SUPABASE_UPSERT_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(chunk),
          signal: timeoutSignal(SUPABASE_UPSERT_TIMEOUT_MS),
        });
        if (response.ok) {
          written += chunk.length;
          lastError = "";
          break;
        }
        const textBody = await response.text().catch(() => "");
        lastError = `HTTP ${response.status}: ${textBody.slice(0, 200)}`;
      } catch (error) {
        lastError = error?.message || String(error);
      }
      if (attempt < SUPABASE_UPSERT_ATTEMPTS) {
        const delayMs = Math.min(30000, 1000 * (2 ** (attempt - 1)));
        console.warn(`Supabase ${table} chunk offset ${i} attempt ${attempt}/${SUPABASE_UPSERT_ATTEMPTS} failed: ${lastError}; retry in ${delayMs}ms`);
        await sleep(delayMs);
      }
    }
    if (lastError) throw new Error(`Supabase ${table} chunk offset ${i} failed: ${lastError}`);
  }
  return written;
}

async function main() {
  const startDate = argValue("--start", defaultStart(Number(process.env.FINMIND_CHIP_LOOKBACK_DAYS || 8)));
  const endDate = argValue("--end", ymd(new Date()));
  const extraDatasets = String(process.env.FINMIND_CHIP_EXTRA_DATASETS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const branchSymbols = String(argValue("--symbols", process.env.FINMIND_BRANCH_SYMBOLS || ""))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const institutionalDatasets = ["TaiwanStockInstitutionalInvestorsBuySellWide", "TaiwanStockInstitutionalInvestorsBuySell"];
  const marginDatasets = ["TaiwanStockMarginPurchaseShortSale"];
  const rawDatasets = [...new Set([...extraDatasets, ...(branchSymbols.length ? ["TaiwanStockTradingDailyReport"] : [])])];

  const summary = { institutional: {}, margin: {}, raw: {} };
  let institutionRows = [];
  for (const dataset of institutionalDatasets) {
    const rawRows = await fetchFinMindData(dataset, startDate, endDate).catch((error) => {
      console.warn(`FinMind ${dataset} skipped: ${error.message}`);
      return [];
    });
    const rows = normalizeInstitutionRows(rawRows, dataset);
    summary.institutional[dataset] = { rawRows: rawRows.length, normalizedRows: rows.length };
    institutionRows = institutionRows.concat(rows);
  }
  const uniqueInstitutionRows = [...new Map(institutionRows.map((row) => [`${row.symbol}:${row.trade_date}`, row])).values()];

  let marginRows = [];
  for (const dataset of marginDatasets) {
    const rawRows = await fetchFinMindData(dataset, startDate, endDate).catch((error) => {
      console.warn(`FinMind ${dataset} skipped: ${error.message}`);
      return [];
    });
    const rows = normalizeMarginRows(rawRows, dataset);
    summary.margin[dataset] = { rawRows: rawRows.length, normalizedRows: rows.length };
    marginRows = marginRows.concat(rows);
  }

  let rawRowsForSupabase = [];
  for (const dataset of rawDatasets) {
    const rows = dataset === "TaiwanStockTradingDailyReport"
      ? await fetchBranchRawRows(dataset, startDate, endDate, branchSymbols)
      : normalizeRawRows(await fetchFinMindData(dataset, startDate, endDate).catch((error) => {
        console.warn(`FinMind ${dataset} skipped: ${error.message}`);
        return [];
      }), dataset);
    summary.raw[dataset] = { normalizedRows: rows.length, requestedSymbols: dataset === "TaiwanStockTradingDailyReport" ? branchSymbols.length : undefined };
    rawRowsForSupabase = rawRowsForSupabase.concat(rows);
  }

  const writtenInstitutional = await upsertTable("finmind_institutional_flows", uniqueInstitutionRows, "symbol,trade_date");
  const writtenMargin = await upsertTable("finmind_margin_short", marginRows, "symbol,trade_date");
  const writtenRaw = await upsertTable("finmind_chip_raw", rawRowsForSupabase, "dataset,symbol,trade_date,actor");

  console.log(JSON.stringify({
    ok: true,
    source: "finmind:chip",
    startDate,
    endDate,
    summary,
    writtenInstitutional,
    writtenMargin,
    writtenRaw,
    updatedAt: new Date().toISOString(),
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
