"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const issues = [];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.PROGRAMFILES || "", "Microsoft\\Edge\\Application\\msedge.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft\\Edge\\Application\\msedge.exe"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome/Edge executable not found");
  return found;
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = path.resolve(ROOT, "." + pathname);
    if (!filePath.startsWith(ROOT)) return response.writeHead(403).end("forbidden");
    fs.readFile(filePath, (error, body) => {
      if (error) return response.writeHead(404).end("not found");
      const ext = path.extname(filePath).toLowerCase();
      const type = ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : ext === ".html" ? "text/html; charset=utf-8" : "application/octet-stream";
      response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      response.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }
  async connect(timeoutMs = 15000) {
    const WebSocketImpl = global.WebSocket || (await import("ws")).WebSocket;
    this.ws = new WebSocketImpl(this.wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timeout after ${timeoutMs}ms`)), timeoutMs);
      const done = (fn, value) => { clearTimeout(timer); fn(value); };
      if (typeof this.ws.addEventListener === "function") {
        this.ws.addEventListener("open", () => done(resolve), { once: true });
        this.ws.addEventListener("error", (error) => done(reject, error), { once: true });
      } else {
        this.ws.once("open", () => done(resolve));
        this.ws.once("error", (error) => done(reject, error));
      }
    });
    const onMessage = (event) => this.handleMessage(event.data || event);
    if (typeof this.ws.addEventListener === "function") this.ws.addEventListener("message", onMessage);
    else this.ws.on("message", onMessage);
  }
  handleMessage(raw) {
    const message = JSON.parse(String(raw));
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      const errorMessage = message.error.message || "CDP error";
      if (/Inspected target navigated or closed/i.test(errorMessage)) pending.resolve({});
      else pending.reject(new Error(errorMessage));
    } else pending.resolve(message.result || {});
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: options.method || "GET", signal: controller.signal });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function launchBrowser() {
  const port = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-membership-ui-"));
  const child = childProcess.spawn(findChrome(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=chrome",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 400); });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`, { timeoutMs: 1000 });
      return { child, port, userDataDir, stderr };
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Chrome did not expose CDP port; ${stderr}`);
}

async function createPage(port) {
  const tab = await fetchJson(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const cdp = new Cdp(tab.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  return cdp;
}

async function evaluate(cdp, fn, arg = null, timeoutMs = 15000) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(${fn})(${JSON.stringify(arg)})`,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.value;
}

async function waitFor(cdp, fn, arg = null, timeoutMs = 30000) {
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await evaluate(cdp, fn, arg, Math.min(8000, timeoutMs)).catch((error) => ({ ok: false, error: error.message }));
    if (last?.ok) return last;
    await sleep(200);
  }
  throw new Error(`waitFor timeout: ${JSON.stringify(last)}`);
}

async function runUiProbe(baseUrl) {
  const browser = await launchBrowser();
  let cdp = null;
  try {
    cdp = await createPage(browser.port);
    const firstUrl = `${baseUrl}/?desktop=1&membershipUiProbe=${Date.now()}`;
    await cdp.send("Page.navigate", { url: firstUrl }, 30000);
    await waitFor(cdp, () => ({ ok: document.readyState === "interactive" || document.readyState === "complete" }), null, 30000);
    await evaluate(cdp, () => {
      localStorage.setItem("fuman-terminal-auth-cache-v1", JSON.stringify({
        access: { status: "active", plan: "pro", allowed: true, permissions: { strategyTerminal: true } },
        expiresAt: Math.floor(Date.now() / 1000) + 3600
      }));
      localStorage.setItem("fuman-terminal-last-route-v1", JSON.stringify({ viewName: "strategy", strategyRoute: "intraday_2m", at: Date.now() }));
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}/?desktop=1&membershipUiProbe=${Date.now()}&savedRoute=1` }, 30000);
    await waitFor(cdp, () => ({ ok: Boolean(window.FUMAN_ENTITLEMENT_GUARD && document.querySelector("aside.sidebar [data-view]")) }), null, 45000);
    return await evaluate(cdp, async () => {
      const targets = [
        { key: "strategy1", view: "strategy", text: "策略1" },
        { key: "strategy2", view: "strategy", text: "策略2" },
        { key: "strategy3", view: "strategy", text: "策略3" },
        { key: "strategy4", view: "strategy", text: "策略4" },
        { key: "strategy5", view: "strategy", text: "策略5" },
        { key: "realtime-radar", view: "realtime-radar" },
        { key: "institution", view: "chip-trade" },
        { key: "cb", view: "cb-detect" },
        { key: "warrant", view: "warrant-flow" },
      ];
      const visible = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const findTarget = (target) => [...document.querySelectorAll(`[data-view="${target.view}"]`)].find((node) => !target.text || (node.textContent || "").includes(target.text));
      const previewState = (target) => {
        const panel = document.querySelector(`#${target.view}-view`);
        const preview = panel?.querySelector(".fuman-entitlement-preview");
        const card = preview?.querySelector(".fuman-entitlement-lock-card");
        const panelChildren = panel ? [...panel.children] : [];
        return {
          exists: Boolean(preview),
          visible: visible(preview),
          inPanel: Boolean(panel && preview && panel.contains(preview)),
          panelActive: Boolean(panel && panel.hidden === false && panel.getAttribute("aria-hidden") !== "true" && panel.classList.contains("active")),
          panelLocked: Boolean(panel?.classList.contains("fuman-entitlement-panel-locked") && panel?.dataset.entitlementLocked === "1"),
          preservedPanelShell: Boolean(panelChildren.some((node) => node !== preview)),
          dialog: card?.getAttribute("role") === "dialog" && card?.getAttribute("aria-label") === "會員權限尚未開通",
          text: preview?.textContent || "",
          actions: [...preview?.querySelectorAll("[data-entitlement-action]") || []].map((node) => node.dataset.entitlementAction).sort(),
          rowsLeaked: Boolean(preview?.querySelector("tbody tr,.strategy-row,.strategy-stock-card,.radar-signal-card,.chip-trade-row,.cb-detect-card,.warrant-flow-card")),
        };
      };
      const results = [];
      const sanitizedRoute = JSON.parse(localStorage.getItem("fuman-terminal-last-route-v1") || "{}");
      const publicMarketMarked = document.querySelector('[data-view="market"]')?.dataset.entitlementLock || "";
      const memberMarked = document.querySelector('[data-view="member"]')?.dataset.entitlementLock || "";
      const poisonedAccess = window.FUMAN_ENTITLEMENT_GUARD?.readAccess?.();
      for (const target of targets) {
        document.querySelector(".fuman-entitlement-preview")?.remove();
        const link = findTarget(target);
        link?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1 }));
        link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 220));
        const panel = document.querySelector(`#${target.view}-view`);
        results.push({
          key: target.key,
          linkFound: Boolean(link),
          marked: link?.dataset.entitlementLock === "required",
          preview: previewState(target),
          protectedPanelActive: Boolean(panel && panel.hidden === false && panel.getAttribute("aria-hidden") !== "true" && panel.classList.contains("active")),
        });
      }
      document.querySelector(".fuman-entitlement-preview")?.remove();
      const strategyLink = findTarget({ view: "strategy", text: "策略2" });
      const routeBlocked = window.FUMAN_DESKTOP_ROUTE_STATE?.shouldBlockView?.("strategy", strategyLink) === true;
      await new Promise((resolve) => setTimeout(resolve, 220));
      return JSON.parse(JSON.stringify({
        sanitizedRoute,
        publicMarketMarked,
        memberMarked,
        poisonedAccess,
        results,
        directRoute: {
          routeBlocked,
          preview: previewState({ view: "strategy" }),
          strategyActive: document.querySelector("#strategy-view")?.hidden === false && document.querySelector("#strategy-view")?.getAttribute("aria-hidden") !== "true" && document.querySelector("#strategy-view")?.classList.contains("active"),
        },
      }));
    }, null, 30000);
  } finally {
    cdp?.close();
    try { browser.child.kill(); } catch {}
    try { fs.rmSync(browser.userDataDir, { recursive: true, force: true }); } catch {}
  }
}

function assertSummary(summary) {
  if (!summary || typeof summary !== "object") {
    issues.push("ui probe returned empty summary");
    return;
  }
  if (!Array.isArray(summary.results)) {
    issues.push("ui probe summary missing results array");
    summary.results = [];
  }
  summary.directRoute = summary.directRoute || {};
  if (summary.sanitizedRoute?.viewName !== "market") issues.push(`saved protected route must sanitize to market; got ${JSON.stringify(summary.sanitizedRoute)}`);
  if (summary.publicMarketMarked) issues.push("public market nav must not be marked entitlement locked");
  if (summary.memberMarked) issues.push("member center nav must not be marked entitlement locked");
  if (summary.poisonedAccess?.entitled !== false || summary.poisonedAccess?.hasValidSession !== false || summary.poisonedAccess?.entitledByPlan !== true) issues.push("local active/pro cache without a valid session token must not unlock protected UI");
  for (const result of summary.results) {
    const preview = result.preview || {};
    if (!result.linkFound) issues.push(`${result.key} protected nav link missing`);
    if (!result.marked) issues.push(`${result.key} protected nav must be visibly marked as locked`);
    if (!preview.exists || !preview.visible || !preview.inPanel || !result.protectedPanelActive) issues.push(`${result.key} must render visible inline member preview inside the protected panel`);
    if (!preview.dialog || !/解鎖完整|註冊 \/ 開通權限|登入已開通帳號/.test(preview.text || "")) issues.push(`${result.key} preview must expose locked preview copy and registration actions`);
    if (!/FUMAN MEMBER PREVIEW|輔滿會員罩|輔滿策略權限/.test(preview.text || "")) issues.push(`${result.key} preview must use the Fuman membership cover design`);
    const todayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" }).format(new Date());
    if (/07\/09/.test(preview.text || "") || !(preview.text || "").includes(todayLabel)) issues.push(`${result.key} preview data date must follow current Taipei trading day, not stale hard-coded 07/09`);
    if (!preview.panelLocked || !preview.preservedPanelShell) issues.push(`${result.key} preview must preserve the protected panel DOM instead of replacing it`);
    for (const action of ["signup", "login", "market"]) {
      if (!preview.actions?.includes(action)) issues.push(`${result.key} preview missing ${action} action`);
    }
    if (preview.rowsLeaked) issues.push(`${result.key} preview must not leak protected rows/cards before membership unlock`);
  }
  if (summary.directRoute.routeBlocked !== true) issues.push("direct route guard must block protected strategy route");
  if (!summary.directRoute.preview?.visible || !summary.directRoute.strategyActive) issues.push("direct route guard must render inline member preview in the strategy panel");
  if (!summary.directRoute.preview?.panelLocked || !summary.directRoute.preview?.preservedPanelShell) issues.push("direct route guard must preserve strategy panel DOM under the member preview");
}
(async () => {
  let staticServer = null;
  try {
    staticServer = await startStaticServer();
    const summary = await runUiProbe(`http://127.0.0.1:${staticServer.port}`);
    assertSummary(summary);
    if (issues.length) {
      console.error("[membership-ui-state] failed");
      for (const issue of issues) console.error("- " + issue);
      console.error(JSON.stringify(summary, null, 2));
      process.exit(1);
    }
    console.log("[membership-ui-state] ok");
    console.log(JSON.stringify({
      checked: summary.results.map((result) => result.key),
      savedRoute: summary.sanitizedRoute,
      directRoutePreview: summary.directRoute.preview?.visible === true,
    }, null, 2));
  } catch (error) {
    console.error("[membership-ui-state] failed");
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  } finally {
    staticServer?.server?.close?.();
  }
})();