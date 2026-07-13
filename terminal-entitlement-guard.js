(function () {
  "use strict";

  const VERSION = "membership-entitlement-guard-20260711-03";
  const AUTH_CACHE_KEY = "fuman-terminal-auth-cache-v1";
  const LAST_ROUTE_KEY = "fuman-terminal-last-route-v1";
  const ALLOWED_STATUSES = new Set(["active", "approved", "admin", "paid", "pro", "premium"]);
  const PUBLIC_VIEWS = new Set(["market", "member"]);
  const PROTECTED_VIEWS = new Set(["strategy", "chip-trade", "cb-detect", "warrant-flow", "realtime-radar"]);
  const PROTECTED_LABELS = ["策略1", "策略2", "策略3", "策略4", "策略5", "即時雷達", "買賣超", "CB可轉債", "CB", "權證走向", "權證", "回測研究", "輔滿成績單"];

  function parseJson(value) {
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function readAccess() {
    const cached = parseJson(localStorage.getItem(AUTH_CACHE_KEY));
    const access = cached?.access || cached?.profile || cached?.user || cached || {};
    const status = String(access.status || access.memberStatus || access.planStatus || "").toLowerCase();
    const plan = String(access.plan || access.planCode || access.tier || "").toLowerCase();
    const permissions = access.permissions || access.features || {};
    const explicitTerminal =
      permissions.strategyTerminal === true ||
      permissions.premiumTerminal === true ||
      permissions.scorecard === true ||
      access.strategyTerminal === true ||
      access.premiumTerminal === true;
    const entitled =
      explicitTerminal ||
      ALLOWED_STATUSES.has(status) ||
      ALLOWED_STATUSES.has(plan) ||
      (access.allowed === true && ALLOWED_STATUSES.has(status));
    return { cached, access, status, plan, entitled };
  }

  function isEntitled() {
    return readAccess().entitled === true;
  }

  function textOf(node) {
    return String(node?.textContent || node?.getAttribute?.("aria-label") || node?.getAttribute?.("title") || "").trim();
  }

  function isLearningPlanUrl(url) {
    return Boolean(url && /\/88(?:\.html)?$/i.test(url.pathname) && url.hash === "#learning-plan");
  }

  function isScorecardUrl(url) {
    return Boolean(url && /\/88(?:\.html)?$/i.test(url.pathname) && !isLearningPlanUrl(url));
  }

  function isProtectedHref(href) {
    if (!href || href === "#") return false;
    try {
      return isScorecardUrl(new URL(href, location.href));
    } catch {
      return false;
    }
  }

  function isProtectedLink(link) {
    if (!link) return false;
    const view = link.dataset?.view || "";
    if (PUBLIC_VIEWS.has(view)) return false;
    if (PROTECTED_VIEWS.has(view)) return true;
    if (isProtectedHref(link.getAttribute("href"))) return true;
    const label = textOf(link);
    return PROTECTED_LABELS.some((item) => label.includes(item)) && !label.includes("學習方案");
  }

  function isProtectedView(viewName, link) {
    if (PUBLIC_VIEWS.has(viewName)) return false;
    if (PROTECTED_VIEWS.has(viewName)) return true;
    return isProtectedLink(link);
  }

  function isProtectedApiUrl(url) {
    if (!url || url.origin !== location.origin) return false;
    return /^\/api\/(open-buy-latest|strategy2-latest|strategy3-latest|strategy4-latest|strategy5-latest|institution-latest|cb-detect-latest|warrant-flow-latest|scorecard|source-reports|terminal-fast-bundle|mobile-boot|mobile-fragment)(?:$|[/?#])/i.test(url.pathname);
  }

  function readAccessToken() {
    const access = readAccess();
    const token = String(access.cached?.accessToken || access.cached?.session?.access_token || "").trim();
    const expiresAt = Number(access.cached?.expiresAt || 0);
    if (!token) return "";
    if (expiresAt && expiresAt * 1000 < Date.now() - 30000) return "";
    return token;
  }

  function installProtectedApiBearer() {
    const originalFetch = window.fetch?.bind(window);
    if (!originalFetch || originalFetch.__fumanEntitlementBearer) return;
    function entitlementFetch(input, init) {
      const raw = typeof input === "string" ? input : input?.url || "";
      let url = null;
      try {
        url = new URL(raw, location.href);
      } catch {}
      if (!url || !isProtectedApiUrl(url)) return originalFetch(input, init);
      const token = readAccessToken();
      if (!token) return originalFetch(input, init);
      const nextInit = { ...(init || {}) };
      const headers = new Headers(nextInit.headers || (typeof input !== "string" ? input.headers : undefined) || {});
      if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
      headers.set("x-fuman-member-session", "1");
      nextInit.headers = headers;
      return originalFetch(input, nextInit);
    }
    entitlementFetch.__fumanEntitlementBearer = true;
    window.fetch = entitlementFetch;
  }

  function ensureStyles() {
    if (document.querySelector("#fuman-entitlement-guard-style")) return;
    const style = document.createElement("style");
    style.id = "fuman-entitlement-guard-style";
    style.textContent = `
      .fuman-entitlement-locked-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(3,7,18,.72);backdrop-filter:blur(10px)}
      .fuman-entitlement-card{width:min(560px,100%);border:1px solid rgba(255,154,69,.55);border-radius:14px;background:linear-gradient(145deg,rgba(15,23,42,.98),rgba(30,41,59,.96));color:#f8fafc;box-shadow:0 26px 72px rgba(0,0,0,.42);padding:24px}
      body[data-theme="sun"] .fuman-entitlement-card,body.sun .fuman-entitlement-card{background:linear-gradient(145deg,#fff,#f8fafc);color:#172033}
      .fuman-entitlement-card h2{margin:0 0 10px;font-size:24px;letter-spacing:0}
      .fuman-entitlement-card p{margin:0 0 16px;color:#94a3b8;line-height:1.65}
      body[data-theme="sun"] .fuman-entitlement-card p,body.sun .fuman-entitlement-card p{color:#475569}
      .fuman-entitlement-actions{display:flex;flex-wrap:wrap;gap:10px}
      .fuman-entitlement-actions button,.fuman-entitlement-actions a{border:1px solid rgba(255,154,69,.5);border-radius:10px;padding:10px 14px;color:inherit;background:rgba(255,154,69,.12);font-weight:800;text-decoration:none;cursor:pointer}
      .fuman-entitlement-actions .primary{background:#ff9b45;color:#111827;border-color:#ff9b45}
      [data-entitlement-lock="required"]::after{content:" 權限";margin-left:6px;color:#ff9b45;font-size:11px;font-weight:800}
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function openMarket() {
    const marketLink = document.querySelector('[data-view="market"]');
    if (marketLink) marketLink.click();
    else if (location.pathname !== "/") location.href = "/?desktop=1";
  }

  function openMemberCenter() {
    location.href = `/auth.html?next=${encodeURIComponent(location.pathname + location.search + location.hash || "/?desktop=1")}`;
  }

  function showLocked(targetLabel) {
    ensureStyles();
    document.querySelector("#fuman-entitlement-locked-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "fuman-entitlement-locked-overlay";
    overlay.className = "fuman-entitlement-locked-overlay";
    overlay.innerHTML = `
      <section class="fuman-entitlement-card" role="dialog" aria-modal="true" aria-label="會員權限尚未開通">
        <h2>會員權限尚未開通</h2>
        <p>${escapeHtml(targetLabel || "此功能")} 需要登入會員並開通權限。公開區目前保留市場總覽、AI 判讀與學習方案。</p>
        <div class="fuman-entitlement-actions">
          <button class="primary" type="button" data-entitlement-action="member">登入 / 開通權限</button>
          <button type="button" data-entitlement-action="market">回市場總覽</button>
          <button type="button" data-entitlement-action="learning" aria-disabled="true" title="學習方案建置中，暫不開放連結">學習方案建置中</button>
          <button type="button" data-entitlement-action="close">關閉</button>
        </div>
      </section>
    `;
    overlay.addEventListener("click", (event) => {
      const action = event.target?.dataset?.entitlementAction;
      if (!action && event.target !== overlay) return;
      if (action === "member") {
        overlay.remove();
        openMemberCenter();
      } else if (action === "market") {
        overlay.remove();
        openMarket();
      } else if (action === "close" || event.target === overlay) {
        overlay.remove();
      }
    });
    document.body.appendChild(overlay);
  }

  function blockEvent(event, link) {
    if (isEntitled()) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    showLocked(textOf(link) || "付費功能");
    return true;
  }

  function installInteractionGuard() {
    const handler = (event) => {
      const link = event.target?.closest?.("a,button,[data-view]");
      if (!link || !document.documentElement.contains(link) || !isProtectedLink(link)) return;
      blockEvent(event, link);
    };
    document.addEventListener("pointerdown", handler, true);
    document.addEventListener("click", handler, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const link = event.target?.closest?.("a,button,[data-view]");
      if (link && isProtectedLink(link)) blockEvent(event, link);
    }, true);
  }

  function sanitizeSavedRoute() {
    if (isEntitled()) return;
    const saved = localStorage.getItem(LAST_ROUTE_KEY) || "";
    let locked = /^(strategy|chip-trade|cb-detect|warrant-flow|realtime-radar)\|/.test(saved);
    if (!locked) {
      const route = parseJson(saved);
      locked = isProtectedView(String(route?.viewName || route?.view || ""));
    }
    if (locked) {
      localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify({ viewName: "market", strategyRoute: "", at: Date.now() }));
    }
  }

  function installRouteHook() {
    const state = window.FUMAN_DESKTOP_ROUTE_STATE || {};
    const previous = state.shouldBlockView;
    state.shouldBlockView = function shouldBlockView(viewName, activeLink) {
      if (!isEntitled() && isProtectedView(viewName, activeLink)) {
        showLocked(textOf(activeLink) || viewName || "付費功能");
        return true;
      }
      return typeof previous === "function" ? previous.call(this, viewName, activeLink) : false;
    };
    window.FUMAN_DESKTOP_ROUTE_STATE = state;
  }

  function markProtectedNav() {
    document.querySelectorAll("a,button,[data-view]").forEach((node) => {
      if (!isProtectedLink(node)) return;
      node.dataset.entitlementLock = "required";
      node.setAttribute("aria-label", `${textOf(node)}，需要會員權限`);
    });
    const memberState = document.querySelector("#member-state");
    if (memberState && !isEntitled()) memberState.textContent = "會員權限：未開通";
    const authMessage = document.querySelector("#auth-message");
    if (authMessage && !isEntitled()) authMessage.textContent = "請登入或註冊，開通後即可查看策略1-5、籌碼、CB、權證與成績單。";
  }

  function installScorecardLock() {
    const current = new URL(location.href);
    if (!isScorecardUrl(current) || isEntitled()) return;
    const originalFetch = window.fetch?.bind(window);
    if (originalFetch) {
      window.fetch = function entitlementFetch(input, init) {
        const raw = typeof input === "string" ? input : input?.url || "";
        let url = null;
        try {
          url = new URL(raw, location.href);
        } catch {}
        if (url && /^\/api\/(scorecard|source-reports)/i.test(url.pathname)) {
          return Promise.resolve(new Response(JSON.stringify({ ok: false, status: 403, reason: "membership_required" }), {
            status: 403,
            headers: { "content-type": "application/json; charset=utf-8" }
          }));
        }
        return originalFetch(input, init);
      };
    }
    const renderLock = () => {
      ensureStyles();
      document.body.dataset.entitlementScorecardLocked = "true";
      const main = document.querySelector("main");
      if (!main) return;
      main.innerHTML = `
        <section class="top" data-testid="scorecard-locked">
          <div>
            <div class="badge">FUMAN SCORECARD</div>
            <h1>輔滿成績單</h1>
            <p>成績單需要登入會員並開通權限。公開區保留市場總覽、AI 判讀與學習方案。</p>
          </div>
        </section>
        <section class="fuman-entitlement-card" style="margin:24px auto;width:min(720px,100%);">
          <h2>會員權限尚未開通</h2>
          <p>/88 成績單屬於付費驗收與回測研究內容；未開通前不讀 scorecard API，也不顯示策略成績。</p>
          <div class="fuman-entitlement-actions">
            <a class="primary" href="/auth.html?next=%2F88">登入 / 開通權限</a>
            <a href="/?desktop=1">回市場總覽</a>
            <span aria-disabled="true" title="學習方案建置中，暫不開放連結">學習方案建置中</span>
          </div>
        </section>
      `;
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderLock, { once: true });
    else renderLock();
  }

  sanitizeSavedRoute();
  installProtectedApiBearer();
  installRouteHook();
  installInteractionGuard();
  installScorecardLock();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markProtectedNav, { once: true });
  else markProtectedNav();

  window.FUMAN_ENTITLEMENT_GUARD = {
    VERSION,
    publicViews: Array.from(PUBLIC_VIEWS),
    protectedViews: Array.from(PROTECTED_VIEWS),
    isEntitled,
    readAccess,
    isProtectedLink,
    isProtectedView,
    showLocked
  };
})();
