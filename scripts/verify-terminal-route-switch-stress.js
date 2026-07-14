const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const BASE_URL = readArg("base-url", process.env.FUMAN_STRESS_BASE_URL || "https://fuman-terminal.vercel.app");
const CDP_BLANK_URL = "data:text/html,FUMAN_ROUTE_STRESS";
const LOOPS = Math.max(1, Math.min(80, Number(readArg("loops", process.env.FUMAN_STRESS_LOOPS || "3")) || 3));
const ROUTES = readArg("routes", process.env.FUMAN_STRESS_ROUTES || "market-ai,watchlist,strategy2,strategy3,strategy4,strategy5,institution,cb,warrant")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);
const ROUTE_TIMEOUT_MS = Math.max(8000, Math.min(120000, Number(readArg("route-timeout", process.env.FUMAN_STRESS_ROUTE_TIMEOUT_MS || "45000")) || 45000));
const OUT_FILE = path.resolve(ROOT, readArg("out", process.env.FUMAN_STRESS_OUTPUT || "outputs/terminal-route-switch-stress.json"));
const HEADFUL = hasFlag("headful") || process.env.FUMAN_STRESS_HEADFUL === "1";

const ROUTE_CONFIG = {
  market: {
    view: "market",
    selector: 'aside.sidebar a[data-view="market"]',
    panel: "#market-view",
    rows: ".metric-card,.sector-card,.market-overview-card,.market-index-card",
  },
  heatmap: {
    view: "market",
    selector: 'aside.sidebar a[data-view="market"]',
    postClick: '#market-view [data-market-mode="overview"], [data-market-mode="overview"]',
    postClickOptional: true,
    panel: "#market-view",
    rows: "#heatmap > *,.sector-card,.heatmap-sector-card,.market-overview-card,.market-ai-card",
  },
  "market-ai": {
    view: "market",
    selector: 'aside.sidebar a[data-view="market"]',
    postClick: '#market-view [data-market-mode="ai"], [data-market-mode="ai"]',
    panel: "#market-view",
    rows: ".market-ai-stock-row,.market-ai-card,.market-ai-block,.market-ai-hero-board,.market-ai-pick-row",
  },
  "realtime-radar": {
    view: "realtime-radar",
    selector: 'aside.sidebar a.realtime-radar-nav[data-view="realtime-radar"]',
    panel: "#realtime-radar-view",
    rows: ".radar-signal-card,.radar-leader-card,.realtime-radar-card,.radar-row",
    allowEmpty: true,
  },
  strategy2: {
    view: "strategy",
    selector: 'aside.sidebar a[data-view="strategy"] .s2',
    panel: "#strategy-view",
    rows: ".strategy2-terminal-table tbody tr,#strategy-table tbody tr,.strategy-row,.intraday-table tbody tr,.strategy-stock-card",
    requiredText: "策略2",
  },
  strategy3: {
    view: "strategy",
    selector: 'aside.sidebar a[data-view="strategy"] .s3',
    panel: "#strategy-view",
    rows: ".strategy-row,.strategy-stock-card",
  },
  strategy4: {
    view: "strategy",
    selector: 'aside.sidebar a[data-view="strategy"] .s4',
    panel: "#strategy-view",
    rows: ".strategy-row,.swing-table tbody tr,.strategy-stock-card",
  },
  strategy5: {
    view: "strategy",
    selector: 'aside.sidebar a[data-view="strategy"] .s5',
    panel: "#strategy-view",
    rows: ".strategy-row,.strategy5-stock-card,.strategy-stock-card",
  },
  institution: {
    view: "chip-trade",
    selector: 'aside.sidebar a[data-view="chip-trade"]',
    panel: "#chip-trade-view",
    rows: ".chip-trade-row,.chip-trade-card,.strategy-row",
    allowEmpty: true,
  },
  cb: {
    view: "cb-detect",
    selector: 'aside.sidebar a[data-view="cb-detect"]',
    panel: "#cb-detect-view",
    rows: ".cb-detect-card,#cb-detect-list > *:not(.cb-detect-empty)",
  },
  warrant: {
    view: "warrant-flow",
    selector: 'aside.sidebar a[data-view="warrant-flow"]',
    panel: "#warrant-flow-view",
    rows: ".warrant-flow-card,.warrant-row,.strategy-row",
  },
  watchlist: {
    view: "watchlist",
    selector: 'aside.sidebar .watchlist-chip-link[data-view="watchlist"]',
    panel: "#watchlist-view",
    rows: ".watchlist-stock-card,.watchlist-card,.watchlist-row,.watch-row",
    allowEmpty: true,
  },
};

const PROTECTED_ROUTES = new Set([
  "strategy2",
  "strategy3",
  "strategy4",
  "strategy5",
  "chip-trade",
  "institution",
  "cb",
  "warrant",
  "warrant-flow",
  "watchlist",
]);
for (const [key, config] of Object.entries(ROUTE_CONFIG)) {
  if (PROTECTED_ROUTES.has(key)) config.protected = true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome or Edge executable not found. Set CHROME_PATH to run route stress.");
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

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method || "GET",
      timeout: options.timeoutMs || 10000,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${url} HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body || "{}"));
        } catch (error) {
          reject(new Error(`${url} JSON parse failed: ${error.message}`));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`${url} request timed out`)));
    request.on("error", reject);
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

  async connect(timeoutMs = 15000) {
    const WebSocketImpl = global.WebSocket || (await import("ws")).WebSocket;
    this.ws = new WebSocketImpl(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP websocket connect timed out after ${timeoutMs}ms`)), timeoutMs);
      const finish = (fn, value) => {
        clearTimeout(timer);
        fn(value);
      };
      if (typeof this.ws.addEventListener === "function") {
        this.ws.addEventListener("open", () => finish(resolve), { once: true });
        this.ws.addEventListener("error", (error) => finish(reject, error), { once: true });
      } else {
        this.ws.once("open", () => finish(resolve));
        this.ws.once("error", (error) => finish(reject, error));
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
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message || "CDP error"}`));
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
      this.pending.set(id, { method, resolve, reject, timer });
    });
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function launchBrowser() {
  const port = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-route-stress-"));
  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--window-size=1440,1000",
    CDP_BLANK_URL,
  ];
  if (!HEADFUL) {
    chromeArgs.unshift(
      "--headless=chrome",
      "--disable-gpu",
      "--disable-gpu-sandbox",
      "--disable-features=Vulkan,DawnGraphite,DefaultANGLEVulkan,VulkanFromANGLE",
    );
  }
  const browser = childProcess.spawn(findBrowser(), chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  browser.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 1000); });
  let stableHits = 0;
  for (let i = 0; i < 100; i += 1) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      await fetchJson(`http://127.0.0.1:${port}/json/list`);
      stableHits += 1;
      if (version.webSocketDebuggerUrl && stableHits >= 2) return { browser, port, userDataDir, stderr: () => stderr };
    } catch {
      stableHits = 0;
    }
    if (browser.exitCode !== null) throw new Error(`browser exited early: ${stderr}`);
    await sleep(150);
  }
  throw new Error(`Chrome CDP did not start: ${stderr}`);
}

async function createTab(port) {
  let lastError = null;
  for (let targetAttempt = 1; targetAttempt <= 5; targetAttempt += 1) {
    let tab = null;
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`, { timeoutMs: 15000 });
      tab = Array.isArray(list) ? list.find((item) => item.type === "page") : null;
    } catch {
      tab = null;
    }
    if (!tab?.webSocketDebuggerUrl) {
      try {
        tab = await fetchJson(`http://127.0.0.1:${port}/json/new`, { method: "PUT", timeoutMs: 15000 });
      } catch {
        tab = null;
      }
    }
    if (!tab?.webSocketDebuggerUrl) {
      lastError = new Error("CDP page target missing websocket URL");
      await sleep(350);
      continue;
    }
    const cdp = new Cdp(tab.webSocketDebuggerUrl);
    try {
      await cdp.connect();
      const runtimeHandshake = await handshakeRuntime(cdp);
      if (!runtimeHandshake.ok) {
        throw new Error(`Runtime.evaluate handshake failed after ${runtimeHandshake.attempts} attempts: ${runtimeHandshake.error}`);
      }
      await cdp.send("DOM.enable", {}, 10000).catch(() => null);
      await cdp.send("Network.enable", {}, 10000).catch(() => null);
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true }, 10000).catch(() => null);
      await cdp.send("Network.setBypassServiceWorker", { bypass: true }, 10000).catch(() => null);
      const pageEnable = await cdp.send("Page.enable", {}, 5000).then(() => ({ ok: true })).catch((error) => ({ ok: false, error: error.message }));
      return { cdp, pageEnable, runtimeHandshake: { ...runtimeHandshake, targetAttempt } };
    } catch (error) {
      lastError = error;
      cdp.close();
      await sleep(500 + targetAttempt * 250);
    }
  }
  throw lastError || new Error("CDP page target missing websocket URL");
}

async function handshakeRuntime(cdp) {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await cdp.send("Runtime.enable", {}, 12000).catch((error) => {
      lastError = error.message;
    });
    try {
      await cdp.send("Runtime.evaluate", { expression: "1", returnByValue: true }, 15000);
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error.message;
      await sleep(350 * attempt);
    }
  }
  return { ok: false, attempts: 3, error: lastError || "unknown runtime handshake failure" };
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

async function waitFor(cdp, fn, arg = null, timeoutMs = 30000, intervalMs = 150) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await evaluate(cdp, fn, arg, Math.min(8000, timeoutMs)).catch((error) => ({ ok: false, error: error.message }));
    if (last?.ok) return last;
    await sleep(intervalMs);
  }
  throw new Error(`waitFor timeout ${JSON.stringify(last)}`);
}

async function querySelectorNodeId(cdp, selector, timeoutMs = 15000) {
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
  const nodeId = await querySelectorNodeId(cdp, selector, 15000);
  const { model } = await cdp.send("DOM.getBoxModel", { nodeId }, 10000);
  const quad = model?.border || model?.content;
  if (!quad || quad.length < 8) throw new Error(`selector has no box model: ${selector}`);
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const x = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const y = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, 10000);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, 10000);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, 10000);
}

async function clickSelector(cdp, selector) {
  await evaluate(cdp, (sel) => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 2 && rect.height > 2 && style.display !== "none" && style.visibility !== "hidden";
    };
    const el = [...document.querySelectorAll(sel)].find((node) => visible(node.closest?.("a,button,[role=button]") || node));
    const target = el?.closest?.("a,button,[role=button]") || el;
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    return true;
  }, selector, 10000).catch(() => false);
  try {
    await clickSelectorByDom(cdp, selector);
    await sleep(140);
    return;
  } catch {
    // Fall through to DOM click for non-layout test targets.
  }
  const clicked = await evaluate(cdp, (sel) => {
    const el = document.querySelector(sel);
    const target = el?.closest?.("a,button,[role=button]") || el;
    if (!target) return false;
    target.click();
    return true;
  }, selector, 10000).catch(() => false);
  if (!clicked) throw new Error(`click failed ${selector}`);
  await sleep(140);
}

async function activateRoute(cdp, key) {
  const config = ROUTE_CONFIG[key];
  if (!config) throw new Error(`Unknown route ${key}`);
  await clickSelector(cdp, config.selector);
  if (config.protected) {
    const locked = await waitFor(cdp, () => {
      const visible = (node) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
      };
      return {
        ok: document.body.classList.contains("auth-locked") || visible(document.querySelector(".member-lock-overlay")) || visible(document.querySelector("#auth-gate")) || /會員權限|開通權限|登入 \/ 開通權限|membership_required/.test(document.body.textContent || ""),
      };
    }, null, 5000, 120).catch(() => ({ ok: false }));
    if (locked.ok) return { membershipLocked: true };
  }
  await waitFor(cdp, (selector) => {
    const panel = document.querySelector(selector);
    if (!panel) return { ok: false, reason: "panel-missing" };
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    return { ok: rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden" };
  }, config.panel, Math.min(ROUTE_TIMEOUT_MS, 20000), 150);
  if (config.postClick) {
    const postClickReady = await waitFor(cdp, (selector) => {
      const visible = (node) => {
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
      };
      const target = [...document.querySelectorAll(selector)].find((node) => visible(node.closest?.("button,a,[role=button]") || node));
      return {
        ok: Boolean(target),
        reason: target ? "" : "missing-or-hidden",
        modeButtons: [...document.querySelectorAll("[data-market-mode]")].map((button) => ({
          mode: button.dataset.marketMode || "",
          text: String(button.textContent || "").replace(/\s+/g, " ").trim(),
          visible: visible(button),
        })),
      };
    }, config.postClick, Math.min(ROUTE_TIMEOUT_MS, 30000), 150).catch((error) => ({ ok: false, error: error.message }));
    if (!postClickReady.ok && !config.postClickOptional) {
      throw new Error(`postClick not ready ${config.postClick}: ${JSON.stringify(postClickReady)}`);
    }
    if (!postClickReady.ok && config.postClickOptional) return;
    await clickSelector(cdp, config.postClick);
  }
}

function ensureRouteActiveInPage(config) {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
  };
  const panel = document.querySelector(config.panel);
  const linkNode = document.querySelector(config.selector);
  const link = linkNode?.closest?.("a,button,[role=button]") || linkNode;
  const viewName = config.view || String(config.panel || "").replace(/^#/, "").replace(/-view$/, "");
  const actions = [];
  if (!visible(panel)) {
    if (link) {
      link.click();
      actions.push("click-link");
    }
    try {
      if (typeof showView === "function") {
        showView(viewName, link || null);
        actions.push("showView");
      }
    } catch (error) {
      actions.push(`showView-error:${error.message}`);
    }
    if (panel) {
      panel.hidden = false;
      panel.classList.add("active");
      document.querySelectorAll(".view-panel,[id$='-view']").forEach((node) => {
        if (node === panel || !String(node.id || "").endsWith("-view")) return;
        node.classList.remove("active");
        if (node.classList.contains("view-panel")) node.hidden = true;
      });
      actions.push("manual-panel");
    }
  }
  if (config.postClick) {
    const target = [...document.querySelectorAll(config.postClick)]
      .find((node) => visible(node.closest?.("button,a,[role=button]") || node));
    const active = target?.classList?.contains("active") || target?.getAttribute?.("aria-selected") === "true";
    if (target && !active) {
      (target.closest?.("button,a,[role=button]") || target).click();
      actions.push("postClick");
    }
    if (!target && !config.postClickOptional) {
      return { ok: false, actions, reason: "postClick-missing" };
    }
  }
  return { ok: visible(panel), actions, reason: visible(panel) ? "" : "panel-hidden" };
}

function collectRouteStats(config, key) {
  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
  };
  const text = (el) => String(el?.textContent || "").replace(/\s+/g, " ").trim();
  const panel = document.querySelector(config.panel);
  const panelText = text(panel).slice(0, 12000);
  const membershipLocked = Boolean(config.protected)
    && (document.body.classList.contains("auth-locked")
      || visible(document.querySelector(".member-lock-overlay"))
      || visible(document.querySelector("#auth-gate"))
      || /會員權限|開通權限|登入 \/ 開通權限|membership_required/.test(document.body.textContent || ""));
  if (membershipLocked) {
    return {
      route: key,
      ok: true,
      membershipLocked: true,
      rows: 0,
      sampleRows: [],
      modeTabs: document.querySelectorAll("#market-view .market-mode-tabs").length,
      aiPanels: document.querySelectorAll("#market-view .market-ai-dashboard,#market-view [data-market-ai-root],#market-view .market-ai-panel").length,
      activePanel: [...document.querySelectorAll(".content-panel,[id$='-view']")].filter(visible).map((el) => el.id || el.dataset.view || "").filter(Boolean).slice(0, 8),
      panelText: "membership gate active",
      blockers: [],
    };
  }
  const explicitTerminalBlocked = (key === "market-ai" || key === "heatmap") && /正式水源未通過|正式水源 blocked|熱力圖正式水源未通過|不顯示正常判讀|不以 fallback\/壞水源顯示正常盤面|source_quality_fail|api_ok_false|publish=blocked|unattended=NO/i.test(panelText);
  const loadingText = /載入今日正式 AI 判讀資料中|載入最新 AI 判讀資料中|載入今日正式 AI 判讀\/熱力圖資料中|正式熱力圖水源同步中|heatmap cache/i.test(panelText);
  const emptyPattern = /等待資料載入|尚未產生|目前沒有符合|尚未新增自選股|更新策略資料中|載入全台股|等待最新 complete run|權證快照尚未建立|載入今日正式 AI 判讀資料中|載入最新 AI 判讀資料中|載入今日正式 AI 判讀\/熱力圖資料中|正式熱力圖水源同步中/;
  const rows = [...(panel || document).querySelectorAll(config.rows || "article")]
    .map((el) => ({ visible: visible(el), text: text(el) }))
    .filter((row) => row.visible && row.text && !emptyPattern.test(row.text));
  const blockerMatches = [...panelText.matchAll(/(?:HTTP\s*503|timeout|static\s*json|Google Sheet|fuman-terminal-sync|資料載入失敗|讀取失敗|載入失敗|未知分頁)/gi)]
    .map((match) => match[0]);
  const modeTabs = document.querySelectorAll("#market-view .market-mode-tabs").length;
  const aiPanels = document.querySelectorAll("#market-view .market-ai-dashboard,#market-view [data-market-ai-root],#market-view .market-ai-panel").length;
  const activePanel = [...document.querySelectorAll(".content-panel,[id$='-view']")]
    .filter(visible)
    .map((el) => el.id || el.dataset.view || "")
    .filter(Boolean)
    .slice(0, 8);
  const hardBlockers = [];
  if (!panel || !visible(panel)) hardBlockers.push(`panel not visible ${config.panel}`);
  if (config.requiredText && !panelText.includes(config.requiredText)) hardBlockers.push(`route ${key} missing required text ${config.requiredText}`);
  if (!config.allowEmpty && rows.length < 1 && !explicitTerminalBlocked) hardBlockers.push(`route ${key} rendered no rows`);
  if ((key === "market-ai" || key === "heatmap") && loadingText) hardBlockers.push(`route ${key} still loading blocked source`);
  if (modeTabs > 1) hardBlockers.push(`modeTabs duplicated actual=${modeTabs}`);
  if (aiPanels > 1) hardBlockers.push(`aiPanels duplicated actual=${aiPanels}`);
  return {
    route: key,
    ok: hardBlockers.length === 0 && blockerMatches.length === 0,
    rows: rows.length,
    sampleRows: rows.slice(0, 3).map((row) => row.text.slice(0, 180)),
    modeTabs,
    aiPanels,
    activePanel,
    panelText: panelText.slice(0, 300),
    blockers: [...new Set([...hardBlockers, ...blockerMatches])],
  };
}

async function verifyRoute(cdp, key) {
  const config = ROUTE_CONFIG[key];
  const startedAt = Date.now();
  const activation = await activateRoute(cdp, key);
  if (activation?.membershipLocked) return { route: key, ok: true, membershipLocked: true, rows: 0, sampleRows: [], modeTabs: 0, aiPanels: 0, activePanel: [], panelText: "membership gate active", blockers: [], ms: Date.now() - startedAt };
  const stats = await waitFor(cdp, ({ config, key, collectSource, ensureSource }) => {
    const ensure = (0, eval)(`(${ensureSource})`);
    const active = ensure(config);
    if (!active.ok) return { ok: false, route: key, rows: 0, blockers: [`route not active: ${active.reason}`], actions: active.actions };
    const collect = (0, eval)(`(${collectSource})`);
    const stats = collect(config, key);
    return { ...stats, ok: stats.ok || (config.allowEmpty && !stats.blockers.length), activationActions: active.actions };
  }, { config, key, collectSource: collectRouteStats.toString(), ensureSource: ensureRouteActiveInPage.toString() }, ROUTE_TIMEOUT_MS, 250);
  return { ...stats, ms: Date.now() - startedAt };
}

async function main() {
  const unknown = ROUTES.filter((route) => !ROUTE_CONFIG[route]);
  if (unknown.length) throw new Error(`Unknown route(s): ${unknown.join(", ")}`);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const browser = await launchBrowser();
  let cdp = null;
  const rounds = [];
  let pageEnable = { ok: false, skipped: true };
  let runtimeHandshake = { ok: false, skipped: true };
  try {
    const url = `${BASE_URL.replace(/\/+$/, "")}/?desktop=1&theme=dark&routeStress=${Date.now()}`;
    const tab = await createTab(browser.port);
    cdp = tab.cdp;
    pageEnable = tab.pageEnable;
    runtimeHandshake = tab.runtimeHandshake;
    await cdp.send("Page.navigate", { url }, ROUTE_TIMEOUT_MS);
    await waitFor(cdp, () => ({ ok: document.readyState === "interactive" || document.readyState === "complete" }), null, 45000, 250);
    await waitFor(cdp, () => ({ ok: Boolean(document.querySelector("aside.sidebar [data-view]")) }), null, 45000, 250);
    for (let loop = 1; loop <= LOOPS; loop += 1) {
      const routeResults = [];
      const startedAt = Date.now();
      console.log(`[route-stress] loop ${loop}/${LOOPS}`);
      for (const route of ROUTES) {
        try {
          const result = await verifyRoute(cdp, route);
          routeResults.push(result);
          console.log(`[route-stress] ok loop=${loop} route=${route} rows=${result.rows} ${result.ms}ms`);
        } catch (error) {
          routeResults.push({ route, ok: false, rows: 0, ms: Date.now() - startedAt, blockers: [error.message] });
          console.log(`[route-stress] fail loop=${loop} route=${route} ${error.message}`);
          break;
        }
      }
      const ok = routeResults.length === ROUTES.length && routeResults.every((item) => item.ok);
      rounds.push({ loop, ok, ms: Date.now() - startedAt, routes: routeResults });
      if (!ok) break;
    }
  } finally {
    cdp?.close?.();
    try { browser.browser.kill(); } catch {}
    await new Promise((resolve) => {
      if (browser.browser.exitCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 1200);
      browser.browser.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try { fs.rmSync(browser.userDataDir, { recursive: true, force: true }); } catch {}
  }
  const failures = rounds.filter((round) => !round.ok);
  const routeTimes = rounds.flatMap((round) => round.routes.map((route) => route.ms || 0)).filter(Boolean).sort((a, b) => a - b);
  const report = {
    ok: failures.length === 0 && rounds.length === LOOPS,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    loops: LOOPS,
    routes: ROUTES,
    samples: rounds.length,
    maxRouteMs: routeTimes[routeTimes.length - 1] || null,
    p95RouteMs: routeTimes[Math.min(routeTimes.length - 1, Math.ceil(routeTimes.length * 0.95) - 1)] || null,
    failures,
    rounds,
    contract: {
      singleBrowserContinuousSwitching: true,
      noPerRoundChromeRelaunch: true,
      runtimeHandshake,
      pageEnableOptional: true,
      pageEnable,
      modeTabs: "modeTabs <= 1",
      aiPanels: "aiPanels <= 1",
      routeSet: ROUTES,
      harness: "single Chrome/tab route switch loop; cold-start remains a separate gate",
    },
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({
    ok: report.ok,
    samples: report.samples,
    maxRouteMs: report.maxRouteMs,
    p95RouteMs: report.p95RouteMs,
    failures: failures.length,
    pageEnable,
    out: path.relative(ROOT, OUT_FILE),
  }, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});



