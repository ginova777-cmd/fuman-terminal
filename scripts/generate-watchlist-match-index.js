const fs = require("fs");
const path = require("path");
const { upsertSnapshot } = require("../lib/supabase-snapshots");

const ROOT = path.resolve(__dirname, "..");
const RUNTIME_ROOT = process.env.FUMAN_RUNTIME_ROOT || process.env.FUMAN_RUNTIME_DIR || "C:\\fuman-runtime";
const DEPLOY_ROOT = process.env.FUMAN_DEPLOY_DIR || "C:\\fuman-terminal";
const OUTPUT = "data/strategy-match-index.json";

const SOURCES = [
  { key: "openBuy", label: "策略1-明日開盤入", api: "open-buy-latest", fields: ["matches"] },
  { key: "strategy2", label: "策略2-當沖雷達", api: "strategy2-latest", fields: ["events", "records", "matches", "rows"] },
  { key: "strategy3", label: "策略3-隔日沖", api: "strategy3-latest", fields: ["matches", "rows"] },
  { key: "strategy4", label: "策略4-波段", api: "strategy4-latest", fields: ["matches", "rows"] },
  { key: "strategy5", label: "策略5-綜合策略", api: "strategy5-latest", fields: ["matches", "rows"] },
  { key: "institution", label: "買賣超", api: "institution-latest", fields: ["data", "rows", "matches"], objectFields: ["data"] },
  { key: "warrant", label: "權證", api: "warrant-flow-latest", fields: ["matches", "rows", "volumeMatches", "singleSignals"], codeField: "underlyingCode" },
  { key: "cb", label: "CB名單", api: "cb-detect-latest", fields: ["rows", "matches"] },
];

function cleanNumber(value) {
  const number = Number(String(value ?? "").replace(/[,+%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function confluenceRankScore(rawScore) {
  return 1 + Math.max(0, Math.min(100, cleanNumber(rawScore))) / 1000;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function signalText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value.label || value.name || value.title || value.short || value.reason || value.id || "").trim();
}

function rowsFromPayload(payload, source) {
  return source.fields.flatMap((field) => {
    const value = payload?.[field];
    if (source.objectFields?.includes(field) && value && typeof value === "object" && !Array.isArray(value)) {
      return Object.values(value);
    }
    return normalizeArray(value);
  }).filter((row) => {
    const codeField = source.codeField || "code";
    return row?.[codeField] || row?.code;
  });
}

function detailsFor(row, key) {
  const sources = {
    openBuy: [row.setup, row.status, row.reason],
    strategy2: [
      row.strategy,
      row.stateLabel,
      row.stateReason,
      ...normalizeArray(row.strategies).map(signalText),
      ...normalizeArray(row.intradaySignals).map(signalText),
    ],
    strategy3: [row.setup, row.status, row.reason, ...normalizeArray(row.matches).map(signalText)],
    strategy4: [
      row.strategyLabel,
      row.swingZone ? `分區${row.swingZone}` : "",
      ...normalizeArray(row.signals).map(signalText),
      ...normalizeArray(row.swingSignals).map(signalText),
    ],
    strategy5: [
      signalText(row.activeMatch),
      ...normalizeArray(row.matches).flatMap((match) => [match?.label, match?.short, match?.title, match?.name, match?.id].map(signalText)),
    ],
    institution: [
      row.total > 0 ? "法人合計買超" : row.total < 0 ? "法人合計賣超" : "法人中性",
      row.foreign > 0 ? "外資買超" : row.foreign < 0 ? "外資賣超" : "",
      row.trust > 0 ? "投信買超" : row.trust < 0 ? "投信賣超" : "",
      row.jointStreak ? `連買${row.jointStreak}日` : "",
    ],
    warrant: [
      row.signalGrade ? `等級${row.signalGrade}` : "",
      row.actionLabel,
      row.stockSetupLabel,
      row.branchLabel,
      row.level ? `Level ${row.level}` : "",
    ],
    cb: [
      row.entryLabel,
      row.tradableLabel,
      row.conversionPriceLabel,
      row.sourceLayer,
      row.cbName,
    ],
  };
  return [...new Set((sources[key] || []).map(signalText).map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 12);
}

function sourceKeyFor(row, source) {
  if (source.key !== "strategy2") return source.key;
  const signalId = String(row.strategy || row.primaryStrategy || row.stateLabel || row.signalId || row.stateId || "").trim();
  const safeSignalId = signalId.replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
  return safeSignalId ? `${source.key}:${safeSignalId}` : source.key;
}

function sourceLabelFor(row, source) {
  if (source.key !== "strategy2") return source.label;
  const strategy = signalText(row.strategy || row.primaryStrategy || row.stateLabel || row.signalId);
  return strategy ? `策略2-${strategy}` : source.label;
}

function createCaptureResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    status(code) { this.statusCode = Number(code) || 200; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function callApi(source) {
  const handler = require(path.join(ROOT, "api", `${source.api}.js`));
  const response = createCaptureResponse();
  await handler({ method: "GET", query: { fresh: "1" } }, response);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`${source.api} status ${response.statusCode}`);
  }
  return response.body && typeof response.body === "object" ? response.body : {};
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
}

function taipeiClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  const seconds = Number(parts.hour || 0) * 3600 + Number(parts.minute || 0) * 60 + Number(parts.second || 0);
  return {
    date: `${parts.year}${parts.month}${parts.day}`,
    seconds,
  };
}

function isAfterTaipei1330(clock = taipeiClock()) {
  return clock.seconds > 13 * 3600 + 30 * 60;
}

async function main() {
  const byCode = {};
  const namesByCode = {};
  const quoteByCode = {};
  const strategies = {};
  const warnings = [];

  for (const source of SOURCES) {
    try {
      const payload = await callApi(source);
      const rows = rowsFromPayload(payload, source);
      const date = payload.usedDate || payload.date || payload.tradeDate || payload.scanStamp || payload.updatedAt || "";
      strategies[source.key] = {
        label: source.label,
        api: `/api/${source.api}`,
        date,
        updatedAt: payload.updatedAt || payload.generatedAt || payload.scanStamp || "",
        cacheSource: payload.cacheSource || payload.source || "",
        count: rows.length,
      };
      for (const row of rows) {
        const code = String(row?.[source.codeField || "code"] || row.code || "").trim();
        if (!/^\d{4}$/.test(code)) continue;
        const name = String(row?.name || row?.stockName || row?.underlyingName || "").trim();
        if (name && !namesByCode[code]) namesByCode[code] = name;
        const quote = {
          close: cleanNumber(row.close || row.price || row.lastPrice || row.referencePrice),
          price: cleanNumber(row.price || row.close || row.lastPrice || row.referencePrice),
          percent: cleanNumber(row.percent ?? row.changePercent ?? row.change_percent),
          volume: cleanNumber(row.volume || row.tradeVolume || row.trade_volume),
          tradeVolume: cleanNumber(row.tradeVolume || row.volume || row.trade_volume),
          value: cleanNumber(row.value || row.tradeValue || row.trade_value),
          tradeValue: cleanNumber(row.tradeValue || row.value || row.trade_value),
          market: String(row.market || row.exchange || "").trim(),
          updatedAt: payload.updatedAt || payload.generatedAt || payload.scanStamp || row.updatedAt || "",
        };
        if (!quoteByCode[code] || quote.value > cleanNumber(quoteByCode[code].value) || quote.close > 0 && cleanNumber(quoteByCode[code].close) <= 0) {
          quoteByCode[code] = quote;
        }
        const rawScore = cleanNumber(row.score || row.maxScore || row.swingScore || row.finalScore || row.total);
        const entry = {
          key: sourceKeyFor(row, source),
          label: sourceLabelFor(row, source),
          score: confluenceRankScore(rawScore),
          rawScore,
          date,
          updatedAt: payload.updatedAt || payload.generatedAt || payload.scanStamp || row.updatedAt || "",
          details: detailsFor(row, source.key),
        };
        if (!byCode[code]) byCode[code] = [];
        byCode[code].push(entry);
      }
    } catch (error) {
      warnings.push(`${source.key}: ${error?.message || String(error)}`);
      strategies[source.key] = { label: source.label, api: `/api/${source.api}`, count: 0, error: error?.message || String(error) };
    }
  }

  for (const [code, entries] of Object.entries(byCode)) {
    const merged = new Map();
    for (const entry of entries) {
      const previous = merged.get(entry.key);
      if (!previous) {
        merged.set(entry.key, { ...entry, details: [...entry.details] });
        continue;
      }
      previous.score = Math.max(cleanNumber(previous.score), cleanNumber(entry.score));
      previous.details = [...new Set([...previous.details, ...entry.details])].slice(0, 12);
      previous.updatedAt = previous.updatedAt || entry.updatedAt;
      previous.date = previous.date || entry.date;
    }
    byCode[code] = [...merged.values()].sort((a, b) => cleanNumber(b.score) - cleanNumber(a.score) || a.key.localeCompare(b.key));
  }

  const payload = {
    ok: true,
    source: "watchlist-match-index",
    updatedAt: new Date().toISOString(),
    count: Object.keys(byCode).length,
    warnings,
    strategies,
    namesByCode,
    quoteByCode,
    byCode,
  };

  for (const root of [...new Set([ROOT, RUNTIME_ROOT, DEPLOY_ROOT])]) {
    writeJson(path.join(root, OUTPUT), payload);
  }

  const clock = taipeiClock();
  const locked = isAfterTaipei1330(clock);
  const snapshot = await upsertSnapshot("watchlist_match_index", payload, {
    source: "data/strategy-match-index.json",
    snapshotId: `watchlist-match-index-${payload.updatedAt.replace(/\D/g, "").slice(0, 14)}`,
    tradeDate: clock.date,
    locked,
    reason: locked ? "after-1330-cache" : "snapshot-cache",
  });
  if (!snapshot.ok) throw new Error(`watchlist snapshot upsert failed: ${snapshot.error || "unknown_error"}`);

  console.log(`[watchlist-index] ok codes=${payload.count} snapshot=watchlist_match_index`);
  if (payload.byCode["3006"]) {
    console.log(`[watchlist-index] 3006 ${payload.byCode["3006"].map((item) => item.label).join(" / ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
