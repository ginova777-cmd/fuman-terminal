const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_ROUTES = [
  "market",
  "heatmap",
  "market-ai",
  "realtime-radar",
  "strategy1",
  "strategy2",
  "strategy3",
  "strategy4",
  "strategy5",
  "institution",
  "cb",
  "warrant",
  "watchlist",
];
const DEFAULT_STRICT_STRATEGY2_ROUTES = ["strategy2"];
const ROUTE_BUDGETS_MS = {
  market: 700,
  heatmap: 900,
  "market-ai": 900,
  "realtime-radar": 1500,
  strategy1: 700,
  strategy2: 2500,
  strategy3: 1200,
  strategy4: 1200,
  strategy5: 1200,
  institution: 1200,
  cb: 1200,
  warrant: 1200,
  watchlist: 700,
};
const STRICT_STRATEGY2_BUDGET_MS = 1800;
const args = process.argv.slice(2);

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] || "" : "";
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const BASE_URL = readArg("base-url") || process.env.FUMAN_COLD_START_BASE_URL || process.env.FUMAN_MEASURE_BASE_URL || "https://fuman-terminal.vercel.app";
const ROUTES_ARG = readArg("routes") || process.env.FUMAN_COLD_START_ROUTES || "";
const STRICT_STRATEGY2 = hasFlag("strict-strategy2") || process.env.FUMAN_COLD_START_STRICT_STRATEGY2 === "1";
const SKIP_WATCHLIST = hasFlag("skip-watchlist") || process.env.FUMAN_COLD_START_SKIP_WATCHLIST === "1";
const MODE = STRICT_STRATEGY2 ? "snapshot-first-strict" : "no-sacrifice-live";
const BUDGET_MULTIPLIER = Number(readArg("budget-multiplier") || process.env.FUMAN_COLD_START_BUDGET_MULTIPLIER || "1") || 1;
const MAX_ROUTE_RETRIES = Math.max(0, Math.min(2, Number(readArg("route-retries") || process.env.FUMAN_COLD_START_ROUTE_RETRIES || "1") || 0));
const OUTPUT_FILE = path.resolve(ROOT, readArg("out") || process.env.FUMAN_COLD_START_OUTPUT || "outputs/terminal-cold-start-performance.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome or Edge executable not found");
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function fetchJson(url, method = "GET") {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.setTimeout(15000, () => request.destroy(new Error("fetch timeout")));
    request.end();
  });
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.eventWaiters = [];
  }

  async connect() {
    const WebSocket = global.WebSocket || (await import("ws")).WebSocket;
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      if (typeof this.ws.addEventListener === "function") {
        this.ws.addEventListener("open", resolve, { once: true });
        this.ws.addEventListener("error", reject, { once: true });
      } else {
        this.ws.once("open", resolve);
        this.ws.once("error", reject);
      }
    });
    const onMessage = async (eventOrData) => {
      let raw = eventOrData?.data ?? eventOrData;
      if (raw && typeof raw.text === "function") raw = await raw.text();
      else if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString("utf8");
      else if (ArrayBuffer.isView(raw)) raw = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
      this.onMessage(String(raw));
    };
    if (typeof this.ws.addEventListener === "function") this.ws.addEventListener("message", onMessage);
    else this.ws.on("message", onMessage);
  }

  onMessage(data) {
    const message = JSON.parse(data);
    if (message.id && this.pending.has(message.id)) {
      const waiter = this.pending.get(message.id);
      clearTimeout(waiter.timer);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || "CDP error"));
      else waiter.resolve(message.result || {});
      return;
    }
    if (message.method) {
      this.events.push(message);
      for (const waiter of [...this.eventWaiters]) {
        if (waiter.method === message.method) {
          this.eventWaiters.splice(this.eventWaiters.indexOf(waiter), 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message.params || {});
        }
      }
    }
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  waitForEvent(method, timeoutMs = 30000) {
    const existingIndex = this.events.findIndex((event) => event.method === method);
    if (existingIndex >= 0) {
      const [event] = this.events.splice(existingIndex, 1);
      return Promise.resolve(event.params || {});
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`event ${method} timed out`)), timeoutMs);
      this.eventWaiters.push({ method, resolve, reject, timer });
    });
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function launchBrowser() {
  const port = await freePort();
  const userDataDir = path.join(os.tmpdir(), `fuman-terminal-cold-start-${Date.now()}`);
  const browser = childProcess.spawn(findBrowser(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });
  for (let i = 0; i < 80; i += 1) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (version.webSocketDebuggerUrl) return { browser, port };
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome CDP did not start");
}

async function createTab(port) {
  const tab = await fetchJson(`http://127.0.0.1:${port}/json/new`, "PUT");
  const cdp = new Cdp(tab.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("DOM.enable");
  return cdp;
}

async function evaluate(cdp, fn, arg = null, timeoutMs = 30000) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(${fn})(${JSON.stringify(arg)})`,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.value;
}

async function waitFor(cdp, fn, arg, timeoutMs = 20000, intervalMs = 100) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, fn, arg, Math.min(5000, timeoutMs)).catch((error) => ({ error: error.message }));
    if (last?.ok) return last;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timeout ${JSON.stringify(last)}`);
}

async function navigate(cdp, routeKey) {
  const contextReady = cdp.waitForEvent("Runtime.executionContextCreated", 45000).catch(() => null);
  const strategy2SnapshotFirst = STRICT_STRATEGY2 ? "&strategy2SnapshotFirst=1" : "";
  const url = `${BASE_URL.replace(/\/+$/, "")}/?desktop=1&theme=dark${strategy2SnapshotFirst}&cold=${Date.now()}-${encodeURIComponent(routeKey)}`;
  await cdp.send("Page.navigate", { url }, 45000);
  await contextReady;
  await waitFor(cdp, () => ({ ok: document.readyState === "interactive" || document.readyState === "complete" }), null, 45000, 250);
  await waitFor(cdp, () => ({ ok: Boolean(document.querySelector("aside.sidebar [data-view]")) }), null, 45000, 250);
  await sleep(250);
}

async function querySelectorNodeId(cdp, selector, timeoutMs = 20000) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const { root } = await cdp.send("DOM.getDocument", { depth: 1, pierce: true }, 8000);
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector }, 8000);
      if (nodeId) return nodeId;
      lastError = "missing";
    } catch (error) {
      lastError = error.message;
    }
    await sleep(100);
  }
  throw new Error(`selector not found: ${selector} (${lastError})`);
}

async function clickSelectorByDom(cdp, selector) {
  const nodeId = await querySelectorNodeId(cdp, selector, 20000);
  const { model } = await cdp.send("DOM.getBoxModel", { nodeId }, 10000);
  const quad = model?.border || model?.content;
  if (!quad || quad.length < 8) throw new Error(`selector has no box model: ${selector}`);
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const y = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function scrollSelectorIntoView(cdp, selector) {
  await evaluate(cdp, (sel) => {
    const el = document.querySelector(sel);
    const target = el?.closest?.("a,button,[role=button]") || el;
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    return true;
  }, selector, 10000).catch(() => false);
  await sleep(80);
}

async function clickSelector(cdp, selector) {
  await scrollSelectorIntoView(cdp, selector);
  try {
    await clickSelectorByDom(cdp, selector);
    return;
  } catch {}
  const rect = await waitFor(cdp, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: "missing" };
    const target = el.closest("a,button,[role=button]") || el;
    const r = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const visible = r.width > 2 && r.height > 2 && style.display !== "none" && style.visibility !== "hidden";
    return { ok: visible, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector, 15000).catch(() => null);
  if (!rect) {
    await clickSelectorByDom(cdp, selector);
    return;
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
}

async function seedWatchlist(cdp) {
  await evaluate(cdp, () => {
    const rows = [
      { code: "2330", name: "台積電", reason: "冷啟動測速自選股", addedAt: new Date().toISOString() },
      { code: "2317", name: "鴻海", reason: "冷啟動測速自選股", addedAt: new Date().toISOString() },
    ];
    localStorage.setItem("fuman_watchlist", JSON.stringify(rows));
    localStorage.setItem("fuman_mobile_watchlist_v1", JSON.stringify(rows));
    return true;
  });
}

function collectRows(route) {
  const activePanel = [...document.querySelectorAll(".view-panel")].find((el) => el.classList.contains("active") && !el.hidden) || document.body;
  const selectors = route.rowSelectors || [
    ".metric-card",
    ".sector-card",
    ".market-ai-card",
    ".market-ai-block",
    ".market-ai-point",
    ".market-ai-stock-row",
    ".radar-signal-card",
    ".radar-leader-card",
    "#strategy-table .strategy-row:not(.strategy-head)",
    "#strategy-table tbody tr",
    "#strategy-table [data-stock-code]",
    ".desktop-route-shell tbody tr",
    ".desktop-route-shell [data-stock-code]",
    ".strategy5-stock-card",
    ".intraday-table tbody tr",
    ".swing-table tbody tr",
    "#chip-trade-body tr",
    "#cb-detect-list > *:not(.cb-detect-empty)",
    ".warrant-flow-panel tbody tr",
    ".warrant-flow-card",
    ".warrant-flow-list > *",
    ".watchlist-stock-list > *",
    ".watchlist-card",
    ".watch-analysis-panel",
  ];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && style.display !== "none" && style.visibility !== "hidden";
  };
  const emptyPattern = /等待資料載入|尚未產生|目前沒有符合|尚未新增自選股|更新策略資料中|載入全台股|等待最新 complete run|權證快照尚未建立|載入最新 AI 判讀資料中/;
  const rows = [];
  for (const selector of selectors) {
    for (const el of activePanel.querySelectorAll(selector)) {
      const text = String(el.textContent || "").replace(/\s+/g, " ").trim();
      if (!visible(el) || !text || emptyPattern.test(text)) continue;
      rows.push({ selector, text: text.slice(0, 160) });
    }
  }
  const panelText = String(activePanel.textContent || "").replace(/\s+/g, " ").trim();
  const countText = String(activePanel.querySelector(".desktop-canvas-count")?.textContent || "").replace(/\s+/g, " ").trim();
  const countMatch = countText.match(/(\d+)\s*\/\s*(\d+)/) || countText.match(/(\d+)\s*筆/);
  const canvasRows = countMatch ? Number(countMatch[1]) || 0 : 0;
  const rowCount = Math.max(rows.length, canvasRows);
  const blocker = /HTTP\s*503|timeout|讀取失敗|載入失敗|資料載入失敗|fallback|static json|Google Sheet|fuman-terminal-sync/i.test(panelText);
  return {
    ok: (rowCount > 0 || route.allowEmpty) && !blocker,
    rows: rowCount,
    domRows: rows.length,
    canvasRows,
    activePanelId: activePanel.id || "",
    sample: rows.slice(0, 3),
    text: panelText.slice(0, 160),
    blocker,
  };
}

const routes = [
  { key: "market", nav: "aside.sidebar a[data-view='market']", rowSelectors: [".metric-card", ".sector-card"] },
  { key: "heatmap", nav: "aside.sidebar a[data-view='market']", mode: "[data-market-mode='overview']", rowSelectors: [".sector-card"] },
  { key: "market-ai", nav: "aside.sidebar a[data-view='market']", mode: "[data-market-mode='ai']", rowSelectors: [".market-ai-card", ".market-ai-block", ".market-ai-point", ".market-ai-stock-row"] },
  { key: "realtime-radar", nav: "aside.sidebar a.realtime-radar-nav[data-view='realtime-radar']", rowSelectors: [".radar-signal-card", ".radar-leader-card", ".desktop-route-shell tbody tr", ".desktop-route-shell [data-stock-code]"] },
  { key: "strategy1", nav: "aside.sidebar a[data-view='strategy'] .s1", allowEmpty: true },
  { key: "strategy2", nav: "aside.sidebar a[data-view='strategy'] .s2" },
  { key: "strategy3", nav: "aside.sidebar a[data-view='strategy'] .s3" },
  { key: "strategy4", nav: "aside.sidebar a[data-view='strategy'] .s4" },
  { key: "strategy5", nav: "aside.sidebar a[data-view='strategy'] .s5" },
  { key: "institution", nav: "aside.sidebar a[data-view='chip-trade']" },
  { key: "cb", nav: "aside.sidebar a[data-view='cb-detect']" },
  { key: "warrant", nav: "aside.sidebar a[data-view='warrant-flow']" },
  { key: "watchlist", nav: "aside.sidebar a[data-view='watchlist']", seedWatchlist: true, allowEmpty: true },
];

function selectedRoutes() {
  const requested = (ROUTES_ARG ? ROUTES_ARG.split(",") : (STRICT_STRATEGY2 ? DEFAULT_STRICT_STRATEGY2_ROUTES : DEFAULT_ROUTES))
    .map((route) => route.trim())
    .filter((route) => route && (!SKIP_WATCHLIST || route !== "watchlist"));
  const byKey = new Map(routes.map((route) => [route.key, route]));
  const unknown = requested.filter((route) => !byKey.has(route));
  if (unknown.length) throw new Error(`Unknown cold-start route(s): ${unknown.join(", ")}`);
  return requested.map((route) => byKey.get(route));
}

function routeBudgetMs(routeKey) {
  const base = routeKey === "strategy2" && STRICT_STRATEGY2
    ? STRICT_STRATEGY2_BUDGET_MS
    : ROUTE_BUDGETS_MS[routeKey] || 900;
  return Math.ceil(base * BUDGET_MULTIPLIER);
}

function isRouteResultOk(item, route) {
  if (item.error) return false;
  if (!Number.isFinite(item.ms)) return false;
  if (item.ms > item.budgetMs) return false;
  if (!route.allowEmpty && !(Number(item.rows) > 0)) return false;
  return true;
}

async function measureRoute(cdp, route) {
  await navigate(cdp, route.key);
  if (route.seedWatchlist) await seedWatchlist(cdp);
  const start = Date.now();
  await clickSelector(cdp, route.nav);
  if (route.mode) await clickSelector(cdp, route.mode);
  const ready = await waitFor(cdp, collectRows, route, 25000, 100);
  return {
    route: route.key,
    ms: Date.now() - start,
    rows: ready.rows,
    activePanelId: ready.activePanelId,
    sample: ready.sample,
  };
}

async function measureRouteInFreshBrowser(route) {
  const { browser, port } = await launchBrowser();
  const cdp = await createTab(port);
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    return await measureRoute(cdp, route);
  } finally {
    cdp.close();
    browser.kill();
  }
}

(async () => {
  const selected = selectedRoutes();
  const results = [];
  for (const route of selected) {
    console.error(`[cold-start] ${route.key}`);
    let evaluated = null;
    try {
      for (let attempt = 0; attempt <= MAX_ROUTE_RETRIES; attempt += 1) {
        const item = await measureRouteInFreshBrowser(route);
        const budgetMs = routeBudgetMs(route.key);
        evaluated = {
          ...item,
          mode: MODE,
          budgetMs,
          attempt: attempt + 1,
          retriesAllowed: MAX_ROUTE_RETRIES,
          ok: isRouteResultOk({ ...item, budgetMs }, route),
        };
        console.error(`[cold-start] ${route.key} ${item.ms}ms rows=${item.rows} budget=${budgetMs}ms attempt=${attempt + 1}`);
        if (evaluated.ok || attempt >= MAX_ROUTE_RETRIES) break;
        console.error(`[cold-start] ${route.key} retrying after transient slow paint`);
        await sleep(350);
      }
      results.push(evaluated);
    } catch (error) {
      const budgetMs = routeBudgetMs(route.key);
      console.error(`[cold-start] ${route.key} failed ${error.message}`);
      results.push({ route: route.key, mode: MODE, ok: false, budgetMs, error: error.message });
    }
    await sleep(250);
  }
  const sorted = [...results].sort((a, b) => Number(b.ms || 0) - Number(a.ms || 0));
  const failures = results.filter((item) => !item.ok);
  const report = {
    ok: failures.length === 0,
    mode: MODE,
    policy: STRICT_STRATEGY2
      ? "latest snapshot must be visible first, then live refresh can replace it"
      : "do not sacrifice Strategy2 realtime; Strategy2 gets a live-route budget",
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    budgetMultiplier: BUDGET_MULTIPLIER,
    outputFile: OUTPUT_FILE,
    routeCount: results.length,
    failures: failures.map((item) => ({ route: item.route, ms: item.ms || null, budgetMs: item.budgetMs, rows: item.rows || 0, error: item.error || "" })),
    slowest: sorted.slice(0, 6).map((item) => ({ route: item.route, ms: item.ms || null, budgetMs: item.budgetMs, rows: item.rows || 0, error: item.error || "" })),
    results,
  };
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({
    ok: report.ok,
    mode: report.mode,
    baseUrl: report.baseUrl,
    outputFile: path.relative(ROOT, OUTPUT_FILE),
    failures: report.failures,
    slowest: report.slowest,
  }, null, 2));
  if (!report.ok) {
    console.error(`[cold-start] failed ${failures.length}/${results.length} route(s); see ${OUTPUT_FILE}`);
    process.exit(1);
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
