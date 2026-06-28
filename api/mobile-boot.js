const crypto = require("crypto");
const {
  endpointPayloadFromSnapshot,
  readDesktopRouteSnapshot,
} = require("../lib/desktop-route-snapshot-cache");

const FRAGMENT_TABS = ["strategy1", "strategy2", "strategy3", "strategy4", "strategy5", "chip", "cb", "warrant"];
const TAB_ENDPOINTS = {
  strategy1: "/api/open-buy-latest",
  strategy2: "/api/strategy2-latest",
  strategy3: "/api/strategy3-latest",
  strategy4: "/api/strategy4-latest",
  strategy5: "/api/strategy5-latest",
  chip: "/api/institution-latest",
  cb: "/api/cb-detect-latest",
  warrant: "/api/warrant-flow-latest",
};
const MARKET_CORE_ENDPOINT = "/api/market?canvas=1&compact=1&shell=1&limit=4";

function originFrom(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host || "fuman-terminal.vercel.app";
  const proto = request.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}`;
}

async function fetchJsonWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
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

function sendPayload(request, response, statusCode, payload) {
  const callback = callbackName(request);
  if (callback) {
    response.setHeader("Content-Type", "application/javascript; charset=utf-8");
    response.status(statusCode).send(request.method === "HEAD" ? "" : `${callback}(${JSON.stringify(payload)});`);
    return;
  }
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.status(statusCode).send(request.method === "HEAD" ? "" : JSON.stringify(payload));
}

function signature(tab, payload) {
  return crypto.createHash("sha1").update(JSON.stringify({
    tab,
    runId: extractRunId(payload, tab),
    updatedAt: payload?.updatedAt || payload?.finishedAt || payload?.generatedAt || "",
    count: payload?.count ?? payload?.total ?? payload?.result_count ?? "",
    quality: payload?.qualityStatus || payload?.sourceHealth?.status || "",
  })).digest("hex").slice(0, 12);
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

function textValue(value, fallback = "--") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function signedText(sign, value, suffix = "") {
  const raw = textValue(value, "");
  if (!raw || raw === "--") return "--";
  const normalizedSign = String(sign || "").includes("-") ? "-" : "+";
  return `${normalizedSign}${raw.replace(/^[+-]/, "")}${suffix}`;
}

function marketRow(rows, code, namePattern) {
  return (Array.isArray(rows) ? rows : []).find((row) => {
    const rowCode = String(row?.code || "").toUpperCase();
    const rowName = String(row?.name || row?.title || "");
    return rowCode === code || namePattern.test(rowName);
  }) || null;
}

function normalizeMarketCore(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const indexes = Array.isArray(payload?.indexes) ? payload.indexes : [];
  const twse = indexes.find((item) => String(item?.["指數"] || "").includes("加權")) || marketRow(rows, "TWSE", /加權|發行量/);
  const otc = indexes.find((item) => String(item?.["指數"] || "").includes("櫃買")) || marketRow(rows, "OTC", /櫃買/);
  const futures = payload?.futuresNear || payload?.futures || marketRow(rows, "TXF", /台指|臺指|TXF/);
  const indexItem = (key, label, item) => ({
    key,
    label,
    value: textValue(item?.["收盤指數"] || item?.price),
    change: signedText(item?.["漲跌"] || item?.pct, item?.["漲跌百分比"] || item?.pct, item?.["漲跌百分比"] ? "%" : ""),
    detail: signedText(item?.["漲跌"] || item?.pct, item?.["漲跌點數"] || item?.score),
    source: textValue(item?._source || item?.reason || payload?.source, "market-api"),
  });
  const futuresItem = {
    key: "txf-night",
    label: "台指期夜盤",
    value: textValue(futures?.price),
    change: textValue(futures?.pct),
    detail: textValue(futures?.change || futures?.score),
    source: textValue(futures?.basisLabel || futures?.reason || "TAIFEX"),
  };
  return [
    indexItem("twse", "加權指數", twse),
    indexItem("otc", "櫃買指數", otc),
    futuresItem,
  ];
}

async function buildBoot(request) {
  const origin = originFrom(request);
  const snapshot = await readDesktopRouteSnapshot({ timeoutMs: 30000 }).catch(() => null);
  const marketPromise = (async () => {
    let payload = endpointPayloadFromSnapshot(snapshot?.payload, MARKET_CORE_ENDPOINT)
      || endpointPayloadFromSnapshot(snapshot?.payload, "/api/market");
    try {
      if (!payload) payload = await fetchJsonWithTimeout(`${origin}${MARKET_CORE_ENDPOINT}`, 9000);
    } catch {
      payload = null;
    }
    return normalizeMarketCore(payload);
  })();
  const results = await Promise.all(FRAGMENT_TABS.map(async (tab) => {
    const endpoint = appendQuery(TAB_ENDPOINTS[tab], {
      mobileBoot: 1,
      canvas: 1,
      compact: 1,
      shell: 1,
      limit: 60,
      ts: Date.now(),
    });
    let payload = endpointPayloadFromSnapshot(snapshot?.payload, endpoint);
    try {
      if (!payload) payload = await fetchJsonWithTimeout(`${origin}${endpoint}`);
    } catch (error) {
      payload = {
        ok: false,
        source: "mobile-boot-tab-timeout",
        error: "mobile_boot_tab_unavailable",
        message: error?.message || String(error),
      };
    }
    return [tab, payload];
  }));
  const fragments = {};
  const runs = {};
  for (const [tab, payload] of results) {
    const hash = signature(tab, payload);
    fragments[tab] = {
      url: `/api/mobile-fragment?tab=${encodeURIComponent(tab)}`,
      hash,
      api: TAB_ENDPOINTS[tab],
      runId: extractRunId(payload, tab),
      complete: payload?.complete === true,
      count: Number(payload?.count ?? payload?.total ?? payload?.result_count ?? 0) || 0,
    };
    runs[tab] = fragments[tab];
  }
  const bootHash = crypto.createHash("sha1").update(JSON.stringify(fragments)).digest("hex").slice(0, 12);
  const updatedAt = new Date().toISOString();
  const marketCore = await marketPromise;
  return {
    ok: true,
    source: "mobile-boot-api-only",
    updatedAt,
    bootHash,
    lowPower: {
      defaultVariant: "lite",
      lowEndVariant: "ultra",
      disablePrefetchOnLowEnd: true,
      tabTopLimit: 5,
      digestPollMs: 60000,
      fullHtmlBudget: 30000,
      liteHtmlBudget: 16000,
      ultraHtmlBudget: 9000,
    },
    fragments,
    runs,
    marketCore,
    digest: {
      fragmentVersion: "mobile-api-only-v1",
      freshness: "fresh",
      aiUpdatedAt: updatedAt,
      aiHash: bootHash,
      liteHash: bootHash,
      ultraHash: bootHash,
      htmlBytes: 0,
      liteBytes: 0,
      ultraBytes: 0,
      bias: "API-only",
    },
    aiSummary: {
      bias: "API-only",
      sample: Object.values(fragments).reduce((sum, item) => sum + (Number(item.count) || 0), 0),
      up: 0,
      down: 0,
      flat: 0,
      reason: "手機策略分頁直接銜接 latest APIs",
    },
    status: { updatedAt },
  };
}

module.exports = function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  response.setHeader("CDN-Cache-Control", "no-store");
  response.setHeader("Vercel-CDN-Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  buildBoot(request).then((payload) => {
    sendPayload(request, response, 200, payload);
  }).catch((error) => {
    sendPayload(request, response, 503, {
      ok: false,
      source: "mobile-boot-api",
      error: "mobile_boot_unavailable",
      message: error?.message || String(error),
    });
  });
};


