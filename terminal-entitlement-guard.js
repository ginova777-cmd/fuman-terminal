(function () {
  "use strict";

  const VERSION = "membership-entitlement-guard-20260713-11";
  const AUTH_CACHE_KEY = "fuman-terminal-auth-cache-v1";
  const LAST_ROUTE_KEY = "fuman-terminal-last-route-v1";
  const ALLOWED_STATUSES = new Set(["active", "approved", "admin", "paid", "pro", "premium"]);
  const UNLOCKED_MEMBERSHIP_CONTENT = new Set(["verified", "token_unlocked"]);
  const PUBLIC_VIEWS = new Set(["market", "member"]);
  const PROTECTED_VIEWS = new Set(["strategy", "chip-trade", "cb-detect", "warrant-flow", "realtime-radar"]);
  const PROTECTED_LABELS = ["策略1", "策略2", "策略3", "策略4", "策略5", "買賣超", "CB可轉債", "CB", "權證走向", "權證", "回測研究"];

  function parseJson(value) {
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function readStoredSupabaseToken() {
    const readToken = (value) => {
      const parsed = parseJson(value);
      const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token;
      if (!token) return null;
      return {
        token: String(token).trim(),
        expiresAt: Number(parsed?.expires_at || parsed?.currentSession?.expires_at || parsed?.session?.expires_at || 0),
      };
    };
    const exact = readToken(localStorage.getItem("sb-jxnqyqnigsppqsxinlrq-auth-token"));
    if (exact?.token) return exact;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || "";
      if (!/^sb-.*-auth-token$/i.test(key)) continue;
      const value = readToken(localStorage.getItem(key));
      if (value?.token) return value;
    }
    return { token: "", expiresAt: 0 };
  }

  function readRuntimeUnlockState() {
    const body = document.body;
    const memberState = document.querySelector("#member-state");
    const status = String(memberState?.dataset?.status || memberState?.dataset?.memberStatus || "").toLowerCase();
    const bodyAccess = body?.dataset?.membershipAccess === "allowed";
    const bodyToken = body?.dataset?.membershipToken === "present";
    const bodyContent = String(body?.dataset?.membershipContent || "").toLowerCase();
    const contentVerified = UNLOCKED_MEMBERSHIP_CONTENT.has(bodyContent);
    const authReady = body?.classList?.contains("auth-ready") && !body.classList.contains("auth-locked");
    const logoutReady = document.querySelector(".sidebar-foot .logout")?.dataset?.authAction === "logout";
    const memberReady = ALLOWED_STATUSES.has(status) || bodyAccess || contentVerified;
    const sessionReady = bodyToken || authReady || logoutReady;
    return {
      status,
      bodyAccess,
      bodyToken,
      bodyContent,
      contentVerified,
      authReady,
      logoutReady,
      entitled: Boolean(memberReady && sessionReady),
    };
  }
  function readAccess() {
    const cached = parseJson(localStorage.getItem(AUTH_CACHE_KEY));
    const access = cached?.access || cached?.profile || cached?.user || cached || {};
    const status = String(access.status || access.memberStatus || access.planStatus || "").toLowerCase();
    const plan = String(access.plan || access.planCode || access.tier || "").toLowerCase();
    const permissions = access.permissions || access.features || {};
    const token = String(cached?.accessToken || cached?.session?.access_token || "").trim();
    const storedToken = readStoredSupabaseToken();
    const expiresAt = Number(cached?.expiresAt || cached?.session?.expires_at || storedToken.expiresAt || 0);
    const sessionToken = token || storedToken.token;
    const hasValidSession = Boolean(sessionToken) && (!expiresAt || expiresAt * 1000 >= Date.now() - 30000);
    const explicitTerminal =
      permissions.strategyTerminal === true ||
      permissions.premiumTerminal === true ||
      permissions.scorecard === true ||
      access.strategyTerminal === true ||
      access.premiumTerminal === true;
    const entitledByPlan =
      explicitTerminal ||
      ALLOWED_STATUSES.has(status) ||
      ALLOWED_STATUSES.has(plan) ||
      (access.allowed === true && ALLOWED_STATUSES.has(status));
    const runtime = readRuntimeUnlockState();
    const entitled = (hasValidSession && entitledByPlan) || runtime.entitled;
    return { cached, access, status, plan, hasValidSession, entitledByPlan, entitled, runtime };
  }

  function isEntitled() {
    return readAccess().entitled === true;
  }

  function membershipStatusModel() {
    const access = readAccess();
    const rawStatus = access.status || access.plan || "";
    const email = String(access.cached?.email || access.access?.email || "").trim();
    if (access.entitled) {
      return {
        status: rawStatus || "active",
        label: "會員：已開通",
        action: "登出",
        actionMode: "logout",
        detail: email ? `已開通策略權限｜${email}` : "已開通策略權限",
      };
    }
    return {
      status: access.hasValidSession ? "pending" : "guest",
      label: "會員：尚未開通",
      action: "登入",
      actionMode: "login",
      detail: access.hasValidSession ? "已登入，但策略權限尚未開通。" : "尚未開通策略權限，請登入或註冊。",
    };
  }

  function syncMemberStatusBadge() {
    const memberState = document.querySelector("#member-state");
    const model = membershipStatusModel();
    if (memberState) {
      memberState.textContent = model.label;
      memberState.dataset.status = model.status;
      memberState.dataset.memberStatus = model.status;
      memberState.title = model.detail;
      memberState.setAttribute("aria-label", `${model.label}，${model.detail}`);
    }
    const authButton = document.querySelector(".sidebar-foot .logout");
    if (authButton) {
      authButton.textContent = model.action;
      authButton.dataset.authAction = model.actionMode;
      authButton.title = model.actionMode === "logout" ? "登出目前帳號" : "登入或註冊會員";
      authButton.setAttribute("aria-label", authButton.title);
    }
    const authMessage = document.querySelector("#auth-message");
    if (authMessage && !isEntitled()) {
      authMessage.textContent = model.status === "pending"
        ? "已登入但尚未開通策略權限；策略內容會先以會員罩顯示。"
        : "請登入或註冊，開通後即可查看策略1-5、籌碼、CB 與權證。";
    }
    return model;
  }

  function clearAuthStorage() {
    try {
      localStorage.removeItem(AUTH_CACHE_KEY);
      Object.keys(localStorage || {}).forEach((key) => {
        if (/^sb-.*-auth-token$/i.test(key)) localStorage.removeItem(key);
      });
    } catch {}
  }

  function openLoginPage() {
    const authUrl = new URL("/auth.html", location.origin);
    authUrl.searchParams.set("mode", "login");
    authUrl.searchParams.set("next", "/?desktop=1");
    location.href = authUrl.toString();
  }

  function handleMemberAuthAction(event) {
    const button = event.target?.closest?.(".sidebar-foot .logout");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const model = syncMemberStatusBadge();
    if (model.actionMode === "logout") {
      clearAuthStorage();
      syncMemberStatusBadge();
      location.href = "/?desktop=1&membership=logged-out";
      return;
    }
    openLoginPage();
  }

  function installMemberStatusSync() {
    const sync = () => syncMemberStatusBadge();
    document.addEventListener("click", handleMemberAuthAction, true);
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("fuman:membership-status-refresh", sync);
    window.setInterval(sync, 15000);
  }

  function textOf(node) {
    return String(node?.textContent || node?.getAttribute?.("aria-label") || node?.getAttribute?.("title") || "").trim();
  }

  function isLearningPlanUrl(url) {
    return Boolean(url && /\/88(?:\.html)?$/i.test(url.pathname) && url.hash === "#learning-plan");
  }

  function isScorecardUrl(url) {
    return false;
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
    const directToken = String(access.cached?.accessToken || access.cached?.session?.access_token || "").trim();
    const supabaseToken = (() => {
      const exact = parseJson(localStorage.getItem("sb-jxnqyqnigsppqsxinlrq-auth-token"));
      const direct = exact?.access_token || exact?.currentSession?.access_token || exact?.session?.access_token;
      if (direct) return { token: String(direct).trim(), expiresAt: Number(exact?.expires_at || exact?.currentSession?.expires_at || exact?.session?.expires_at || 0) };
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
        const value = parseJson(localStorage.getItem(key));
        const nested = value?.access_token || value?.currentSession?.access_token || value?.session?.access_token;
        if (nested) return { token: String(nested).trim(), expiresAt: Number(value?.expires_at || value?.currentSession?.expires_at || value?.session?.expires_at || 0) };
      }
      return { token: "", expiresAt: 0 };
    })();
    const token = directToken || supabaseToken.token;
    const expiresAt = Number(access.cached?.expiresAt || supabaseToken.expiresAt || 0);
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
      .view-panel.fuman-entitlement-panel-locked{position:relative;min-height:calc(100vh - 120px);background:#eef9fb!important}
      .view-panel.fuman-entitlement-panel-locked > :not(.fuman-entitlement-preview){filter:blur(2px);opacity:.08;pointer-events:none;user-select:none}
      .fuman-entitlement-preview{position:relative;z-index:20;min-height:calc(100vh - 120px);padding:20px 22px 36px;background:#eef9fb;background-image:linear-gradient(rgba(9,74,85,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(9,74,85,.06) 1px,transparent 1px);background-size:48px 48px;color:#10202a;font-family:inherit}
      .fuman-entitlement-hero{display:grid;grid-template-columns:minmax(320px,1.2fr) repeat(3,minmax(180px,.78fr));gap:12px;margin-bottom:18px}
      .fuman-entitlement-panel,.fuman-entitlement-stat,.fuman-entitlement-side,.fuman-entitlement-main,.fuman-entitlement-lock-card,.fuman-entitlement-mini-card{border:1px solid #cfe2eb;border-radius:8px;background:rgba(255,255,255,.94);box-shadow:0 12px 32px rgba(42,74,92,.08)}
      .fuman-entitlement-panel{padding:24px 20px;min-height:110px}.fuman-entitlement-kicker{display:inline-flex;align-items:center;width:max-content;border:1px solid #f2b99a;border-radius:999px;padding:6px 10px;color:#b84d24;background:#fff7f1;font-weight:900;font-size:12px}.fuman-entitlement-panel h1{margin:14px 0 6px;font-size:34px;letter-spacing:0;color:#10202a}.fuman-entitlement-panel p{margin:0;color:#64748b;line-height:1.6}.fuman-entitlement-stat{padding:16px 16px 14px}.fuman-entitlement-stat span{display:block;color:#475569;font-size:12px;font-weight:900}.fuman-entitlement-stat strong{display:block;margin-top:8px;font-size:23px;color:#111827}.fuman-entitlement-stat small{display:block;margin-top:5px;color:#64748b}
      .fuman-entitlement-body{display:grid;grid-template-columns:284px minmax(0,1fr);gap:16px}.fuman-entitlement-side{padding:18px;min-height:500px}.fuman-entitlement-side-row{display:flex;align-items:center;gap:13px}.fuman-entitlement-side-icon{display:grid;place-items:center;width:46px;height:46px;border:1px solid #f2c1cd;border-radius:12px;background:#fff0f3;color:#a33b53;font-weight:900}.fuman-entitlement-side b{display:block;font-size:16px;color:#10202a}.fuman-entitlement-side small{display:block;color:#64748b;margin-top:4px}.fuman-entitlement-count{margin-left:auto;border:1px solid #cfe2eb;border-radius:999px;background:#f5fbff;padding:8px 14px;font-weight:900;color:#10202a}.fuman-entitlement-lock-list{display:grid;gap:10px;margin-top:24px}.fuman-entitlement-lock-list div{border:1px solid #d7e7ef;border-radius:8px;background:#fbfdff;padding:12px}.fuman-entitlement-lock-list span{display:block;color:#006772;font-size:12px;font-weight:900}.fuman-entitlement-lock-list strong{display:block;margin-top:5px;color:#10202a}.fuman-entitlement-lock-list small{display:block;margin-top:4px;color:#64748b}
      .fuman-entitlement-main{overflow:hidden}.fuman-entitlement-main-head{display:flex;align-items:center;gap:10px;padding:20px 22px;border-bottom:1px solid #d7e7ef;background:#fffdf5}.fuman-entitlement-main-head h2{margin:0;font-size:23px;color:#10202a}.fuman-entitlement-badge{border-radius:999px;background:#fff1ec;color:#c2410c;padding:4px 8px;font-size:12px;font-weight:900}.fuman-entitlement-main-head .fuman-entitlement-count{margin-left:auto}.fuman-entitlement-lock-card{margin:14px;padding:22px}.fuman-entitlement-lock-card h3{margin:14px 0 12px;font-size:28px;letter-spacing:0;color:#10202a}.fuman-entitlement-lock-card p{margin:0;color:#64748b;line-height:1.75}.fuman-entitlement-lock-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}.fuman-entitlement-lock-grid div{border:1px solid #d5e3ec;border-radius:8px;background:#f8fafc;padding:14px}.fuman-entitlement-lock-grid span{display:block;color:#475569;font-size:12px;font-weight:900}.fuman-entitlement-lock-grid strong{display:block;margin-top:10px;font-size:22px;color:#111827}.fuman-entitlement-feature-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}.fuman-entitlement-mini-card span{display:inline-flex;border:1px solid #f6b99c;border-radius:999px;background:#fff7ed;color:#006772;padding:5px 9px;font-size:12px;font-weight:900}.fuman-entitlement-mini-card{padding:14px;box-shadow:none}.fuman-entitlement-mini-card b{display:block;margin-top:10px;color:#10202a}.fuman-entitlement-mini-card small{display:block;margin-top:6px;color:#64748b;line-height:1.45}.fuman-entitlement-pills{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 18px}.fuman-entitlement-pills span{border:1px solid #f6b99c;border-radius:999px;background:#fff7ed;color:#006772;padding:7px 11px;font-weight:900}.fuman-entitlement-empty{width:min(360px,100%);border:1px solid #d4e4ec;border-radius:8px;background:#f8fafc;padding:18px;margin-bottom:18px}.fuman-entitlement-empty strong{display:block;font-size:24px;margin-top:8px;color:#10202a}.fuman-entitlement-empty small{display:block;color:#64748b;margin-top:5px}.fuman-entitlement-actions{display:flex;flex-wrap:wrap;gap:10px}.fuman-entitlement-actions button,.fuman-entitlement-actions a{border:1px solid #f2b596;border-radius:8px;padding:12px 16px;color:#006772;background:#fff5ed;font-weight:900;text-decoration:none;cursor:pointer}.fuman-entitlement-actions .primary{background:#006772;color:#fff;border-color:#006772}.fuman-entitlement-actions button:hover,.fuman-entitlement-actions a:hover{background:#ffe9db}.fuman-entitlement-actions .primary:hover{background:#00515d}
      [data-entitlement-lock="required"]::after{content:" 權限";margin-left:6px;color:#ff9b45;font-size:11px;font-weight:800}
      @media (max-width:1100px){.fuman-entitlement-hero{grid-template-columns:1fr 1fr}.fuman-entitlement-body{grid-template-columns:1fr}.fuman-entitlement-side{min-height:auto}.fuman-entitlement-feature-grid{grid-template-columns:1fr}}
      @media (max-width:720px){.fuman-entitlement-preview{padding:14px}.fuman-entitlement-hero,.fuman-entitlement-lock-grid{grid-template-columns:1fr}.fuman-entitlement-panel h1{font-size:28px}.fuman-entitlement-lock-card h3{font-size:24px}}
    `;
    document.head.appendChild(style);
  }
  function escapeHtml(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function openMarket() {
    clearLockedPreview();
    const marketLink = document.querySelector('[data-view="market"]');
    if (marketLink) marketLink.click();
    else if (location.pathname !== "/") location.href = "/?desktop=1";
  }

  function openMemberCenter(mode = "login") {
    const authUrl = new URL("/auth.html", location.origin);
    authUrl.searchParams.set("mode", mode === "signup" ? "signup" : "login");
    authUrl.searchParams.set("next", location.pathname + location.search + location.hash || "/?desktop=1");
    location.href = authUrl.toString();
  }

  function formatTradeDateLabel(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 8) return `${digits.slice(4, 6)}/${digits.slice(6, 8)}`;
    if (/^\d{1,2}\/\d{1,2}$/.test(raw)) return raw.padStart(5, "0");
    return "";
  }

  function taipeiTodayLabel() {
    return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" }).format(new Date());
  }

  function updateLockedPreviewCalendar(panel) {
    const preview = panel?.querySelector?.(".fuman-entitlement-preview");
    if (!preview) return;
    const dateLabel = preview.querySelector("[data-entitlement-date-label]");
    const dateMeta = preview.querySelector("[data-entitlement-date-meta]");
    const marketMeta = preview.querySelector("[data-entitlement-market-meta]");
    const fallback = taipeiTodayLabel();
    if (dateLabel && (!dateLabel.textContent || dateLabel.textContent === "--")) dateLabel.textContent = fallback;
    const apply = (payload) => {
      const tradeDate = payload?.displayTradeDate || payload?.marketDate || payload?.requestedDate || payload?.taipeiDate || "";
      const label = formatTradeDateLabel(tradeDate) || fallback;
      if (dateLabel) dateLabel.textContent = label;
      if (dateMeta) dateMeta.textContent = payload?.marketOpen === true ? "開市日 / 會員預覽" : "交易日 / 會員預覽";
      if (marketMeta) marketMeta.textContent = payload?.marketOpen === true ? `${label} 開市恢復，資料持續更新` : "會員預覽不覆蓋正式交易日";
      preview.dataset.tradeDate = String(tradeDate || "");
      preview.dataset.marketOpen = payload?.marketOpen === true ? "true" : "false";
    };
    apply({ taipeiDate: fallback });
    fetch(`/api/market-calendar?t=${Date.now()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (payload) apply(payload); })
      .catch(() => {});
  }
  function lockedTitle(viewName, targetLabel) {
    if (viewName === "strategy") return "策略中心";
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

  function forceActivePanel(panel) {
    if (!panel) return;
    document.querySelectorAll(".view-panel").forEach((item) => {
      const active = item === panel;
      item.hidden = !active;
      item.classList.toggle("active", active);
      item.setAttribute("aria-hidden", active ? "false" : "true");
    });
  }
  function lockedPreviewMarkup(viewName, targetLabel) {
    const title = escapeHtml(lockedTitle(viewName, targetLabel));
    const feature = escapeHtml(targetLabel || title);
    const isStrategy = viewName === "strategy";
    const sideTitle = isStrategy ? "動能分數 75+" : title;
    const sideSmall = isStrategy ? "核心動能模型" : "會員限定模組";
    const lockTitle = isStrategy ? "解鎖完整策略名單" : `解鎖完整${title}內容`;
    const lockText = isStrategy
      ? `「${feature}」已納入輔滿策略權限。訪客只看得到策略熱度、候選數與狀態輪廓；股票代號、名稱、價格、籌碼特徵、排序理由會在註冊並開通後顯示。`
      : `${feature} 的即時名單、完整欄位與排序理由需要登入會員並開通權限；運算與資料更新會照常執行，訪客只看到鎖定預覽。`;
    return `
      <section class="fuman-entitlement-preview fuman-entitlement-preview-v2" data-membership-required="1" data-entitlement-preview="${escapeHtml(viewName)}" aria-label="輔滿會員權限預覽">
        <div class="fuman-entitlement-hero">
          <section class="fuman-entitlement-panel">
            <span class="fuman-entitlement-kicker">FUMAN MEMBER PREVIEW</span>
            <h1>輔滿策略權限</h1>
            <p>公開訪客保留策略輪廓，完整名單、排序理由與即時欄位由會員權限解鎖。</p>
          </section>
          <section class="fuman-entitlement-stat"><span>資料日</span><strong data-entitlement-date-label>${taipeiTodayLabel()}</strong><small data-entitlement-date-meta>交易日確認中</small></section>
          <section class="fuman-entitlement-stat"><span>策略模組</span><strong>11</strong><small>日線 / 籌碼 / 短線</small></section>
          <section class="fuman-entitlement-stat"><span>目前結果</span><strong>0</strong><small data-entitlement-market-meta>訪客預覽</small></section>
        </div>
        <div class="fuman-entitlement-body">
          <aside class="fuman-entitlement-side" aria-label="目前鎖定模組">
            <div class="fuman-entitlement-side-row">
              <span class="fuman-entitlement-side-icon">↘</span>
              <span><small>目前策略</small><b>${escapeHtml(sideTitle)}</b><small>${escapeHtml(sideSmall)}</small></span>
              <span class="fuman-entitlement-count">0 檔</span>
            </div>
            <div class="fuman-entitlement-lock-list">
              <div><span>01 / 名單</span><strong>股票清單鎖定</strong><small>代號、名稱、價格與排名開通後顯示。</small></div>
              <div><span>02 / 訊號</span><strong>策略理由鎖定</strong><small>條件命中、籌碼與技術欄位不對訪客曝光。</small></div>
              <div><span>03 / 更新</span><strong>即時節奏保留</strong><small>系統照常運算，畫面只顯示預覽狀態。</small></div>
            </div>
          </aside>
          <section class="fuman-entitlement-main">
            <header class="fuman-entitlement-main-head">
              <h2>${escapeHtml(feature)}</h2>
              <span class="fuman-entitlement-badge">權限鎖定</span>
              <span class="fuman-entitlement-count">0 檔</span>
            </header>
            <article class="fuman-entitlement-lock-card" role="dialog" aria-modal="false" aria-label="會員權限尚未開通">
              <span class="fuman-entitlement-kicker">輔滿會員罩</span>
              <h3>${escapeHtml(lockTitle)}</h3>
              <p>${escapeHtml(lockText)}</p>
              <div class="fuman-entitlement-lock-grid">
                <div><span>候選數</span><strong>0</strong></div>
                <div><span>更新時間</span><strong>--</strong></div>
                <div><span>狀態</span><strong>預覽</strong></div>
              </div>
              <div class="fuman-entitlement-feature-grid">
                <div class="fuman-entitlement-mini-card"><span>會員欄位</span><b>完整股票資訊</b><small>股票代號、名稱、價格、排序與策略分數。</small></div>
                <div class="fuman-entitlement-mini-card"><span>策略證據</span><b>命中條件細節</b><small>籌碼、技術與量價條件只對開通帳號顯示。</small></div>
                <div class="fuman-entitlement-mini-card"><span>操作入口</span><b>註冊後解鎖</b><small>登入已開通帳號或註冊後聯絡開通權限。</small></div>
              </div>
              <div class="fuman-entitlement-pills">
                <span>0 檔候選</span><span>${escapeHtml(sideTitle)}</span><span>等待更新</span><span>完整名單已鎖定</span>
              </div>
              <div class="fuman-entitlement-empty"><span>--</span><strong>今日尚無候選</strong><small>等待策略更新</small></div>
              <div class="fuman-entitlement-actions">
                <button class="primary" type="button" data-entitlement-action="signup">註冊 / 開通權限</button>
                <button type="button" data-entitlement-action="login">登入已開通帳號</button>
                <button type="button" data-entitlement-action="market">回市場總覽</button>
              </div>
            </article>
          </section>
        </div>
      </section>
    `;
  }
  function clearLockedPreview() {
    document.querySelector("#fuman-entitlement-locked-overlay")?.remove();
    document.querySelectorAll(".fuman-entitlement-preview").forEach((node) => node.remove());
    document.querySelectorAll(".fuman-entitlement-panel-locked").forEach((panel) => {
      panel.classList.remove("fuman-entitlement-panel-locked");
      delete panel.dataset.entitlementLocked;
      delete panel.dataset.entitlementView;
      delete panel.dataset.entitlementLabel;
    });
  }

  function bindLockedPreviewActions(panel) {
    panel.querySelectorAll("[data-entitlement-action]").forEach((node) => {
      if (node.dataset.entitlementBound === "1") return;
      node.dataset.entitlementBound = "1";
      node.addEventListener("click", (event) => {
        event.preventDefault();
        const action = event.currentTarget?.dataset?.entitlementAction;
        if (action === "market") openMarket();
        else openMemberCenter(action === "signup" ? "signup" : "login");
      });
    });
  }

  function renderLockedPreview(panel, viewName, targetLabel) {
    if (isEntitled()) {
      clearLockedPreview();
      return;
    }
    panel.querySelector(".fuman-entitlement-preview")?.remove();
    panel.classList.add("fuman-entitlement-panel-locked");
    panel.dataset.entitlementLocked = "1";
    panel.dataset.entitlementView = viewName;
    panel.dataset.entitlementLabel = targetLabel || "";
    panel.insertAdjacentHTML("afterbegin", lockedPreviewMarkup(viewName, targetLabel));
    bindLockedPreviewActions(panel);
    installLockedPreviewObserver(panel);
  }

  function reassertLockedPreview(panel, viewName, targetLabel) {
    const apply = () => {
      if (isEntitled() || !panel || !document.documentElement.contains(panel)) return;
      forceActivePanel(panel);
      if (panel.dataset.entitlementLocked === "1" && panel.querySelector(".fuman-entitlement-preview")) return;
      renderLockedPreview(panel, viewName || panel.dataset.entitlementView || "strategy", targetLabel || panel.dataset.entitlementLabel || "付費功能");
    };
    requestAnimationFrame(apply);
    setTimeout(apply, 80);
    setTimeout(apply, 220);
  }
  function installLockedPreviewObserver(panel) {
    if (panel.__fumanEntitlementObserver) return;
    panel.__fumanEntitlementObserver = new MutationObserver(() => {
      if (isEntitled()) {
        clearLockedPreview();
        return;
      }
      if (panel.dataset.entitlementLocked !== "1" || panel.querySelector(".fuman-entitlement-preview")) return;
      renderLockedPreview(panel, panel.dataset.entitlementView || "strategy", panel.dataset.entitlementLabel || "付費功能");
    });
    panel.__fumanEntitlementObserver.observe(panel, { childList: true });
  }

  function showLocked(targetLabel, viewName = "strategy", activeLink = null) {
    if (isEntitled()) {
      clearLockedPreview();
      return;
    }
    ensureStyles();
    clearLockedPreview();
    const normalizedView = PROTECTED_VIEWS.has(viewName) ? viewName : (activeLink?.dataset?.view || "strategy");
    const panel = activateLockedView(normalizedView, activeLink);
    if (!panel) return;
    renderLockedPreview(panel, normalizedView, targetLabel);
    forceActivePanel(panel);
    requestAnimationFrame(() => forceActivePanel(panel));
    setTimeout(() => forceActivePanel(panel), 180);
    reassertLockedPreview(panel, normalizedView, targetLabel);
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
      if (isEntitled()) {
        clearLockedPreview();
        return typeof previous === "function" ? previous.call(this, viewName, activeLink) : false;
      }
      if (isProtectedView(viewName, activeLink)) {
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
    syncMemberStatusBadge();
  }

  function installScorecardLock() {
    // /88 is a public scorecard surface. Membership guard only protects terminal strategy data.
  }

  function reconcileEntitlementState() {
    syncMemberStatusBadge();
    if (isEntitled()) clearLockedPreview();
  }

  function installEntitlementStateDetector() {
    const reconcile = () => reconcileEntitlementState();
    window.addEventListener("fuman:membership-content-verified", reconcile);
    window.addEventListener("fuman:membership-status-refresh", reconcile);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    window.addEventListener("storage", reconcile);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reconcile, { once: true });
    else requestAnimationFrame(reconcile);
    window.setInterval(reconcile, 5000);
  }

  sanitizeSavedRoute();
  installProtectedApiBearer();
  installRouteHook();
  installInteractionGuard();
  installScorecardLock();
  installMemberStatusSync();
  installEntitlementStateDetector();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markProtectedNav, { once: true });
  else markProtectedNav();

  window.FUMAN_ENTITLEMENT_GUARD = {
    VERSION,
    publicViews: Array.from(PUBLIC_VIEWS),
    protectedViews: Array.from(PROTECTED_VIEWS),
    isEntitled,
    readAccess,
    membershipStatusModel,
    syncMemberStatusBadge,
    clearLockedPreview,
    reconcileEntitlementState,
    handleMemberAuthAction,
    isProtectedLink,
    isProtectedView,
    showLocked
  };
})();
