(() => {
  if (window.__fumanTerminalDisplayV2) return;
  window.__fumanTerminalDisplayV2 = true;

  const VERSION = "terminal-display-v2-20260823-06";
  const LAST_ROUTE_KEY = window.FUMAN_RUNTIME_CONFIG?.lastRouteKey || "fuman-terminal-last-route-v1";
  const ROUTES = {
    market: { view: "market", panel: "market-view", label: "市場總覽", protected: false },
    strategy2: { view: "strategy", panel: "strategy-view", route: "intraday_2m", label: "當沖雷達", protected: true, api: "/api/strategy2-latest", snapshot: "/api/terminal-display-snapshot?route=strategy2" },
    strategy3: { view: "strategy", panel: "strategy-view", route: "strategy3", label: "隔日沖", protected: true, api: "/api/strategy3-latest", snapshot: "/api/terminal-display-snapshot?route=strategy3" },
    strategy4: { view: "strategy", panel: "strategy-view", route: "swing_radar", label: "波段", protected: true, api: "/api/strategy4-latest", snapshot: "/api/terminal-display-snapshot?route=strategy4" },
    strategy5: { view: "strategy", panel: "strategy-view", route: "strategy5", label: "綜合策略", protected: true, api: "/api/strategy5-latest", snapshot: "/api/terminal-display-snapshot?route=strategy5" },
    institution: { view: "chip-trade", panel: "chip-trade-view", label: "買賣超", protected: true, api: "/api/institution-latest", snapshot: "/api/terminal-display-snapshot?route=institution" },
    watchlist: { view: "watchlist", panel: "watchlist-view", label: "自選股", protected: false },
    member: { view: "member", panel: "member-view", label: "會員", protected: false },
  };

  let lastRenderedKey = "";
  let watchdogTimer = null;

  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  }


  function stockCode(value) {
    return String(value || "").match(/\b\d{4}\b/)?.[0] || "";
  }

  function priceValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2).replace(/\.00$/, "") : "--";
  }

  function threeGateLevel(row) {
    return row?.terminalThreeGate || row?.terminal_three_gate || row?.threeGate || row?.three_gate || row?.threeGatePrice || null;
  }

  function threeGateHtml(row, code, date) {
    const level = threeGateLevel(row);
    const state = level ? "ready" : "loading";
    const reference = level?.referenceDate || level?.reference_date || "";
    return `<div class="terminal-display-v2-three-gate" data-terminal-display-v2-three-gate="${escapeHtml(code)}" data-terminal-display-v2-three-gate-date="${escapeHtml(date || "")}" data-terminal-display-v2-three-gate-state="${state}"><small>三關價</small><span data-terminal-display-v2-three-gate-upper>上 ${escapeHtml(priceValue(level?.upperGate ?? level?.upper_gate))}</span><span data-terminal-display-v2-three-gate-middle>中 ${escapeHtml(priceValue(level?.middleGate ?? level?.middle_gate))}</span><span data-terminal-display-v2-three-gate-lower>下 ${escapeHtml(priceValue(level?.lowerGate ?? level?.lower_gate))}</span><em data-terminal-display-v2-three-gate-reference>${escapeHtml(reference ? `基準 ${reference}` : "正式日K讀取中")}</em></div>`;
  }

  function paintThreeGatePrices(levels = []) {
    const byCode = new Map(levels.map((level) => [stockCode(level?.code), level]).filter(([code]) => code));
    document.querySelectorAll("[data-terminal-display-v2-three-gate]").forEach((node) => {
      const code = stockCode(node.dataset.terminalDisplayV2ThreeGate);
      const level = byCode.get(code);
      if (!level) {
        node.dataset.terminalDisplayV2ThreeGateState = "missing";
        const reference = node.querySelector("[data-terminal-display-v2-three-gate-reference]");
        if (reference) reference.textContent = "正式日K資料不足";
        return;
      }
      node.dataset.terminalDisplayV2ThreeGateState = "ready";
      const upper = node.querySelector("[data-terminal-display-v2-three-gate-upper]");
      const middle = node.querySelector("[data-terminal-display-v2-three-gate-middle]");
      const lower = node.querySelector("[data-terminal-display-v2-three-gate-lower]");
      const reference = node.querySelector("[data-terminal-display-v2-three-gate-reference]");
      if (upper) upper.textContent = `上 ${priceValue(level.upperGate)}`;
      if (middle) middle.textContent = `中 ${priceValue(level.middleGate)}`;
      if (lower) lower.textContent = `下 ${priceValue(level.lowerGate)}`;
      if (reference) reference.textContent = level.referenceDate ? `基準 ${level.referenceDate}` : "正式日K";
    });
  }

  async function hydrateThreeGatePrices(routeKey, rows, date) {
    if (!["strategy2", "strategy3", "strategy4", "strategy5", "institution"].includes(routeKey)) return;
    const codes = [...new Set(rows.map((row) => stockCode(row?.code || row?.symbol || row?.stock_id || row?.stockId)).filter(Boolean))].slice(0, 120);
    if (!codes.length) return;
    try {
      const query = new URLSearchParams({ codes: codes.join(","), asOf: date || "" });
      const response = await fetch(`/api/three-gate-prices?${query.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true || payload?.contract !== "terminal-three-gate-prices-v1") throw new Error(`three_gate_${response.status}`);
      paintThreeGatePrices(Array.isArray(payload.levels) ? payload.levels : []);
    } catch {
      document.querySelectorAll("[data-terminal-display-v2-three-gate-state='loading']").forEach((node) => {
        node.dataset.terminalDisplayV2ThreeGateState = "missing";
        const reference = node.querySelector("[data-terminal-display-v2-three-gate-reference]");
        if (reference) reference.textContent = "正式日K暫不可讀";
      });
    }
  }
  function routeFromLink(link) {
    const view = link?.dataset?.view || "";
    const route = link?.dataset?.strategyRoute || "";
    const label = text(link?.textContent);
    if (view === "market") return "market";
    if (view === "watchlist") return "watchlist";
    if (view === "member") return "member";
    if (view === "chip-trade") return "institution";
    if (view === "strategy") {
      if (route === "intraday_2m" || label.includes("當沖")) return "strategy2";
      if (route === "strategy3" || label.includes("隔日")) return "strategy3";
      if (route === "swing_radar" || label.includes("波段")) return "strategy4";
      if (route === "strategy5" || label.includes("綜合")) return "strategy5";
    }
    return "";
  }

  function localBearerToken() {
    try {
      const keys = [window.FUMAN_RUNTIME_CONFIG?.authCacheKey || "fuman-terminal-auth-cache-v1", "fuman-terminal-auth-cache-v1"];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        if (/^sb-.+-auth-token$/.test(key)) keys.push(key);
      }
      for (const key of keys) {
        const raw = String(localStorage.getItem(key) || "");
        const parsed = (() => { try { return JSON.parse(raw); } catch { return null; } })();
        const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token || raw.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] || "";
        if (token) return token;
      }
    } catch {}
    return "";
  }

  function hasLocalBearerToken() {
    return Boolean(localBearerToken());
  }

  function authHeaders() {
    const token = localBearerToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function membershipAllowed() {
    return document.body?.dataset?.membershipAccess === "allowed" || hasLocalBearerToken();
  }

  function setActivePanel(route) {
    const panel = document.getElementById(route.panel);
    if (!panel) return null;
    document.querySelectorAll(".view-panel").forEach((item) => {
      const active = item === panel;
      item.classList.toggle("active", active);
      item.hidden = !active;
      item.setAttribute("aria-hidden", active ? "false" : "true");
    });
    return panel;
  }

  function setActiveNav(routeKey) {
    document.querySelectorAll("aside.sidebar [data-view]").forEach((item) => {
      const active = routeFromLink(item) === routeKey;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }

  function persistRoute(route) {
    try {
      localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify({ viewName: route.view, strategyRoute: route.route || "", at: Date.now(), source: VERSION }));
    } catch {}
  }

  function installStyles() {
    if (document.getElementById("terminal-display-v2-style")) return;
    const style = document.createElement("style");
    style.id = "terminal-display-v2-style";
    style.textContent = `
      .terminal-display-v2-state { min-height: 360px; display: grid; align-content: center; gap: 14px; padding: 28px; border: 1px solid rgba(120,145,185,.26); border-radius: 8px; background: rgba(13,22,36,.82); color: #d8e6f8; }
      .terminal-display-v2-state .kicker, .terminal-display-v2-badge { width: fit-content; border-radius: 5px; background: #ff4f57; color: #fff; padding: 7px 9px; font-size: 12px; font-weight: 900; letter-spacing: 0; }
      .terminal-display-v2-state h2 { margin: 0; color: #f4f8ff; font-size: 24px; line-height: 1.25; letter-spacing: 0; }
      .terminal-display-v2-state p { margin: 0; max-width: 760px; color: #91a6c2; font-size: 14px; line-height: 1.7; }
      .terminal-display-v2-state .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
      .terminal-display-v2-state button { min-height: 34px; border: 1px solid rgba(117,212,255,.42); border-radius: 6px; background: #102135; color: #dff6ff; font-weight: 900; cursor: pointer; }
      .terminal-display-v2-state .secondary { border-color: rgba(145,166,194,.34); color: #b8c8dc; }
      .terminal-display-v2-api-shell { display: grid; gap: 14px; width: 100%; color: #eaf2ff; }
      .terminal-display-v2-api-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 16px 18px; border: 1px solid rgba(120,145,185,.24); border-radius: 8px; background: rgba(12,22,36,.78); }
      .terminal-display-v2-api-head h3 { margin: 12px 0 7px; color: #f3f7ff; font-size: 22px; line-height: 1.25; letter-spacing: 0; }
      .terminal-display-v2-api-head p { margin: 0; color: #9fb1c9; font-size: 13px; line-height: 1.6; }
      .terminal-display-v2-count { min-width: 74px; border-radius: 6px; background: rgba(117,212,255,.12); border: 1px solid rgba(117,212,255,.32); color: #c7f2ff; padding: 9px 12px; text-align: center; font-weight: 900; }
      .terminal-display-v2-list { display: grid; gap: 10px; }
      .terminal-display-v2-card { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 14px 16px; border: 1px solid rgba(120,145,185,.22); border-radius: 8px; background: rgba(16,28,45,.72); box-shadow: inset 3px 0 0 rgba(255,138,61,.78); }
      .terminal-display-v2-rank { color: #ffbd7a; font-size: 14px; font-weight: 900; }
      .terminal-display-v2-main { min-width: 0; display: grid; gap: 6px; }
      .terminal-display-v2-main strong { color: #f7fbff; font-size: 18px; line-height: 1.25; }
      .terminal-display-v2-main p { margin: 0; color: #afbdd0; font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
      .terminal-display-v2-three-gate { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 9px; margin-top: 2px; color: #aebed3; font-size: 11px; font-weight: 800; line-height: 1.35; }
      .terminal-display-v2-three-gate small { color: #f4c656; font-size: 11px; font-weight: 900; }
      .terminal-display-v2-three-gate span { color: #dce8f7; white-space: nowrap; }
      .terminal-display-v2-three-gate span:nth-of-type(1) { color: #ff889a; }
      .terminal-display-v2-three-gate span:nth-of-type(2) { color: #f4c656; }
      .terminal-display-v2-three-gate span:nth-of-type(3) { color: #55d8b3; }
      .terminal-display-v2-three-gate em { color: #71839c; font-size: 10px; font-style: normal; white-space: nowrap; }
      .terminal-display-v2-metrics { display: grid; grid-template-columns: repeat(2, minmax(62px, 1fr)); gap: 7px; min-width: 150px; }
      .terminal-display-v2-metrics div { border: 1px solid rgba(120,145,185,.18); border-radius: 6px; background: rgba(7,14,25,.5); padding: 7px 9px; }
      .terminal-display-v2-metrics small { display: block; color: #7f91aa; font-size: 11px; font-weight: 800; }
      .terminal-display-v2-metrics b { display: block; margin-top: 3px; color: #f8fbff; font-size: 15px; }
      @media (max-width: 760px) { .terminal-display-v2-api-head, .terminal-display-v2-card { grid-template-columns: 1fr; display: grid; } .terminal-display-v2-card { gap: 9px; } .terminal-display-v2-metrics { min-width: 0; } }
      body.fuman-light-theme .terminal-display-v2-state, body.fuman-light-theme .terminal-display-v2-api-head, body.fuman-light-theme .terminal-display-v2-card { background: #f7fbff; border-color: #d6e4ef; color: #24384f; }
      body.fuman-light-theme .terminal-display-v2-state h2, body.fuman-light-theme .terminal-display-v2-api-head h3, body.fuman-light-theme .terminal-display-v2-main strong { color: #19314a; }
      body.fuman-light-theme .terminal-display-v2-state p, body.fuman-light-theme .terminal-display-v2-api-head p, body.fuman-light-theme .terminal-display-v2-main p { color: #62788f; }
      body.fuman-light-theme .terminal-display-v2-three-gate small { color: #8d5d0a; }
      body.fuman-light-theme .terminal-display-v2-three-gate span { color: #3d5870; }
      body.fuman-light-theme .terminal-display-v2-three-gate span:nth-of-type(1) { color: #b84f62; }
      body.fuman-light-theme .terminal-display-v2-three-gate span:nth-of-type(2) { color: #97650c; }
      body.fuman-light-theme .terminal-display-v2-three-gate span:nth-of-type(3) { color: #237763; }
      body.fuman-light-theme .terminal-display-v2-three-gate em { color: #587187; }
    `;
    document.head.appendChild(style);
  }

  function stateHtml(route, state) {
    const isLocked = state === "locked";
    const title = isLocked ? `${route.label}需要會員權限` : `${route.label}顯示層已接管`;
    const body = isLocked
      ? "目前沒有可用的登入權杖或會員權限，所以終端不再停在載入狀態，改顯示明確的鎖定畫面。登入後重新點選左側分頁即可讀取正式策略資料。"
      : "正式 renderer 尚未完成畫面，請按重新讀取；v2 會直接讀正式 API 並顯示清單。";
    return `<section class="terminal-display-v2-state" data-terminal-display-v2-state="${state}"><div class="kicker">FMN://terminal-display-v2</div><h2>${title}</h2><p>${body}</p><div class="actions"><button type="button" data-terminal-display-v2-retry>重新讀取</button><button class="secondary" type="button" data-terminal-display-v2-market>回市場總覽</button></div></section>`;
  }

  function targetFor(panel) {
    return panel.querySelector("#strategy-table") || panel.querySelector(".strategy-results") || panel;
  }

  function payloadRows(payload) {
    const candidates = [payload?.matches, payload?.results, payload?.items, payload?.rows, payload?.data, payload?.signals];
    const rows = candidates.find(Array.isArray) || [];
    return rows.filter((row) => row && typeof row === "object");
  }

  function renderApiFallback(routeKey, payload, source = "api") {
    const route = ROUTES[routeKey];
    if (!route) return false;
    installStyles();
    const panel = setActivePanel(route);
    if (!panel) return false;
    setActiveNav(routeKey);
    persistRoute(route);
    lastRenderedKey = routeKey;
    if (route.route && document.body) document.body.dataset.strategyActiveRoute = route.route;
    const rows = payloadRows(payload);
    const target = targetFor(panel);
    const date = payload?.tradeDate || payload?.trade_date || payload?.dataDate || payload?.usedDate || payload?.expectedTradeDate || "--";
    const runId = payload?.runId || payload?.run_id || payload?.latestRunId || "--";
    const cards = rows.slice(0, 120).map((row, index) => {
      const code = row.code || row.symbol || row.stock_id || row.stockId || "--";
      const name = row.name || row.stock_name || row.stockName || "";
      const score = row.score ?? row.totalScore ?? row.rank_score ?? row.signalScore ?? "--";
      const reason = row.reason || row.triggerReason || row.trigger_reason || row.aiSummary || row.summary || row.signal_type || row.strategy || "正式策略命中";
      const price = row.close_price ?? row.close ?? row.entry_price ?? row.price ?? "--";
      return `<article class="terminal-display-v2-card" data-terminal-display-v2-row="1"><div class="terminal-display-v2-rank">#${index + 1}</div><div class="terminal-display-v2-main"><strong>${escapeHtml(code)} ${escapeHtml(name)}</strong><p>${escapeHtml(reason)}</p>${threeGateHtml(row, stockCode(code), date)}</div><div class="terminal-display-v2-metrics"><div><small>分數</small><b>${escapeHtml(score)}</b></div><div><small>價格</small><b>${escapeHtml(price)}</b></div></div></article>`;
    }).join("");
    target.innerHTML = `<section class="terminal-display-v2-api-shell" data-terminal-display-v2-api="${escapeHtml(source)}"><header class="terminal-display-v2-api-head"><div><span class="terminal-display-v2-badge">FMN://terminal-display-v2.api</span><h3>${escapeHtml(route.label)}正式資料</h3><p>資料日 ${escapeHtml(date)} | Run ${escapeHtml(runId)} | ${escapeHtml(String(rows.length))} 檔</p></div><strong class="terminal-display-v2-count">${escapeHtml(String(rows.length))} 檔</strong></header><section class="terminal-display-v2-list" aria-label="${escapeHtml(route.label)}正式資料">${cards || `<div class="terminal-display-v2-state"><div class="kicker">FMN://terminal-display-v2.empty</div><h2>${escapeHtml(route.label)}目前沒有清單</h2><p>API 已回應，但這個時間點沒有可顯示股票。</p><div class="actions"><button type="button" data-terminal-display-v2-retry>重新讀取</button><button class="secondary" type="button" data-terminal-display-v2-market>回市場總覽</button></div></div>`}</section></section>`;
    hydrateThreeGatePrices(routeKey, rows, date);
    return true;
  }

  function renderState(routeKey, state) {
    const route = ROUTES[routeKey];
    if (!route) return false;
    installStyles();
    const panel = setActivePanel(route);
    if (!panel) return false;
    setActiveNav(routeKey);
    persistRoute(route);
    lastRenderedKey = routeKey;
    document.documentElement.dataset.fumanDisplayV2Route = routeKey;
    if (route.route && document.body) document.body.dataset.strategyActiveRoute = route.route;
    targetFor(panel).innerHTML = stateHtml(route, state);
    return true;
  }

  async function loadSnapshotFallback(routeKey) {
    const route = ROUTES[routeKey];
    if (!route?.snapshot) return false;
    try {
      const separator = route.snapshot.includes("?") ? "&" : "?";
      const url = route.snapshot + separator + "display_v2=" + Date.now();
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || payload.ok === false || !Array.isArray(payload.rows) || !payload.rows.length) return false;
      return renderApiFallback(routeKey, {
        ...payload,
        matches: payload.rows,
        count: payload.count ?? payload.rows.length,
        cacheSource: payload.source || "terminal-display-snapshot",
      }, "snapshot");
    } catch {
      return false;
    }
  }
  async function loadApiFallback(routeKey) {
    const route = ROUTES[routeKey];
    if (!route?.api) return renderState(routeKey, "empty");
    if (route.protected && !membershipAllowed()) return renderState(routeKey, "locked");
    try {
      renderState(routeKey, "empty");
      if (await loadSnapshotFallback(routeKey)) return true;
      const response = await fetch(`${route.api}?display_v2=${Date.now()}`, { cache: "no-store", headers: authHeaders() });
      const payload = await response.json().catch(() => null);
      if (payload?.protected || payload?.error === "protected") throw new Error("protected_api_requires_login");
      if (!response.ok || !payload) throw new Error(`api_${response.status}`);
      return renderApiFallback(routeKey, payload, "retry");
    } catch (error) {
      const box = document.querySelector(".terminal-display-v2-state p");
      if (box) box.textContent = `正式 API 暫時讀取失敗：${error?.message || error}。`;
      return false;
    }
  }

  function armWatchdog(routeKey) {
    clearTimeout(watchdogTimer);
    const route = ROUTES[routeKey];
    if (!route?.protected) return;
    watchdogTimer = setTimeout(() => {
      const panel = document.getElementById(route.panel);
      if (!panel || panel.hidden) return;
      const body = text(panel.textContent);
      if (/正在載入正式策略資料|策略資料載入中|正式策略載入中/.test(body)) {
        if (membershipAllowed()) loadApiFallback(routeKey);
        else renderState(routeKey, "locked");
      }
    }, 6500);
  }

  function activate(routeKey, options = {}) {
    const route = ROUTES[routeKey];
    if (!route) return false;
    window.__fumanTerminalDisplayV2State = { routeKey, route, at: Date.now(), version: VERSION };
    lastRenderedKey = routeKey;
    if (route.protected && !membershipAllowed()) return renderState(routeKey, "locked");
    setActivePanel(route);
    setActiveNav(routeKey);
    persistRoute(route);
    if (route.snapshot) loadSnapshotFallback(routeKey);
    armWatchdog(routeKey);
    if (options.forceState) renderState(routeKey, options.forceState);
    return true;
  }

  function onClick(event) {
    const link = event.target?.closest?.("aside.sidebar [data-view]:not([data-member-tab])");
    if (!link) return;
    const routeKey = routeFromLink(link);
    if (!routeKey) return;
    const route = ROUTES[routeKey];
    if (link.tagName === "A" && link.getAttribute("href") === "#") event.preventDefault();
    if (route.protected && !membershipAllowed()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activate(routeKey);
      return;
    }
    activate(routeKey);
  }

  function onAction(event) {
    if (event.target?.closest?.("[data-terminal-display-v2-market]")) {
      event.preventDefault();
      activate("market");
      return;
    }
    if (event.target?.closest?.("[data-terminal-display-v2-retry]")) {
      event.preventDefault();
      loadApiFallback(lastRenderedKey || "market");
    }
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("click", onAction, true);
  window.FUMAN_TERMINAL_DISPLAY_V2 = { activate, renderState, renderApiFallback, loadApiFallback, loadSnapshotFallback, routeFromLink, version: VERSION };
})();

(() => {
  if (window.__fumanTerminalDisplayV2Kline) return;
  window.__fumanTerminalDisplayV2Kline = "terminal-display-v2-kline-20260823-01";
  const cache = new Map();
  const ranges = new Map();

  function codeOf(value) {
    return String(value || "").match(/\b\d{4}\b/)?.[0] || "";
  }
  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function price(value) {
    const parsed = number(value);
    return parsed ? parsed.toLocaleString("zh-TW", { maximumFractionDigits: 2 }) : "--";
  }
  function shortDate(value) {
    return String(value || "").slice(5).replace("-", "/") || "--";
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
  }
  function installStyle() {
    if (document.getElementById("terminal-display-v2-kline-style")) return;
    const style = document.createElement("style");
    style.id = "terminal-display-v2-kline-style";
    style.textContent = `
      .terminal-display-v2-card[data-terminal-display-v2-kline-code] { cursor: pointer; position: relative; padding-right: 78px; }
      .terminal-display-v2-card[data-terminal-display-v2-kline-code]::after { content: "日 K"; position: absolute; right: 14px; top: 50%; transform: translateY(-50%); min-height: 28px; border: 1px solid rgba(96,165,250,.58); border-radius: 6px; padding: 6px 9px; background: rgba(30,64,175,.14); color: #bfdbfe; font-size: 12px; font-weight: 900; }
      .terminal-display-v2-card.is-kline-open { border-color: rgba(232,180,75,.82); box-shadow: inset 3px 0 0 #e8b44b; }
      .terminal-display-v2-kline-panel { margin-top: -2px; overflow: hidden; border: 1px solid rgba(139,164,199,.28); border-radius: 8px; background: #0b1420; color: #eaf2ff; }
      .terminal-display-v2-kline-head { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; padding: 14px 16px 10px; border-bottom: 1px solid rgba(139,164,199,.18); }
      .terminal-display-v2-kline-head span { display: block; margin-bottom: 5px; color: #94a8c2; font-size: 12px; font-weight: 900; }
      .terminal-display-v2-kline-head strong { display: block; color: #eaf2ff; font-size: 14px; line-height: 1.5; }
      .terminal-display-v2-kline-head small { display: block; margin-top: 3px; color: #71839c; font-size: 11px; }
      .terminal-display-v2-kline-head b.is-up { color: #ff5872; }
      .terminal-display-v2-kline-head b.is-down { color: #21c79a; }
      .terminal-display-v2-kline-controls { display: flex; flex-shrink: 0; gap: 5px; }
      .terminal-display-v2-kline-range { min-width: 47px; height: 30px; border: 1px solid #29394e; border-radius: 5px; background: #111c2c; color: #a5b4c8; font-size: 12px; font-weight: 900; cursor: pointer; }
      .terminal-display-v2-kline-range.active { border-color: #e8b44b; background: #e8b44b; color: #161d29; }
      .terminal-display-v2-kline-legend { display: flex; flex-wrap: wrap; gap: 11px; padding: 9px 16px 0; color: #71839c; font-size: 11px; font-weight: 800; }
      .terminal-display-v2-kline-legend .ma5 { color: #f4c656; }
      .terminal-display-v2-kline-legend .ma10 { color: #4aa7ff; }
      .terminal-display-v2-kline-legend .ma20 { color: #b18ae3; }
      .terminal-display-v2-kline-svg { display: block; width: 100%; height: 300px; padding: 3px 10px 8px 0; box-sizing: border-box; }
      .terminal-display-v2-kline-svg .grid { stroke: rgba(135,157,189,.17); stroke-width: 1; stroke-dasharray: 3 4; }
      .terminal-display-v2-kline-svg .divider { stroke: rgba(135,157,189,.24); stroke-width: 1; }
      .terminal-display-v2-kline-svg .axis { fill: #687b94; font-size: 11px; font-weight: 700; }
      .terminal-display-v2-kline-empty { display: grid; min-height: 180px; place-items: center; padding: 16px; color: #8fa2bd; font-size: 13px; font-weight: 800; text-align: center; }
      body.fuman-light-theme .terminal-display-v2-kline-panel { background: #f7fbff; border-color: #d6e4ef; color: #24384f; }
      body.fuman-light-theme .terminal-display-v2-kline-head strong { color: #1c3147; }
      @media (max-width: 760px) { .terminal-display-v2-kline-head { display: grid; } .terminal-display-v2-kline-controls { flex-wrap: wrap; } }
    `;
    document.head.appendChild(style);
  }
  function movingAverage(rows, period) {
    return rows.map((_, index) => {
      if (index < period - 1) return null;
      const slice = rows.slice(index - period + 1, index + 1);
      return slice.reduce((sum, row) => sum + number(row.close), 0) / period;
    });
  }
  function svg(rows) {
    const bars = rows.slice(-260).filter((row) => row && row.date && row.open && row.high && row.low && row.close);
    if (bars.length < 20) return '<div class="terminal-display-v2-kline-empty">正式日 K 資料不足，暫不繪圖。</div>';
    const width = 920, height = 300, left = 46, right = 18, top = 18, volumeTop = 228, bottom = 24;
    const priceMin = Math.min(...bars.map((bar) => number(bar.low)));
    const priceMax = Math.max(...bars.map((bar) => number(bar.high)));
    const volumeMax = Math.max(1, ...bars.map((bar) => number(bar.volumeLots)));
    const span = Math.max(0.01, priceMax - priceMin);
    const x = (index) => left + (index * (width - left - right)) / Math.max(1, bars.length - 1);
    const y = (value) => top + ((priceMax - value) / span) * (volumeTop - top - 12);
    const volumeBottom = height - bottom;
    const bodyWidth = Math.max(2, Math.min(9, (width - left - right) / Math.max(1, bars.length) * 0.58));
    const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const value = priceMax - span * ratio;
      const yy = y(value);
      return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" class="grid"/><text x="4" y="${yy + 4}" class="axis">${price(value)}</text>`;
    }).join("");
    const candles = bars.map((bar, index) => {
      const xx = x(index);
      const open = number(bar.open), close = number(bar.close), high = number(bar.high), low = number(bar.low);
      const isUp = close >= open;
      const tone = isUp ? "is-up" : "is-down";
      const color = isUp ? "#ff5872" : "#21c79a";
      const bodyTop = Math.min(y(open), y(close));
      const bodyHeight = Math.max(1.5, Math.abs(y(open) - y(close)));
      const volumeHeight = Math.max(1, (number(bar.volumeLots) / volumeMax) * 50);
      return `<line class="kline-wick ${tone}" x1="${xx}" y1="${y(high)}" x2="${xx}" y2="${y(low)}" stroke="${color}" stroke-width="1.2"/><rect class="kline-candle ${tone}" x="${xx - bodyWidth / 2}" y="${bodyTop}" width="${bodyWidth}" height="${bodyHeight}" rx="1" fill="${color}"/><rect class="kline-volume ${tone}" x="${xx - bodyWidth / 2}" y="${volumeBottom - volumeHeight}" width="${bodyWidth}" height="${volumeHeight}" rx="1" fill="${color}" opacity=".6"/>`;
    }).join("");
    const line = (period, color) => {
      const points = movingAverage(bars, period).map((value, index) => value ? `${x(index).toFixed(1)},${y(value).toFixed(1)}` : "").filter(Boolean).join(" ");
      return points ? `<polyline class="kline-ma-${period}" points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` : "";
    };
    const labelIndexes = [0, Math.floor((bars.length - 1) / 2), bars.length - 1].filter((value, index, array) => array.indexOf(value) === index);
    const labels = labelIndexes.map((index) => `<text x="${x(index)}" y="${height - 4}" text-anchor="middle" class="axis">${shortDate(bars[index].date)}</text>`).join("");
    return `<svg class="terminal-display-v2-kline-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="正式日 K 線與成交量">${grid}<line x1="${left}" y1="${volumeTop - 8}" x2="${width - right}" y2="${volumeTop - 8}" class="divider"/>${candles}${line(5, "#f4c656")}${line(10, "#4aa7ff")}${line(20, "#b18ae3")}${labels}</svg>`;
  }
  function panelHtml(code) {
    const range = [60, 120, 240].includes(ranges.get(code)) ? ranges.get(code) : 120;
    const payload = cache.get(code);
    const controls = [60, 120, 240].map((value) => `<button type="button" class="terminal-display-v2-kline-range ${range === value ? "active" : ""}" data-terminal-display-v2-kline-range="${value}" aria-pressed="${range === value ? "true" : "false"}">${value} 日</button>`).join("");
    if (!payload) return `<header class="terminal-display-v2-kline-head"><div><span>日 K</span><strong>正式 OHLCV 載入中</strong></div><div class="terminal-display-v2-kline-controls">${controls}</div></header><div class="terminal-display-v2-kline-empty">讀取 ${escapeHtml(code)} 正式日 OHLCV...</div>`;
    if (payload.ok !== true) return `<header class="terminal-display-v2-kline-head"><div><span>日 K</span><strong>正式 OHLCV 無法顯示</strong></div><div class="terminal-display-v2-kline-controls">${controls}</div></header><div class="terminal-display-v2-kline-empty">${escapeHtml(payload.error || "日 K 正式來源暫時無資料")}</div>`;
    const bars = (Array.isArray(payload.bars) ? payload.bars : []).slice(-range);
    const last = bars[bars.length - 1] || {};
    const previous = bars[bars.length - 2] || last;
    const change = number(last.close) - number(previous.close);
    const pct = number(previous.close) ? (change / number(previous.close)) * 100 : 0;
    return `<header class="terminal-display-v2-kline-head"><div><span>日 K</span><strong>${shortDate(last.date)}　開 ${price(last.open)}　高 ${price(last.high)}　低 ${price(last.low)}　收 <b class="${change >= 0 ? "is-up" : "is-down"}">${price(last.close)}</b></strong><small>${escapeHtml(payload.source || "supabase:daily-kline")}｜${bars.length} 根｜${change >= 0 ? "+" : ""}${pct.toFixed(2)}%</small></div><div class="terminal-display-v2-kline-controls">${controls}</div></header><div class="terminal-display-v2-kline-legend"><span class="ma5">MA5</span><span class="ma10">MA10</span><span class="ma20">MA20</span><span>下方為成交量（張）</span></div>${svg(bars)}`;
  }
  async function fetchKline(code) {
    if (!code || cache.has(code)) return cache.get(code) || null;
    try {
      const response = await fetch(`/api/daily-kline?code=${encodeURIComponent(code)}&limit=260&display_v2=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      const next = response.ok && payload?.ok === true ? payload : { ok: false, error: payload?.error || `daily_kline_http_${response.status}` };
      cache.set(code, next);
      return next;
    } catch {
      const failure = { ok: false, error: "daily_kline_network_error" };
      cache.set(code, failure);
      return failure;
    }
  }
  function markCards() {
    document.querySelectorAll(".terminal-display-v2-card").forEach((card) => {
      const code = codeOf(card.querySelector("strong")?.textContent || card.textContent);
      if (code) card.dataset.terminalDisplayV2KlineCode = code;
    });
  }
  async function openCard(card) {
    const code = codeOf(card?.dataset?.terminalDisplayV2KlineCode || card?.textContent);
    if (!code) return;
    installStyle();
    markCards();
    document.querySelectorAll(".terminal-display-v2-card.is-kline-open").forEach((item) => { if (item !== card) item.classList.remove("is-kline-open"); });
    document.querySelectorAll(".terminal-display-v2-kline-panel").forEach((item) => { if (item.previousElementSibling !== card) item.hidden = true; });
    let panel = card.nextElementSibling?.classList?.contains("terminal-display-v2-kline-panel") ? card.nextElementSibling : null;
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "terminal-display-v2-kline-panel";
      card.insertAdjacentElement("afterend", panel);
    }
    card.classList.add("is-kline-open");
    panel.hidden = false;
    panel.dataset.terminalDisplayV2KlineCode = code;
    panel.innerHTML = panelHtml(code);
    await fetchKline(code);
    panel.innerHTML = panelHtml(code);
  }
  document.addEventListener("click", (event) => {
    const range = event.target?.closest?.("[data-terminal-display-v2-kline-range]");
    if (range) {
      event.preventDefault();
      const panel = range.closest(".terminal-display-v2-kline-panel");
      const code = codeOf(panel?.dataset?.terminalDisplayV2KlineCode);
      const value = Number(range.dataset.terminalDisplayV2KlineRange);
      if (code && [60, 120, 240].includes(value)) {
        ranges.set(code, value);
        panel.innerHTML = panelHtml(code);
      }
      return;
    }
    const card = event.target?.closest?.(".terminal-display-v2-card[data-terminal-display-v2-kline-code]");
    if (card) {
      event.preventDefault();
      openCard(card).catch(() => {});
    }
  }, true);
  const observer = new MutationObserver(markCards);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  installStyle();
  markCards();
  window.FUMAN_TERMINAL_DISPLAY_V2_KLINE = { openCard, markCards, version: window.__fumanTerminalDisplayV2Kline };
})();



