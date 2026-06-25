const crypto = require("crypto");
const {
  endpointPayloadFromSnapshot,
  readDesktopRouteSnapshot,
} = require("../lib/desktop-route-snapshot-cache");

const TAB_CONFIG = {
  strategy1: {
    title: "策略1 開盤入",
    subtitle: "Supabase complete run",
    endpoint: "/api/open-buy-latest",
    points: ["21:30 候選", "08:55 最終"],
  },
  strategy2: {
    title: "策略2 當沖",
    subtitle: "2 分 K 即時偵測",
    endpoint: "/api/latest-strategy?key=strategy2",
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
    points: ["Supabase 價量來源", "完整掃描後更新", "runId 更新即刷新"],
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
  return firstValue(row, ["entryAt", "timestamp", "quoteTime", "latestSeenAt", "latestAAt", "firstAAt", "highestAt"], "");
}

function strategy2TimeValue(row) {
  return intradayTimeValue(strategy2EntryTime(row));
}

function inStrategy2Window(row) {
  const seconds = strategy2TimeValue(row);
  return seconds >= 8 * 3600 + 45 * 60 && seconds <= 12 * 3600;
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
    return [...rows].filter(inStrategy2Window).sort((a, b) => strategy2TimeValue(b) - strategy2TimeValue(a)).slice(0, 20);
  }
  return rows.slice(0, 20);
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
  const action = firstValue(row, ["actionLabel", "label", "signal", "signalName", "strategy", "status", "source"], "掃描命中");
  const score = firstValue(row, ["finalScore", "score", "rankScore", "totalScore"], "--");
  const pct = firstValue(row, ["percent", "changePercent", "pct", "displayPercent", "risePct"], null);
  const reason = firstValue(row, ["reason", "summary", "description", "memo", "note", "why"], "");
  const line = `${action}｜${score}｜${pct === null ? "--" : `${numberText(pct)}%`}`;
  return `
    <article class="mobile-terminal-row">
      <b>#${index + 1}</b>
      <div>
        <h4>${esc(code)} ${esc(name)}</h4>
        <p>${esc(line)}</p>
        <small>${esc(String(reason).slice(0, 150))}</small>
      </div>
      <div class="mobile-terminal-actions">
        <button type="button" data-mobile-ai-contract="analyze" data-ai-stock-code="${esc(code)}" data-ai-stock-name="${esc(name)}">看分析</button>
        <button type="button" data-mobile-ai-contract="watch" data-ai-watch-code="${esc(code)}" data-ai-watch-name="${esc(name)}">加入自選</button>
      </div>
    </article>`;
}

function renderFragment(tab, config, payload) {
  const rows = normalizeRows(payload, tab);
  const reportedCount = Number(payload?.count ?? payload?.total ?? payload?.result_count ?? 0) || 0;
  const count = Math.max(reportedCount, rows.length);
  const updatedAt = payload?.updatedAt || payload?.finishedAt || payload?.generatedAt || payload?.scanTime || payload?.date || "";
  const runId = payload?.runId
    || payload?.transport?.runId
    || payload?.transport?.payloadRunId
    || payload?.payload?.runId
    || payload?.payload?.transport?.runId
    || payload?.meta?.runId
    || "";
  const quality = payload?.qualityStatus || payload?.sourceHealth?.status || "";
  const statusLine = [config.subtitle, runId ? `run ${runId}` : "", quality ? `quality ${quality}` : ""].filter(Boolean).join("｜");
  const points = config.points.map((point, index) => `<p><b>${index + 1}</b>${esc(point)}</p>`).join("");
  const list = rows.length ? rows.map((row, index) => rowHtml(row, index, tab)).join("") : `<div class="empty-state">等待最新 complete run。</div>`;
  return `<section class="mobile-terminal-fragment" data-mobile-terminal-fragment="1" data-mobile-fragment-key="${esc(tab)}" data-run-id="${esc(runId)}">
      <article class="mobile-terminal-head">
        <small>API-only complete run</small>
        <strong>${esc(config.title)}</strong>
        <p>${esc(statusLine)}</p>
        <div class="mobile-terminal-stats">
          <span>數量<b>${esc(count)}</b></span>
          <span>更新<b>${esc(shortTime(updatedAt))}</b></span>
        </div>
      </article>
      <section class="mobile-terminal-points">${points}</section>
      <section class="mobile-terminal-list">${list}</section>
    </section>`;
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
      ts: Date.now(),
    });
    const snapshot = await readDesktopRouteSnapshot({ timeoutMs: 30000 }).catch(() => null);
    const payload = endpointPayloadFromSnapshot(snapshot?.payload, endpoint)
      || await fetchJsonWithTimeout(`${originFrom(request)}${endpoint}`, 12000);
    const html = renderFragment(tab, config, payload);
    response.setHeader("ETag", `"${crypto.createHash("sha1").update(html).digest("hex").slice(0, 16)}"`);
    sendHtml(request, response, 200, html, { tab });
  } catch (error) {
    sendHtml(request, response, 503, `<div class="empty-state">手機 API fragment 暫時無法取得：${esc(error?.message || error)}</div>`, { tab });
  }
};
