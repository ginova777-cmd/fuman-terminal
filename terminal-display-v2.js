(() => {
  if (window.__fumanTerminalDisplayV2) return;
  window.__fumanTerminalDisplayV2 = true;

  const VERSION = "terminal-display-v2-20260823-05";
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
      .terminal-display-v2-metrics { display: grid; grid-template-columns: repeat(2, minmax(62px, 1fr)); gap: 7px; min-width: 150px; }
      .terminal-display-v2-metrics div { border: 1px solid rgba(120,145,185,.18); border-radius: 6px; background: rgba(7,14,25,.5); padding: 7px 9px; }
      .terminal-display-v2-metrics small { display: block; color: #7f91aa; font-size: 11px; font-weight: 800; }
      .terminal-display-v2-metrics b { display: block; margin-top: 3px; color: #f8fbff; font-size: 15px; }
      @media (max-width: 760px) { .terminal-display-v2-api-head, .terminal-display-v2-card { grid-template-columns: 1fr; display: grid; } .terminal-display-v2-card { gap: 9px; } .terminal-display-v2-metrics { min-width: 0; } }
      body.fuman-light-theme .terminal-display-v2-state, body.fuman-light-theme .terminal-display-v2-api-head, body.fuman-light-theme .terminal-display-v2-card { background: #f7fbff; border-color: #d6e4ef; color: #24384f; }
      body.fuman-light-theme .terminal-display-v2-state h2, body.fuman-light-theme .terminal-display-v2-api-head h3, body.fuman-light-theme .terminal-display-v2-main strong { color: #19314a; }
      body.fuman-light-theme .terminal-display-v2-state p, body.fuman-light-theme .terminal-display-v2-api-head p, body.fuman-light-theme .terminal-display-v2-main p { color: #62788f; }
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
      return `<article class="terminal-display-v2-card" data-terminal-display-v2-row="1"><div class="terminal-display-v2-rank">#${index + 1}</div><div class="terminal-display-v2-main"><strong>${escapeHtml(code)} ${escapeHtml(name)}</strong><p>${escapeHtml(reason)}</p></div><div class="terminal-display-v2-metrics"><div><small>分數</small><b>${escapeHtml(score)}</b></div><div><small>價格</small><b>${escapeHtml(price)}</b></div></div></article>`;
    }).join("");
    target.innerHTML = `<section class="terminal-display-v2-api-shell" data-terminal-display-v2-api="${escapeHtml(source)}"><header class="terminal-display-v2-api-head"><div><span class="terminal-display-v2-badge">FMN://terminal-display-v2.api</span><h3>${escapeHtml(route.label)}正式資料</h3><p>資料日 ${escapeHtml(date)} | Run ${escapeHtml(runId)} | ${escapeHtml(String(rows.length))} 檔</p></div><strong class="terminal-display-v2-count">${escapeHtml(String(rows.length))} 檔</strong></header><section class="terminal-display-v2-list" aria-label="${escapeHtml(route.label)}正式資料">${cards || `<div class="terminal-display-v2-state"><div class="kicker">FMN://terminal-display-v2.empty</div><h2>${escapeHtml(route.label)}目前沒有清單</h2><p>API 已回應，但這個時間點沒有可顯示股票。</p><div class="actions"><button type="button" data-terminal-display-v2-retry>重新讀取</button><button class="secondary" type="button" data-terminal-display-v2-market>回市場總覽</button></div></div>`}</section></section>`;
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
