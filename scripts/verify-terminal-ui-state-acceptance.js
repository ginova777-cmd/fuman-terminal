const childProcess = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REQUIRED_STATES = ["empty", "blocked", "degraded", "0-result"];
const REQUIRED_SURFACES = [
  "Strategy1/open-buy",
  "Strategy2",
  "Strategy3",
  "Strategy4",
  "Strategy5",
  "realtime radar",
  "market overview",
  "AI interpretation",
  "warrant flow",
  "chip/institution flow",
  "CB detect",
  "watchlist",
  "mobile views",
];
const VIEWPORTS = [
  { key: "desktop", width: 1366, height: 900, mobile: false },
  { key: "mobile", width: 390, height: 844, mobile: true },
];

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scriptValue(packageJson, key) {
  return String(packageJson.scripts?.[key] || "");
}

function assertIncludes(issues, file, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) issues.push(`${file} missing UI state acceptance marker ${marker}`);
  }
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

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome or Edge executable not found for rendered UI-state drill");
  return found;
}

function fetchJson(url, options = {}) {
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
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${url} HTTP ${response.statusCode}: ${body.slice(0, 160)}`));
          return;
        }
        try { resolve(JSON.parse(body || "{}")); } catch (error) { reject(error); }
      });
    });
    request.on("timeout", () => request.destroy(new Error(`${url} timed out`)));
    request.on("error", reject);
    request.end();
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }

  connect(timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP websocket connect timeout")), timeoutMs);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", (error) => { clearTimeout(timer); reject(error); }, { once: true });
      this.ws.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
          else pending.resolve(message.result || {});
          return;
        }
        if (message.method) this.events.push(message);
      });
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
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
    try { this.ws?.close(); } catch {}
  }
}

async function launchBrowser() {
  const port = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuman-ui-state-"));
  const child = childProcess.spawn(findBrowser(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--remote-allow-origins=*",
    "--disable-features=Translate,OptimizationHints,MediaRouter",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1366,900",
    "data:text/html,FUMAN_UI_STATE_ACCEPTANCE",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 1200); });
  for (let i = 0; i < 80; i += 1) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return { child, port, userDataDir, page, stderr: () => stderr };
    } catch {}
    if (child.exitCode !== null) throw new Error(`browser exited early: ${stderr}`);
    await sleep(150);
  }
  throw new Error(`browser did not expose CDP page: ${stderr}`);
}

function renderedDrillHtml() {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fuman UI State Acceptance Drill</title>
<style>
  :root { color-scheme: light dark; font-family: Arial, "Microsoft JhengHei", sans-serif; }
  body { margin: 0; background: #111827; color: #f8fafc; }
  main { display: grid; gap: 16px; padding: 24px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .terminal-state-surface { border: 1px solid #334155; border-radius: 8px; padding: 16px; min-height: 148px; background: #172033; }
  .state-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 16px; font-weight: 700; }
  .state-badge { border: 1px solid currentColor; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
  .state-reason { margin-top: 12px; line-height: 1.5; color: #cbd5e1; }
  .state-action { margin-top: 12px; font-size: 13px; color: #93c5fd; }
  .state-empty { border-color: #64748b; }
  .state-blocked { border-color: #f87171; }
  .state-degraded { border-color: #facc15; }
  .state-zero-result { border-color: #38bdf8; }
  .hidden-row, .spinner, .skeleton, .success-banner { display: none; }
  @media (max-width: 520px) { main { grid-template-columns: 1fr; padding: 12px; } }
</style>
</head>
<body>
<main aria-label="All terminal UI state acceptance drill">
  <section class="terminal-state-surface state-empty" data-ui-state="empty">
    <div class="state-title">空狀態 <span class="state-badge">empty</span></div>
    <p class="state-reason">等待完整掃描或使用者尚未加入資料，畫面必須顯示 deliberate empty state。</p>
    <p class="state-action">不可顯示空白表格、舊資料列、壞掉 skeleton 或永遠轉圈。</p>
    <div class="spinner" aria-hidden="true">loading</div>
  </section>
  <section class="terminal-state-surface state-blocked" data-ui-state="blocked" data-source="strategy-source-gate">
    <div class="state-title">阻擋狀態 <span class="state-badge">blocked</span></div>
    <p class="state-reason">Strategy source gate blocked: quote coverage below threshold，必須顯示策略/來源與原因。</p>
    <p class="state-action">不可顯示成功、正式 YES 或可發布狀態。</p>
    <div class="success-banner" aria-hidden="true">success</div>
  </section>
  <section class="terminal-state-surface state-degraded" data-ui-state="degraded" data-source="fallback-source">
    <div class="state-title">降級可用 <span class="state-badge">degraded</span></div>
    <p class="state-reason">degraded-but-usable: fallback source active, stale/partial coverage warning visible。</p>
    <p class="state-action">必須讓使用者知道資料仍可看但不是完整健康狀態。</p>
  </section>
  <section class="terminal-state-surface state-zero-result" data-ui-state="0-result" data-complete="true" data-count="0">
    <div class="state-title">零結果 <span class="state-badge">0-result</span></div>
    <p class="state-reason">completed healthy scan with zero matches，明確顯示本次無符合標的。</p>
    <p class="state-action">不可被當成 loading、failure 或 missing data。</p>
  </section>
</main>
</body>
</html>`;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, 15000);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  return result.result?.value;
}

async function runRenderedStateDrill() {
  const browser = await launchBrowser();
  const cdp = new CdpClient(browser.page.webSocketDebuggerUrl);
  try {
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(renderedDrillHtml())}`;
    const results = [];
    for (const viewport of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      });
      await cdp.send("Page.navigate", { url });
      await sleep(450);
      const proof = await evaluate(cdp, `(() => {
        const visible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 8 && rect.height > 8 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const text = (el) => String(el?.textContent || '').replace(/\s+/g, ' ').trim();
        return [...document.querySelectorAll('[data-ui-state]')].map((card) => {
          const state = card.dataset.uiState || '';
          const body = text(card);
          const badge = card.querySelector('.state-badge');
          const badgeText = text(badge);
          const visibleSuccess = [...card.querySelectorAll('.success-banner,[data-success],.publish-success')]
            .filter(visible)
            .map(text)
            .join(' ');
          return {
            state,
            visible: visible(card),
            hasBadge: Boolean(badge) && visible(badge) && badgeText.length > 0,
            hasReason: Boolean(card.querySelector('.state-reason')) && text(card.querySelector('.state-reason')).length >= 24,
            hasAction: Boolean(card.querySelector('.state-action')),
            hasSource: state !== 'blocked' && state !== 'degraded' ? true : Boolean(card.dataset.source) || /source|來源|coverage|fallback|gate/i.test(body),
            hasNoRows: card.querySelectorAll('[data-stock-code],tbody tr,.strategy-row,.mobile-terminal-row').length === 0,
            noVisibleSpinner: ![...card.querySelectorAll('.spinner,.skeleton,[aria-busy="true"]')].some(visible),
            noSuccessMislead: state !== 'blocked' || !/success|成功|YES|publish allowed/i.test(visibleSuccess),
            zeroComplete: state !== '0-result' || (card.dataset.complete === 'true' && card.dataset.count === '0' && /zero matches|無符合|0[- ]result/i.test(body)),
          };
        });
      })()`);
      results.push({ viewport: viewport.key, proof });
    }
    const issues = [];
    for (const result of results) {
      const states = new Set(result.proof.map((item) => item.state));
      for (const state of REQUIRED_STATES) {
        if (!states.has(state)) issues.push(`${result.viewport} missing rendered state ${state}`);
      }
      for (const item of result.proof) {
        for (const [key, value] of Object.entries(item)) {
          if (key !== "state" && value !== true) issues.push(`${result.viewport}/${item.state} failed ${key}`);
        }
      }
    }
    if (issues.length) throw new Error(issues.join("; "));
    return results;
  } finally {
    cdp.close();
    try { browser.child.kill(); } catch {}
    await sleep(200);
    try { fs.rmSync(browser.userDataDir, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const issues = [];
  const packageJson = JSON.parse(read("package.json"));
  const agents = read("AGENTS.md");
  const uiE2e = read("scripts/verify-terminal-ui-e2e.js");
  const uiMatrix = read("scripts/verify-terminal-ui-e2e-matrix.js");

  assertIncludes(issues, "AGENTS.md", agents, [
    "All-Terminal UI Acceptance",
    "Do not validate only the data contract",
    "actual rendered desktop and mobile UI",
    ...REQUIRED_STATES,
    ...REQUIRED_SURFACES,
  ]);

  for (const state of REQUIRED_STATES) {
    const pattern = state === "0-result" ? /\b0[- ]result\b/i : new RegExp(`\\b${state}\\b`, "i");
    if (!pattern.test(agents)) issues.push(`AGENTS.md must name rendered UI state ${state}`);
  }

  if (!scriptValue(packageJson, "verify:terminal-ui-e2e").includes("scripts/verify-terminal-ui-e2e.js")) {
    issues.push("package.json scripts.verify:terminal-ui-e2e must run scripts/verify-terminal-ui-e2e.js");
  }
  if (!scriptValue(packageJson, "verify:terminal-ui-e2e:matrix").includes("scripts/verify-terminal-ui-e2e-matrix.js")) {
    issues.push("package.json scripts.verify:terminal-ui-e2e:matrix must run scripts/verify-terminal-ui-e2e-matrix.js");
  }
  if (!scriptValue(packageJson, "verify:terminal-ui-state-acceptance").includes("scripts/verify-terminal-ui-state-acceptance.js")) {
    issues.push("package.json must expose verify:terminal-ui-state-acceptance");
  }

  for (const marker of [
    "DESKTOP_ROUTES",
    "MOBILE_ROUTES",
    "allowWaitingEmpty",
    "allowEmpty",
    "freshness/date/run signal not visible enough",
  ]) {
    if (!uiE2e.includes(marker)) issues.push(`verify-terminal-ui-e2e.js missing rendered UI marker ${marker}`);
  }

  for (const marker of [
    "desktop-night,desktop-sun",
    "mobile-phone-portrait-night,mobile-phone-portrait-sun",
    "mobile-phone-landscape-night,mobile-phone-landscape-sun",
    "mobile-tablet-night,mobile-tablet-sun",
    "mobile-desktop-night,mobile-desktop-sun",
    "terminal-ui-e2e-report.md",
  ]) {
    if (!uiMatrix.includes(marker)) issues.push(`verify-terminal-ui-e2e-matrix.js missing matrix coverage marker ${marker}`);
  }

  if (issues.length) {
    console.error("[terminal-ui-state-acceptance] failed");
    for (const issue of issues) console.error("- " + issue);
    process.exit(1);
  }

  const rendered = await runRenderedStateDrill();
  console.log(`[terminal-ui-state-acceptance] ok states=${REQUIRED_STATES.join(",")} surfaces=${REQUIRED_SURFACES.length} rendered=${rendered.map((item) => item.viewport).join(",")}`);
}

main().catch((error) => {
  console.error(`[terminal-ui-state-acceptance] failed: ${error?.stack || error}`);
  process.exit(1);
});
