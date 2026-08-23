(() => {
  if (window.__fumanTerminalDisplayV2) return;
  window.__fumanTerminalDisplayV2 = true;

  const VERSION = "terminal-display-v2-20260823-01";
  const LAST_ROUTE_KEY = window.FUMAN_RUNTIME_CONFIG?.lastRouteKey || "fuman-terminal-last-route-v1";
  const ROUTES = {
    market: { view: "market", panel: "market-view", label: "市場總覽", protected: false },
    strategy2: { view: "strategy", panel: "strategy-view", route: "intraday_2m", label: "當沖雷達", protected: true, api: "/api/strategy2-latest" },
    strategy3: { view: "strategy", panel: "strategy-view", route: "strategy3", label: "隔日沖", protected: true, api: "/api/strategy3-latest" },
    strategy4: { view: "strategy", panel: "strategy-view", route: "swing_radar", label: "波段", protected: true, api: "/api/strategy4-latest" },
    strategy5: { view: "strategy", panel: "strategy-view", route: "strategy5", label: "綜合策略", protected: true, api: "/api/strategy5-latest" },
    institution: { view: "chip-trade", panel: "chip-trade-view", label: "買賣超", protected: true, api: "/api/institution-latest" },
    watchlist: { view: "watchlist", panel: "watchlist-view", label: "自選股", protected: false },
    member: { view: "member", panel: "member-view", label: "會員", protected: false },
  };

  let lastRenderedKey = "";
  let watchdogTimer = null;

  function text(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
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

  function hasLocalBearerToken() {
    try {
      const keys = [window.FUMAN_RUNTIME_CONFIG?.authCacheKey || "fuman-terminal-auth-cache-v1", "fuman-terminal-auth-cache-v1"];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        if (/^sb-.+-auth-token$/.test(key)) keys.push(key);
      }
      return keys.some((key) => /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(String(localStorage.getItem(key) || "")));
    } catch {
      return false;
    }
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
      localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify({
        viewName: route.view,
        strategyRoute: route.route || "",
        at: Date.now(),
        source: VERSION,
      }));
    } catch {}
  }

  function installStyles() {
    if (document.getElementById("terminal-display-v2-style")) return;
    const style = document.createElement("style");
    style.id = "terminal-display-v2-style";
    style.textContent = `
      .terminal-display-v2-state { min-height: 360px; display: grid; align-content: center; gap: 14px; padding: 28px; border: 1px solid rgba(120,145,185,.26); border-radius: 8px; background: rgba(13,22,36,.82); color: #d8e6f8; }
      .terminal-display-v2-state .kicker { color: #75d4ff; font-size: 12px; font-weight: 900; letter-spacing: 0; }
      .terminal-display-v2-state h2 { margin: 0; color: #f4f8ff; font-size: 24px; line-height: 1.25; letter-spacing: 0; }
      .terminal-display-v2-state p { margin: 0; max-width: 760px; color: #91a6c2; font-size: 14px; line-height: 1.7; }
      .terminal-display-v2-state .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
      .terminal-display-v2-state button { min-height: 34px; border: 1px solid rgba(117,212,255,.42); border-radius: 6px; background: #102135; color: #dff6ff; font-weight: 900; cursor: pointer; }
      .terminal-display-v2-state .secondary { border-color: rgba(145,166,194,.34); color: #b8c8dc; }
      body.fuman-light-theme .terminal-display-v2-state { background: #f7fbff; border-color: #d6e4ef; color: #24384f; }
      body.fuman-light-theme .terminal-display-v2-state h2 { color: #19314a; }
      body.fuman-light-theme .terminal-display-v2-state p { color: #62788f; }
    `;
    document.head.appendChild(style);
  }

  function stateHtml(route, state) {
    const isLocked = state === "locked";
    const title = isLocked ? `${route.label}需要會員權限` : `${route.label}顯示層已接管`;
    const body = isLocked
      ? "目前沒有可用的登入權杖或會員權限，所以終端不再停在載入狀態，改顯示明確的鎖定畫面。登入後重新點選左側分頁即可讀取正式策略資料。"
      : "正式資料仍在重新同步。這個畫面代表切頁已成功，若資料源稍慢，請按重新讀取。";
    return `
      <section class="terminal-display-v2-state" data-terminal-display-v2-state="${state}">
        <div class="kicker">FMN://terminal-display-v2</div>
        <h2>${title}</h2>
        <p>${body}</p>
        <div class="actions">
          <button type="button" data-terminal-display-v2-retry>重新讀取</button>
          <button class="secondary" type="button" data-terminal-display-v2-market>回市場總覽</button>
        </div>
      </section>
    `;
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
    const target = panel.querySelector("#strategy-table") || panel.querySelector(".strategy-results") || panel;
    target.innerHTML = stateHtml(route, state);
    return true;
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
        renderState(routeKey, membershipAllowed() ? "empty" : "locked");
      }
    }, 4500);
  }

  function activate(routeKey, options = {}) {
    const route = ROUTES[routeKey];
    if (!route) return false;
    window.__fumanTerminalDisplayV2State = { routeKey, route, at: Date.now(), version: VERSION };
    if (route.protected && !membershipAllowed()) {
      return renderState(routeKey, "locked");
    }
    setActivePanel(route);
    setActiveNav(routeKey);
    persistRoute(route);
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
      const key = lastRenderedKey || "market";
      if (membershipAllowed()) {
        location.reload();
      } else {
        activate(key);
      }
    }
  }

  document.addEventListener("click", onClick, true);
  document.addEventListener("click", onAction, true);
  window.FUMAN_TERMINAL_DISPLAY_V2 = { activate, renderState, routeFromLink, version: VERSION };
})();
