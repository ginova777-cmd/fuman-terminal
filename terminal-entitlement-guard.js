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
      .fuman-entitlement-preview{min-height:calc(100vh - 120px);padding:28px;background:#eef9fb;background-image:linear-gradient(rgba(9,74,85,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(9,74,85,.055) 1px,transparent 1px);background-size:48px 48px;color:#10202a}
      .fuman-entitlement-hero{display:grid;grid-template-columns:minmax(260px,1.1fr) repeat(3,minmax(180px,.7fr));gap:12px;margin-bottom:22px}
      .fuman-entitlement-panel,.fuman-entitlement-stat,.fuman-entitlement-side,.fuman-entitlement-main,.fuman-entitlement-lock-card{border:1px solid #cfe2eb;border-radius:10px;background:rgba(255,255,255,.92);box-shadow:0 10px 30px rgba(42,74,92,.08)}
      .fuman-entitlement-panel{padding:26px 20px}.fuman-entitlement-kicker{display:inline-flex;align-items:center;border:1px solid #f2b99a;border-radius:999px;padding:6px 10px;color:#b84d24;background:#fff7f1;font-weight:800;font-size:12px}.fuman-entitlement-panel h1{margin:12px 0 0;font-size:36px;letter-spacing:0}.fuman-entitlement-stat{padding:16px}.fuman-entitlement-stat span{display:block;color:#475569;font-size:12px;font-weight:800}.fuman-entitlement-stat strong{display:block;margin-top:8px;font-size:23px}.fuman-entitlement-stat small{display:block;margin-top:5px;color:#64748b}
      .fuman-entitlement-body{display:grid;grid-template-columns:380px minmax(0,1fr);gap:18px}.fuman-entitlement-side{padding:16px}.fuman-entitlement-side-row{display:flex;align-items:center;gap:14px}.fuman-entitlement-side-icon{display:grid;place-items:center;width:46px;height:46px;border:1px solid #f2c1cd;border-radius:12px;background:#fff0f3;color:#a33b53;font-weight:900}.fuman-entitlement-side b{display:block;font-size:16px}.fuman-entitlement-side small{display:block;color:#64748b;margin-top:4px}.fuman-entitlement-count{margin-left:auto;border:1px solid #cfe2eb;border-radius:999px;background:#f5fbff;padding:8px 14px;font-weight:900}
      .fuman-entitlement-main{overflow:hidden}.fuman-entitlement-main-head{display:flex;align-items:center;gap:10px;padding:22px 28px;border-bottom:1px solid #d7e7ef;background:#fffdf5}.fuman-entitlement-main-head h2{margin:0;font-size:24px}.fuman-entitlement-badge{border-radius:999px;background:#fff1ec;color:#c2410c;padding:3px 8px;font-size:12px;font-weight:900}.fuman-entitlement-main-head .fuman-entitlement-count{margin-left:auto}
      .fuman-entitlement-lock-card{margin:16px;padding:28px}.fuman-entitlement-lock-card h3{margin:14px 0 12px;font-size:28px;letter-spacing:0}.fuman-entitlement-lock-card p{margin:0;color:#64748b;line-height:1.75}.fuman-entitlement-lock-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:20px 0}.fuman-entitlement-lock-grid div{border:1px solid #d5e3ec;border-radius:8px;background:#f8fafc;padding:14px}.fuman-entitlement-lock-grid span{display:block;color:#475569;font-size:12px;font-weight:900}.fuman-entitlement-lock-grid strong{display:block;margin-top:10px;font-size:22px}.fuman-entitlement-pills{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 20px}.fuman-entitlement-pills span{border:1px solid #f6b99c;border-radius:999px;background:#fff7ed;color:#006772;padding:7px 11px;font-weight:900}.fuman-entitlement-empty{width:min(360px,100%);border:1px solid #d4e4ec;border-radius:8px;background:#f8fafc;padding:18px;margin-bottom:18px}.fuman-entitlement-empty strong{display:block;font-size:24px;margin-top:8px}.fuman-entitlement-actions{display:flex;flex-wrap:wrap;gap:10px}.fuman-entitlement-actions button,.fuman-entitlement-actions a{border:1px solid #f2b596;border-radius:10px;padding:12px 16px;color:#006772;background:#fff5ed;font-weight:900;text-decoration:none;cursor:pointer}.fuman-entitlement-actions .primary{background:#fff5ed;color:#006772;border-color:#f2b596}.fuman-entitlement-actions button:hover,.fuman-entitlement-actions a:hover{background:#ffe9db}
      [data-entitlement-lock="required"]::after{content:" 權限";margin-left:6px;color:#ff9b45;font-size:11px;font-weight:800}
      @media (max-width:900px){.fuman-entitlement-preview{padding:16px}.fuman-entitlement-hero,.fuman-entitlement-body{grid-template-columns:1fr}.fuman-entitlement-lock-grid{grid-template-columns:1fr}.fuman-entitlement-panel h1{font-size:30px}}
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

  function lockedTitle(viewName, targetLabel) {
    if (viewName === "strategy") return "策略中心";
    if (viewName === "realtime-radar") return "即時雷達";
    if (viewName === "chip-trade") return "買賣超";
    if (viewName === "cb-detect") return "CB可轉債";
    if (viewName === "warrant-flow") return "權證走向";
    return targetLabel || "會員功能";
  }

  function activateLockedView(viewName, activeLink) {
    const targetView = PROTECTED_VIEWS.has(viewName) ? viewName : "strategy";
    const panel = document.querySelector(`#${targetView}-view`);
    if (!panel) return null;
    document.querySelectorAll(".view-panel").forEach((item) => {
      const active = item === panel;
      item.hidden = !active;
      item.classList.toggle("active", active);
      item.setAttribute("aria-hidden", active ? "false" : "true");
    });
    document.querySelectorAll("[data-view]").forEach((item) => {
      const active = item === activeLink || (item.dataset.view === targetView && !activeLink);
      item.classList.toggle("active", active);
      item.setAttribute("aria-current", active ? "page" : "false");
    });
    return panel;
  }

  function lockedPreviewMarkup(viewName, targetLabel) {
    const title = escapeHtml(lockedTitle(viewName, targetLabel));
    const feature = escapeHtml(targetLabel || title);
    const isStrategy = viewName === "strategy";
    const sideTitle = isStrategy ? "動能分數 75+" : title;
    const sideSmall = isStrategy ? "核心動能" : "會員限定模組";
    const lockTitle = isStrategy ? "解鎖完整策略名單" : `解鎖完整${title}內容`;
    const lockText = isStrategy
      ? `「${feature}」目前有 0 檔候選。未開通時只保留策略熱度與輪廓，完整股票代號、名稱、價格、籌碼特徵與排序名單會在開通後顯示。`
      : `${feature} 的即時名單與完整欄位需要登入會員並開通權限；運算與資料更新會照常執行，訪客只看到鎖定預覽。`;
    return `
      <section class="fuman-entitlement-preview" data-membership-required="1" data-entitlement-preview="${escapeHtml(viewName)}" aria-label="會員鎖定預覽">
        <div class="fuman-entitlement-hero">
          <section class="fuman-entitlement-panel">
            <span class="fuman-entitlement-kicker">策略控制台</span>
            <h1>${title}</h1>
          </section>
          <section class="fuman-entitlement-stat"><span>資料日</span><strong>07/09</strong><small>2,779 檔股票</small></section>
          <section class="fuman-entitlement-stat"><span>策略數</span><strong>11</strong><small>日線 / 籌碼 / 短線</small></section>
          <section class="fuman-entitlement-stat"><span>目前結果</span><strong>0</strong><small>--</small></section>
        </div>
        <div class="fuman-entitlement-body">
          <aside class="fuman-entitlement-side">
            <div class="fuman-entitlement-side-row">
              <span class="fuman-entitlement-side-icon">⌁</span>
              <span><small>目前策略</small><b>${escapeHtml(sideTitle)}</b><small>${escapeHtml(sideSmall)}</small></span>
              <span class="fuman-entitlement-count">0 檔</span>
            </div>
          </aside>
          <section class="fuman-entitlement-main">
            <header class="fuman-entitlement-main-head">
              <h2>${escapeHtml(sideTitle)}</h2>
              <span class="fuman-entitlement-badge">核心功能</span>
              <span class="fuman-entitlement-count">0 檔</span>
            </header>
            <article class="fuman-entitlement-lock-card" role="dialog" aria-modal="false" aria-label="會員權限尚未開通">
              <span class="fuman-entitlement-kicker">進階策略預覽</span>
              <h3>${escapeHtml(lockTitle)}</h3>
              <p>${escapeHtml(lockText)}</p>
              <div class="fuman-entitlement-lock-grid">
                <div><span>候選數</span><strong>0</strong></div>
                <div><span>更新時間</span><strong>--</strong></div>
                <div><span>狀態</span><strong>預覽</strong></div>
              </div>
              <div class="fuman-entitlement-pills">
                <span>0 檔候選</span><span>${escapeHtml(sideTitle)}</span><span>等待更新</span><span>完整名單已鎖定</span>
              </div>
              <div class="fuman-entitlement-empty"><span>--</span><strong>今日尚無候選</strong><small>等待策略更新</small></div>
              <div class="fuman-entitlement-actions">
                <button class="primary" type="button" data-entitlement-action="member">登入已開通帳號</button>
                <button type="button" data-entitlement-action="member">聯絡開通權限</button>
                <button type="button" data-entitlement-action="market">回市場總覽</button>
              </div>
            </article>
          </section>
        </div>
      </section>
    `;
  }

  function showLocked(targetLabel, viewName = "strategy", activeLink = null) {
    ensureStyles();
    document.querySelector("#fuman-entitlement-locked-overlay")?.remove();
    const normalizedView = PROTECTED_VIEWS.has(viewName) ? viewName : (activeLink?.dataset?.view || "strategy");
    const panel = activateLockedView(normalizedView, activeLink);
    if (!panel) return;
    panel.innerHTML = lockedPreviewMarkup(normalizedView, targetLabel);
    panel.querySelectorAll("[data-entitlement-action]").forEach((node) => {
      node.addEventListener("click", (event) => {
        event.preventDefault();
        const action = event.currentTarget?.dataset?.entitlementAction;
        if (action === "market") openMarket();
        else openMemberCenter();
      });
    });
  }
  function blockEvent(event, link) {
    if (isEntitled()) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    showLocked(textOf(link) || "付費功能", link?.dataset?.view || "strategy", link);
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
        showLocked(textOf(activeLink) || viewName || "付費功能", viewName, activeLink);
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
