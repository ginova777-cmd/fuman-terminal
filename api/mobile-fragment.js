const crypto = require("crypto");
const strategy5Latest = require("./strategy5-latest");
const {
  endpointPayloadFromSnapshot,
  readDesktopRouteSnapshot,
} = require("../lib/desktop-route-snapshot-cache");

const TAB_CONFIG = {
  ai: {
    title: "AI 判讀",
    subtitle: "市場總覽 AI dashboard",
    endpoint: "/api/market-ai-live",
    points: ["今日重點", "風險提醒", "優先觀察", "熱門觀察股"],
  },
  strategy1: {
    title: "策略1 開盤入",
    subtitle: "Supabase complete run",
    endpoint: "/api/open-buy-latest",
    points: ["08:46 期貨初動", "08:55 期現試撮", "08:58~08:59 終判"],
  },
  strategy2: {
    title: "策略2 當沖",
    subtitle: "2 分 K 即時偵測",
    endpoint: "/api/strategy2-latest",
    points: ["只看進場區", "等待量價確認", "盤中訊號掃描端完成"],
  },
  strategy3: {
    title: "策略3 隔日沖",
    subtitle: "完整掃描 complete run",
    endpoint: "/api/strategy3-latest",
    points: ["只看 complete run", "排除舊靜態 JSON", "runId 更新即刷新"],
  },
  strategy4: {
    title: "策略4 波段",
    subtitle: "完整掃描 complete run",
    endpoint: "/api/strategy4-latest",
    points: ["Supabase 價量來源", "三角收斂起漲", "runId 更新即刷新"],
  },
  strategy5: {
    title: "策略5 綜合",
    subtitle: "多策略共振",
    endpoint: "/api/strategy5-latest",
    points: ["共振優先", "分數排序", "完整掃描後更新"],
  },
  chip: {
    title: "法人籌碼",
    subtitle: "外資/投信/自營合計",
    endpoint: "/api/institution-latest",
    points: ["連買優先", "合計買超", "籌碼集中"],
  },
  cb: {
    title: "CB 可轉債",
    subtitle: "轉換價 / 技術 / 進場模型",
    endpoint: "/api/cb-detect-latest",
    points: ["CB 代號優先", "轉換價距離", "進場模型狀態"],
  },
  warrant: {
    title: "權證資金",
    subtitle: "認購熱度與標的型態",
    endpoint: "/api/warrant-flow-latest",
    points: ["權證先熱", "標的型態", "只看候選觀察"],
  },
};

function setNoStore(response, contentType = "text/html; charset=utf-8") {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Type", contentType);
}

function originFrom(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host || "fuman-terminal.vercel.app";
  const proto = request.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

function appendQuery(endpoint, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  if (!query) return endpoint;
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${query}`;
}

function callbackName(request) {
  const url = new URL(request.url, originFrom(request));
  const callback = String(url.searchParams.get("callback") || "").trim();
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(callback) ? callback : "";
}

function sendHtml(request, response, statusCode, html, extra = {}) {
  const callback = callbackName(request);
  if (callback) {
    response.setHeader("Content-Type", "application/javascript; charset=utf-8");
    response.status(statusCode).send(request.method === "HEAD" ? "" : `${callback}(${JSON.stringify({ ok: statusCode < 400, html, ...extra })});`);
    return;
  }
  response.status(statusCode).send(request.method === "HEAD" ? "" : html);
}

async function fetchJsonWithTimeout(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function createCaptureResponse(resolve) {
  let statusCode = 200;
  return {
    setHeader() {},
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      resolve({ statusCode, payload });
      return this;
    },
    send(payload) {
      resolve({ statusCode, payload });
      return this;
    },
    end(payload) {
      resolve({ statusCode, payload });
      return this;
    },
  };
}

function fetchStrategy5Internal(request, endpoint) {
  const url = new URL(endpoint, originFrom(request));
  const query = Object.fromEntries(url.searchParams.entries());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("strategy5_internal_timeout")), 12000);
    const finish = (result) => {
      clearTimeout(timer);
      if (Number(result.statusCode || 0) >= 400 || result.payload?.ok === false) {
        reject(new Error(result.payload?.detail || result.payload?.error || `HTTP ${result.statusCode}`));
        return;
      }
      resolve(result.payload);
    };
    Promise.resolve(strategy5Latest({
      ...request,
      method: "GET",
      url: endpoint,
      query,
      fumanInternalVerify: true,
    }, createCaptureResponse(finish))).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function shortTime(value) {
  const text = String(value || "");
  const date = Date.parse(text);
  if (Number.isFinite(date)) {
    return new Date(date).toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Taipei" });
  }
  return text.slice(0, 19).replace("T", " ") || "--";
}

function intradayTimeParts(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] || 0),
  };
}

function intradayTimeText(value) {
  const parts = intradayTimeParts(value);
  if (!parts) return "--";
  return [
    String(parts.hour).padStart(2, "0"),
    String(parts.minute).padStart(2, "0"),
    String(parts.second).padStart(2, "0"),
  ].join(":");
}

function intradayTimeValue(value) {
  const parts = intradayTimeParts(value);
  if (!parts) return 0;
  return parts.hour * 3600 + parts.minute * 60 + parts.second;
}

function arrayAt(value, keys) {
  for (const key of keys) {
    const current = key.split(".").reduce((obj, part) => obj?.[part], value);
    if (Array.isArray(current)) return current;
  }
  return [];
}

function strategy2EntryTime(row) {
  return firstValue(row, ["entryAt", "timestamp", "time", "latestSeenAt", "latestAAt", "firstAAt", "highestAt", "quoteTime"], "");
}

function strategy2TimeValue(row) {
  return intradayTimeValue(strategy2EntryTime(row));
}

function inStrategy2Window(row) {
  const seconds = strategy2TimeValue(row);
  return seconds >= 8 * 3600 + 45 * 60 && seconds <= 12 * 3600;
}

function isEvidenceLikeRow(row) {
  if (!row || typeof row !== "object") return true;
  const text = JSON.stringify(row).slice(0, 1200);
  return /not required|not_required|source status not required|does not require|writer=|collector=|already-running|api-only-poll/i.test(text);
}

function isValidBusinessRow(row, tab = "") {
  if (!row || typeof row !== "object" || isEvidenceLikeRow(row)) return false;
  if (tab === "cb") {
    const cbCode = String(firstValue(row, ["cbCode", "cb_code", "convertibleBondCode", "bondCode", "symbol", "code"], "")).trim();
    const stockCode = String(firstValue(row, ["stockCode", "stock_id", "stockId", "underlyingCode", "code"], "")).trim();
    return /^\d{4,6}$/.test(cbCode) && /^\d{4}$/.test(stockCode || cbCode.slice(0, 4));
  }
  if (["strategy1", "strategy2", "strategy3", "strategy4", "strategy5", "chip"].includes(tab)) {
    const code = String(firstValue(row, ["code", "stock_id", "stockId", "symbol", "underlyingCode", "ticker"], "")).trim();
    return /^\d{4}$/.test(code);
  }
  if (tab === "warrant") {
    const code = String(firstValue(row, ["underlyingCode", "code", "stockCode"], "")).trim();
    const warrantCode = String(firstValue(row, ["warrantCode", "symbol"], "")).trim();
    return /^\d{4}$/.test(code) || /^\d{5,6}$/.test(warrantCode);
  }
  return true;
}
function normalizeRows(payload, tab = "") {
  const rows = arrayAt(payload, [
    "matches",
    "results",
    "rows",
    "items",
    "candidates",
    "signals",
    "records",
    "events",
    "data",
    "top",
    "payload.records",
    "payload.events",
    "payload.matches",
    "payload.results",
    "mobile.top",
  ]);
  if (tab === "strategy2") {
    const sortedRows = [...rows].sort((a, b) => strategy2TimeValue(b) - strategy2TimeValue(a));
    const windowRows = sortedRows.filter(inStrategy2Window);
    return (windowRows.length ? windowRows : sortedRows).filter((row) => isValidBusinessRow(row, tab)).slice(0, 20);
  }
  return rows.filter((row) => isValidBusinessRow(row, tab)).slice(0, 20);
}

function isEmptyStrategy2Snapshot(payload) {
  if (!payload || typeof payload !== "object") return false;
  const rows = normalizeRows(payload, "strategy2");
  const count = Number(payload.count ?? payload.displayCount ?? payload.resultCount ?? payload.result_count ?? 0) || 0;
  return rows.length === 0 && count > 0;
}

function isEmptyStrategy1WaitingSnapshot(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload?.meta?.previous_2130_carry_forward || payload?.transport?.previous2130CarryForward) return false;
  const rows = normalizeRows(payload, "strategy1");
  const count = Number(payload.count ?? payload.displayCount ?? payload.resultCount ?? payload.result_count ?? 0) || 0;
  if (rows.length || count > 0) return false;
  const text = [
    payload.qualityStatus,
    payload.cacheSource,
    payload.reason,
    payload.error,
    payload.detail,
    payload.transport?.gate,
    payload.transport?.source,
  ].filter(Boolean).join(" ");
  return /waiting|snapshot|not_trading_day|preopen_not_ready|futopt_not_ready|decision/i.test(text);
}

function firstValue(row, keys, fallback = "") {
  for (const key of keys) {
    const value = key.split(".").reduce((obj, part) => obj?.[part], row);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function numberText(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "--";
  return num.toFixed(digits).replace(/\.00$/, "");
}

function numberValue(value) {
  const number = Number(String(value ?? "").replace(/[,％%]/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function strategy4TriangleSvg(row) {
  const triangle = row?.triangleBreakout;
  const lines = triangle?.chartLines;
  const upper = lines?.upperResistance?.points;
  const lower = lines?.lowerSupport?.points;
  const marker = lines?.breakoutMarker;
  const signals = Array.isArray(row?.signals) ? row.signals : [];
  const hasSignal = signals.some((signal) => signal?.id === "triangle_breakout");
  if (!triangle?.detected && !hasSignal) return "";
  if (!Array.isArray(upper) || upper.length < 2 || !Array.isArray(lower) || lower.length < 2) return "";
  const prices = [
    ...upper.map((point) => numberValue(point?.price)),
    ...lower.map((point) => numberValue(point?.price)),
    numberValue(marker?.price),
  ].filter((value) => value > 0);
  if (prices.length < 4) return "";
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const pad = Math.max((maxPrice - minPrice) * 0.16, maxPrice * 0.01, 1);
  const yMin = minPrice - pad;
  const yMax = maxPrice + pad;
  const mapY = (price) => 52 - ((numberValue(price) - yMin) / Math.max(yMax - yMin, 1)) * 42;
  const mapX = (points, index) => 10 + (150 * index) / Math.max(points.length - 1, 1);
  const toPolyline = (points) => points.map((point, index) => `${mapX(points, index).toFixed(1)},${mapY(point?.price).toFixed(1)}`).join(" ");
  const markerX = 160;
  const markerY = mapY(marker?.price);
  return `
        <div class="mobile-triangle-chart" data-mobile-triangle-chart="1">
          <svg viewBox="0 0 170 64" role="img" aria-label="三角收斂支撐壓力線">
            <polyline points="${esc(toPolyline(upper))}" fill="none" stroke="#fb7185" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            <polyline points="${esc(toPolyline(lower))}" fill="none" stroke="#22c55e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="${esc(markerX.toFixed(1))}" cy="${esc(markerY.toFixed(1))}" r="3.8" fill="#f97316" stroke="#fed7aa" stroke-width="1.2" />
          </svg>
          <small>壓 ${esc(numberText(triangle.resistance))}｜支 ${esc(numberText(triangle.support))}｜突破 ${esc(numberText(triangle.breakoutPrice))}</small>
        </div>`;
}

function rowHtml(row, index, tab = "") {
  const code = firstValue(row, ["code", "stock_id", "stockId", "symbol", "underlyingCode", "ticker"], "--");
  const name = firstValue(row, ["name", "stock_name", "stockName", "underlyingName", "company"], "");
  if (tab === "strategy2") {
    const entryTime = strategy2EntryTime(row);
    const entryPrice = firstValue(row, ["entryPrice", "observedPrice", "latestSeenPrice", "latestAPrice", "firstAPrice", "supportPrice"], "--");
    const state = firstValue(row, ["stateLabel", "actionLabel", "label", "signal", "strategy"], "即時偵測");
    const reason = firstValue(row, ["reason", "stateReason", "summary", "description", "memo", "note"], "");
    return `
    <article class="mobile-terminal-row">
      <b>#${index + 1}</b>
      <div>
        <h4>${esc(intradayTimeText(entryTime))}｜${esc(code)} ${esc(name)}</h4>
        <p>${esc(state)}｜進場價格 ${esc(numberText(entryPrice))}</p>
        <small>${esc(String(reason).slice(0, 150))}</small>
      </div>
      <div class="mobile-terminal-actions">
        <button type="button" data-mobile-ai-contract="analyze" data-ai-stock-code="${esc(code)}" data-ai-stock-name="${esc(name)}">看分析</button>
        <button type="button" data-mobile-ai-contract="watch" data-ai-watch-code="${esc(code)}" data-ai-watch-name="${esc(name)}">加入自選</button>
      </div>
    </article>`;
  }
  if (tab === "cb") {
    const cbCode = firstValue(row, ["cbCode", "cb_code", "convertibleBondCode", "bondCode", "code"], "--");
    const cbName = firstValue(row, ["cbName", "cb_name", "convertibleBondName", "bondName", "name"], "");
    const stockCode = firstValue(row, ["code", "stock_id", "stockId", "underlyingCode"], "");
    const stockName = firstValue(row, ["stockName", "underlyingName", "company"], "");
    const action = firstValue(row, ["tradableLabel", "entryLabel", "stage", "sourceLayer", "status"], "CB 偵測");
    const score = firstValue(row, ["score", "finalScore", "rankScore", "baseScore"], "--");
    const premium = firstValue(row, ["premium", "conversionDistancePct", "conversionPremiumRate"], null);
    const reason = firstValue(row, ["tradableReason", "entryPlan.tradableReason", "sourceLayer", "summary", "reason"], "");
    const tags = arrayAt(row, ["tags"]).slice(0, 3).join(" / ");
    const line = `${action}｜${score}｜溢價 ${premium === null ? "--" : `${numberText(premium)}%`}`;
    return `
    <article class="mobile-terminal-row">
      <b>#${index + 1}</b>
      <div>
        <h4>${esc(cbCode)} ${esc(cbName)}</h4>
        <p>${esc(line)}</p>
        <small>${esc([stockCode ? `現股 ${stockCode} ${stockName}` : "", reason, tags].filter(Boolean).join("｜").slice(0, 180))}</small>
      </div>
      <div class="mobile-terminal-actions">
        <button type="button" data-mobile-ai-contract="analyze" data-ai-stock-code="${esc(stockCode || cbCode)}" data-ai-stock-name="${esc(stockName || cbName)}">看分析</button>
        <button type="button" data-mobile-ai-contract="watch" data-ai-watch-code="${esc(stockCode || cbCode)}" data-ai-watch-name="${esc(stockName || cbName)}">加入自選</button>
      </div>
    </article>`;
  }
  const action = firstValue(row, ["actionLabel", "label", "signal", "signalName", "strategy", "status", "source"], "掃描命中");
  const score = firstValue(row, ["finalScore", "score", "rankScore", "totalScore"], "--");
  const pct = firstValue(row, ["percent", "changePercent", "pct", "displayPercent", "risePct"], null);
  const reason = firstValue(row, ["reason", "summary", "description", "memo", "note", "why"], "");
  const line = `${action}｜${score}｜${pct === null ? "--" : `${numberText(pct)}%`}`;
  const triangleChart = tab === "strategy4" ? strategy4TriangleSvg(row) : "";
  const strategy4Matched = tab === "strategy5" && Boolean(firstValue(row, ["strategy4Matched", "strategy4_matched", "strategy4RunId", "strategy4_run_id"], ""));
  const displayName = strategy4Matched ? `🔥 ${name}` : name;
  return `
    <article class="mobile-terminal-row">
      <b>#${index + 1}</b>
      <div>
        <h4>${esc(code)} ${esc(displayName)}</h4>
        <p>${esc(line)}</p>
        <small>${esc(String(reason).slice(0, 150))}</small>
        ${triangleChart}
      </div>
      <div class="mobile-terminal-actions">
        <button type="button" data-mobile-ai-contract="analyze" data-ai-stock-code="${esc(code)}" data-ai-stock-name="${esc(name)}">看分析</button>
        <button type="button" data-mobile-ai-contract="watch" data-ai-watch-code="${esc(code)}" data-ai-watch-name="${esc(name)}">加入自選</button>
      </div>
    </article>`;
}

function renderFragment(tab, config, payload) {
  if (tab === "ai") return renderAiFragment(tab, config, payload);
  const rows = normalizeRows(payload, tab);
  const reportedCount = Number(payload?.count ?? payload?.total ?? payload?.result_count ?? 0) || 0;
  const count = Math.max(reportedCount, rows.length);
  const updatedAt = payload?.updatedAt || payload?.finishedAt || payload?.generatedAt || payload?.scanTime || payload?.date || "";
  const runId = extractRunId(payload, tab);
  const quality = payload?.qualityStatus || payload?.sourceHealth?.status || "";
  const evidenceStatus = payload?.evidenceStatus || payload?.run_quality_at_publish?.evidenceStatus || "";
  const unattendedStatus = payload?.unattendedStatus || payload?.run_quality_at_publish?.unattendedStatus || "";
  const publishAllowed = payload?.publishAllowed ?? payload?.run_quality_at_publish?.publishAllowed;
  const preservePreviousGood = payload?.preservePreviousGood ?? payload?.run_quality_at_publish?.preservePreviousGood;
  const blockedReason = payload?.blockedReason || payload?.scanner_block_reason || payload?.run_quality_at_publish?.blockedReason || "";
  const publishLabel = publishAllowed === false ? "publish blocked" : publishAllowed === true ? "publish allowed" : "";
  const preserveLabel = preservePreviousGood === true ? "preserve previous good" : "";
  const statusLine = [
    config.subtitle,
    runId ? `run ${runId}` : "",
    quality ? `quality ${quality}` : "",
    evidenceStatus ? `evidence ${evidenceStatus}` : "",
    publishLabel,
    preserveLabel,
  ].filter(Boolean).join("｜");
  const blockedHtml = publishAllowed === false || evidenceStatus === "insufficient" || unattendedStatus === "NO"
    ? `<p class="mobile-terminal-blocked" data-mobile-blocked-reason="${esc(blockedReason)}">${esc(blockedReason || "source not ready; latest preserved")}</p>`
    : "";

  const points = config.points.map((point, index) => `<p><b>${index + 1}</b>${esc(point)}</p>`).join("");
  const list = rows.length ? rows.map((row, index) => rowHtml(row, index, tab)).join("") : `<div class="empty-state">等待最新 complete run。</div>`;
  return `<section class="mobile-terminal-fragment" data-mobile-terminal-fragment="1" data-mobile-fragment-key="${esc(tab)}" data-run-id="${esc(runId)}">
      <article class="mobile-terminal-head">
        <small>API-only complete run</small>
        <strong>${esc(config.title)}</strong>
        <p>${esc(statusLine)}</p>
        ${blockedHtml}
        <div class="mobile-terminal-stats">
          <span>數量<b>${esc(count)}</b></span>
          <span>更新<b>${esc(shortTime(updatedAt))}</b></span>
        </div>
      </article>
      <section class="mobile-terminal-points">${points}</section>
      <section class="mobile-terminal-list">${list}</section>
    </section>`;
}

function groupRows(payload, key, aliases = []) {
  const keys = [key, ...aliases];
  const group = keys.map((item) => payload?.groups?.[item]).find(Boolean);
  const filter = arrayAt(payload, ["filters"]).find((item) => keys.includes(item?.key));
  return arrayAt(group || filter || {}, ["rows", "stocks"]).slice(0, 8);
}

function renderAiStockRow(row, index) {
  const code = firstValue(row, ["code", "Code", "symbol", "stockId", "stock_id"], "--");
  const name = firstValue(row, ["name", "Name", "stockName", "stock_name"], "");
  const pct = firstValue(row, ["pct", "percent", "changePercent"], null);
  const score = firstValue(row, ["score", "rankScore", "finalScore"], "--");
  const source = firstValue(row, ["source", "cacheSource"], "AI");
  const industry = firstValue(row, ["industry", "sector", "group"], "--");
  const reason = firstValue(row, ["reason", "summary", "description", "signal"], "");
  const pctText = pct === null ? "--" : `${numberText(pct)}%`;
  return `
    <article class="market-ai-stock-row">
      <b class="market-ai-rank">#${index + 1}</b>
      <div>
        <h4>${esc(code)} ${esc(name)}</h4>
        <p>${esc(source)}｜${esc(industry)}｜${esc(pctText)}｜分數 ${esc(score)}</p>
        <small>${esc(String(reason).slice(0, 150))}</small>
      </div>
      <button type="button" data-mobile-ai-contract="analyze" data-ai-stock-code="${esc(code)}" data-ai-stock-name="${esc(name)}">看分析</button>
      <button type="button" data-mobile-ai-contract="watch" data-ai-watch-code="${esc(code)}" data-ai-watch-name="${esc(name)}">加入自選</button>
    </article>`;
}

function renderAiFragment(tab, config, payload) {
  const dashboard = payload?.dashboard || {};
  const summary = payload?.summary || {};
  const hotStocks = arrayAt(payload, ["hotStocks"]);
  const apiRows = arrayAt(payload, ["rows"]);
  const rows = hotStocks.length ? hotStocks : apiRows.length ? apiRows : groupRows(payload, "all");
  const updatedAt = payload?.updatedAt || payload?.servedAt || payload?.generatedAt || "";
  const runId = extractRunId({ runId: payload?.snapshot?.snapshotId || payload?.snapshot?.key || payload?.cacheSource || "market-ai-live", updatedAt }, tab);
  const sample = Number(dashboard.sample || summary.sample || payload?.breadth?.sample || 0) || rows.length;
  const up = Number(dashboard.up || summary.up || 0);
  const down = Number(dashboard.down || summary.down || 0);
  const bias = dashboard.bias || summary.bias || "AI 判讀";
  const action = dashboard.action || summary.action || "等待方向";
  const confidence = dashboard.confidence || summary.confidence || "觀察";
  const todayPoints = arrayAt(payload, ["todayPoints"]).slice(0, 4);
  const riskNotes = arrayAt(payload, ["riskNotes"]).slice(0, 3);
  const reasoning = arrayAt(payload, ["reasoning"]).slice(0, 4);
  const filters = [
    ["all", "全部", groupRows(payload, "all")],
    ["momentum", "動能強", groupRows(payload, "momentum")],
    ["institution", "法人買超", groupRows(payload, "institution", ["legal"])],
    ["intraday", "當沖熱", groupRows(payload, "intraday")],
    ["risk", "風險高", groupRows(payload, "risk")],
  ];
  const pointHtml = todayPoints.length ? todayPoints.map((point, index) => `
    <p class="market-ai-point"><b>${index + 1}</b><span>${esc(point)}</span></p>
  `).join("") : config.points.map((point, index) => `
    <p class="market-ai-point"><b>${index + 1}</b><span>${esc(point)}</span></p>
  `).join("");
  const riskHtml = riskNotes.length ? riskNotes.map((note) => `
    <article class="market-ai-card"><small>${esc(note.title || "風險")}</small><p>${esc(note.text || note.reason || "")}</p></article>
  `).join("") : '<article class="market-ai-card"><small>風險</small><p>等待 AI 判讀風險資料。</p></article>';
  const reasoningHtml = reasoning.length ? reasoning.map((item) => `
    <article class="market-ai-card"><small>${esc(item.key || "依據")}</small><strong>${esc(item.title || "--")}</strong><p>${esc(item.text || "")}</p></article>
  `).join("") : '<article class="market-ai-card"><small>依據</small><strong>等待資料</strong><p>AI 判讀依據尚未補齊。</p></article>';
  return `<section class="mobile-terminal-fragment mobile-ai-fragment" data-mobile-terminal-fragment="1" data-mobile-ai-fragment="1" data-mobile-ai-contract="root" data-mobile-fragment-key="${esc(tab)}" data-run-id="${esc(runId)}">
      <article class="market-ai-card mobile-ai-hero">
        <small>市場總覽 AI｜${esc(shortTime(updatedAt))}</small>
        <strong>${esc(bias)}</strong>
        <p>${esc(action)}｜信心 ${esc(confidence)}</p>
        <div class="metrics">
          <span>樣本<b>${esc(sample.toLocaleString("zh-TW"))}</b></span>
          <span>上漲<b>${esc(up.toLocaleString("zh-TW"))}</b></span>
          <span>下跌<b>${esc(down.toLocaleString("zh-TW"))}</b></span>
        </div>
      </article>
      <section class="market-ai-block">
        <h3>AI 今日重點</h3>
        <div class="market-ai-list">${pointHtml}</div>
      </section>
      <section class="market-ai-block">
        <h3>風險提醒</h3>
        <div class="market-ai-list">${riskHtml}</div>
      </section>
      <section class="market-ai-block">
        <h3>AI 判讀依據</h3>
        <div class="market-ai-list">${reasoningHtml}</div>
      </section>
      <section class="market-ai-block">
        <h3>熱門觀察股</h3>
        <div class="market-ai-actions">${filters.map(([key, label, items], index) => `<button type="button" ${index === 0 ? 'class="active"' : ""} data-market-ai-filter="${esc(key)}">${esc(label)} ${items.length}</button>`).join("")}</div>
        <div class="market-ai-sort-note">目前排序：綜合分數，來源 ${esc(payload?.source || payload?.cacheSource || "api/market-ai-live")}</div>
        ${filters.map(([key, label, items], index) => {
          const list = key === "all" && rows.length ? rows : items;
          return `<div class="market-ai-hot" data-market-ai-mobile-list="${esc(key)}" ${index === 0 ? "" : "hidden"} aria-label="${esc(label)}">${list.length ? list.slice(0, 10).map(renderAiStockRow).join("") : '<div class="empty-state">目前這組沒有符合標的。</div>'}</div>`;
        }).join("")}
      </section>
    </section>`;
}

function compactToken(value) {
  return String(value || "waiting")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "waiting";
}

function compactDate(value) {
  const raw = String(value || "").replace(/\D/g, "");
  if (raw.length >= 8) return raw.slice(0, 8);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replace(/\D/g, "");
}

function waitingRunId(payload, tab = "") {
  const reason = payload?.reason || payload?.error || payload?.detail || payload?.qualityStatus || payload?.cacheSource || "waiting";
  const date = compactDate(payload?.date || payload?.marketSession?.taipeiDate || payload?.updatedAt || payload?.transport?.fetchedAt);
  return `${compactToken(tab || "mobile")}-waiting-${date}-${compactToken(reason)}`;
}

function extractRunId(payload, tab = "") {
  const runId = String(
    payload?.runId
    || payload?.transport?.runId
    || payload?.transport?.payloadRunId
    || payload?.payload?.runId
    || payload?.payload?.transport?.runId
    || payload?.meta?.runId
    || ""
  ).trim();
  return runId || waitingRunId(payload, tab);
}

module.exports = async function handler(request, response) {
  setNoStore(response);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).send("method_not_allowed");
    return;
  }
  const url = new URL(request.url, originFrom(request));
  const tab = String(url.searchParams.get("tab") || "").trim();
  const config = TAB_CONFIG[tab];
  if (!config) {
    sendHtml(request, response, 404, '<div class="empty-state">未知分頁。</div>', { tab });
    return;
  }
  try {
    const endpoint = appendQuery(config.endpoint, {
      mobile: 1,
      canvas: 1,
      compact: 1,
      shell: 1,
      limit: 60,
      ...(tab === "strategy3" ? { live: 1, verify: 1, noSnapshot: 1 } : {}),
      ts: Date.now(),
    });
    const snapshot = await readDesktopRouteSnapshot({ timeoutMs: 30000 }).catch(() => null);
    const snapshotPayload = tab === "ai" ? null : endpointPayloadFromSnapshot(snapshot?.payload, endpoint);
    const forceLivePayload = tab === "strategy3" || tab === "strategy5";
    const payload = forceLivePayload
      || !snapshotPayload
      || (tab === "strategy1" && isEmptyStrategy1WaitingSnapshot(snapshotPayload))
      || (tab === "strategy2" && isEmptyStrategy2Snapshot(snapshotPayload))
      ? (tab === "strategy5"
        ? await fetchStrategy5Internal(request, endpoint)
        : await fetchJsonWithTimeout(`${originFrom(request)}${endpoint}`, tab === "ai" ? 30000 : 12000))
      : snapshotPayload;
    const html = renderFragment(tab, config, payload);
    response.setHeader("ETag", `"${crypto.createHash("sha1").update(html).digest("hex").slice(0, 16)}"`);
    sendHtml(request, response, 200, html, { tab });
  } catch (error) {
    sendHtml(request, response, 503, `<div class="empty-state">手機 API fragment 暫時無法取得：${esc(error?.message || error)}</div>`, { tab });
  }
};
