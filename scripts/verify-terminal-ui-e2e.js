const childProcess = require("child_process");
const fs = require("fs/promises");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_BASE_URL = "https://fuman-terminal.vercel.app";
const BLANK_PAGE_URL = "data:text/html,FUMAN_E2E";
const BASE_URL = optionValue("--base-url") || process.env.FUMAN_UI_E2E_BASE_URL || DEFAULT_BASE_URL;
const BASE_ORIGIN = new URL(BASE_URL).origin;
const OUT_DIR = path.resolve(optionValue("--out") || process.env.FUMAN_UI_E2E_OUT || path.join(ROOT, "outputs", "terminal-ui-e2e"));
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const KEEP_BROWSER = process.argv.includes("--keep-browser");
const HEADFUL = process.argv.includes("--headful");
const NO_SCREENSHOTS = process.argv.includes("--no-screenshots");
const DEBUG = process.argv.includes("--debug") || process.env.FUMAN_UI_E2E_DEBUG === "1";
const RUN_ONLY = new Set((optionValue("--only") || process.env.FUMAN_UI_E2E_ONLY || "desktop-night,desktop-sun,mobile-night,mobile-sun")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean));
const ROUTE_FILTER = new Set((optionValue("--routes") || process.env.FUMAN_UI_E2E_ROUTES || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean));
const SKIP_WATCHLIST = process.argv.includes("--skip-watchlist") || process.env.FUMAN_UI_E2E_SKIP_WATCHLIST === "1";
const EVAL_TIMEOUT_MS = Number(optionValue("--eval-timeout") || process.env.FUMAN_UI_E2E_EVAL_TIMEOUT_MS || 30000);
const ROUTE_TIMEOUT_MS = Number(optionValue("--route-timeout") || process.env.FUMAN_UI_E2E_ROUTE_TIMEOUT_MS || 45000);

const DESKTOP_ROUTES = [
  { key: "market", label: "market overview", selector: "aside.sidebar a[data-view=\"market\"]", expectedRouteKey: "market|市場總覽", expectedPanelId: "market-view", requiredFieldSignals: ["runOrDate", "sourceFreshness", "reasonScoreActionRisk"] },
  { key: "heatmap", label: "heatmap", selector: "aside.sidebar a[data-view=\"market\"]", expectedRouteKey: "market|市場總覽", expectedPanelId: "market-view", postClickSelector: "#market-view .market-mode-tabs [data-market-mode=\"overview\"]", requiredText: ["熱力圖"], requiredFieldSignals: ["runOrDate", "sourceFreshness", "reasonScoreActionRisk"] },
  { key: "market-ai", label: "market ai", selector: "aside.sidebar a[data-view=\"market\"]", expectedRouteKey: "market|市場總覽", expectedPanelId: "market-view", postClickSelector: "#market-view .market-mode-tabs [data-market-mode=\"ai\"]", requiredText: ["AI 判讀", "操作建議", "風險"] },
  { key: "realtime-radar", label: "realtime radar", selector: "aside.sidebar a.realtime-radar-nav[data-view=\"realtime-radar\"]", expectedRouteKey: "realtime-radar|即時雷達", expectedPanelId: "realtime-radar-view", requiredFieldSignals: ["runOrDate", "sourceFreshness", "reasonScoreActionRisk"] },
  { key: "strategy1", label: "strategy1", selector: "aside.sidebar a[data-view=\"strategy\"] .s1", expectedRouteKey: "strategy|策略1", expectedPanelId: "strategy-view", allowWaitingEmpty: true, fallbackNeedles: ["策略1-明日開盤入", "21:30初篩", "08:55搓合"] },
  { key: "strategy2", label: "strategy2 live", selector: "aside.sidebar a[data-view=\"strategy\"] .s2", expectedRouteKey: "strategy|策略2", expectedPanelId: "strategy-view" },
  { key: "strategy3", label: "strategy3", selector: "aside.sidebar a[data-view=\"strategy\"] .s3", expectedRouteKey: "strategy|策略3", expectedPanelId: "strategy-view" },
  { key: "strategy4", label: "strategy4", selector: "aside.sidebar a[data-view=\"strategy\"] .s4", expectedRouteKey: "strategy|策略4", expectedPanelId: "strategy-view" },
  { key: "strategy5", label: "strategy5", selector: "aside.sidebar a[data-view=\"strategy\"] .s5", expectedRouteKey: "strategy|策略5", expectedPanelId: "strategy-view" },
  { key: "institution", label: "institution", selector: "aside.sidebar a[data-view=\"chip-trade\"]", expectedRouteKey: "chip-trade|買賣超", expectedPanelId: "chip-trade-view" },
  { key: "cb", label: "cb detect", selector: "aside.sidebar a[data-view=\"cb-detect\"]", expectedRouteKey: "cb-detect|CB可轉債", expectedPanelId: "cb-detect-view" },
  { key: "warrant", label: "warrant flow", selector: "aside.sidebar a[data-view=\"warrant-flow\"]", expectedRouteKey: "warrant-flow|權證走向", expectedPanelId: "warrant-flow-view" },
  { key: "watchlist", label: "watchlist", selector: "aside.sidebar .watchlist-chip-link[data-view=\"watchlist\"]", expectedRouteKey: "watchlist|自選股", expectedPanelId: "watchlist-view", allowWaitingEmpty: true, requiredText: ["自選股"], requiredFieldSignals: ["codeName", "reasonScoreActionRisk"] },
];

const MOBILE_ROUTES = [
  { key: "ai", label: "market ai", fragment: "ai" },
  { key: "strategy1", label: "strategy1", fragment: "strategy1", allowMissingRunId: true },
  { key: "strategy2", label: "strategy2 live", fragment: "strategy2" },
  { key: "strategy3", label: "strategy3", fragment: "strategy3" },
  { key: "strategy4", label: "strategy4", fragment: "strategy4" },
  { key: "strategy5", label: "strategy5", fragment: "strategy5" },
  { key: "institution", label: "institution", fragment: "chip" },
  { key: "cb", label: "cb detect", fragment: "cb" },
  { key: "warrant", label: "warrant flow", fragment: "warrant" },
  { key: "watch", label: "watchlist", fragment: "watch", allowEmpty: true },
];

const MOBILE_VIEWPORTS = {
  "phone-portrait": {
    key: "phone-portrait",
    label: "phone portrait",
    width: 390,
    height: 844,
    mobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  "phone-landscape": {
    key: "phone-landscape",
    label: "phone landscape",
    width: 844,
    height: 390,
    mobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  tablet: {
    key: "tablet",
    label: "tablet",
    width: 820,
    height: 1180,
    mobile: true,
    userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  "desktop-mobile": {
    key: "desktop-mobile",
    label: "desktop opening mobile URL",
    width: 1024,
    height: 768,
    mobile: false,
  },
};

const MOBILE_RUNS = [
  { flag: "mobile-night", theme: "night", viewport: MOBILE_VIEWPORTS["phone-portrait"] },
  { flag: "mobile-sun", theme: "sun", viewport: MOBILE_VIEWPORTS["phone-portrait"] },
  { flag: "mobile-phone-portrait-night", theme: "night", viewport: MOBILE_VIEWPORTS["phone-portrait"] },
  { flag: "mobile-phone-portrait-sun", theme: "sun", viewport: MOBILE_VIEWPORTS["phone-portrait"] },
  { flag: "mobile-phone-landscape-night", theme: "night", viewport: MOBILE_VIEWPORTS["phone-landscape"] },
  { flag: "mobile-phone-landscape-sun", theme: "sun", viewport: MOBILE_VIEWPORTS["phone-landscape"] },
  { flag: "mobile-tablet-night", theme: "night", viewport: MOBILE_VIEWPORTS.tablet },
  { flag: "mobile-tablet-sun", theme: "sun", viewport: MOBILE_VIEWPORTS.tablet },
  { flag: "mobile-desktop-night", theme: "night", viewport: MOBILE_VIEWPORTS["desktop-mobile"] },
  { flag: "mobile-desktop-sun", theme: "sun", viewport: MOBILE_VIEWPORTS["desktop-mobile"] },
];

function optionValue(name) {
  const prefix = `${name}=`;
  return (process.argv.find((arg) => arg.startsWith(prefix)) || "").slice(prefix.length);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debug(message) {
  if (DEBUG) console.log(`[terminal-ui-e2e:debug] ${message}`);
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function withCacheBust(url) {
  const target = new URL(url, BASE_URL);
  target.searchParams.set("ui-e2e", Date.now().toString());
  return target.toString();
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const fsSync = require("fs");
  const found = candidates.find((candidate) => fsSync.existsSync(candidate));
  if (!found) throw new Error("Chrome or Edge executable not found. Set CHROME_PATH to run UI E2E.");
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

async function fetchJson(url, options = {}) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method || "GET",
      timeout: 8000,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${url} HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body || "{}"));
        } catch (error) {
          reject(new Error(`${url} JSON parse failed: ${error?.message || error}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`${url} request timed out`)));
    request.on("error", (error) => reject(new Error(`${url} fetch failed: ${error?.message || error}`)));
    request.end();
  });
}

async function launchBrowser() {
  const port = await freePort();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "fuman-ui-e2e-"));
  const browserPath = findBrowser();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--window-size=1440,1000",
    BLANK_PAGE_URL,
  ];
  if (!HEADFUL) {
    args.unshift(
      "--headless=new",
      "--disable-gpu",
      "--disable-gpu-sandbox",
      "--disable-features=Vulkan,DawnGraphite,DefaultANGLEVulkan,VulkanFromANGLE",
    );
  }
  debug(`launch browser=${browserPath} port=${port} headful=${HEADFUL ? "1" : "0"}`);
  const child = childProcess.spawn(browserPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk).slice(0, 1000);
  });
  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  let stableHits = 0;
  let lastError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await fetchJson(versionUrl);
      await fetchJson(`http://127.0.0.1:${port}/json/list`);
      stableHits += 1;
      if (stableHits >= 2) {
        debug(`browser CDP ready port=${port}`);
        return { child, port, userDataDir, stderr: () => stderr };
      }
    } catch (error) {
      stableHits = 0;
      lastError = error;
      if (child.exitCode !== null) throw new Error(`browser exited early: ${stderr}`);
      await sleep(150);
    }
  }
  throw new Error(`browser did not expose stable CDP: ${lastError?.message || ""} ${stderr}`);
}

async function createTab(browser) {
  const port = typeof browser === "number" ? browser : browser.port;
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      debug(`create tab attempt=${attempt + 1} port=${port}`);
      let target = null;
      try {
        const newUrl = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(BLANK_PAGE_URL)}`;
        target = await fetchJson(newUrl, { method: "PUT" });
        debug(`new target=${target.type || ""}:${target.title || target.url || ""}`);
      } catch (error) {
        const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
        debug(`targets=${list.map((item) => `${item.type}:${item.title || item.url || ""}`).join(" | ")}`);
        target = list.find((item) => item.type === "page");
      }
      if (!target?.webSocketDebuggerUrl) {
        lastError = new Error("CDP page target missing websocket URL");
        await sleep(350);
        continue;
      }
      const cdp = new Cdp(target.webSocketDebuggerUrl);
      try {
        debug(`connect websocket attempt=${attempt + 1}`);
        await cdp.connect();
        debug("enable Runtime/DOM/Network; Page.enable is optional");
        await cdp.send("Runtime.enable", {}, 30000);
        await cdp.send("DOM.enable", {}, 30000);
        await cdp.send("Network.enable", {}, 30000);
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, 10000).catch(() => null);
        await cdp.send("Network.setBypassServiceWorker", { bypass: true }, 10000).catch(() => null);
        await cdp.send("Storage.clearDataForOrigin", { origin: BASE_ORIGIN, storageTypes: "all" }, 10000).catch(() => null);
        await cdp.send("Page.enable", {}, 5000).catch((error) => debug(`Page.enable skipped: ${error.message}`));
        await cdp.send("Log.enable", {}, 10000).catch(() => null);
        return cdp;
      } catch (error) {
        lastError = error;
        cdp.close();
        await sleep(500 + attempt * 250);
      }
    } catch (error) {
      lastError = error;
      if (browser?.child?.exitCode !== null && browser?.child?.exitCode !== undefined) {
        throw new Error(`browser exited before CDP tab init (code ${browser.child.exitCode}): ${browser.stderr?.() || lastError.message}`);
      }
      await sleep(350);
    }
  }
  throw lastError || new Error("CDP page target missing websocket URL");
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.eventWaiters = [];
    this.events = [];
  }

  connect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        try { this.ws?.close(); } catch {}
        finish(reject, new Error(`CDP websocket connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => finish(resolve), { once: true });
      this.ws.addEventListener("error", (error) => finish(reject, error), { once: true });
      this.ws.addEventListener("close", () => finish(reject, new Error("CDP websocket closed before open")), { once: true });
      this.ws.addEventListener("message", (event) => {
        this.handleMessage(event).catch((error) => {
          this.events.push({ method: "CDP.parseError", params: { message: error.message } });
        });
      });
    });
  }

  async handleMessage(event) {
    let raw = event.data;
    if (raw && typeof raw.text === "function") raw = await raw.text();
    else if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString("utf8");
    else if (ArrayBuffer.isView(raw)) raw = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
    const message = JSON.parse(String(raw));
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
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
      this.pending.set(id, { method, resolve, reject, timer });
    });
  }

  waitForEvent(method, timeoutMs = 30000) {
    const existingIndex = this.events.findIndex((event) => event.method === method);
    if (existingIndex >= 0) {
      const [event] = this.events.splice(existingIndex, 1);
      return Promise.resolve(event.params || {});
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((item) => item.resolve !== resolve);
        reject(new Error(`event ${method} timed out`));
      }, timeoutMs);
      this.eventWaiters.push({ method, resolve, reject, timer });
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

async function evaluate(cdp, fn, arg = null, timeoutMs = EVAL_TIMEOUT_MS) {
  const expression = `(${fn})(${JSON.stringify(arg)})`;
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function waitFor(cdp, fn, arg, timeoutMs = 20000, intervalMs = 250) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, fn, arg, Math.min(EVAL_TIMEOUT_MS, Math.max(12000, timeoutMs))).catch((error) => ({ error: error.message }));
    if (last && !last.error && last.ok) return last;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timed out: ${JSON.stringify(last)}`);
}

async function setViewport(cdp, mode) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: mode.width,
    height: mode.height,
    deviceScaleFactor: mode.deviceScaleFactor || 1,
    mobile: Boolean(mode.mobile),
    screenWidth: mode.width,
    screenHeight: mode.height,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: Boolean(mode.mobile) }).catch(() => null);
  if (mode.mobile) {
    await cdp.send("Network.setUserAgentOverride", {
      userAgent: mode.userAgent || "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
  } else {
    await cdp.send("Network.setUserAgentOverride", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    }).catch(() => null);
  }
}

async function navigate(cdp, url) {
  cdp.events = cdp.events.filter((event) => !["Runtime.executionContextCreated"].includes(event.method));
  const contextReady = cdp.waitForEvent("Runtime.executionContextCreated", 45000).catch(() => null);
  await cdp.send("Page.navigate", { url }, 45000);
  await contextReady;
  await waitFor(cdp, () => ({
    ok: document.readyState === "interactive" || document.readyState === "complete",
    state: document.readyState,
  }), null, 45000, 500).catch(() => null);
  await cdp.send("Page.stopLoading").catch(() => null);
  await sleep(1000);
  await cdp.send("Page.bringToFront").catch(() => null);
}

async function querySelectorNodeId(cdp, selector, timeoutMs = 12000) {
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
    await sleep(250);
  }
  throw new Error(`selector not found: ${selector} (${lastError})`);
}

async function waitForSelector(cdp, selector, timeoutMs = 30000) {
  return querySelectorNodeId(cdp, selector, timeoutMs);
}

async function clickSelectorByDom(cdp, selector) {
  const nodeId = await waitForSelector(cdp, selector, 20000);
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
  await sleep(120);
}

async function clickSelector(cdp, selector) {
  await scrollSelectorIntoView(cdp, selector);
  try {
    await clickSelectorByDom(cdp, selector);
    return;
  } catch {}
  await scrollSelectorIntoView(cdp, selector);
  const rect = await waitFor(cdp, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: "missing" };
    const target = el.closest("a,button,[role=button]") || el;
    const r = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    const visible = r.width > 2 && r.height > 2 && style.display !== "none" && style.visibility !== "hidden";
    return { ok: visible, x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
  }, selector, 15000).catch(() => null);
  if (!rect) {
    await clickSelectorByDom(cdp, selector);
    return;
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
}

async function waitForDesktopRoute(cdp, route, timeoutMs = 7000) {
  return waitFor(cdp, (expected) => {
    const activePanel = [...document.querySelectorAll(".view-panel")].find((el) => el.classList.contains("active") && !el.hidden);
    const activeRouteKey = document.documentElement.dataset.fumanDesktopActiveRoute || window.__fumanDesktopActiveRoute?.key || "";
    const activeNav = document.querySelector("[data-view].active,[data-view][aria-current='page']");
    const panelOk = !expected.expectedPanelId || activePanel?.id === expected.expectedPanelId;
    const routeOk = !expected.expectedRouteKey || activeRouteKey === expected.expectedRouteKey;
    return {
      ok: panelOk && routeOk,
      activePanelId: activePanel?.id || "",
      activeRouteKey,
      activeNavView: activeNav?.dataset?.view || "",
      expectedPanelId: expected.expectedPanelId || "",
      expectedRouteKey: expected.expectedRouteKey || "",
    };
  }, route, timeoutMs, 250);
}

async function activateDesktopRoute(cdp, route) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickSelector(cdp, route.selector);
    last = await waitForDesktopRoute(cdp, route, attempt ? 7000 : 4500).catch((error) => ({ error: error.message }));
    if (last && !last.error && last.ok) return last;
    await sleep(350);
  }
  throw new Error(`desktop route did not activate: ${route.key} (${JSON.stringify(last)})`);
}

async function prepareDesktopRoute(cdp, route) {
  if (route.key !== "watchlist") return;
  await evaluate(cdp, () => {
    const rows = [
      { code: "2334", name: "旺宏", reason: "UI E2E 自選股既有卡片驗證", addedAt: new Date().toISOString() },
    ];
    const value = JSON.stringify(rows);
    const rawSetItem = Storage.prototype.setItem.__fumanOriginalSetItem || Storage.prototype.setItem;
    localStorage.removeItem("fuman_watchlist");
    localStorage.removeItem("fuman_mobile_watchlist_v1");
    rawSetItem.call(localStorage, "fuman_watchlist", value);
    rawSetItem.call(localStorage, "fuman_mobile_watchlist_v1", value);
    localStorage.removeItem("fuman-terminal-ai-watchlist");
    document.querySelector("#watchlist-entry-status")?.replaceChildren();
    window.FUMAN_WATCHLIST_SHELL_INSTANCE?.render?.();
    return true;
  });
}

async function prepareMobileRoute(cdp, route) {
  if (route.fragment !== "watch") return;
  await evaluate(cdp, () => {
    const rows = [
      ["2334", "旺宏"],
      ["1101", "台泥"],
      ["2317", "鴻海"],
      ["2303", "聯電"],
      ["2330", "台積電"],
      ["2454", "聯發科"],
      ["2603", "長榮"],
      ["2881", "富邦金"],
      ["2327", "國巨"],
      ["9904", "寶成"],
      ["8112", "至上"],
      ["2408", "南亞科"],
    ].map(([code, name]) => ({ code, name, reason: "UI E2E 手機自選股十檔上限驗證", addedAt: new Date().toISOString() }));
    const value = JSON.stringify(rows);
    const rawSetItem = Storage.prototype.setItem.__fumanOriginalSetItem || Storage.prototype.setItem;
    localStorage.removeItem("fuman_watchlist");
    localStorage.removeItem("fuman_mobile_watchlist_v1");
    rawSetItem.call(localStorage, "fuman_watchlist", value);
    rawSetItem.call(localStorage, "fuman_mobile_watchlist_v1", value);
    localStorage.removeItem("fuman-terminal-ai-watchlist");
    return true;
  });
}

async function afterDesktopRouteActivate(cdp, route) {
  if (route.postClickSelector) {
    let active = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await waitFor(cdp, (selector) => {
        const visible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 2 && rect.height > 2 && style.display !== "none" && style.visibility !== "hidden";
        };
        const button = [...document.querySelectorAll(selector)].find(visible);
        return { ok: Boolean(button), text: String(button?.textContent || "").replace(/\s+/g, " ").trim() };
      }, route.postClickSelector, attempt ? 7000 : 15000, 250).catch(() => null);
      active = await evaluate(cdp, (selector) => {
        const visible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 2 && rect.height > 2 && style.display !== "none" && style.visibility !== "hidden";
        };
        const button = [...document.querySelectorAll(selector)].find(visible) || document.querySelector(selector);
        if (!button) return { ok: false, reason: "missing" };
        button.scrollIntoView({ block: "center", inline: "center" });
        button.click();
        if (!button.classList.contains("active") && typeof window.FUMAN_SELECT_MARKET_DESKTOP_MODE === "function") {
          window.FUMAN_SELECT_MARKET_DESKTOP_MODE(button.dataset.marketMode, "ui-e2e-visible-post-click");
        }
        return {
          ok: Boolean(button.classList.contains("active") || button.getAttribute("aria-pressed") === "true"),
          text: String(button.textContent || "").replace(/\s+/g, " ").trim(),
          className: String(button.className || ""),
        };
      }, route.postClickSelector).catch((error) => ({ ok: false, error: error.message }));
      await sleep(attempt ? 900 : 1200);
      if (!active?.ok) {
        active = await evaluate(cdp, (selector) => {
          const button = document.querySelector(selector);
          return {
            ok: Boolean(button?.classList?.contains("active") || button?.getAttribute("aria-pressed") === "true"),
            text: String(button?.textContent || "").replace(/\s+/g, " ").trim(),
            className: String(button?.className || ""),
          };
        }, route.postClickSelector).catch((error) => ({ ok: false, error: error.message }));
      }
      if (active?.ok) break;
    }
    if (!active?.ok) await sleep(1200);
  }
  if (route.key === "watchlist") {
    const submitWatchlistCode = async (code) => {
      await evaluate(cdp, (code) => {
        const input = document.querySelector("#watchlist-search-input");
        const add = document.querySelector("#watchlist-add-btn");
        if (!input || !add) return { ok: false, value: "", inputMissing: !input, addMissing: !add };
        input.focus();
        input.value = code;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        add.click();
        return { ok: true, value: input.value, disabled: input.disabled === true, addDisabled: add.disabled === true };
      }, code);
    };
    const addWatchlistCode = async (code) => {
      await submitWatchlistCode(code);
      await waitFor(cdp, (code) => {
        let rows = [];
        try { rows = JSON.parse(localStorage.getItem("fuman_watchlist") || "[]"); } catch {}
        const storageOk = Array.isArray(rows) && rows.some((item) => String(item?.code || "") === code);
        const cardOk = Boolean(document.querySelector(`.watchlist-card[data-code="${code}"]`));
        const status = String(document.querySelector("#watchlist-entry-status")?.textContent || "");
        const bridgeReady = /^20260628-0[3-9]/.test(String(window.__fumanWatchlistAddBridge || ""));
        const shellReady = Boolean(window.FUMAN_WATCHLIST_SHELL_INSTANCE || window.FUMAN_WATCHLIST_SHELL_MODULE);
        const containerReady = Boolean(document.querySelector("#watchlist-stocks"));
        return { ok: shellReady && containerReady && storageOk && cardOk && !/尚未同步/.test(status), bridgeReady, shellReady, containerReady, storageOk, cardOk, status, rows: rows.map((item) => item?.code).join(",") };
      }, code, 15000, 300);
    };
    const addedCodes = ["2324", "6770", "8112", "2327", "9904"];
    for (const addedCode of addedCodes) {
      await addWatchlistCode(addedCode);
    }
    await submitWatchlistCode("8112");
    await waitFor(cdp, () => {
      const cards = [...document.querySelectorAll('.watchlist-card[data-code="8112"]')];
      const selected = Boolean(document.querySelector('.watchlist-card.selected[data-code="8112"]'));
      const status = String(document.querySelector("#watchlist-entry-status")?.textContent || "");
      return { ok: cards.length === 1 && (selected || /已在自選股/.test(status)) && !/尚未同步/.test(status), cards: cards.length, selected, status };
    }, null, 15000, 300);
    for (const addedCode of ["2317", "2303", "2330", "2454"]) {
      await addWatchlistCode(addedCode);
    }
    await waitFor(cdp, () => {
      let rows = [];
      try { rows = JSON.parse(localStorage.getItem("fuman_watchlist") || "[]"); } catch {}
      const codes = rows.map((item) => String(item?.code || ""));
      const cards = [...document.querySelectorAll(".watchlist-card[data-code]")].map((item) => item.dataset.code || "");
      const status = String(document.querySelector("#watchlist-entry-status")?.textContent || "");
      const countText = String(document.querySelector("#watchlist-count")?.textContent || "").trim();
      return {
        ok: rows.length === 10
          && cards.length === 10
          && codes.includes("6770")
          && cards.includes("6770")
          && codes.includes("2324")
          && cards.includes("2324")
          && new Set(codes).size === 10
          && new Set(cards).size === 10
          && /^10(?:\/10)?$/.test(countText)
          && !/尚未同步/.test(status),
        rows: codes.join(","),
        cards: cards.join(","),
        count: countText,
        inputDisabled: document.querySelector("#watchlist-search-input")?.disabled === true,
        addDisabled: document.querySelector("#watchlist-add-btn")?.disabled === true,
        status,
      };
    }, null, 15000, 300);
    await evaluate(cdp, () => {
      const ok = window.FUMAN_WATCHLIST_FORCE_ADD_CODE?.("1101");
      let rows = [];
      try { rows = JSON.parse(localStorage.getItem("fuman_watchlist") || "[]"); } catch {}
      return { ok: ok === false || rows.length <= 10, result: ok, rows: rows.length };
    });
    await waitFor(cdp, () => {
      let rows = [];
      try { rows = JSON.parse(localStorage.getItem("fuman_watchlist") || "[]"); } catch {}
      return {
        ok: rows.length === 10 && !rows.some((item) => String(item?.code || "") === "1101") && !document.querySelector('.watchlist-card[data-code="1101"]'),
        rows: rows.map((item) => item?.code).join(","),
        has1101: Boolean(document.querySelector('.watchlist-card[data-code="1101"]')),
      };
    }, null, 10000, 250);
    await evaluate(cdp, () => {
      const button = document.querySelector('[data-watch-remove="8112"]');
      button?.dispatchEvent?.(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return Boolean(button);
    });
    await waitFor(cdp, () => {
      let rows = [];
      try { rows = JSON.parse(localStorage.getItem("fuman_watchlist") || "[]"); } catch {}
      const cards = [...document.querySelectorAll(".watchlist-card[data-code]")].map((item) => item.dataset.code || "");
      return {
        ok: rows.length === 9 && cards.length === 9 && !cards.includes("8112") && document.querySelector("#watchlist-search-input")?.disabled === false,
        rows: rows.map((item) => item?.code).join(","),
        cards: cards.join(","),
        inputDisabled: document.querySelector("#watchlist-search-input")?.disabled === true,
      };
    }, null, 15000, 300);
    await addWatchlistCode("1101");
    await waitFor(cdp, () => {
      const card = document.querySelector('.watchlist-card[data-code="1101"]');
      card?.dispatchEvent?.(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const analysis = document.querySelector("#watchlist-analysis");
      const text = String(analysis?.textContent || "");
      const metrics = analysis?.querySelectorAll(".watch-metric").length || 0;
      const details = analysis?.querySelectorAll(".watch-detail-section-card").length || 0;
      const notes = analysis?.querySelectorAll(".watch-note-row article").length || 0;
      const featurePills = analysis?.querySelectorAll(".watch-feature-pill").length || 0;
      const status = String(document.querySelector("#watchlist-entry-status")?.textContent || "");
      let rows = [];
      try { rows = JSON.parse(localStorage.getItem("fuman_watchlist") || "[]"); } catch {}
      const countText = String(document.querySelector("#watchlist-count")?.textContent || "").trim();
      return {
        ok: Boolean(card)
          && rows.length === 10
          && /^10(?:\/10)?$/.test(countText)
          && text.includes("1101")
          && metrics >= 4
          && details >= 5
          && notes >= 3
          && featurePills >= 6
          && !/尚未同步/.test(status),
        count: countText,
        text: text.slice(0, 200),
        metrics,
        details,
        notes,
        featurePills,
        status,
      };
    }, null, 15000, 300);
    const clicked = await evaluate(cdp, () => {
      const target = document.querySelector('.watchlist-card[data-code="1101"]') || document.querySelector(".watchlist-card[data-code]") || document.querySelector(".desktop-route-shell tbody tr");
      target?.dispatchEvent?.(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return Boolean(target);
    }).catch(() => false);
    if (!clicked) await sleep(800);
    await sleep(800);
  }
}

async function screenshot(cdp, filename) {
  if (NO_SCREENSHOTS) return "";
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true }, 30000);
  const file = path.join(SCREENSHOT_DIR, filename);
  await fs.writeFile(file, Buffer.from(result.data, "base64"));
  return file;
}

function collectDesktopStats(route) {
  const visible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && style.display !== "none" && style.visibility !== "hidden";
  };
  const text = (el) => String(el?.textContent || "").replace(/\s+/g, " ").trim();
  const activePanel = [...document.querySelectorAll(".view-panel")].find((el) => el.classList.contains("active") && !el.hidden) || document.body;
  if (route.key === "market-ai" && activePanel.id === "market-view" && !activePanel.classList.contains("market-ai-mode")) {
    if (typeof window.FUMAN_SELECT_MARKET_DESKTOP_MODE === "function") {
      window.FUMAN_SELECT_MARKET_DESKTOP_MODE("ai", "ui-e2e-stats-guard");
    } else {
      activePanel.querySelector(".market-mode-tabs [data-market-mode=\"ai\"]")?.click?.();
    }
  }
  const activeRouteKey = document.documentElement.dataset.fumanDesktopActiveRoute || window.__fumanDesktopActiveRoute?.key || "";
  const activeNav = document.querySelector("[data-view].active,[data-view][aria-current='page']");
  const routeIdentityOk = (!route.expectedPanelId || activePanel.id === route.expectedPanelId)
    && (!route.expectedRouteKey || activeRouteKey === route.expectedRouteKey);
  const panelText = text(activePanel).slice(0, 16000);
  const rowSelectors = [
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
  const emptyPattern = /等待資料載入|尚未產生|目前沒有符合|更新策略資料中|載入全台股|等待最新 complete run|權證快照尚未建立/;
  const domRows = [];
  for (const selector of rowSelectors) {
    for (const el of activePanel.querySelectorAll(selector)) {
      const rowText = text(el);
      if (!visible(el) || !rowText || emptyPattern.test(rowText)) continue;
      domRows.push({ selector, text: rowText.slice(0, 180) });
    }
  }
  const canvas = activePanel.querySelector("canvas.desktop-route-canvas, canvas");
  let canvasPixelDiversity = 0;
  let canvasSize = null;
  if (canvas?.getContext && canvas.width && canvas.height) {
    canvasSize = { width: canvas.width, height: canvas.height };
    const ctx = canvas.getContext("2d");
    const colors = new Set();
    const stepX = Math.max(1, Math.floor(canvas.width / 28));
    const stepY = Math.max(1, Math.floor(canvas.height / 18));
    for (let y = 0; y < canvas.height; y += stepY) {
      for (let x = 0; x < canvas.width; x += stepX) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        if (d[3] > 0) colors.add(`${d[0] >> 4},${d[1] >> 4},${d[2] >> 4},${d[3] >> 4}`);
      }
    }
    canvasPixelDiversity = colors.size;
  }
  const canvasCountText = text(activePanel.querySelector(".desktop-canvas-count"));
  const countMatch = canvasCountText.match(/(\d+)\s*\/\s*(\d+)/) || canvasCountText.match(/(\d+)\s*筆/);
  const canvasRows = countMatch ? Number(countMatch[1]) || 0 : 0;
  const filterCounts = [...activePanel.querySelectorAll("[data-chip-canvas-filter] b,[data-strategy4-signal-filter] b,[data-warrant-flow-tab] b,[data-market-ai-filter] b")]
    .map((el) => Number(text(el).replace(/\D/g, "")) || 0)
    .filter((value) => value > 0);
  const marketAiDashboard = route.key === "market-ai" ? (() => {
    const filterButtons = [...activePanel.querySelectorAll("[data-market-ai-filter]")];
    const labels = filterButtons.map((button) => text(button).replace(/\s+\d+$/, "").trim());
    const clicked = [];
    filterButtons.forEach((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      clicked.push({ key: button.dataset.marketAiFilter || "", active: button.classList.contains("active") });
    });
    const overflow = Math.max(0, Math.ceil((document.documentElement.scrollWidth || document.body.scrollWidth || 0) - window.innerWidth));
    return {
      heroBoard: visible(activePanel.querySelector(".market-ai-hero-board")),
      metricCards: [...activePanel.querySelectorAll(".market-ai-hero-metrics > span")].filter(visible).length,
      keyCards: [...activePanel.querySelectorAll(".market-ai-summary .market-ai-card")].filter(visible).length,
      evidenceCards: [...activePanel.querySelectorAll(".market-ai-evidence article")].filter(visible).length,
      filters: labels,
      clicked,
      stockRows: [...activePanel.querySelectorAll(".market-ai-stock-row")].filter(visible).length,
      horizontalOverflow: overflow,
    };
  })() : null;
  const marketOverviewContract = route.key === "heatmap" || route.key === "market" ? (() => {
    const metricCards = [...activePanel.querySelectorAll(".metric-grid .metric-card")].filter(visible);
    const sectorCards = [...activePanel.querySelectorAll(".sector-section .sector-card")].filter(visible);
    const aiPanel = activePanel.querySelector("[data-market-api-ai],.market-ai-panel");
    const ticker = activePanel.querySelector(".ticker-strip");
    const strength = activePanel.querySelector(".strength-panel");
    return {
      metricCards: metricCards.length,
      firstMetricText: text(metricCards[0]).slice(0, 80),
      sectorCards: sectorCards.length,
      aiVisible: visible(aiPanel),
      tickerVisible: visible(ticker),
      strengthVisible: visible(strength),
    };
  })() : null;
  const blockerMatches = [...panelText.matchAll(/(?:HTTP\s*503|timeout|fallback|static\s*json|Google Sheet|fuman-terminal-sync|資料載入失敗|讀取失敗|載入失敗|買賣超模組載入失敗|權證資料檔讀取失敗|手機 API fragment 暫時無法取得|等待資料載入|尚未產生 CB|權證快照尚未建立|更新策略資料中)/gi)].map((match) => match[0]);
  const freshnessText = [
    text(activePanel.querySelector(".data-freshness-bar")),
    text(activePanel.querySelector(".refresh-line")),
    text(activePanel.querySelector(".desktop-canvas-status")),
  ].filter(Boolean).join(" | ");
  const emptyStateText = text(activePanel.querySelector("[data-canvas-empty-note]:not([hidden])"));
  const waitingEmptyOk = Boolean(route.allowWaitingEmpty && emptyStateText && /等待|受控|decision|futopt|ready|snapshot/i.test(emptyStateText));
  const dateSignals = [...`${freshnessText} ${panelText}`.matchAll(/(?:20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}|20\d{6}|\d{1,2}[\/.]\d{1,2}\s+\d{2}:\d{2}|runId|run-|fresh|complete|更新|掃描|資料日期|今日)/gi)].slice(0, 12).map((match) => match[0]);
  const rowsVisible = Math.max(domRows.length, canvasRows);
  const softEmptyPattern = /等待資料載入|尚未產生 CB|權證快照尚未建立|更新策略資料中/;
  const hardBlockers = rowsVisible > 0 ? blockerMatches.filter((match) => !softEmptyPattern.test(match)) : blockerMatches;
  const requiredText = Array.isArray(route.requiredText) ? route.requiredText : [];
  const missingRequiredText = requiredText.filter((needle) => !panelText.includes(needle));
  const fieldSignals = {
    codeName: /(?:\b\d{4}\b\s*[\u4e00-\u9fffA-Za-z]{1,}|(?:股票|代號|標的|權證|CB).{0,42}(?:[\u4e00-\u9fff]{2,}|名稱))/.test(panelText),
    runOrDate: dateSignals.length > 0,
    sourceFreshness: /(?:來源|API|Supabase|fresh|complete|更新|掃描|資料)/i.test(panelText),
    reasonScoreActionRisk: /(?:原因|判斷|訊號|分數|排序|進場|觀察|風險|操作|建議|熱度|型態|雷達|CBAS|門檻|轉換|溢價|強|弱|自選股|分析|快照)/.test(panelText),
  };
  const warnings = [];
  if (!routeIdentityOk) {
    warnings.push(`route identity mismatch: panel=${activePanel.id || ""}/${route.expectedPanelId || ""}, route=${activeRouteKey}/${route.expectedRouteKey || ""}`);
  }
  if (waitingEmptyOk) warnings.push(`controlled waiting state: ${emptyStateText.slice(0, 90)}`);
  if (!dateSignals.length) warnings.push("freshness/date/run signal not visible enough");
  if (missingRequiredText.length) warnings.push(`missing required visible text: ${missingRequiredText.join(", ")}`);
  if (!rowsVisible && filterCounts.length) warnings.push("route has populated subfilters but default view has no rows");
  if (rowsVisible > 0 && hardBlockers.length !== blockerMatches.length) warnings.push("ignored hidden/soft empty-state text because rows are visible");
  const requiredFieldSignals = Array.isArray(route.requiredFieldSignals)
    ? route.requiredFieldSignals
    : ["codeName", "runOrDate", "sourceFreshness", "reasonScoreActionRisk"];
  const fieldBlockers = rowsVisible > 0
    ? requiredFieldSignals.filter((key) => !fieldSignals[key]).map((key) => `visible field signal missing: ${key}`)
    : [];
  const contractBlockers = [];
  if (route.key === "watchlist") {
    const bridgeReady = /^20260628-0[3-9]/.test(String(window.__fumanWatchlistAddBridge || ""));
    const shellReady = Boolean(window.FUMAN_WATCHLIST_SHELL_INSTANCE || window.FUMAN_WATCHLIST_SHELL_MODULE);
    const containerReady = Boolean(activePanel.querySelector("#watchlist-stocks"));
    const cards = [...activePanel.querySelectorAll(".watchlist-card[data-code]")];
    const cardCodes = cards.map((card) => card.dataset.code || "").filter(Boolean);
    const selectedCard = activePanel.querySelector(".watchlist-card.selected[data-code]") || cards[0];
    const analysis = activePanel.querySelector("#watchlist-analysis");
    const analysisText = text(analysis);
    const countText = text(activePanel.querySelector("#watchlist-count"));
    const featurePills = analysis?.querySelectorAll(".watch-feature-pill").length || 0;
    const metrics = analysis?.querySelectorAll(".watch-metric").length || 0;
    const details = analysis?.querySelectorAll(".watch-detail-section-card").length || 0;
    const notes = analysis?.querySelectorAll(".watch-note-row article").length || 0;
    const actionControls = analysis?.querySelectorAll(".watch-action-row input,.watch-action-row button").length || 0;
    const input = activePanel.querySelector("#watchlist-search-input");
    const add = activePanel.querySelector("#watchlist-add-btn");
    const status = text(activePanel.querySelector("#watchlist-entry-status"));
    if (!bridgeReady) warnings.push(`watchlist add bridge not detected actual=${window.__fumanWatchlistAddBridge || "<missing>"}`);
    if (!shellReady) contractBlockers.push("watchlist rich shell not ready");
    if (!containerReady) contractBlockers.push("watchlist card container missing");
    if (cards.length !== 10) contractBlockers.push(`watchlist must finish at 10 cards actual=${cards.length}`);
    if (new Set(cardCodes).size !== cardCodes.length) contractBlockers.push(`watchlist card codes must be unique actual=${cardCodes.join(",")}`);
    if (!/^10(?:\/10)?$/.test(countText)) contractBlockers.push(`watchlist count must be 10 or 10/10 actual=${countText || "<missing>"}`);
    if (!selectedCard?.dataset?.code || !analysisText.includes(selectedCard.dataset.code)) {
      contractBlockers.push(`watchlist analysis must match selected card actual=${selectedCard?.dataset?.code || "<missing>"}`);
    }
    if (featurePills < 6) contractBlockers.push(`watchlist feature pills below 6 actual=${featurePills}`);
    if (metrics < 4) contractBlockers.push(`watchlist summary metrics below 4 actual=${metrics}`);
    if (details < 5) contractBlockers.push(`watchlist detail cards below 5 actual=${details}`);
    if (notes < 3) contractBlockers.push(`watchlist AI note rows below 3 actual=${notes}`);
    if (actionControls < 3) contractBlockers.push(`watchlist analysis action controls below 3 actual=${actionControls}`);
    if (/尚未同步/.test(status)) contractBlockers.push(`watchlist status still shows unsynced: ${status}`);
  }
  const marketAiBlockers = [];
  const marketOverviewBlockers = [];
  if (route.key === "heatmap" || route.key === "market") {
    if ((marketOverviewContract?.metricCards || 0) !== 1) marketOverviewBlockers.push(`market overview metric cards must be 1 actual=${marketOverviewContract?.metricCards || 0}`);
    if (!/加權/.test(marketOverviewContract?.firstMetricText || "")) marketOverviewBlockers.push(`market overview first metric must be weighted index actual=${marketOverviewContract?.firstMetricText || "<missing>"}`);
    if ((marketOverviewContract?.sectorCards || 0) < 8) marketOverviewBlockers.push(`market overview heatmap sector cards ${marketOverviewContract?.sectorCards || 0}<8`);
    if (marketOverviewContract?.aiVisible) marketOverviewBlockers.push("market overview must not show AI dashboard");
    if (marketOverviewContract?.tickerVisible) marketOverviewBlockers.push("market overview must not show ticker strip");
    if (marketOverviewContract?.strengthVisible) marketOverviewBlockers.push("market overview must not show strength panel");
  }
  if (route.key === "market-ai") {
    const requiredFilters = ["全部", "動能強", "法人買超", "當沖熱", "風險高"];
    if (!marketAiDashboard?.heroBoard) marketAiBlockers.push("market AI hero board missing");
    if ((marketAiDashboard?.metricCards || 0) < 4) marketAiBlockers.push(`market AI metric cards ${marketAiDashboard?.metricCards || 0}<4`);
    if ((marketAiDashboard?.keyCards || 0) < 3) marketAiBlockers.push(`market AI key cards ${marketAiDashboard?.keyCards || 0}<3`);
    if ((marketAiDashboard?.evidenceCards || 0) < 4) marketAiBlockers.push(`market AI evidence cards ${marketAiDashboard?.evidenceCards || 0}<4`);
    for (const label of requiredFilters) {
      if (!marketAiDashboard?.filters?.some((item) => item.includes(label))) marketAiBlockers.push(`market AI filter missing ${label}`);
    }
    if (!marketAiDashboard?.clicked?.every((item) => item.active)) marketAiBlockers.push("market AI capsule filter click did not activate every tab");
    if ((marketAiDashboard?.horizontalOverflow || 0) > 8) marketAiBlockers.push(`market AI desktop horizontal overflow ${marketAiDashboard.horizontalOverflow}px`);
  }
  const blockers = [...new Set([...hardBlockers, ...fieldBlockers, ...contractBlockers, ...marketOverviewBlockers, ...marketAiBlockers])];
  return {
    kind: "desktop",
    routeKey: route.key,
    label: route.label,
    activePanelId: activePanel.id || "",
    activeRouteKey,
    activeNavView: activeNav?.dataset?.view || "",
    routeIdentityOk,
    expectedPanelId: route.expectedPanelId || "",
    expectedRouteKey: route.expectedRouteKey || "",
    routeHeader: text(activePanel.querySelector(".desktop-route-shell-head h2")) || text(activePanel.querySelector("h1,h2,h3")),
    rowsVisible,
    domRows: domRows.length,
    canvasRows,
    canvasCountText,
    canvasPixelDiversity,
    canvasSize,
    sampleRows: domRows.slice(0, 3),
    filterCounts,
    freshnessText,
    emptyStateText,
    waitingEmptyOk,
    dateSignals,
    fieldSignals,
    marketAiDashboard,
    marketOverviewContract,
    missingRequiredText,
    blockerMatches: blockers,
    warnings,
    ok: routeIdentityOk && (rowsVisible > 0 || waitingEmptyOk) && blockers.length === 0 && missingRequiredText.length === 0,
  };
}

function collectMobileStats(route) {
  const text = (el) => String(el?.textContent || "").replace(/\s+/g, " ").trim();
  const content = document.querySelector("#content");
  const status = document.querySelector("#status");
  const root = content?.querySelector("[data-mobile-terminal-fragment]") || content?.firstElementChild || content;
  const rows = [...content.querySelectorAll(".mobile-terminal-row,.market-ai-stock-row,.watch-row,article")]
    .map((el) => text(el))
    .filter((value) => value && !/等待資料|讀取中|載入中/.test(value));
  const panelText = text(content).slice(0, 16000);
  const blockerMatches = [...panelText.matchAll(/(?:HTTP\s*503|timeout|fallback|static\s*json|Google Sheet|fuman-terminal-sync|暫時無法取得|讀取失敗|載入失敗|等待資料|讀取中|載入中|未知分頁|沒有資料)/gi)].map((match) => match[0]);
  const rootKey = root?.dataset?.mobileFragmentKey || "";
  const runId = root?.dataset?.runId || "";
  const statusText = text(status);
  const dateSignals = [...`${statusText} ${panelText}`.matchAll(/(?:20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}|20\d{6}|\d{2}:\d{2}|runId|run-|fresh|stale|expired|更新|掃描|資料)/gi)].slice(0, 12).map((match) => match[0]);
  const shell = document.querySelector(".shell");
  const tabs = document.querySelector("#tabs");
  const hero = document.querySelector("#hero");
  const card = content?.querySelector(".mobile-terminal-head,.mobile-terminal-row,.market-ai-stock-row,.market-ai-block,.watch-row");
  const bodyStyle = getComputedStyle(document.body);
  const shellStyle = shell ? getComputedStyle(shell) : null;
  const tabsStyle = tabs ? getComputedStyle(tabs) : null;
  const heroStyle = hero ? getComputedStyle(hero) : null;
  const cardStyle = card ? getComputedStyle(card) : null;
  const shellRect = shell?.getBoundingClientRect?.() || { width: 0, height: 0, left: 0, right: 0 };
  const heroRect = hero?.getBoundingClientRect?.() || { width: 0, height: 0 };
  const scrollWidth = Math.max(document.documentElement.scrollWidth || 0, document.body.scrollWidth || 0);
  const horizontalOverflow = Math.max(0, Math.ceil(scrollWidth - window.innerWidth));
  const layout = {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    orientation: document.documentElement.dataset.orientation || "",
    bodyBackground: bodyStyle.backgroundColor || "",
    bodyFont: bodyStyle.fontFamily || "",
    shellWidth: Math.round(shellRect.width || 0),
    shellMaxWidth: shellStyle?.maxWidth || "",
    tabsDisplay: tabsStyle?.display || "",
    tabsFlexWrap: tabsStyle?.flexWrap || "",
    heroBorder: heroStyle?.borderTopStyle || "",
    heroWidth: Math.round(heroRect.width || 0),
    cardBorder: cardStyle?.borderTopStyle || "",
    horizontalOverflow,
  };
  const layoutBlockers = [];
  const contractBlockers = [];
  const actionText = [...document.querySelectorAll(".actions a,.actions button")].map((el) => text(el)).join(" ");
  const actionHref = [...document.querySelectorAll(".actions a")].map((el) => el.getAttribute("href") || "").join(" ");
  if (!shell || !tabs || !hero) layoutBlockers.push("mobile shell missing core layout nodes");
  if (/終端/.test(actionText) || (actionHref && /(?:^|\/)(?:index\.html)?(?:\?|#|$)/.test(actionHref))) {
    layoutBlockers.push("mobile shell must not expose desktop terminal action");
  }
  if (/Times New Roman/i.test(layout.bodyFont) || /(^|,\s*)serif(\s*,|$)/i.test(layout.bodyFont)) {
    layoutBlockers.push(`mobile CSS not applied: font=${layout.bodyFont}`);
  }
  if (!layout.bodyBackground || layout.bodyBackground === "rgba(0, 0, 0, 0)" || layout.bodyBackground === "rgb(255, 255, 255)") {
    layoutBlockers.push(`mobile CSS not applied: background=${layout.bodyBackground || "<missing>"}`);
  }
  if (layout.tabsDisplay !== "flex") layoutBlockers.push(`mobile tabs must be flex actual=${layout.tabsDisplay || "<missing>"}`);
  if (layout.heroBorder === "none" || !layout.heroBorder) layoutBlockers.push("mobile hero card border is missing");
  if (card && (layout.cardBorder === "none" || !layout.cardBorder)) layoutBlockers.push("mobile data card border is missing");
  if (layout.shellWidth <= 0) layoutBlockers.push("mobile shell width is zero");
  if (layout.shellWidth > Math.min(window.innerWidth, 860)) layoutBlockers.push(`mobile shell is too wide actual=${layout.shellWidth} viewport=${window.innerWidth}`);
  if (horizontalOverflow > 8) layoutBlockers.push(`mobile page has horizontal overflow ${horizontalOverflow}px`);
  if (route.fragment === "watch") {
    const watchRows = [...content.querySelectorAll(".watch-row")];
    const removeButtons = [...content.querySelectorAll("[data-watch-remove]")];
    const watchCodes = watchRows.map((row) => text(row).match(/\b\d{4}\b/)?.[0] || "").filter(Boolean);
    const storageCodes = ["fuman_watchlist", "fuman_mobile_watchlist_v1"].map((key) => {
      try {
        const rows = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(rows) ? rows.map((item) => String(item?.code || "")).filter(Boolean) : [];
      } catch {
        return [];
      }
    });
    const statusTextForWatch = statusText || panelText;
    if (watchRows.length !== 10) contractBlockers.push(`mobile watch tab must render exactly 10 watch rows actual=${watchRows.length}`);
    if (new Set(watchCodes).size !== watchCodes.length) contractBlockers.push(`mobile watch codes must be unique actual=${watchCodes.join(",")}`);
    if (!watchCodes.includes("2334")) contractBlockers.push(`mobile watch seeded code 2334 missing actual=${watchCodes.join(",")}`);
    if (watchCodes.includes("8112") || watchCodes.includes("2408")) contractBlockers.push(`mobile watch rendered rows past 10-code cap actual=${watchCodes.join(",")}`);
    storageCodes.forEach((codes, index) => {
      const key = index === 0 ? "fuman_watchlist" : "fuman_mobile_watchlist_v1";
      if (codes.length !== 10) contractBlockers.push(`mobile watch storage ${key} must be capped at 10 actual=${codes.length}`);
      if (!codes.includes("2334")) contractBlockers.push(`mobile watch storage ${key} missing 2334 actual=${codes.join(",")}`);
      if (codes.includes("8112") || codes.includes("2408")) contractBlockers.push(`mobile watch storage ${key} kept rows past cap actual=${codes.join(",")}`);
    });
    if (removeButtons.length < watchRows.length) contractBlockers.push(`mobile watch tab remove buttons missing rows=${watchRows.length} buttons=${removeButtons.length}`);
    if (!/自選\s+10/.test(statusTextForWatch)) contractBlockers.push(`mobile watch status must show self-selected count 10 actual=${statusTextForWatch || "<missing>"}`);
  }
  const mobileAiDashboard = route.fragment === "ai" ? (() => {
    const filters = [...content.querySelectorAll("[data-market-ai-filter]")];
    const clicked = [];
    filters.forEach((button) => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const key = button.dataset.marketAiFilter || "";
      const list = content.querySelector(`[data-market-ai-mobile-list="${key}"]`);
      clicked.push({ key, active: button.classList.contains("active"), visibleList: Boolean(list && !list.hidden) });
    });
    return {
      root: Boolean(content?.querySelector(".mobile-ai-fragment[data-mobile-ai-fragment='1']")),
      cards: [...content.querySelectorAll(".market-ai-card")].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && getComputedStyle(el).display !== "none";
      }).length,
      blocks: content.querySelectorAll(".market-ai-block").length,
      stockRows: content.querySelectorAll(".market-ai-stock-row").length,
      filters: filters.map((el) => text(el)),
      clicked,
    };
  })() : null;
  if (route.fragment === "ai") {
    if (!mobileAiDashboard.root) layoutBlockers.push("mobile AI fragment must come from API fragment root");
    if (mobileAiDashboard.cards < 4) layoutBlockers.push(`mobile AI cards ${mobileAiDashboard.cards}<4`);
    if (mobileAiDashboard.blocks < 4) layoutBlockers.push(`mobile AI blocks ${mobileAiDashboard.blocks}<4`);
    if (mobileAiDashboard.stockRows < 1) layoutBlockers.push("mobile AI stock rows missing");
    for (const label of ["全部", "動能強", "法人買超", "當沖熱", "風險高"]) {
      if (!mobileAiDashboard.filters.some((item) => item.includes(label))) layoutBlockers.push(`mobile AI filter missing ${label}`);
    }
    if (!mobileAiDashboard.clicked.every((item) => item.active && item.visibleList)) layoutBlockers.push("mobile AI capsule filter click did not reveal every list");
  }
  const keyOk = route.fragment === "watch" || rootKey === route.fragment;
  const warnings = [];
  if (!dateSignals.length && !route.allowEmpty) warnings.push("freshness/date/run signal not visible enough");
  const blockers = [...new Set([...blockerMatches, ...layoutBlockers, ...contractBlockers])];
  return {
    kind: "mobile",
    routeKey: route.key,
    label: route.label,
    fragment: route.fragment,
    activeButtons: [...document.querySelectorAll("#tabs button.active")].map((el) => text(el)),
    rootKey,
    runId,
    rowsVisible: rows.length,
    sampleRows: rows.slice(0, 3),
    statusText,
    dateSignals,
    layout,
    mobileAiDashboard,
    layoutBlockers,
    blockerMatches: blockers,
    warnings,
    ok: keyOk
      && (route.allowEmpty || rows.length > 0)
      && (route.allowEmpty || route.allowMissingRunId || route.fragment === "ai" || Boolean(runId))
      && blockers.length === 0,
  };
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function outerHtml(cdp, selector = "body") {
  const nodeId = await querySelectorNodeId(cdp, selector, 10000);
  const { outerHTML } = await cdp.send("DOM.getOuterHTML", { nodeId }, 15000);
  return outerHTML || "";
}

async function fallbackDesktopStats(cdp, route, error) {
  const html = await outerHtml(cdp, "body").catch(() => "");
  const panelText = htmlToText(html).slice(0, 16000);
  const rowMatches = html.match(/class="[^"]*(?:metric-card|sector-card|market-ai-stock-row|radar-signal-card|radar-leader-card|strategy-row|strategy5-stock-card|intraday-table|swing-table|warrant-flow-card|mobile-terminal-row)[^"]*"/gi) || [];
  const countMatch = panelText.match(/(\d+)\s*\/\s*(\d+)/) || panelText.match(/(\d+)\s*筆/);
  const rowsVisible = Math.max(rowMatches.length, countMatch ? Number(countMatch[1]) || 0 : 0);
  const blockerMatches = [...panelText.matchAll(/(?:HTTP\s*503|timeout|fallback|static\s*json|Google Sheet|fuman-terminal-sync|資料載入失敗|讀取失敗|載入失敗|等待資料載入|尚未產生 CB|權證快照尚未建立|更新策略資料中)/gi)].map((match) => match[0]);
  const dateSignals = [...panelText.matchAll(/(?:20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}|20\d{6}|\d{1,2}[\/.]\d{1,2}\s+\d{2}:\d{2}|runId|run-|fresh|complete|更新|掃描|資料日期|今日)/gi)].slice(0, 12).map((match) => match[0]);
  const softEmptyPattern = /等待資料載入|尚未產生 CB|權證快照尚未建立|更新策略資料中/;
  const hardBlockers = rowsVisible > 0 ? blockerMatches.filter((match) => !softEmptyPattern.test(match)) : blockerMatches;
  const routeNeedles = Array.isArray(route.fallbackNeedles) && route.fallbackNeedles.length
    ? route.fallbackNeedles
    : String(route.expectedRouteKey || "").split("|").filter(Boolean);
  const routeTextOk = routeNeedles.length
    ? routeNeedles.some((needle) => panelText.includes(needle))
    : true;
  return {
    kind: "desktop",
    routeKey: route.key,
    label: route.label,
    routeIdentityOk: routeTextOk,
    expectedPanelId: route.expectedPanelId || "",
    expectedRouteKey: route.expectedRouteKey || "",
    rowsVisible,
    domRows: rowMatches.length,
    canvasRows: countMatch ? Number(countMatch[1]) || 0 : 0,
    canvasCountText: countMatch ? countMatch[0] : "",
    canvasPixelDiversity: 0,
    sampleRows: [],
    filterCounts: [],
    freshnessText: dateSignals.slice(0, 5).join(" / "),
    dateSignals,
    blockerMatches: [...new Set(hardBlockers)],
    warnings: [
      `Runtime stats fallback: ${error.message}`,
      routeTextOk ? "route identity inferred from visible page text in fallback stats" : "route identity unavailable in fallback stats",
      ...(rowsVisible > 0 && hardBlockers.length !== blockerMatches.length ? ["ignored hidden/soft empty-state text because rows are visible"] : []),
    ],
    ok: routeTextOk && rowsVisible > 0 && hardBlockers.length === 0,
  };
}

async function fallbackMobileStats(cdp, route, error) {
  const html = await outerHtml(cdp, "#content").catch(() => "");
  const panelText = htmlToText(html).slice(0, 16000);
  const rowMatches = html.match(/class="[^"]*(?:mobile-terminal-row|market-ai-stock-row|watch-row)[^"]*"/gi) || [];
  const keyMatch = html.match(/data-mobile-fragment-key="([^"]+)"/);
  const runMatch = html.match(/data-run-id="([^"]*)"/);
  const blockerMatches = [...panelText.matchAll(/(?:HTTP\s*503|timeout|fallback|static\s*json|Google Sheet|fuman-terminal-sync|暫時無法取得|讀取失敗|載入失敗|等待資料|讀取中|載入中|未知分頁|沒有資料)/gi)].map((match) => match[0]);
  const dateSignals = [...panelText.matchAll(/(?:20\d{2}[\/.-]\d{1,2}[\/.-]\d{1,2}|20\d{6}|\d{2}:\d{2}|runId|run-|fresh|stale|expired|更新|掃描|資料)/gi)].slice(0, 12).map((match) => match[0]);
  const rootKey = keyMatch?.[1] || "";
  const runId = runMatch?.[1] || "";
  return {
    kind: "mobile",
    routeKey: route.key,
    label: route.label,
    fragment: route.fragment,
    activeButtons: [],
    rootKey,
    runId,
    rowsVisible: rowMatches.length,
    sampleRows: [],
    statusText: dateSignals.slice(0, 5).join(" / "),
    dateSignals,
    blockerMatches: [...new Set(blockerMatches)],
    warnings: [`Runtime stats fallback: ${error.message}`],
    ok: (route.allowEmpty || rowMatches.length > 0)
      && (route.allowEmpty || route.allowMissingRunId || route.fragment === "ai" || Boolean(runId))
      && blockerMatches.length === 0,
  };
}

async function collectDesktopStatsWhenReady(cdp, route, timeoutMs = 22000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(cdp, collectDesktopStats, route)
      .catch((error) => fallbackDesktopStats(cdp, route, error));
    if (last?.ok && !(last.blockerMatches || []).length) {
      if (route.key === "market-ai") {
        const stability = await collectMarketAiLayoutStability(cdp).catch((error) => ({
          ok: false,
          error: error.message,
          blocker: `market AI layout stability check failed: ${error.message}`,
        }));
        last.marketAiDashboard = { ...(last.marketAiDashboard || {}), stability };
        if (!stability.ok) {
          last.ok = false;
          last.blockerMatches = [...new Set([...(last.blockerMatches || []), stability.blocker || "market AI layout jumped after ready"])];
        }
      }
      if (last.ok && (route.key === "market-ai" || route.key === "heatmap" || route.key === "market")) {
        const finalMode = route.key === "market-ai" ? "ai" : "overview";
        const toggle = await collectMarketModeToggleContract(cdp, finalMode).catch((error) => ({
          ok: false,
          error: error.message,
          blocker: `market mode toggle contract failed: ${error.message}`,
        }));
        last.marketModeToggle = toggle;
        if (!toggle.ok) {
          last.ok = false;
          last.blockerMatches = [...new Set([...(last.blockerMatches || []), toggle.blocker || "market overview/AI mode cannot toggle freely"])];
        }
      }
      if (last.ok && !(last.blockerMatches || []).length) return last;
    }
    await sleep(900);
  }
  return last || { kind: "desktop", routeKey: route.key, label: route.label, ok: false, rowsVisible: 0, blockerMatches: ["desktop stats missing"], warnings: [] };
}

async function collectMarketAiLayoutStability(cdp) {
  return evaluate(cdp, async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rectOf = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        top: Math.round(rect.top * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
      };
    };
    const sample = () => {
      const panel = document.querySelector("#market-view [data-market-api-ai]");
      return {
        at: Date.now(),
        signature: panel?.dataset?.marketAiStableSignature || "",
        panel: rectOf("#market-view [data-market-api-ai]"),
        hero: rectOf("#market-view .market-ai-hero-board"),
        hot: rectOf("#market-view .market-ai-hot"),
        stockRows: document.querySelectorAll("#market-view .market-ai-stock-row").length,
      };
    };
    const samples = [sample()];
    await wait(700);
    samples.push(sample());
    await wait(900);
    samples.push(sample());
    const maxDelta = (selector, field) => {
      const values = samples.map((item) => item?.[selector]?.[field]).filter((value) => Number.isFinite(value));
      if (values.length < 2) return 0;
      return Math.max(...values) - Math.min(...values);
    };
    const panelTopDelta = maxDelta("panel", "top");
    const heroTopDelta = maxDelta("hero", "top");
    const panelHeightDelta = maxDelta("panel", "height");
    const hotHeightDelta = maxDelta("hot", "height");
    const ok = panelTopDelta <= 4 && heroTopDelta <= 4 && panelHeightDelta <= 24 && hotHeightDelta <= 24;
    return {
      ok,
      samples,
      panelTopDelta,
      heroTopDelta,
      panelHeightDelta,
      hotHeightDelta,
      blocker: ok ? "" : `market AI layout jumped top=${panelTopDelta}px hero=${heroTopDelta}px height=${panelHeightDelta}px hot=${hotHeightDelta}px`,
    };
  }, null, 10000);
}

async function collectMarketModeToggleContract(cdp, finalMode = "overview") {
  return evaluate(cdp, async (expectedFinalMode) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const text = (el) => String(el?.textContent || "").replace(/\s+/g, " ").trim();
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden" && el.hidden !== true;
    };
    const market = document.querySelector("#market-view");
    if (!market) return { ok: false, blocker: "market view missing for mode toggle contract", steps: [] };
    const read = (expectedMode, label) => {
      const activeButton = market.querySelector(".market-mode-tabs [data-market-mode].active");
      const aiPanel = market.querySelector("[data-market-api-ai],.market-ai-panel");
      const metricCards = [...market.querySelectorAll(".metric-grid .metric-card")].filter(visible);
      const sectorCards = [...market.querySelectorAll(".sector-section .sector-card")].filter(visible);
      const state = {
        label,
        expectedMode,
        activeButton: activeButton?.dataset?.marketMode || "",
        datasetMode: document.documentElement.dataset.fumanMarketDesktopMode || "",
        className: market.className || "",
        title: text(market.querySelector(".page-header h1")),
        aiVisible: visible(aiPanel),
        heroVisible: visible(market.querySelector(".market-ai-hero-board")),
        metricCards: metricCards.length,
        firstMetricText: text(metricCards[0]).slice(0, 90),
        sectorCards: sectorCards.length,
      };
      state.ok = expectedMode === "ai"
        ? state.activeButton === "ai" && /market-ai-mode/.test(state.className) && state.aiVisible && /AI 判讀/.test(state.title)
        : state.activeButton === "overview" && /market-overview-mode/.test(state.className) && !state.aiVisible && /市場總覽/.test(state.title) && state.metricCards === 1 && /加權/.test(state.firstMetricText) && state.sectorCards >= 8;
      return state;
    };
    const clickMode = async (mode, label) => {
      const button = market.querySelector(`.market-mode-tabs [data-market-mode="${mode}"]`);
      if (!button) return { ok: false, label, expectedMode: mode, blocker: `market mode button missing: ${mode}` };
      button.click();
      await wait(mode === "ai" ? 1200 : 520);
      return read(mode, label);
    };
    const steps = [];
    steps.push(await clickMode("ai", "ai-1"));
    steps.push(await clickMode("overview", "overview-1"));
    steps.push(await clickMode("ai", "ai-2"));
    steps.push(await clickMode("overview", "overview-2"));
    if (expectedFinalMode === "ai") steps.push(await clickMode("ai", "restore-ai"));
    else steps.push(read("overview", "restore-overview"));
    const failed = steps.find((item) => !item.ok);
    return {
      ok: !failed,
      finalMode: expectedFinalMode,
      steps,
      blocker: failed ? `market mode toggle failed at ${failed.label}: active=${failed.activeButton || ""} classes=${failed.className || ""} title=${failed.title || ""}` : "",
    };
  }, finalMode, 15000);
}

async function runDesktopMode(browser, theme) {
  debug(`desktop mode start theme=${theme}`);
  const cdp = await createTab(browser);
  await setViewport(cdp, { width: 1440, height: 1000, mobile: false });
  await navigate(cdp, withCacheBust(`${BASE_URL.replace(/\/+$/, "")}/?desktop=1&theme=${theme === "sun" ? "sun" : "dark"}`));
  debug(`desktop navigated theme=${theme}`);
  await waitForSelector(cdp, "aside.sidebar [data-view]", 45000);
  await sleep(1200);
  const results = [];
  for (const route of DESKTOP_ROUTES.filter((item) => (!SKIP_WATCHLIST || item.key !== "watchlist") && (!ROUTE_FILTER.size || ROUTE_FILTER.has(item.key)))) {
    let stats = null;
    try {
      stats = await withTimeout((async () => {
        await prepareDesktopRoute(cdp, route);
        await activateDesktopRoute(cdp, route);
        await afterDesktopRouteActivate(cdp, route);
        await sleep(["institution", "cb", "warrant"].includes(route.key) ? 5200 : 3200);
        return collectDesktopStatsWhenReady(cdp, route);
      })(), ROUTE_TIMEOUT_MS, `desktop/${theme}/${route.key}`);
    } catch (error) {
      stats = { kind: "desktop", routeKey: route.key, label: route.label, ok: false, rowsVisible: 0, blockerMatches: [error.message], warnings: [] };
    }
    stats.theme = theme;
    stats.screenshot = await withTimeout(
      screenshot(cdp, `desktop-${theme}-${route.key}.png`),
      Math.min(ROUTE_TIMEOUT_MS, 30000),
      `desktop/${theme}/${route.key}/screenshot`,
    ).catch((error) => `screenshot failed: ${error.message}`);
    console.log(`[terminal-ui-e2e] ${stats.ok ? "ok" : "fail"} desktop/${theme}/${route.key} rows=${stats.rowsVisible || 0}`);
    results.push(stats);
  }
  cdp.close();
  return results;
}

async function runMobileMode(browser, theme, viewport = MOBILE_VIEWPORTS["phone-portrait"]) {
  debug(`mobile mode start theme=${theme} viewport=${viewport.key}`);
  const cdp = await createTab(browser);
  await setViewport(cdp, viewport);
  await navigate(cdp, withCacheBust(`${BASE_URL.replace(/\/+$/, "")}/mobile`));
  debug(`mobile navigated theme=${theme} viewport=${viewport.key}`);
  await waitForSelector(cdp, "#tabs button[data-fragment]", 45000);
  await evaluate(cdp, (nextTheme) => {
    localStorage.setItem("fuman_mobile_sun", nextTheme === "sun" ? "1" : "0");
    document.documentElement.dataset.sun = nextTheme === "sun" ? "1" : "0";
    return true;
  }, theme);
  await sleep(1200);
  const results = [];
  for (const route of MOBILE_ROUTES.filter((item) => (!SKIP_WATCHLIST || (item.key !== "watch" && item.fragment !== "watch")) && (!ROUTE_FILTER.size || ROUTE_FILTER.has(item.key) || ROUTE_FILTER.has(item.fragment)))) {
    let stats = null;
    try {
      stats = await withTimeout((async () => {
        await prepareMobileRoute(cdp, route);
        await clickSelector(cdp, `#tabs button[data-fragment="${route.fragment}"]`);
        if (route.fragment !== "watch") {
          await waitFor(cdp, (fragment) => {
            const root = document.querySelector("#content [data-mobile-terminal-fragment]");
            return { ok: root?.dataset?.mobileFragmentKey === fragment };
          }, route.fragment, 18000, 300).catch(() => waitForSelector(cdp, `#content [data-mobile-fragment-key="${route.fragment}"]`, 18000));
        } else {
          await waitFor(cdp, () => {
            const rows = [...document.querySelectorAll("#content .watch-row")];
            const status = String(document.querySelector("#status")?.textContent || "");
            const storageLengths = ["fuman_watchlist", "fuman_mobile_watchlist_v1"].map((key) => {
              try {
                const parsed = JSON.parse(localStorage.getItem(key) || "[]");
                return Array.isArray(parsed) ? parsed.length : -1;
              } catch {
                return -1;
              }
            });
            return {
              ok: rows.length === 10 && storageLengths.every((length) => length === 10) && /自選\s+10/.test(status),
              rows: rows.length,
              storageLengths,
              status,
            };
          }, null, 12000, 250);
        }
        return evaluate(cdp, collectMobileStats, route).catch((error) => fallbackMobileStats(cdp, route, error));
      })(), ROUTE_TIMEOUT_MS, `mobile/${theme}/${route.key}`);
    } catch (error) {
      stats = { kind: "mobile", routeKey: route.key, label: route.label, fragment: route.fragment, ok: false, rowsVisible: 0, blockerMatches: [error.message], warnings: [] };
    }
    stats.theme = theme;
    stats.viewportKey = viewport.key;
    stats.viewportLabel = viewport.label;
    stats.screenshot = await withTimeout(
      screenshot(cdp, `mobile-${viewport.key}-${theme}-${route.key}.png`),
      Math.min(ROUTE_TIMEOUT_MS, 30000),
      `mobile/${viewport.key}/${theme}/${route.key}/screenshot`,
    ).catch((error) => `screenshot failed: ${error.message}`);
    console.log(`[terminal-ui-e2e] ${stats.ok ? "ok" : "fail"} mobile/${viewport.key}/${theme}/${route.key} rows=${stats.rowsVisible || 0}`);
    results.push(stats);
  }
  cdp.close();
  return results;
}

function markdownReport(report) {
  const lines = [];
  lines.push("# Terminal UI E2E Report");
  lines.push("");
  lines.push(`- Base URL: ${report.baseUrl}`);
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Overall: ${report.ok ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push("| Surface | Viewport | Theme | Route | Rows | Freshness / status | Result | Notes |");
  lines.push("|---|---|---:|---|---:|---|---|---|");
  for (const item of report.results) {
    const notes = [...(item.blockerMatches || []), ...(item.warnings || [])].join("; ");
    lines.push(`| ${item.kind} | ${item.viewportKey || "-"} | ${item.theme} | ${item.routeKey} | ${item.rowsVisible || 0} | ${(item.freshnessText || item.statusText || "").replace(/\|/g, "/").slice(0, 90)} | ${item.ok ? "PASS" : "FAIL"} | ${notes.replace(/\|/g, "/").slice(0, 120)} |`);
  }
  lines.push("");
  lines.push("## Screenshots");
  for (const item of report.results) {
    if (item.screenshot && !String(item.screenshot).startsWith("screenshot failed")) {
      lines.push(`- ${item.kind} ${item.theme} ${item.routeKey}: ${item.screenshot}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const browser = await launchBrowser();
  const results = [];
  try {
    if (RUN_ONLY.has("desktop-night")) results.push(...await runDesktopMode(browser, "night"));
    if (RUN_ONLY.has("desktop-sun")) results.push(...await runDesktopMode(browser, "sun"));
    const mobileExecuted = new Set();
    for (const spec of MOBILE_RUNS) {
      if (!RUN_ONLY.has(spec.flag)) continue;
      const key = `${spec.viewport.key}:${spec.theme}`;
      if (mobileExecuted.has(key)) continue;
      mobileExecuted.add(key);
      results.push(...await runMobileMode(browser, spec.theme, spec.viewport));
    }
  } finally {
    if (!KEEP_BROWSER) {
      try { browser.child.kill(); } catch {}
      await fs.rm(browser.userDataDir, { recursive: true, force: true }).catch(() => null);
    }
  }
  const report = {
    ok: results.every((item) => item.ok),
    baseUrl: BASE_URL.replace(/\/+$/, ""),
    generatedAt: new Date().toISOString(),
    results,
  };
  await fs.writeFile(path.join(OUT_DIR, "terminal-ui-e2e-report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT_DIR, "terminal-ui-e2e-report.md"), markdownReport(report));
  const failed = results.filter((item) => !item.ok);
  for (const item of results) {
    console.log(`[terminal-ui-e2e] ${item.ok ? "ok" : "fail"} ${item.kind}/${item.theme}/${item.routeKey} rows=${item.rowsVisible || 0}`);
  }
  if (failed.length) {
    console.error(`[terminal-ui-e2e] failed ${failed.length}/${results.length}`);
    process.exit(1);
  }
  console.log(`[terminal-ui-e2e] ok ${results.length}/${results.length}`);
}

main().catch((error) => {
  console.error(`[terminal-ui-e2e] failed: ${error?.stack || error}`);
  process.exit(1);
});
