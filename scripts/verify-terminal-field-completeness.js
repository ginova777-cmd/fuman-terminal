const fs = require("fs");
const path = require("path");

const BASE_URL = (process.env.FUMAN_AUDIT_BASE_URL || "https://fuman-terminal.vercel.app").replace(/\/+$/, "");
const OUT_DIR = path.resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length) || "outputs/terminal-field-completeness");
const LIMIT = Math.max(1, Number(process.env.TERMINAL_FIELD_AUDIT_LIMIT || 20));
const ROUTE_FILTER = new Set((process.argv.find((arg) => arg.startsWith("--routes="))?.slice("--routes=".length) || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean));

const ROUTES = [
  {
    key: "strategy2",
    label: "策略2即時",
    endpoint: "/api/strategy2-latest?compact=1&limit=60&live=1",
    groups: [
      ["代號", ["code", "symbol", "stockId", "stock_id"]],
      ["名稱", ["name", "stockName", "stock_name"]],
      ["即時價", ["price", "close", "lastPrice", "latestClose"]],
      ["漲跌幅", ["changePercent", "change_percent", "percent", "pct"]],
      ["量能", ["volume", "tradeVolume", "totalVolume", "trade_volume"]],
      ["訊號時間", ["time", "quoteTime", "latestSeenAt", "updatedAt", "firstAAt"]],
      ["條件/訊號", ["stateId", "signalId", "primaryStrategy", "reason", "signals", "tags"]],
    ],
  },
  {
    key: "strategy3",
    label: "策略3",
    endpoint: "/api/strategy3-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
    groups: [
      ["代號", ["code", "symbol", "stockId", "stock_id"]],
      ["名稱", ["name", "stockName", "stock_name"]],
      ["價格", ["price", "close", "lastPrice", "latestClose"]],
      ["量能", ["volume", "tradeVolume", "trade_volume", "totalVolume"]],
      ["分數", ["score", "finalScore", "rankScore"]],
      ["條件/原因", ["reason", "signals", "tags", "description"]],
    ],
  },
  {
    key: "strategy4",
    label: "策略4",
    endpoint: "/api/strategy4-latest?canvas=1&compact=1&shell=1&limit=70&live=1",
    groups: [
      ["代號", ["code", "symbol", "stockId", "stock_id"]],
      ["名稱", ["name", "stockName", "stock_name"]],
      ["價格", ["price", "close", "lastPrice", "latestClose"]],
      ["量能", ["volume", "volumeLots", "volume_lots", "tradeVolume", "trade_volume"]],
      ["分數", ["score", "finalScore", "rankScore"]],
      ["分區/型態", ["zone", "zoneLabel", "zone_label", "strategy", "pattern"]],
      ["條件/原因", ["reason", "signals", "tags", "description"]],
    ],
  },
  {
    key: "strategy5",
    label: "策略5",
    endpoint: "/api/strategy5-latest?canvas=1&compact=1&shell=1&limit=140&live=1",
    groups: [
      ["代號", ["code", "symbol", "stockId", "stock_id"]],
      ["名稱", ["name", "stockName", "stock_name"]],
      ["價格", ["price", "close", "lastPrice", "latestClose"]],
      ["分數", ["score", "finalScore", "rankScore"]],
      ["籌碼", ["institutionTotalNet", "institution_total_net", "totalNet", "total_net", "foreignNet", "foreign_net", "trustNet", "investment_trust_net"]],
      ["條件/原因", ["reason", "signals", "tags", "description"]],
    ],
  },
  {
    key: "institution",
    label: "買賣超",
    endpoint: "/api/institution-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
    groups: [
      ["代號", ["code", "symbol", "stockId", "stock_id"]],
      ["名稱", ["name", "stockName", "stock_name"]],
      ["價格", ["price", "close", "lastPrice", "latestClose"]],
      ["外資", ["foreignNet", "foreign_net", "foreignLots", "foreign"]],
      ["投信", ["trustNet", "investment_trust_net", "trust"]],
      ["自營", ["dealerNet", "dealer_net", "dealer"]],
      ["合計", ["totalNet", "total_net", "institutionTotalNet", "institution_total_net"]],
    ],
  },
  {
    key: "cb",
    label: "CB",
    endpoint: "/api/cb-detect-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
    groups: [
      ["股票代號", ["code", "underlyingCode", "stockCode"]],
      ["CB代號", ["cbCode", "symbol", "bondCode"]],
      ["CB名稱", ["cbName", "name", "bondName"]],
      ["分數", ["score", "finalScore"]],
      ["來源層", ["sourceLayer", "stage"]],
      ["股價", ["stockPrice", "price", "close"]],
      ["轉換/溢價", ["convertPrice", "effectiveConvertPrice", "conversionPriceLabel", "premium"]],
      ["操作條件", ["entryLabel", "selectedEntryModel", "tags", "reason"]],
    ],
  },
  {
    key: "warrant",
    label: "權證走向",
    endpoint: "/api/warrant-flow-latest?canvas=1&compact=1&shell=1&limit=60&live=1",
    groups: [
      ["權證代號", ["warrantCode", "code", "symbol"]],
      ["權證名稱", ["warrantName", "name"]],
      ["標的代號", ["underlyingCode", "stockCode"]],
      ["標的名稱", ["underlyingName", "stockName"]],
      ["分數", ["score", "finalScore", "warrantHeatScore"]],
      ["標的價格", ["underlyingClose", "underlyingPrice", "stockClose", "stockPrice"]],
      ["權證價格", ["warrantPrice", "warrantClose", "warrantLastPrice"]],
      ["成交/金額", ["value", "tradeValue", "callValue", "volume"]],
      ["條件/原因", ["reason", "actionLabel", "tags", "signal"]],
    ],
  },
  {
    key: "market",
    label: "市場總覽",
    endpoint: "/api/market?canvas=1&compact=1&shell=1&limit=24&live=1",
    metaGroups: [
      ["日期/更新", ["updatedAt", "generatedAt", "date", "tradeDate"]],
      ["來源/freshness", ["source", "cacheSource", "freshness", "snapshotFresh"]],
    ],
    groups: [
      ["名稱", ["name", "label", "title", "symbol"]],
      ["數值", ["value", "price", "close", "index"]],
      ["時間/更新", ["updatedAt", "time", "date"]],
    ],
  },
  {
    key: "market-ai",
    label: "AI判讀",
    endpoint: "/api/market-ai-live?limit=60&live=1",
    allowZeroWhen: (payload) => payload?.dataFreshness?.priorityStaleBlocked === true
      || payload?.priorityObservation?.staleBlocked === true,
    metaGroups: [
      ["日期/更新", ["updatedAt", "generatedAt", "snapshot.tradeDate", "aiDetectWindow.taipeiDate"]],
      ["來源/freshness", ["source", "cacheSource", "freshness", "snapshotFresh"]],
      ["AI摘要/廣度", ["summary", "breadth", "marketSession", "aiDetectWindow"]],
    ],
    groups: [
      ["代號", ["code", "Code", "symbol", "stockId", "stock_id"]],
      ["名稱", ["name", "Name", "stockName", "stock_name"]],
      ["價格/判讀", ["price", "close", "ClosingPrice", "lastPrice", "latestClose", "reason"]],
      ["漲跌/排序", ["change", "Change", "pct", "percent", "score", "rankScore", "finalScore", "rank"]],
      ["來源/更新", ["source", "industry", "updatedAt", "quoteDate"]],
    ],
    rowGroups: (row) => {
      const code = String(row?.code || row?.symbol || "").trim().toUpperCase();
      const side = String(row?.side || "").trim().toLowerCase();
      if (code === "REPORT" || code === "RISK" || side === "report" || side === "risk") {
        return [
          ["代號", ["code", "symbol"]],
          ["名稱", ["name", "title"]],
          ["AI文字", ["reason", "summary", "title"]],
          ["來源/更新", ["source", "updatedAt", "quoteDate"]],
        ];
      }
      return [
        ["代號", ["code", "Code", "symbol", "stockId", "stock_id"]],
        ["名稱", ["name", "Name", "stockName", "stock_name"]],
        ["價格", ["price", "close", "ClosingPrice", "lastPrice", "latestClose"]],
        ["漲跌/排序", ["change", "Change", "pct", "percent", "score", "rankScore", "finalScore", "rank"]],
        ["來源/更新", ["source", "industry", "updatedAt", "quoteDate"]],
      ];
    },
  },
];

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0 || value.every(isBlank);
  if (typeof value === "object") return Object.keys(value).length === 0;
  const text = String(value).trim();
  return !text || text === "--" || text === "—" || /^n\/a$/i.test(text) || /^null$/i.test(text) || /^undefined$/i.test(text);
}

function getPath(row, pathText) {
  return String(pathText).split(".").reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, row);
}

function rowIdentity(row, index) {
  return [
    getPath(row, "code") || getPath(row, "symbol") || getPath(row, "warrantCode") || getPath(row, "cbCode") || getPath(row, "underlyingCode") || `#${index + 1}`,
    getPath(row, "name") || getPath(row, "stockName") || getPath(row, "warrantName") || getPath(row, "cbName") || getPath(row, "underlyingName") || "",
  ].filter(Boolean).join(" ");
}

function rowsOf(payload) {
  for (const key of ["rows", "matches", "data", "items", "top", "stocks", "sectors", "hotStocks"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (payload?.snapshot) {
    for (const key of ["rows", "matches", "data", "items", "top", "stocks", "sectors", "hotStocks"]) {
      if (Array.isArray(payload.snapshot?.[key])) return payload.snapshot[key];
    }
  }
  if (Array.isArray(payload?.market?.stocks)) return payload.market.stocks;
  if (Array.isArray(payload?.breadth?.stocks)) return payload.breadth.stocks;
  if (payload?.data && typeof payload.data === "object") return Object.values(payload.data);
  return [];
}

async function fetchJson(endpoint) {
  const url = new URL(endpoint, BASE_URL);
  url.searchParams.set("fieldAudit", String(Date.now()));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text || "{}"); } catch {}
    return { ok: response.ok, status: response.status, json, text: text.slice(0, 500), url: url.toString() };
  } finally {
    clearTimeout(timeout);
  }
}

function isMembershipRequiredPayload(payload) {
  return Boolean(payload && payload.protected === true && payload.error === "membership_required");
}

function numericZero(value) {
  return value === 0 || value === "0";
}

function isCompleteEmptyPayload(payload = {}) {
  const completeEvidence = [payload.evidenceStatus, payload.sourceEvidenceStatus, payload.qualityStatus, payload.status]
    .some((value) => /^(complete|sufficient|ok|ready)$/i.test(String(value || "")));
  const explicitZero = [payload.count, payload.resultCount, payload.readbackCount, payload.rowsReturned, payload.total]
    .some(numericZero);
  const publishOk = payload.publishAllowed === true || payload.ok === true || payload.unattendedStatus === "YES";
  return Boolean(completeEvidence && explicitZero && publishOk);
}

function isFailClosedZeroPayload(payload = {}) {
  const statusText = [
    payload.evidenceStatus,
    payload.sourceEvidenceStatus,
    payload.qualityStatus,
    payload.status,
    payload.reason,
    payload.error,
    payload.scannerBlockReason,
    payload.scanner_block_reason,
  ].map((value) => String(value || "")).join(" ");
  const blocked = payload.publishAllowed === false
    || payload.unattendedStatus === "NO"
    || payload.preservePreviousGood === true
    || payload.degradedBlocksLatest === true
    || /blocked|degraded|insufficient|source_quality_fail|market_closed|source_date_not_today|not_ready/i.test(statusText);
  return Boolean(blocked);
}

function checkRoute(route, payload) {
  const rows = rowsOf(payload).slice(0, LIMIT);
  const issues = [];
  (route.metaGroups || [
    ["日期/runId", ["runId", "transport.runId", "updatedAt", "generatedAt", "usedDate", "date", "tradeDate"]],
    ["來源/freshness", ["source", "cacheSource", "transport.source", "freshness", "qualityStatus", "sourceHealth.status"]],
  ]).forEach(([label, fields]) => {
    const hit = fields.find((field) => !isBlank(getPath(payload, field)));
    if (!hit) {
      issues.push({
        row: "payload",
        field: label,
        message: `missing all of: ${fields.join(", ")}`,
      });
    }
  });
  if (!rows.length) {
    if ((route.allowZeroWhen && route.allowZeroWhen(payload)) || isCompleteEmptyPayload(payload) || isFailClosedZeroPayload(payload)) {
      return { rows, issues, zeroAllowed: true };
    }
    issues.push({ row: "", field: "rows", message: "no rows/cards returned" });
    return { rows, issues, zeroAllowed: false };
  }
  rows.forEach((row, index) => {
    const groups = typeof route.rowGroups === "function" ? route.rowGroups(row, payload) : route.groups;
    groups.forEach(([label, fields]) => {
      const hit = fields.find((field) => !isBlank(getPath(row, field)));
      if (!hit) {
        issues.push({
          row: rowIdentity(row, index),
          field: label,
          message: `missing all of: ${fields.join(", ")}`,
        });
      }
    });
  });
  return { rows, issues, zeroAllowed: false };
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function writeReports(results) {
  ensureOutDir();
  fs.writeFileSync(path.join(OUT_DIR, "terminal-field-completeness.json"), `${JSON.stringify(results, null, 2)}\n`);
  const lines = [
    "# Terminal Field Completeness",
    "",
    `- Checked: ${new Date().toISOString()}`,
    `- Base URL: ${BASE_URL}`,
    `- Rows checked per route: ${LIMIT}`,
    "",
    "| 策略 | status | rows | issues | runId | cacheSource |",
    "|---|---:|---:|---:|---|---|",
  ];
  for (const result of results) {
    lines.push(`| ${result.label} | ${result.status} | ${result.rows} | ${result.issues.length} | ${result.runId || "--"} | ${result.cacheSource || "--"} |`);
  }
  lines.push("");
  for (const result of results.filter((item) => item.issues.length)) {
    lines.push(`## ${result.label}`);
    result.issues.slice(0, 80).forEach((issue) => {
      lines.push(`- ${issue.row || "--"}: ${issue.field} - ${issue.message}`);
    });
    lines.push("");
  }
  fs.writeFileSync(path.join(OUT_DIR, "terminal-field-completeness.md"), `${lines.join("\n")}\n`);
}

async function main() {
  const results = [];
  for (const route of ROUTES.filter((item) => !ROUTE_FILTER.size || ROUTE_FILTER.has(item.key))) {
    console.log(`[field-completeness] ${route.key}`);
    const response = await fetchJson(route.endpoint);
    if (!response.ok || !response.json) {
      if (response.status === 401 && isMembershipRequiredPayload(response.json)) {
        results.push({
          key: route.key,
          label: route.label,
          endpoint: route.endpoint,
          status: response.status,
          ok: true,
          protectedByMembership: true,
          rows: 0,
          issues: [],
        });
        continue;
      }
      results.push({
        key: route.key,
        label: route.label,
        endpoint: route.endpoint,
        status: response.status,
        ok: false,
        rows: 0,
        issues: [{ row: "", field: "api", message: `HTTP ${response.status}: ${response.text}` }],
      });
      continue;
    }
    const checked = checkRoute(route, response.json);
    results.push({
      key: route.key,
      label: route.label,
      endpoint: route.endpoint,
      status: response.status,
      ok: checked.issues.length === 0,
      rows: checked.rows.length,
      zeroAllowed: checked.zeroAllowed,
      runId: response.json.runId || response.json.transport?.runId || "",
      cacheSource: response.json.cacheSource || response.json.transport?.source || "",
      updatedAt: response.json.updatedAt || response.json.generatedAt || "",
      issues: checked.issues,
    });
  }
  writeReports(results);
  const issues = results.flatMap((result) => result.issues.map((issue) => `${result.key}: ${issue.row || "--"} ${issue.field} ${issue.message}`));
  if (issues.length) {
    console.error("[field-completeness] failed");
    issues.slice(0, 120).forEach((issue) => console.error("- " + issue));
    process.exitCode = 1;
    return;
  }
  console.log("[field-completeness] ok");
}

main().catch((error) => {
  console.error(`[field-completeness] failed: ${error?.stack || error?.message || String(error)}`);
  process.exitCode = 1;
});
